import { eq } from "drizzle-orm";
import { getMeetingsAfter } from "./fathom-client.js";
import type { FathomMeeting } from "./fathom-client.js";
import { processDealData } from "./deal-processor.js";
import { matchDeal } from "./deal-matcher.js";
import { notifyDealReview } from "./slack-notifier.js";
import { db, schema } from "../../db/index.js";

const PULL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const PROCESS_DELAY_MS = 15_000; // 15 seconds between Claude calls

let lastPullTime: string | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

// Internal meeting patterns — these are never deals
const INTERNAL_PATTERNS = [
  "paid ads", "sales coaching", "team meeting", "implementation weekly",
  "design team", "marketing kickoff", "engineering", "product", "standup",
  "sprint", "retro", "all hands", "1:1", "interview", "hiring", "training",
  "weekly touch base", "weekly touchbase", "biweekly check-in",
  "monthly touchpoint", "onboarding touchpoint", "winddown weekly",
  "ubo requirements", "class action", "finovate", "fathom demo",
  "gomarketmodel", "go market model", "apollo", "golden venture",
];

function getEisenSpeakers(meeting: FathomMeeting): Array<{ name: string; email: string }> {
  const speakers = new Map<string, { name: string; email: string }>();
  for (const entry of meeting.transcript || []) {
    const email = (entry.speaker.matched_calendar_invitee_email || "").toLowerCase();
    if (email.includes("witheisen") || email.includes("eisen")) {
      speakers.set(email, { name: entry.speaker.display_name, email });
    }
  }
  return [...speakers.values()];
}

/**
 * Check if a meeting title looks like an internal meeting (not a deal).
 */
function isInternalMeeting(title: string): boolean {
  const lower = title.toLowerCase();
  // Match internal patterns
  if (INTERNAL_PATTERNS.some(p => lower.includes(p))) return true;
  // Single-word titles are internal 1:1s
  if (lower.split(/[\s/\-|]/).filter(Boolean).length <= 1) return true;
  // No company indicator — not a deal meeting
  if (!lower.includes("eisen") && !lower.includes("escheatment") && !lower.includes("demo") && !lower.includes("proposal") && !lower.includes("intro")) return true;
  return false;
}

/**
 * Check company status in the database.
 * Returns: "closed" | "active" | "new"
 */
function checkCompanyStatus(title: string, allDeals: any[]): { status: "closed" | "active" | "new"; matchedDeal?: any } {
  const titleLower = title.toLowerCase();
  const normalize = (s: string) =>
    s.toLowerCase().trim().replace(/\s*(,?\s*(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?))\s*$/gi, "").trim();

  // Extract company-like segments from title
  const segments = titleLower.split(/[|/&<>]/).concat(titleLower.split(" - "))
    .map(s => s.replace(/eisen/gi, "").trim()).filter(s => s.length > 2);

  // Check each deal for a match
  let hasActive = false;
  let hasClosed = false;
  let activeDeal: any = null;
  let closedDeal: any = null;

  for (const d of allDeals) {
    const companyNorm = normalize(d.companyName);
    if (companyNorm.length <= 2) continue;

    // Check if this deal's company name appears in the title (both directions)
    const matches = titleLower.includes(companyNorm) ||
      segments.some(seg => companyNorm.includes(seg) || seg.includes(companyNorm));

    if (!matches) continue;

    if (d.dealStage === "closed_won" || d.dealStage === "closed_lost") {
      hasClosed = true;
      closedDeal = d;
    } else {
      hasActive = true;
      activeDeal = d;
    }
  }

  // Active deal takes priority over closed
  if (hasActive) return { status: "active", matchedDeal: activeDeal };
  if (hasClosed) return { status: "closed", matchedDeal: closedDeal };
  return { status: "new" };
}

/**
 * Pull new transcripts from Fathom and store them in the DB.
 */
