import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import {
  createDeal as hubspotCreateDeal,
  updateDeal as hubspotUpdateDeal,
} from "../services/hubspot-client.js";
import { notifyDealSynced } from "../services/slack-notifier.js";

const router = Router();

// ── POST /webhook — Receive Slack interactive payloads ──
router.post("/webhook", async (req, res) => {
  try {
    // Slack sends interactive payloads as application/x-www-form-urlencoded
    // with a "payload" field containing JSON
    const rawPayload = req.body.payload;

    if (!rawPayload) {
      res.status(400).json({ error: "Missing payload" });
      return;
    }

    const payload =
      typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

    if (payload.type !== "block_actions") {
      res.status(200).send("OK");
      return;
    }

    const action = payload.actions?.[0];
    if (!action) {
      res.status(200).send("OK");
      return;
    }

    const actionId = action.action_id as
      | "go_live"
      | "review"
      | "inconclusive";
    const dealId = parseInt(action.value, 10);

    if (isNaN(dealId)) {
      res.status(400).json({ error: "Invalid deal ID in action value" });
      return;
    }

    const reviewedBy =
      payload.user?.username || payload.user?.name || "slack_user";

    // Map action to review status
    const reviewStatus = actionId;

    // Update deal review status
    const [updatedDeal] = await db
      .update(schema.deals)
      .set({
        reviewStatus,
        reviewedBy,
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.deals.id, dealId))
      .returning();

    if (!updatedDeal) {
      res.status(200).json({
        response_type: "ephemeral",
        text: `Deal ${dealId} not found.`,
      });
      return;
    }

    // If go_live, trigger HubSpot sync
    if (actionId === "go_live") {
      try {
        let hubspotDealId: string;

        if (updatedDeal.hubspotDealId) {
          await hubspotUpdateDeal(updatedDeal.hubspotDealId, updatedDeal);
          hubspotDealId = updatedDeal.hubspotDealId;
        } else {
          hubspotDealId = await hubspotCreateDeal(updatedDeal);
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

        // Log workflow run
        await db.insert(schema.workflowRuns).values({
          workflowType: "crm_sync",
          status: "completed",
          dealId,
          triggeredBy: "manual",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          metadata: JSON.stringify({ hubspotDealId, triggeredVia: "slack" }),
        });

        await notifyDealSynced(updatedDeal);
      } catch (hubspotError) {
        console.error(
          "HubSpot sync failed from Slack action:",
          hubspotError
        );
      }
    }

    // Respond to Slack with 200 to acknowledge the action
    res.status(200).json({
      response_type: "in_channel",
      text: `Deal "${updatedDeal.companyName}" marked as *${actionId}* by ${reviewedBy}.`,
    });
  } catch (error) {
    console.error("Slack webhook processing error:", error);
    // Always respond 200 to Slack to prevent retries
    res.status(200).json({
      response_type: "ephemeral",
      text: "An error occurred processing this action.",
    });
  }
});

export default router;
