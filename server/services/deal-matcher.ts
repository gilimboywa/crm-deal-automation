import type { DealBox, MatchResult } from "../lib/types.js";
import type { Deal } from "../../db/schema.js";

/**
 * Normalize a company name for comparison:
 * lowercase, trim, remove common suffixes (Inc, LLC, Corp, Ltd, etc.)
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(
      /\s*(,?\s*(inc\.?|llc\.?|corp\.?|corporation|ltd\.?|limited|co\.?|company|plc\.?|l\.?p\.?|lp))\s*$/gi,
      ""
    )
    .trim();
}

/**
 * Simple Levenshtein distance calculation.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio between two strings (0 to 1).
 */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Match a DealBox against existing deals in the database.
 *
 * Returns:
 * - "update" + matchedDealId if exact normalized match + same deal type
 * - "inconclusive" if fuzzy match found (similarity > 0.6 or substring match)
 * - "new" if no match found
 */
export function matchDeal(
  dealBox: DealBox,
  existingDeals: Deal[]
): MatchResult {
  const normalizedNew = normalizeCompanyName(dealBox.companyName);

  if (!normalizedNew) {
    return {
      result: "new",
      confidence: 1,
      reason: "Empty company name — treating as new deal.",
    };
  }

  let bestFuzzyMatch: {
    deal: Deal;
    score: number;
    matchType: "includes" | "startsWith" | "levenshtein";
  } | null = null;

  for (const existingDeal of existingDeals) {
    const normalizedExisting = normalizeCompanyName(existingDeal.companyName);

    // ── Exact match ──
    if (normalizedNew === normalizedExisting) {
      // Same deal type (or both null) → update
      const sameType =
        dealBox.dealType === existingDeal.dealType ||
        (!dealBox.dealType && !existingDeal.dealType);

      if (sameType) {
        return {
          result: "update",
          matchedDealId: existingDeal.id,
          confidence: 1,
          reason: `Exact company name match "${existingDeal.companyName}" with same deal type.`,
        };
      }

      // Same company but different deal type → still inconclusive
      return {
        result: "inconclusive",
        matchedDealId: existingDeal.id,
        confidence: 0.8,
        reason: `Exact company name match "${existingDeal.companyName}" but different deal type (existing: ${existingDeal.dealType}, new: ${dealBox.dealType}).`,
      };
    }

    // ── Substring / startsWith checks ──
    if (
      normalizedNew.includes(normalizedExisting) ||
      normalizedExisting.includes(normalizedNew)
    ) {
      const score = 0.75;
      if (!bestFuzzyMatch || score > bestFuzzyMatch.score) {
        bestFuzzyMatch = { deal: existingDeal, score, matchType: "includes" };
      }
      continue;
    }

    if (
      normalizedNew.startsWith(normalizedExisting) ||
      normalizedExisting.startsWith(normalizedNew)
    ) {
      const score = 0.7;
      if (!bestFuzzyMatch || score > bestFuzzyMatch.score) {
        bestFuzzyMatch = { deal: existingDeal, score, matchType: "startsWith" };
      }
      continue;
    }

    // ── Levenshtein similarity ──
    const sim = similarity(normalizedNew, normalizedExisting);
    if (sim > 0.6) {
      if (!bestFuzzyMatch || sim > bestFuzzyMatch.score) {
        bestFuzzyMatch = {
          deal: existingDeal,
          score: sim,
          matchType: "levenshtein",
        };
      }
    }
  }

  // ── Return fuzzy match as inconclusive ──
  if (bestFuzzyMatch) {
    return {
      result: "inconclusive",
      matchedDealId: bestFuzzyMatch.deal.id,
      confidence: bestFuzzyMatch.score,
      reason: `Fuzzy match (${bestFuzzyMatch.matchType}, score: ${bestFuzzyMatch.score.toFixed(2)}) with existing deal "${bestFuzzyMatch.deal.companyName}" (ID: ${bestFuzzyMatch.deal.id}).`,
    };
  }

  // ── No match ──
  return {
    result: "new",
    confidence: 1,
    reason: `No matching deal found for company "${dealBox.companyName}".`,
  };
}
