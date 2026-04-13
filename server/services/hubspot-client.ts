import { Client } from "@hubspot/api-client";
import type { Deal } from "../../db/schema.js";
import { HUBSPOT_DEAL_PROPERTY_MAP } from "../lib/constants.js";

let _hubspotClient: Client | null = null;

function getHubspot(): Client {
  if (!_hubspotClient) {
    const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!accessToken) throw new Error("HUBSPOT_ACCESS_TOKEN is not set");
    _hubspotClient = new Client({ accessToken });
  }
  return _hubspotClient;
}

/**
 * Map our internal deal fields to HubSpot property names.
 */
function mapDealToHubSpotProperties(
  deal: Partial<Deal>
): Record<string, string> {
  const properties: Record<string, string> = {};

  for (const [ourField, hubspotField] of Object.entries(
    HUBSPOT_DEAL_PROPERTY_MAP
  )) {
    const value = (deal as Record<string, any>)[ourField];
    if (value !== undefined && value !== null) {
      properties[hubspotField] = String(value);
    }
  }

  return properties;
}

/**
 * Create a deal in HubSpot. Returns the HubSpot deal ID.
 */
export async function createDeal(deal: Deal): Promise<string> {
  try {
    const properties = mapDealToHubSpotProperties(deal);

    const response = await getHubspot().crm.deals.basicApi.create({
      properties,
      associations: [],
    });

    return response.id;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown HubSpot error";
    throw new Error(`Failed to create HubSpot deal: ${message}`);
  }
}

/**
 * Update an existing deal in HubSpot.
 */
export async function updateDeal(
  hubspotDealId: string,
  deal: Partial<Deal>
): Promise<void> {
  try {
    const properties = mapDealToHubSpotProperties(deal);

    await getHubspot().crm.deals.basicApi.update(hubspotDealId, {
      properties,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown HubSpot error";
    throw new Error(`Failed to update HubSpot deal: ${message}`);
  }
}

/**
 * Search for deals in HubSpot by company name.
 */
export async function searchDealByCompany(
  companyName: string
): Promise<any[]> {
  try {
    const response = await getHubspot().crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "dealname",
              operator: "CONTAINS_TOKEN",
              value: companyName,
            },
          ],
        },
      ],
      properties: ["dealname", "amount", "dealstage", "pipeline"],
      limit: 10,
      after: "0",
      sorts: [],
    });

    return response.results || [];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown HubSpot error";
    throw new Error(`Failed to search HubSpot deals: ${message}`);
  }
}

/**
 * Create a contact in HubSpot. Returns the HubSpot contact ID.
 */
export async function createContact(contact: {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  title?: string | null;
}): Promise<string> {
  try {
    const properties: Record<string, string> = {
      firstname: contact.firstName,
    };

    if (contact.lastName) properties.lastname = contact.lastName;
    if (contact.email) properties.email = contact.email;
    if (contact.phone) properties.phone = contact.phone;
    if (contact.company) properties.company = contact.company;
    if (contact.title) properties.jobtitle = contact.title;

    const response = await getHubspot().crm.contacts.basicApi.create({
      properties,
      associations: [],
    });

    return response.id;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown HubSpot error";
    throw new Error(`Failed to create HubSpot contact: ${message}`);
  }
}

/**
 * Search for a contact in HubSpot by email.
 */
export async function searchContactByEmail(email: string): Promise<any> {
  try {
    const response = await getHubspot().crm.contacts.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: email,
            },
          ],
        },
      ],
      properties: ["firstname", "lastname", "email", "company", "jobtitle"],
      limit: 1,
      after: "0",
      sorts: [],
    });

    return response.results?.[0] || null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown HubSpot error";
    throw new Error(`Failed to search HubSpot contacts: ${message}`);
  }
}

/**
 * Get all deals from HubSpot with all relevant properties.
 */
export async function getAllDeals(): Promise<any[]> {
  try {
    const allDeals: any[] = [];
    let after: string | undefined = undefined;

    const properties = [
      // Core deal fields
      "dealname", "amount", "closedate", "pipeline", "dealstage",
      "description", "dealtype", "createdate",
      // Source & origin
      "primary_deal_source", "deal_source_description", "how_found", "referral_partner",
      // Classification
      "icp_1_or_2", "deal_type_2", "asset_classes",
      // Dates & ownership
      "notes_last_contacted", "notes_last_updated", "notes_next_activity_date",
      "hubspot_owner_id", "hubspot_owner_assigneddate",
      // Financials & metrics
      "hs_forecast_probability", "hs_forecast_amount",
      "number_of_customer_accounts", "contract_term",
      "disbursement_pricing", "escheatment_pricing",
      // Activity
      "num_associated_contacts", "num_contacted_notes", "num_notes",
      // Other
      "closed_lost_reason", "closed_won_reason",
      "location", "website", "underlying_vendors",
      "baas", "founding_year",
    ];

    // Paginate through all deals
    do {
      const response = await getHubspot().crm.deals.basicApi.getPage(
        100,
        after,
        properties,
      );

      if (response.results) {
        allDeals.push(...response.results);
      }

      after = response.paging?.next?.after;
    } while (after);

    return allDeals;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown HubSpot error";
    throw new Error(`Failed to get HubSpot deals: ${message}`);
  }
}

/**
 * Associate a contact with a deal in HubSpot.
 */
export async function associateContactWithDeal(
  dealId: string,
  contactId: string
): Promise<void> {
  try {
    await getHubspot().crm.deals.associationsApi.create(
      dealId,
      "contacts",
      contactId,
      [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }]
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown HubSpot error";
    throw new Error(
      `Failed to associate contact ${contactId} with deal ${dealId}: ${message}`
    );
  }
}
