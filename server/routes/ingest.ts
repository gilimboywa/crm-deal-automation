import { Router } from "express";
import { db, schema } from "../../db/index.js";
import { processDealData } from "../services/deal-processor.js";
import { matchDeal } from "../services/deal-matcher.js";
import { notifyDealReview } from "../services/slack-notifier.js";
import type { ProcessingInput } from "../lib/types.js";

const router = Router();

// ── POST / — Ingest raw data from n8n or any external source ──
router.post("/", async (req, res) => {
  try {
    const input: ProcessingInput = req.body;

    if (!input.sourceType || !input.data) {
      res.status(400).json({
        error: "Request body must include sourceType and data",
      });
      return;
    }

    // Step 1: Process through Claude to extract DealBox
    const { dealBox, reasoning } = await processDealData(input);

    // Step 2: Skip ONLY if ALL deals for this company are closed (no active ones).
    const allDeals = await db.select().from(schema.deals);
    const normalize = (s: string) => s.toLowerCase().trim().replace(/\s*(,?\s*(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?))\s*$/gi, "").trim();
    const companyDeals = allDeals.filter((d) => normalize(d.companyName) === normalize(dealBox.companyName));
    const hasActiveDeal = companyDeals.some((d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost");
    const hasClosedDeal = companyDeals.some((d) => d.dealStage === "closed_won" || d.dealStage === "closed_lost");

    if (hasClosedDeal && !hasActiveDeal) {
      const closedMatch = companyDeals.find((d) => d.dealStage === "closed_won" || d.dealStage === "closed_lost")!;
      res.json({
        skipped: true,
        reason: `${dealBox.companyName} is a closed deal (${closedMatch.dealStage === "closed_won" ? "won" : "lost"}, deal #${closedMatch.id}). No active deals. Skipping.`,
        matchedDealId: closedMatch.id,
      });
      return;
    }

    // Step 3: Match against active deals only
    const activeDeals = allDeals.filter(
      (d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost"
    );
    const matchResult = matchDeal(dealBox, activeDeals);

    // Step 3: Save to database
    const [savedDeal] = await db
      .insert(schema.deals)
      .values({
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
        reviewStatus: "pending",
        rawInputData: JSON.stringify(input),
        claudeReasoning: reasoning,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
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
      triggeredBy: "n8n",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      metadata: JSON.stringify({ matchResult, sourceType: input.sourceType }),
    });

    // Step 6: Notify Slack (non-fatal)
    try {
      await notifyDealReview(savedDeal, matchResult);
    } catch (slackError) {
      console.error("Slack notification failed (non-fatal):", slackError);
    }

    res.status(201).json({
      deal: savedDeal,
      matchResult,
      reasoning,
      contactsCreated: dealBox.associatedContacts.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Ingest processing failed:", error);
    res.status(500).json({ error: message });
  }
});

export default router;
