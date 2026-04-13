import "./env.js";
import app from "./app.js";
import { getAllDeals } from "./services/hubspot-client.js";
import { startFathomPoller } from "./services/fathom-poller.js";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

const HUBSPOT_STAGE_MAP: Record<string, string> = {
  "1325612618": "0",
  "1325612619": "1",
  "1325612620": "2",
  "1325612621": "3",
  "1325612622": "4",
  "1325612623": "closed_won",
  "1325612624": "closed_lost",
};

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log(`CRM Deal Automation API running on http://localhost:${PORT}`);

  // Step 1: Always pull HubSpot deals FIRST so we know what's closed
  try {
    console.log("[Startup] Pulling HubSpot deals...");
    const hubspotDeals = await getAllDeals();
    let created = 0, updated = 0;

    for (const hsDeal of hubspotDeals) {
      const props = hsDeal.properties || {};
      const hubspotDealId = hsDeal.id;
      const [existing] = await db.select().from(schema.deals)
        .where(eq(schema.deals.hubspotDealId, hubspotDealId)).limit(1);

      const dealData = {
        hubspotDealId,
        companyName: props.dealname || "Unknown",
        amount: props.amount ? parseFloat(props.amount) : null,
        closeDate: props.closedate || null,
        pipeline: props.pipeline || "[NEW] Sales Pipeline",
        dealStage: HUBSPOT_STAGE_MAP[props.dealstage] || props.dealstage || "0",
        primaryDealSource: props.primary_deal_source || null,
        dealSourceDetails: props.deal_source_description || null,
        dealDescription: props.description || null,
        icp: props.icp_1_or_2
          ? props.icp_1_or_2.toLowerCase().startsWith("intentional") || props.icp_1_or_2.toLowerCase().includes("bank")
            ? "ICP 1" : "ICP 2"
          : null,
        dealType: props.dealtype || props.deal_type_2 || null,
        createDate: props.createdate || new Date().toISOString(),
        lastContacted: props.notes_last_contacted || null,
        dealOwner: props.hubspot_owner_id || null,
        forecastProbability: props.hs_forecast_probability ? parseFloat(props.hs_forecast_probability) : null,
        numCustomerAccounts: props.number_of_customer_accounts ? parseInt(props.number_of_customer_accounts) : null,
        contractTerm: props.contract_term || null,
        disbursementPricing: props.disbursement_pricing || null,
        escheatmentPricing: props.escheatment_pricing || null,
        syncedToHubspot: true,
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (existing) {
        await db.update(schema.deals).set(dealData).where(eq(schema.deals.id, existing.id));
        updated++;
      } else {
        await db.insert(schema.deals).values({
          ...dealData, matchResult: "synced", reviewStatus: "go_live", createdAt: new Date().toISOString(),
        });
        created++;
      }
    }
    console.log(`[Startup] HubSpot: ${hubspotDeals.length} deals (${created} created, ${updated} updated)`);
  } catch (e) {
    console.error("[Startup] HubSpot pull failed:", e);
  }

  // Poller disabled — Claude Code runs the poller externally
  // startFathomPoller();
});
