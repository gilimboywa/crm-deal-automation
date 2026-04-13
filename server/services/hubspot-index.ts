/**
 * hubspot-index.ts — In-memory index of all deals, keyed by normalized company name.
 *
 * Loaded once at startup from the local SQLite database (which is synced from HubSpot).
 * Provides O(1) lookups by company name for the deterministic router.
 *
 * The index answers: "For company X, what deals exist and what are their stages?"
 */

import { db, schema } from "../../db/index.js";
import { normalizeCompany, isSelfCompany, isTooShort, compareCompanies } from "./company-matcher.js";

export interface IndexedDeal {
  id: number;
  hubspotDealId: string | null;
  companyName: string;          // original
  normalizedName: string;       // after normalizeCompany()
  dealStage: string;
  dealType: string | null;
  reviewStatus: string;
  isClosed: boolean;            // closed_won or closed_lost
  isActive: boolean;            // stages 0-4
  matchResult: string | null;
  claudeReasoning: string | null;
}

export interface CompanyRecord {
  canonical: string;            // normalized company name
  deals: IndexedDeal[];
  hasActive: boolean;           // at least one deal in stages 0-4
  hasClosedOnly: boolean;       // ALL deals are closed_won or closed_lost
  hasAny: boolean;
}

// ── The index ──
const companyIndex = new Map<string, CompanyRecord>();

/**
 * Build/rebuild the index from the database.
 * Call this at startup and after HubSpot syncs.
 */
export function rebuildIndex(): { totalDeals: number; companies: number } {
  companyIndex.clear();

  const allDeals = db.select().from(schema.deals).all() as any[];

  for (const deal of allDeals) {
    const normalized = normalizeCompany(deal.companyName);
    if (!normalized || isSelfCompany(normalized) || isTooShort(normalized)) continue;

    const isClosed = deal.dealStage === "closed_won" || deal.dealStage === "closed_lost";
    const isActive = !isClosed;

    const indexed: IndexedDeal = {
      id: deal.id,
      hubspotDealId: deal.hubspotDealId,
      companyName: deal.companyName,
      normalizedName: normalized,
      dealStage: deal.dealStage,
      dealType: deal.dealType,
      reviewStatus: deal.reviewStatus,
      isClosed,
      isActive,
      matchResult: deal.matchResult,
      claudeReasoning: deal.claudeReasoning,
    };

    if (!companyIndex.has(normalized)) {
      companyIndex.set(normalized, {
        canonical: normalized,
        deals: [],
        hasActive: false,
        hasClosedOnly: false,
        hasAny: true,
      });
    }

    const record = companyIndex.get(normalized)!;
    record.deals.push(indexed);
    record.hasActive = record.deals.some((d) => d.isActive);
    record.hasClosedOnly = record.deals.length > 0 && !record.hasActive;
  }

  console.log(`[HubSpotIndex] Indexed ${allDeals.length} deals across ${companyIndex.size} companies`);
  return { totalDeals: allDeals.length, companies: companyIndex.size };
}

/**
 * Look up a company by normalized name.
 * Returns null if not found.
 */
export function lookupCompany(companyName: string): CompanyRecord | null {
  const normalized = normalizeCompany(companyName);
  if (!normalized || isSelfCompany(normalized) || isTooShort(normalized)) return null;

  // Direct lookup
  const direct = companyIndex.get(normalized);
  if (direct) return direct;

  // Fuzzy search across all indexed companies
  let bestMatch: { record: CompanyRecord; score: number } | null = null;

  for (const [key, record] of companyIndex) {
    const { score } = compareCompanies(companyName, record.deals[0].companyName);
    if (score >= 0.8 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { record, score };
    }
  }

  return bestMatch?.record ?? null;
}

/**
 * Look up a company from a Fathom title.
 * Tries each extracted candidate against the index.
 * Returns the BEST match (active > closed > null).
 */
export function lookupFromTitle(
  candidates: string[]
): { record: CompanyRecord; matchedCandidate: string } | null {
  let bestActive: { record: CompanyRecord; matchedCandidate: string } | null = null;
  let bestClosed: { record: CompanyRecord; matchedCandidate: string } | null = null;

  for (const candidate of candidates) {
    // Direct lookup first
    const direct = companyIndex.get(candidate);
    if (direct) {
      if (direct.hasActive) {
        return { record: direct, matchedCandidate: candidate }; // Active wins immediately
      }
      if (!bestClosed) bestClosed = { record: direct, matchedCandidate: candidate };
      continue;
    }

    // Fuzzy search
    for (const [key, record] of companyIndex) {
      const { score } = compareCompanies(candidate, key);
      if (score >= 0.8) {
        if (record.hasActive && !bestActive) {
          bestActive = { record, matchedCandidate: candidate };
        } else if (record.hasClosedOnly && !bestClosed) {
          bestClosed = { record, matchedCandidate: candidate };
        }
      }
    }
  }

  // Active takes priority over closed
  return bestActive ?? bestClosed ?? null;
}

/**
 * Get the full index (for debugging / stats).
 */
export function getIndexStats(): {
  companies: number;
  activeCompanies: number;
  closedOnlyCompanies: number;
} {
  let active = 0;
  let closedOnly = 0;
  for (const record of companyIndex.values()) {
    if (record.hasActive) active++;
    else if (record.hasClosedOnly) closedOnly++;
  }
  return { companies: companyIndex.size, activeCompanies: active, closedOnlyCompanies: closedOnly };
}

/**
 * Get all company names in the index (for debugging).
 */
export function getAllCompanyNames(): string[] {
  return [...companyIndex.keys()];
}
