import { eq } from "drizzle-orm";
import { getMeetingsAfter } from "./fathom-client.js";
import type { FathomMeeting } from "./fathom-client.js";
import { processDealData } from "./deal-processor.js";
import { matchDeal } from "./deal-matcher.js";
import { notifyDealReview } from "./slack-notifier.js";
import { db, schema } from "../../db/index.js";
import { routeTranscript, shouldProcess, shouldSkip, type RoutingDecision } from "./router.js";
import { rebuildIndex } from "./hubspot-index.js";
import { normalizeCompany } from "./company-matcher.js";

const PULL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const PROCESS_DELAY_MS = 15_000; // 15 seconds between Claude calls

let lastPullTime: string | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

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
 * Pull new transcripts from Fathom and store them in the DB.
 * At this stage we only store — NO routing decisions yet.
 * Routing happens in processNextPending().
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

      // Store with status "pending" — routing happens later
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
        isSalesCall: false,  // Will be set by router
        salesPerson: null,
        status: "pending",
        errorMessage: null,
        pulledAt: new Date().toISOString(),
      });

      stored++;
      console.log(`[Fathom] Stored: "${meeting.title}"`);
    }

    lastPullTime = new Date().toISOString();
    console.log(`[Fathom] Pull complete: ${stored} stored, ${skipped} already existed`);
  } catch (error) {
    console.error("[Fathom] Pull error:", error);
  }
}

/**
 * Process the next pending transcript using the DETERMINISTIC ROUTER.
 *
 * Flow:
 * 1. Pick next pending transcript
 * 2. Run deterministic router (NO Claude involved)
 * 3. If SKIP_* → mark as skipped, done
 * 4. If REVIEW_AMBIGUOUS → mark for review, done
 * 5. If PROCESS_ACTIVE or PROCESS_NEW → send to Claude for field extraction
 * 6. Claude extracts Deal Box → save to deals table → Slack notification
 */
async function processNextPending() {
  if (processing) return;

  const pending = db.select().from(schema.fathomTranscripts)
    .where(eq(schema.fathomTranscripts.status, "pending")).limit(1).get();

  if (!pending) return;
  processing = true;

  try {
    // ── STEP 1: Deterministic routing (NO Claude) ──
    const routing: RoutingDecision = routeTranscript(pending.title);
    console.log(`[Router] "${pending.title}" → ${routing.outcome}: ${routing.reason}`);

    // ── STEP 2: Handle SKIP outcomes ──
    if (shouldSkip(routing)) {
      db.update(schema.fathomTranscripts)
        .set({
          status: "skipped",
          processedAt: new Date().toISOString(),
          errorMessage: `${routing.outcome}: ${routing.reason}`,
          isSalesCall: false,
        })
        .where(eq(schema.fathomTranscripts.id, pending.id)).run();

      console.log(`[Fathom] Skipped "${pending.title}" — ${routing.outcome}`);
      processing = false;
      return;
    }

    // ── STEP 3: Handle REVIEW_AMBIGUOUS ──
    if (routing.outcome === "REVIEW_AMBIGUOUS") {
      db.update(schema.fathomTranscripts)
        .set({
          status: "skipped",
          processedAt: new Date().toISOString(),
          errorMessage: `REVIEW_AMBIGUOUS: ${routing.reason}`,
          isSalesCall: true,
        })
        .where(eq(schema.fathomTranscripts.id, pending.id)).run();

      console.log(`[Fathom] Flagged for review: "${pending.title}" — ${routing.reason}`);
      processing = false;
      return;
    }

    // ── STEP 4: PROCESS_ACTIVE or PROCESS_NEW → Claude extraction ──
    console.log(`[Fathom] Processing: "${pending.title}" (${routing.outcome})`);

    db.update(schema.fathomTranscripts)
      .set({ status: "processing", isSalesCall: true })
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

    // ── STEP 5: Post-Claude verification ──
    // Double-check the company Claude extracted against closed deals
    const allDeals = await db.select().from(schema.deals);
    const norm = normalizeCompany(dealBox.companyName);
    const companyDeals = allDeals.filter(
      (d) => normalizeCompany(d.companyName) === norm
    );
    const hasActiveDeal = companyDeals.some(
      (d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost"
    );
    const hasClosedOnly = companyDeals.length > 0 && !hasActiveDeal;

    if (hasClosedOnly) {
      db.update(schema.fathomTranscripts)
        .set({
          status: "skipped",
          processedAt: new Date().toISOString(),
          errorMessage: `SKIP_CLOSED_ONLY (post-Claude): ${dealBox.companyName}`,
        })
        .where(eq(schema.fathomTranscripts.id, pending.id)).run();

      console.log(`[Fathom] Skipped "${dealBox.companyName}" — closed (caught post-Claude)`);
      processing = false;
      return;
    }

    // ── STEP 6: Match against active deals only ──
    const activeDeals = allDeals.filter(
      (d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost"
    );
    const matchResult = matchDeal(dealBox, activeDeals);

    // ── STEP 7: Save deal to review ──
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
        routingOutcome: routing.outcome,
        routingReason: routing.reason,
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

    // Rebuild index after new deal
    rebuildIndex();

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
 * IMPORTANT: rebuildIndex() must be called BEFORE this (done in server/index.ts after HubSpot pull).
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
