import { eq } from "drizzle-orm";
import { getMeetingsAfter } from "./fathom-client.js";
import type { FathomMeeting } from "./fathom-client.js";
import { processDealData } from "./deal-processor.js";
import { matchDeal } from "./deal-matcher.js";
import { notifyDealReview } from "./slack-notifier.js";
import { db, schema } from "../../db/index.js";

const PULL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const PROCESS_DELAY_MS = 15_000; // 15 seconds between Claude calls (rate limit safety)

let lastPullTime: string | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

// Sales team — only their calls get processed
const SALES_NAMES = ["gil", "jerry"];

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

function isSalesCall(eisenSpeakers: Array<{ name: string; email: string }>): { is: boolean; person: string | null } {
  for (const s of eisenSpeakers) {
    for (const salesName of SALES_NAMES) {
      if (s.email.includes(salesName) || s.name.toLowerCase().includes(salesName)) {
        return { is: true, person: s.name };
      }
    }
  }
  return { is: false, person: null };
}

/**
 * Pull new transcripts from Fathom and store them in the DB.
 */
async function pullTranscripts() {
  console.log("[Fathom] Pulling new transcripts...");

  try {
    // Pull all available transcripts (no date limit on first run)
    const since = lastPullTime || "2020-01-01T00:00:00Z";
    const meetings = await getMeetingsAfter(since, 50);

    let stored = 0;
    let skipped = 0;

    for (const meeting of meetings) {
      // Check if already stored
      const existing = db
        .select()
        .from(schema.fathomTranscripts)
        .where(eq(schema.fathomTranscripts.recordingId, meeting.recording_id))
        .get();

      if (existing) {
        skipped++;
        continue;
      }

      const eisenSpeakers = getEisenSpeakers(meeting);
      const sales = isSalesCall(eisenSpeakers);

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
        isSalesCall: sales.is,
        salesPerson: sales.person,
        status: "pending",
        pulledAt: new Date().toISOString(),
      });

      stored++;
      console.log(`[Fathom] Stored: "${meeting.title}" (${sales.is ? `sales: ${sales.person}` : "ops/CS → skipped"})`);
    }

    lastPullTime = new Date().toISOString();
    console.log(`[Fathom] Pull complete: ${stored} stored, ${skipped} already existed, ${meetings.length} total`);
  } catch (error) {
    console.error("[Fathom] Pull error:", error);
  }
}

/**
 * Process the next pending transcript through Claude.
 * Called with delays to respect rate limits.
 */
