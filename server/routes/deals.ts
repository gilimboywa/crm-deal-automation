import { Router } from "express";
import { eq, like, and, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { processDealData } from "../services/deal-processor.js";
import { matchDeal } from "../services/deal-matcher.js";
import { notifyDealReview } from "../services/slack-notifier.js";
import {
  createDeal as hubspotCreateDeal,
  updateDeal as hubspotUpdateDeal,
} from "../services/hubspot-client.js";
import { routeTranscript, routeEmail, shouldProcess, shouldSkip, extractDomainFromFrom } from "../services/router.js";
import { rebuildIndex } from "../services/hubspot-index.js";
import { normalizeCompany } from "../services/company-matcher.js";
import type { ProcessingInput } from "../lib/types.js";

const router = Router();

// ── GET / — List all deals with optional filters ──
router.get("/", async (req, res) => {
  try {
    const { stage, reviewStatus, search } = req.query;

    const conditions = [];

    if (stage && typeof stage === "string") {
      conditions.push(eq(schema.deals.dealStage, stage));
    }

    if (reviewStatus && typeof reviewStatus === "string") {
      conditions.push(eq(schema.deals.reviewStatus, reviewStatus));
    }

    if (search && typeof search === "string") {
      conditions.push(like(schema.deals.companyName, `%${search}%`));
    }

    const deals =
      conditions.length > 0
        ? await db
            .select()
            .from(schema.deals)
            .where(and(...conditions))
            .orderBy(schema.deals.createdAt)
        : await db
            .select()
            .from(schema.deals)
            .orderBy(schema.deals.createdAt);

    res.json({ deals });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── GET /pipeline — Deals grouped by stage ──
router.get("/pipeline", async (_req, res) => {
  try {
    const allDeals = await db.select().from(schema.deals);

    const pipeline: Record<string, typeof allDeals> = {};
    for (const deal of allDeals) {
      if (!pipeline[deal.dealStage]) {
        pipeline[deal.dealStage] = [];
      }
      pipeline[deal.dealStage].push(deal);
    }

    res.json({ pipeline });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── GET /review-queue — Deals pending review ──
router.get("/review-queue", async (_req, res) => {
  try {
    const deals = await db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.reviewStatus, "pending"))
      .orderBy(schema.deals.createdAt);

    res.json({ deals });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── GET /:id — Single deal with associated contacts ──
router.get("/:id", async (req, res) => {
  try {
    const dealId = parseInt(req.params.id, 10);
    if (isNaN(dealId)) {
      res.status(400).json({ error: "Invalid deal ID" });
      return;
    }

    const deal = await db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId))
      .limit(1);

    if (deal.length === 0) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }

    // Get associated contacts via join table
    const associatedContacts = await db
      .select({
        contact: schema.contacts,
        role: schema.dealContacts.role,
      })
      .from(schema.dealContacts)
      .innerJoin(
        schema.contacts,
        eq(schema.dealContacts.contactId, schema.contacts.id)
      )
      .where(eq(schema.dealContacts.dealId, dealId));

    res.json({
      deal: deal[0],
      contacts: associatedContacts.map((ac) => ({
        ...ac.contact,
        role: ac.role,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── POST / — Create deal manually ──
router.post("/", async (req, res) => {
  try {
    const newDeal = await db
      .insert(schema.deals)
      .values({
        ...req.body,
        createDate: req.body.createDate || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();

    res.status(201).json({ deal: newDeal[0] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── PUT /:id — Update deal fields ──
router.put("/:id", async (req, res) => {
  try {
    const dealId = parseInt(req.params.id, 10);
    if (isNaN(dealId)) {
      res.status(400).json({ error: "Invalid deal ID" });
      return;
    }

    const updated = await db
      .update(schema.deals)
      .set({
        ...req.body,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.deals.id, dealId))
      .returning();

    if (updated.length === 0) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }

    res.json({ deal: updated[0] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── POST /process — Deterministic route → Claude extract → match → save → notify ──
router.post("/process", async (req, res) => {
  try {
    const input: ProcessingInput = req.body;

    if (!input.sourceType || !input.data) {
      res.status(400).json({ error: "sourceType and data are required" });
      return;
    }

    // ── STEP 1: Deterministic routing (NO Claude) ──
    const title = input.data.title as string || input.data.subject as string || "";
    if (title) {
      const senderInfo = (input.data.senderDomain as string)
        || (input.data.from as string)
        || null;

      const routing = input.sourceType === "email"
        ? routeEmail(title, senderInfo)
        : routeTranscript(title);

      console.log(`[Router] /process "${title}" → ${routing.outcome}: ${routing.reason}`);

      if (shouldSkip(routing)) {
        res.json({
          skipped: true,
          reason: `${routing.outcome}: ${routing.reason}`,
          routingOutcome: routing.outcome,
        });
        return;
      }
    }

    // ── STEP 2: Process through Claude (only reaches here if routing passed) ──
    const { dealBox, reasoning } = await processDealData(input);

    // ── STEP 3: Post-Claude closed-deal verification ──
    const allDeals = await db.select().from(schema.deals);
    const norm = normalizeCompany(dealBox.companyName);
    const companyDeals = allDeals.filter((d) => normalizeCompany(d.companyName) === norm);
    const hasActiveDeal = companyDeals.some((d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost");
    const hasClosedDeal = companyDeals.some((d) => d.dealStage === "closed_won" || d.dealStage === "closed_lost");

    if (hasClosedDeal && !hasActiveDeal) {
      const closedMatch = companyDeals.find((d) => d.dealStage === "closed_won" || d.dealStage === "closed_lost")!;
      res.json({
        skipped: true,
        reason: `SKIP_CLOSED_ONLY (post-Claude): ${dealBox.companyName} is ${closedMatch.dealStage} (deal #${closedMatch.id}). No active deals.`,
        matchedDealId: closedMatch.id,
      });
      return;
    }

    // ── STEP 4: Match against active deals only ──
    const activeDeals = allDeals.filter(
      (d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost"
    );
    const matchResult = matchDeal(dealBox, activeDeals);

    // Step 3: Save to database
    const newDealValues = {
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
      matchedDealId: matchResult.matchedDealId || null,
      reviewStatus: "pending" as const,
      rawInputData: JSON.stringify(input),
      claudeReasoning: reasoning,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const [savedDeal] = await db
      .insert(schema.deals)
      .values(newDealValues)
      .returning();

    // Step 4: Save associated contacts
    for (const contact of dealBox.associatedContacts) {
      const [savedContact] = await db
        .insert(schema.contacts)
        .values({
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          company: contact.company,
          title: contact.title,
          associationReason: contact.associationReason,
          firstSeenDate: contact.firstSeenDate,
          createdAt: new Date().toISOString(),
        })
        .returning();

      await db.insert(schema.dealContacts).values({
        dealId: savedDeal.id,
        contactId: savedContact.id,
        role: contact.role,
      });
    }

    // Step 5: Log workflow run
    await db.insert(schema.workflowRuns).values({
      workflowType: "creation_matching",
      status: "completed",
      dealId: savedDeal.id,
      triggeredBy: input.sourceType === "manual" ? "manual" : "n8n",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      metadata: JSON.stringify({ matchResult }),
    });

    // Step 6: Notify Slack
    try {
      await notifyDealReview(savedDeal, matchResult);
    } catch (slackError) {
      console.error("Slack notification failed (non-fatal):", slackError);
    }

    res.status(201).json({
      deal: savedDeal,
      matchResult,
      reasoning,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── POST /:id/review — Review decision (go_live, review, inconclusive) ──
router.post("/:id/review", async (req, res) => {
  try {
    const dealId = parseInt(req.params.id, 10);
    if (isNaN(dealId)) {
      res.status(400).json({ error: "Invalid deal ID" });
      return;
    }

    const { decision, reviewedBy } = req.body as {
      decision: "go_live" | "review" | "inconclusive";
      reviewedBy: string;
    };

    if (!decision || !["go_live", "review", "inconclusive"].includes(decision)) {
      res.status(400).json({
        error: "decision must be one of: go_live, review, inconclusive",
      });
      return;
    }

    const [updated] = await db
      .update(schema.deals)
      .set({
        reviewStatus: decision,
        reviewedBy: reviewedBy || null,
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.deals.id, dealId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }

    // If go_live, trigger HubSpot sync
    if (decision === "go_live") {
      try {
        let hubspotDealId: string;

        if (updated.hubspotDealId) {
          await hubspotUpdateDeal(updated.hubspotDealId, updated);
          hubspotDealId = updated.hubspotDealId;
        } else {
          hubspotDealId = await hubspotCreateDeal(updated);
        }

        await db
          .update(schema.deals)
          .set({
            hubspotDealId,
            syncedToHubspot: true,
            lastSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.deals.id, dealId));
      } catch (hubspotError) {
        console.error("HubSpot sync failed during review:", hubspotError);
        // Don't fail the review just because HubSpot sync failed
      }
    }

    res.json({ deal: updated, decision });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── POST /route-test — Test the deterministic router without processing ──
router.post("/route-test", async (req, res) => {
  try {
    const { title, sourceType, senderDomain } = req.body;
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const routing = sourceType === "email"
      ? routeEmail(title, senderDomain || null)
      : routeTranscript(title);

    res.json({ routing });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── POST /rebuild-index — Rebuild the HubSpot index ──
router.post("/rebuild-index", async (_req, res) => {
  try {
    const stats = rebuildIndex();
    res.json({ success: true, ...stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
