/**
 * gino-client.ts — Gino badge scan integration for conference leads.
 *
 * Pulls badge scans from the Gino Lead Capture app and feeds them
 * into the deal processing pipeline as a FIRST-CLASS data source.
 *
 * Gino badge data includes:
 * - firstName, lastName, title, company, email, phone
 * - enrichedEmail, enrichedPhone, linkedinUrl, companyUrl (from Clay)
 * - notes, status
 *
 * Conference leads are treated as:
 * - primaryDealSource = "Conference"
 * - dealStage = "1" (Qualified — they showed interest at the booth)
 * - forecastProbability = 10% (initial interest only)
 */

import { routeTranscript, shouldProcess, shouldSkip } from "./router.js";
import { processDealData } from "./deal-processor.js";
import { matchDeal } from "./deal-matcher.js";
import { notifyDealReview } from "./slack-notifier.js";
import { rebuildIndex } from "./hubspot-index.js";
import { normalizeCompany } from "./company-matcher.js";
import { db, schema } from "../../db/index.js";

const GINO_API_KEY = process.env.GINO_API_KEY || "";

export interface GinoBadge {
  id: number;
  firstName: string;
  lastName: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  enrichedEmail: string | null;
  enrichedPhone: string | null;
  linkedinUrl: string | null;
  companyUrl: string | null;
  notes: string | null;
  status: string | null;
  createdAt: string | null;
}

/**
 * Fetch all badge scans from the Gino API server.
 * The Gino app stores badges in a separate PostgreSQL database.
 * We pull them via the REST API.
 */
export async function fetchBadges(ginoBaseUrl: string): Promise<GinoBadge[]> {
  try {
    const res = await fetch(`${ginoBaseUrl}/api/badges`, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Gino API returned ${res.status}: ${res.statusText}`);
    }

    const badges: GinoBadge[] = await res.json();
    console.log(`[Gino] Fetched ${badges.length} badge scans`);
    return badges;
  } catch (error) {
    console.error("[Gino] Failed to fetch badges:", error);
    return [];
  }
}

/**
 * Process Gino badge scans through the deal pipeline.
 * Each badge with a company name gets routed → Claude → saved.
 */
export async function processGinoBadges(
  ginoBaseUrl: string
): Promise<{
  total: number;
  skipped: number;
  processed: number;
  errors: number;
  details: Array<{ badge: string; outcome: string; reason: string }>;
}> {
  const badges = await fetchBadges(ginoBaseUrl);

  const stats = {
    total: badges.length,
    skipped: 0,
    processed: 0,
    errors: 0,
    details: [] as Array<{ badge: string; outcome: string; reason: string }>,
  };

  // Get existing deals to check for duplicates
  const existingDeals = await db.select().from(schema.deals);

  for (const badge of badges) {
    const label = `${badge.firstName} ${badge.lastName || ""} (${badge.company || "unknown"})`.trim();

    try {
      // Skip badges without company names
      if (!badge.company || badge.company.trim().length === 0) {
        stats.skipped++;
        stats.details.push({ badge: label, outcome: "SKIP_NO_COMPANY", reason: "No company name on badge" });
        continue;
      }

      // Check if already processed (by Gino badge ID)
      const isDuplicate = existingDeals.some((d) => {
        if (!d.rawInputData) return false;
        try {
          const raw = JSON.parse(d.rawInputData);
          return raw.ginoBadgeId === badge.id;
        } catch {
          return false;
        }
      });

      if (isDuplicate) {
        stats.skipped++;
        stats.details.push({ badge: label, outcome: "SKIP_DUPLICATE", reason: "Already processed" });
        continue;
      }

      // Use the company name as a "title" for the router
      const routing = routeTranscript(`Eisen | ${badge.company} - Conference`);

      if (shouldSkip(routing)) {
        stats.skipped++;
        stats.details.push({ badge: label, outcome: routing.outcome, reason: routing.reason });
        continue;
      }

      // Process through Claude with badge data
      if (shouldProcess(routing)) {
        const badgeData = [
          `Name: ${badge.firstName} ${badge.lastName || ""}`,
          badge.title ? `Title: ${badge.title}` : null,
          `Company: ${badge.company}`,
          badge.email ? `Email: ${badge.email}` : null,
          badge.enrichedEmail ? `Work Email: ${badge.enrichedEmail}` : null,
          badge.phone ? `Phone: ${badge.phone}` : null,
          badge.enrichedPhone ? `Work Phone: ${badge.enrichedPhone}` : null,
          badge.linkedinUrl ? `LinkedIn: ${badge.linkedinUrl}` : null,
          badge.companyUrl ? `Company Website: ${badge.companyUrl}` : null,
          badge.notes ? `Notes: ${badge.notes}` : null,
          `Scanned at: ${badge.createdAt || "unknown date"}`,
        ].filter(Boolean).join("\n");

        const { dealBox, reasoning } = await processDealData({
          sourceType: "gino_badge",
          data: {
            title: `Conference Lead: ${badge.company}`,
            badgeScan: badgeData,
            created_at: badge.createdAt || new Date().toISOString(),
          },
        });

        // Post-Claude closed check
        const norm = normalizeCompany(dealBox.companyName);
        const companyDeals = existingDeals.filter((d) => normalizeCompany(d.companyName) === norm);
        const hasActive = companyDeals.some((d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost");
        const hasClosed = companyDeals.length > 0 && !hasActive;

        if (hasClosed) {
          stats.skipped++;
          stats.details.push({ badge: label, outcome: "SKIP_CLOSED_ONLY", reason: `Post-Claude: ${dealBox.companyName} is closed` });
          continue;
        }

        // Match
        const activeDeals = existingDeals.filter((d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost");
        const matchResult = matchDeal(dealBox, activeDeals);

        // Save deal
        const [savedDeal] = await db.insert(schema.deals).values({
          companyName: dealBox.companyName,
          amount: dealBox.amount,
          closeDate: dealBox.closeDate,
          pipeline: dealBox.pipeline,
          dealStage: dealBox.dealStage,
          dealSourcePerson: dealBox.dealSourcePerson,
          primaryDealSource: "Conference",
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
            source: "gino_badge",
            ginoBadgeId: badge.id,
            company: badge.company,
            routingOutcome: routing.outcome,
          }),
          claudeReasoning: reasoning,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).returning();

        // Save the badge contact
        if (badge.firstName) {
          const [savedContact] = await db.insert(schema.contacts).values({
            firstName: badge.firstName,
            lastName: badge.lastName,
            email: badge.enrichedEmail || badge.email,
            company: badge.company,
            title: badge.title,
            associationReason: "Conference badge scan",
            firstSeenDate: badge.createdAt,
            createdAt: new Date().toISOString(),
          }).returning();

          await db.insert(schema.dealContacts).values({
            dealId: savedDeal.id,
            contactId: savedContact.id,
            role: "primary",
          });
        }

        rebuildIndex();
        try {
          await notifyDealReview(savedDeal, matchResult);
        } catch (e) {
          console.error("[Gino] Slack notification failed:", e);
        }

        stats.processed++;
        stats.details.push({
          badge: label,
          outcome: routing.outcome,
          reason: `Created deal #${savedDeal.id} "${dealBox.companyName}" (${matchResult.result})`,
        });

        // Rate limit
        await new Promise((r) => setTimeout(r, 15_000));
      }
    } catch (error) {
      stats.errors++;
      const msg = error instanceof Error ? error.message : "Unknown error";
      stats.details.push({ badge: label, outcome: "ERROR", reason: msg });
      console.error(`[Gino] Error processing badge "${label}":`, msg);
    }
  }

  return stats;
}