async function pullTranscripts() {
  console.log("[Fathom] Pulling new transcripts...");

  try {
    const since = lastPullTime || "2020-01-01T00:00:00Z";
    const meetings = await getMeetingsAfter(since);

    let stored = 0;
    let skipped = 0;

    for (const meeting of meetings) {
      const existing = db.select().from(schema.fathomTranscripts)
        .where(eq(schema.fathomTranscripts.recordingId, meeting.recording_id)).get();

      if (existing) { skipped++; continue; }

      const eisenSpeakers = getEisenSpeakers(meeting);
      const internal = isInternalMeeting(meeting.title);

      await db.insert(schema.fathomTranscripts).values({
        recordingId: meeting.recording_id,
        title: meeting.title,
        meetingUrl: meeting.url,
        scheduledStart: meeting.scheduled_start_time,
        scheduledEnd: meeting.scheduled_end_time,
        recordingStart: meeting.recording_start_time,
        recordingEnd: meeting.recording_end_time,
        transcript: JSON.stringify(meeting.transcript || []),
        eisenSpeakers: JSON.stringify(eisenSpeakers),
        isSalesCall: !internal,
        salesPerson: null,
        status: internal ? "skipped" : "pending",
        errorMessage: internal ? "Internal meeting" : null,
        pulledAt: new Date().toISOString(),
      });

      stored++;
      if (internal) {
        console.log(`[Fathom] Stored & skipped (internal): "${meeting.title}"`);
      } else {
        console.log(`[Fathom] Stored: "${meeting.title}"`);
      }
    }

    lastPullTime = new Date().toISOString();
    console.log(`[Fathom] Pull complete: ${stored} stored, ${skipped} already existed`);
  } catch (error) {
    console.error("[Fathom] Pull error:", error);
  }
}

/**
 * Process the next pending transcript.
 * The logic:
 * 1. Check company against database (closed? active? new?)
 * 2. Closed (no active deal) → skip
 * 3. Active deal exists → process as UPDATE
 * 4. No deal exists → process as NEW
 */