async function processNextPending() {
  if (processing) return;

  const pending = db
    .select()
    .from(schema.fathomTranscripts)
    .where(eq(schema.fathomTranscripts.status, "pending"))
    .limit(1)
    .get();

  if (!pending) return;

  processing = true;

  try {
    // Pre-check: extract company name from meeting title and check if it's a closed deal
    // Title patterns: "Escheatment - Company | Eisen", "Eisen & Company | Topic", "Topic - Company | Eisen"
    const titleLower = pending.title.toLowerCase();
    const allDeals = await db.select().from(schema.deals);
    const normalize = (s: string) =>
      s.toLowerCase().trim().replace(/\s*(,?\s*(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?))\s*$/gi, "").trim();

    // Check if any closed deal company name appears in the meeting title (both directions)
    // "Coastal" in title should match "Coastal Community Bank" in DB and vice versa
    const closedMatch = allDeals.find((d) => {
      if (d.dealStage !== "closed_won" && d.dealStage !== "closed_lost") return false;
      const companyNorm = normalize(d.companyName);
      if (companyNorm.length <= 2) return false;
      // Check both directions: title contains company name OR company name contains a title segment
      if (titleLower.includes(companyNorm)) return true;
      // Extract company-like segments from title (split by | - / &)
      const segments = titleLower.split(/[|\-\/&<>]/).map(s => s.replace(/eisen/gi, "").trim()).filter(s => s.length > 2);
      return segments.some(seg => companyNorm.includes(seg) || seg.includes(companyNorm));
    });

    if (closedMatch) {
      db.update(schema.fathomTranscripts)
        .set({ status: "skipped", processedAt: new Date().toISOString(), errorMessage: `Closed deal: ${closedMatch.companyName} (${closedMatch.dealStage})` })
        .where(eq(schema.fathomTranscripts.id, pending.id))
        .run();
      console.log(`[Fathom] Skipped "${pending.title}" — ${closedMatch.companyName} is ${closedMatch.dealStage}`);
      processing = false;
      return;
    }

    console.log(`[Fathom] Processing: "${pending.title}"`);

    // Update status
    db.update(schema.fathomTranscripts)
      .set({ status: "processing" })
      .where(eq(schema.fathomTranscripts.id, pending.id))
      .run();

    const transcript = JSON.parse(pending.transcript);
    const input = {
      sourceType: "fathom" as const,
      data: {
        title: pending.title,
        created_at: pending.pulledAt,
        recording_id: pending.recordingId,
        scheduled_start_time: pending.scheduledStart,
        scheduled_end_time: pending.scheduledEnd,
        transcript,
        url: pending.meetingUrl,
      },
    };

    const { dealBox, reasoning } = await processDealData(input);

    // Match against active deals (closed already filtered by pre-check above)
    const activeDealsList = allDeals.filter(
      (d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost"
    );
    const matchResult = matchDeal(dealBox, activeDealsList);

    // Save deal
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
        salesPerson: pending.salesPerson,
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
      .where(eq(schema.fathomTranscripts.id, pending.id))
      .run();

    // Notify Slack
    try {
      await notifyDealReview(savedDeal, matchResult);
    } catch (e) {
      console.error("[Fathom] Slack notification failed:", e);
    }

    console.log(`[Fathom] Created deal #${savedDeal.id} for "${dealBox.companyName}" (match: ${matchResult.result})`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    db.update(schema.fathomTranscripts)
      .set({ status: msg.includes("rate_limit") ? "pending" : "error", errorMessage: msg })
      .where(eq(schema.fathomTranscripts.id, pending.id))
      .run();
    console.error(`[Fathom] Error processing "${pending.title}": ${msg}`);

    // If rate limited, wait longer before next attempt
    if (msg.includes("rate_limit")) {
      console.log("[Fathom] Rate limited — will retry in 2 minutes");
      processing = false;
      setTimeout(() => processNextPending(), 120_000);
      return;
    }
  }

  processing = false;
}

/**
 * Start the Fathom system: pull every 30 min, process pending every 15 sec.
 */
export function startFathomPoller() {
  const existingCount = db.select().from(schema.fathomTranscripts).all().length;
  const pendingCount = db.select().from(schema.fathomTranscripts)
    .where(eq(schema.fathomTranscripts.status, "pending")).all().length;

  console.log(`[Fathom] Started. ${existingCount} transcripts stored, ${pendingCount} pending processing.`);

  // Pull transcripts: first run after 5 sec, then every 30 min
  setTimeout(() => pullTranscripts(), 5_000);
  pullTimer = setInterval(() => pullTranscripts(), PULL_INTERVAL_MS);

  // Process queue: check every 15 sec for pending transcripts
  setInterval(() => processNextPending(), PROCESS_DELAY_MS);
}

export function stopFathomPoller() {
  if (pullTimer) { clearInterval(pullTimer); pullTimer = null; }
  console.log("[Fathom] Stopped.");
}

export async function manualPoll(): Promise<{ pulled: number; pending: number }> {
  await pullTranscripts();
  const pending = db.select().from(schema.fathomTranscripts)
    .where(eq(schema.fathomTranscripts.status, "pending")).all().length;
  return { pulled: db.select().from(schema.fathomTranscripts).all().length, pending };
}
