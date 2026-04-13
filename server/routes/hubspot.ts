import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import {
  createDeal,
  updateDeal,
  createContact,
  searchContactByEmail,
  associateContactWithDeal,
  getAllDeals,
} from "../services/hubspot-client.js";
import { notifyDealSynced } from "../services/slack-notifier.js";

const router = Router();

// ── POST /sync-deal/:id — Sync a deal to HubSpot ──
router.post("/sync-deal/:id", async (req, res) => {
  try {
    const dealId = parseInt(req.params.id, 10);
    if (isNaN(dealId)) {
      res.status(400).json({ error: "Invalid deal ID" });
      return;
    }

    // Fetch the deal from DB
    const [deal] = await db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId))
      .limit(1);

    if (!deal) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }

    let hubspotDealId: string;

    // Create or update in HubSpot
    if (deal.hubspotDealId) {
      await updateDeal(deal.hubspotDealId, deal);
      hubspotDealId = deal.hubspotDealId;
    } else {
      hubspotDealId = await createDeal(deal);
    }

    // Sync associated contacts
    const dealContactRows = await db
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

    for (const { contact } of dealContactRows) {
      try {
        let hubspotContactId: string | null = null;

        // Search by email if available
        if (contact.email) {
          const existing = await searchContactByEmail(contact.email);
          if (existing) {
            hubspotContactId = existing.id;
          }
        }

        // Create contact in HubSpot if not found
        if (!hubspotContactId) {
          hubspotContactId = await createContact({
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            company: contact.company,
            title: contact.title,
          });

          // Update local record with HubSpot ID
          await db
            .update(schema.contacts)
            .set({ hubspotContactId })
            .where(eq(schema.contacts.id, contact.id));
        }

        // Associate contact with deal
        await associateContactWithDeal(hubspotDealId, hubspotContactId);
      } catch (contactError) {
        console.error(
          `Failed to sync contact ${contact.id} to HubSpot:`,
          contactError
        );
        // Continue with other contacts
      }
    }

    // Update deal record with HubSpot info
    const [updatedDeal] = await db
      .update(schema.deals)
      .set({
        hubspotDealId,
        syncedToHubspot: true,
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.deals.id, dealId))
      .returning();

    // Log workflow run
    await db.insert(schema.workflowRuns).values({
      workflowType: "crm_sync",
      status: "completed",
      dealId,
      triggeredBy: "manual",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      metadata: JSON.stringify({ hubspotDealId }),
    });

    // Notify Slack
    try {
      await notifyDealSynced(updatedDeal);
    } catch (slackError) {
      console.error("Slack notification failed (non-fatal):", slackError);
    }

    res.json({
      deal: updatedDeal,
      hubspotDealId,
      message: "Deal synced to HubSpot successfully",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// HubSpot stage ID → internal stage mapping
const HUBSPOT_STAGE_MAP: Record<string, string> = {
  "1325612618": "0",           // Prospect - Needs Analysis
  "1325612619": "1",           // Qualified
  "1325612620": "2",           // Business Case/Testing
  "1325612621": "3",           // Terms
  "1325612622": "4",           // Legal / Due Diligence
  "1325612623": "closed_won",
  "1325612624": "closed_lost",
};

// ── POST /pull-deals — Pull all deals from HubSpot into local DB ──
router.post("/pull-deals", async (_req, res) => {
  try {
    const hubspotDeals = await getAllDeals();

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const hsDeal of hubspotDeals) {
      const props = hsDeal.properties || {};
      const hubspotDealId = hsDeal.id;

      // Check if we already have this deal locally
      const [existing] = await db
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.hubspotDealId, hubspotDealId))
        .limit(1);

      const dealData = {
        hubspotDealId,
        companyName: props.dealname || "Unknown",
        amount: props.amount ? parseFloat(props.amount) : null,
        closeDate: props.closedate || null,
        pipeline: props.pipeline || "[NEW] Sales Pipeline",
        dealStage: HUBSPOT_STAGE_MAP[props.dealstage] || props.dealstage || "0",
        dealSourcePerson: null, // Not a standard HubSpot property
        primaryDealSource: props.primary_deal_source || null,
        dealSourceDetails: props.deal_source_description || null,
        dealDescription: props.description || null,
        icp: props.icp_1_or_2
          ? props.icp_1_or_2.toLowerCase().startsWith("intentional") || props.icp_1_or_2.toLowerCase().includes("bank")
            ? "ICP 1"
            : "ICP 2"
          : null,
        dealType: props.dealtype || props.deal_type_2 || null,
        createDate: props.createdate || new Date().toISOString(),
        lastContacted: props.notes_last_contacted || null,
        dealOwner: props.hubspot_owner_id || null,
        forecastProbability: props.hs_forecast_probability
          ? parseFloat(props.hs_forecast_probability)
          : null,
        numCustomerAccounts: props.number_of_customer_accounts
          ? parseInt(props.number_of_customer_accounts)
          : null,
        numStateReports: null, // Custom property - map if exists
        numDueDiligenceLetters: null,
        contractTerm: props.contract_term || null,
        disbursementPricing: props.disbursement_pricing || null,
        escheatmentPricing: props.escheatment_pricing || null,
        syncedToHubspot: true,
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (existing) {
        await db
          .update(schema.deals)
          .set(dealData)
          .where(eq(schema.deals.id, existing.id));
        updated++;
      } else {
        await db.insert(schema.deals).values({
          ...dealData,
          matchResult: "synced",
          reviewStatus: "go_live",
          createdAt: new Date().toISOString(),
        });
        created++;
      }
    }

    res.json({
      message: `Pulled ${hubspotDeals.length} deals from HubSpot`,
      total: hubspotDeals.length,
      created,
      updated,
      skipped,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