async function processNextPending() {
  if (processing) return;

  const pending = db.select().from(schema.fathomTranscripts)
    .where(eq(schema.fathomTranscripts.status, "pending")).limit(1).get();

  if (!pending) return;
  processing = true;

  try {
    const allDeals = await db.select().from(schema.deals);
    const companyCheck = checkCompanyStatus(pending.title, allDeals);

    // CLOSED (no active deal) → skip entirely
    if (companyCheck.status === "closed") {
      db.update(schema.fathomTranscripts)
        .set({ status: "skipped", processedAt: new Date().toISOString(), errorMessage: `Closed: ${companyCheck.matchedDeal.companyName} (${companyCheck.matchedDeal.dealStage})` })
        .where(eq(schema.fathomTranscripts.id, pending.id)).run();
      console.log(`[Fathom] Skipped "${pending.title}" — ${companyCheck.matchedDeal.companyName} is ${companyCheck.matchedDeal.dealStage}`);
      processing = false;
      return;
    }

    // ACTIVE or NEW → process through Claude
    console.log(`[Fathom] Processing: "${pending.title}" (${companyCheck.status})`);

    db.update(schema.fathomTranscripts)
      .set({ status: "processing" })
      .where(eq(schema.fathomTranscripts.id, pending.id)).run();

    const transcript = JSON.parse(pending.transcript);
    const { dealBox, reasoning } = await processDealData({
      sourceType: "fathom",
      data: {
        title: pending.title,
        created_at: pending.pulledAt,
        recording_id: pending.recordingId,
        scheduled_start_time: pending.scheduledStart,
        scheduled_end_time: pending.scheduledEnd,
        transcript,
        url: pending.meetingUrl,
      },
    });

    // After Claude extracts company name, double-check against closed deals
    const normalize = (s: string) =>
      s.toLowerCase().trim().replace(/\s*(,?\s*(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?))\s*$/gi, "").trim();

    const companyDeals = allDeals.filter(d => normalize(d.companyName) === normalize(dealBox.companyName));
    const hasActiveDeal = companyDeals.some(d => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost");
    const hasClosedOnly = companyDeals.length > 0 && !hasActiveDeal;

    if (hasClosedOnly) {
      db.update(schema.fathomTranscripts)
        .set({ status: "skipped", processedAt: new Date().toISOString(), errorMessage: `Closed after Claude extract: ${dealBox.companyName}` })
        .where(eq(schema.fathomTranscripts.id, pending.id)).run();
      console.log(`[Fathom] Skipped "${dealBox.companyName}" — closed (caught after Claude)`);
      processing = false;
      return;
    }

    // Match against active deals only
    const activeDeals = allDeals.filter(d => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost");
    const matchResult = matchDeal(dealBox, activeDeals);

    // Save deal to review
    const [savedDeal] = await db.insert(schema.deals).values({
      companyName: dealBox.companyName,
      amount: dealBox.amount,
      closeDate: dealBox.closeDate,
      pipeline: dealBox.pipeline,
      dealStage: dealBox.dealStage,
      dealSourcePerson: dealBox.dealSourcePerson,
      primaryDealSource: dealBox.primaryDealSource,
      dealSourceDetails: dealBox.dealSourceDetails,
      dealDescription: dealBox.dealDescription,
      icp: dealBox.icp,
      dealType: dealBox.dealType,
      createDate: dealBox.createDate,
      lastContacted: dealBox.lastContacted,
      dealOwner: dealBox.dealOwner,
      forecastProbability: dealBox.forecastProbability,
      numCustomerAccounts: dealBox.numCustomerAccounts,
      numStateReports: dealBox.numStateReports,
      numDueDiligenceLetters: dealBox.numDueDiligenceLetters,
      contractTerm: dealBox.contractTerm,
      disbursementPricing: dealBox.disbursementPricing,
      escheatmentPricing: dealBox.escheatmentPricing,
      dollarValuePerItem: dealBox.dollarValuePerItem,
      annualPlatformFee: dealBox.annualPlatformFee,
      implementationFee: dealBox.implementationFee,
      numEscheatmentsPerYear: dealBox.numEscheatmentsPerYear,
      matchResult: matchResult.result,
      matchedDealId: matchResult.matchedDealId ?? null,
      reviewStatus: "pending",
      rawInputData: JSON.stringify({
        source: "fathom",
        title: pending.title,
        recording_id: pending.recordingId,
        url: pending.meetingUrl,
      }),
      claudeReasoning: reasoning,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    // Save contacts
    if (dealBox.associatedContacts?.length) {
      for (const contact of dealBox.associatedContacts) {
        const [savedContact] = await db.insert(schema.contacts).values({
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          company: contact.company,
          title: contact.title,
          associationReason: contact.associationReason,
          firstSeenDate: contact.firstSeenDate,
          createdAt: new Date().toISOString(),
        }).returning();

        await db.insert(schema.dealContacts).values({
          dealId: savedDeal.id,
          contactId: savedContact.id,
          role: contact.role,
        });
      }
    }

    // Update transcript status
    db.update(schema.fathomTranscripts)
      .set({ status: "processed", dealId: savedDeal.id, processedAt: new Date().toISOString() })
      .where(eq(schema.fathomTranscripts.id, pending.id)).run();

    // Notify Slack
    try {
      await notifyDealReview(savedDeal, matchResult);
    } catch (e) {
      console.error("[Fathom] Slack notification failed:", e);
    }

    console.log(`[Fathom] Created deal #${savedDeal.id} "${dealBox.companyName}" (${matchResult.result})`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    const status = msg.includes("rate_limit") ? "pending" : "error";
    db.update(schema.fathomTranscripts)
      .set({ status, errorMessage: msg })
      .where(eq(schema.fathomTranscripts.id, pending.id)).run();

    if (msg.includes("rate_limit")) {
      console.log("[Fathom] Rate limited — retry in 2 min");
      processing = false;
      setTimeout(() => processNextPending(), 120_000);
      return;
    }
    console.error(`[Fathom] Error: "${pending.title}": ${msg}`);
  }

  processing = false;
}

/**
 * Start the Fathom system.
 */
export function startFathomPoller() {
  const existingCount = db.select().from(schema.fathomTranscripts).all().length;
  const pendingCount = db.select().from(schema.fathomTranscripts)
    .where(eq(schema.fathomTranscripts.status, "pending")).all().length;

  console.log(`[Fathom] Started. ${existingCount} transcripts, ${pendingCount} pending.`);

  // Pull: first after 5 sec, then every 30 min
  setTimeout(() => pullTranscripts(), 5_000);
  pullTimer = setInterval(() => pullTranscripts(), PULL_INTERVAL_MS);

  // Process: check every 15 sec
  setInterval(() => processNextPending(), PROCESS_DELAY_MS);
}

export function stopFathomPoller() {
  if (pullTimer) { clearInterval(pullTimer); pullTimer = null; }
}

export async function manualPoll(): Promise<{ pulled: number; pending: number }> {
  await pullTranscripts();
  const pending = db.select().from(schema.fathomTranscripts)
    .where(eq(schema.fathomTranscripts.status, "pending")).all().length;
  return { pulled: db.select().from(schema.fathomTranscripts).all().length, pending };
}
