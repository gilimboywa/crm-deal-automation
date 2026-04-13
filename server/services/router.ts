/**
 * router.ts — Deterministic routing engine.
 *
 * This is the GATEKEEPER. No item reaches Claude unless routing passes.
 *
 * Input: a Fathom transcript title (or email subject, or any raw text identifying a company).
 * Output: one of 6 deterministic outcomes:
 *
 *   SKIP_CLOSED_ONLY   — company exists but ALL deals are closed-won/lost
 *   SKIP_INTERNAL       — meeting title matches internal meeting patterns
 *   SKIP_VENDOR_TOOL    — meeting is with a vendor/tool provider, not a prospect
 *   SKIP_NO_COMPANY     — cannot extract any company name from the input
 *   PROCESS_ACTIVE      — company has an active deal → process as UPDATE
 *   PROCESS_NEW         — company not found in database → process as NEW
 *   REVIEW_AMBIGUOUS    — fuzzy match, multiple candidates, or other ambiguity → human review
 *
 * The router does NOT call Claude. It does NOT write to the database.
 * It only READS the HubSpot index and returns a routing decision.
 */

import { extractCompaniesFromTitle, normalizeCompany, isSelfCompany } from "./company-matcher.js";
import { lookupFromTitle, lookupCompany, type CompanyRecord } from "./hubspot-index.js";

// ── Routing outcomes ──

export type RoutingOutcome =
  | "SKIP_CLOSED_ONLY"
  | "SKIP_INTERNAL"
  | "SKIP_VENDOR_TOOL"
  | "SKIP_NO_COMPANY"
  | "PROCESS_ACTIVE"
  | "PROCESS_NEW"
  | "REVIEW_AMBIGUOUS";

export interface RoutingDecision {
  outcome: RoutingOutcome;
  reason: string;
  companyName: string | null;           // extracted company name (if any)
  matchedRecord: CompanyRecord | null;  // matched deal record (if any)
  candidates: string[];                 // all extracted candidate names
}

// ── Internal meeting patterns ──
const INTERNAL_PATTERNS = [
  "paid ads", "sales coaching", "team meeting", "implementation weekly",
  "design team", "marketing kickoff", "marketing", "engineering", "product",
  "standup", "sprint", "retro", "all hands", "1:1", "interview", "hiring",
  "training", "weekly touch base", "weekly touchbase", "biweekly check-in",
  "monthly touchpoint", "onboarding touchpoint", "winddown weekly",
  "ubo requirements", "class action", "finovate", "fathom demo",
  "gomarketmodel", "go market model", "apollo", "golden venture",
  "team sync", "internal", "company meeting", "board meeting",
  "leadership", "offsite", "quarterly review", "qbr",
  "onboarding |",  // "Onboarding | Company" is post-sale
];

// ── Vendor/tool patterns (not prospects) ──
const VENDOR_PATTERNS = [
  "hubspot", "salesforce", "zapier", "n8n", "slack", "notion",
  "figma", "linear", "jira", "confluence", "asana", "monday.com",
  "aws", "azure", "google cloud", "stripe", "plaid",
];

/**
 * Route a Fathom transcript title to a deterministic outcome.
 */
export function routeTranscript(title: string): RoutingDecision {
  const titleLower = title.toLowerCase().trim();

  // ── Step 1: Internal meeting check ──
  for (const pattern of INTERNAL_PATTERNS) {
    if (titleLower.includes(pattern)) {
      return {
        outcome: "SKIP_INTERNAL",
        reason: `Title matches internal pattern: "${pattern}"`,
        companyName: null,
        matchedRecord: null,
        candidates: [],
      };
    }
  }

  // Single-word titles are internal 1:1s or personal meetings
  const words = titleLower.split(/[\s/\-|]/).filter((w) => w.length > 0);
  if (words.length <= 1) {
    return {
      outcome: "SKIP_INTERNAL",
      reason: `Single-word title: "${title}" — likely internal or personal`,
      companyName: null,
      matchedRecord: null,
      candidates: [],
    };
  }

  // ── Step 2: Vendor/tool check ──
  for (const pattern of VENDOR_PATTERNS) {
    if (titleLower.includes(pattern)) {
      return {
        outcome: "SKIP_VENDOR_TOOL",
        reason: `Title matches vendor/tool pattern: "${pattern}"`,
        companyName: null,
        matchedRecord: null,
        candidates: [],
      };
    }
  }

  // ── Step 3: Extract company candidates from title ──
  const candidates = extractCompaniesFromTitle(title);

  if (candidates.length === 0) {
    // Last check: does the title have ANY company-related keyword?
    const hasDealKeyword = ["demo", "proposal", "intro", "discovery", "pitch", "rfi", "rfp"]
      .some((kw) => titleLower.includes(kw));

    if (!hasDealKeyword) {
      return {
        outcome: "SKIP_NO_COMPANY",
        reason: `Cannot extract company name from: "${title}"`,
        companyName: null,
        matchedRecord: null,
        candidates: [],
      };
    }

    // Has a deal keyword but no company name — ambiguous
    return {
      outcome: "REVIEW_AMBIGUOUS",
      reason: `Has deal keyword but no company name extractable from: "${title}"`,
      companyName: null,
      matchedRecord: null,
      candidates: [],
    };
  }

  // ── Step 4: Look up candidates in the HubSpot index ──
  const lookup = lookupFromTitle(candidates);

  if (!lookup) {
    // No match in database → NEW deal
    return {
      outcome: "PROCESS_NEW",
      reason: `Company "${candidates[0]}" not found in deal database`,
      companyName: candidates[0],
      matchedRecord: null,
      candidates,
    };
  }

  const { record, matchedCandidate } = lookup;

  // ── Step 5: Classify based on deal status ──
  if (record.hasActive) {
    return {
      outcome: "PROCESS_ACTIVE",
      reason: `Active deal found for "${record.deals[0].companyName}" (matched via "${matchedCandidate}")`,
      companyName: record.canonical,
      matchedRecord: record,
      candidates,
    };
  }

  if (record.hasClosedOnly) {
    return {
      outcome: "SKIP_CLOSED_ONLY",
      reason: `All deals for "${record.deals[0].companyName}" are closed (${record.deals.map((d) => d.dealStage).join(", ")})`,
      companyName: record.canonical,
      matchedRecord: record,
      candidates,
    };
  }

  // Shouldn't reach here, but handle gracefully
  return {
    outcome: "REVIEW_AMBIGUOUS",
    reason: `Unexpected state for "${record.canonical}" — flagging for review`,
    companyName: record.canonical,
    matchedRecord: record,
    candidates,
  };
}

/**
 * Route an email subject + sender domain to a deterministic outcome.
 * Similar to routeTranscript but uses email-specific heuristics.
 */
export function routeEmail(subject: string, senderDomain: string | null): RoutingDecision {
  // Skip Eisen-internal emails
  if (senderDomain && (senderDomain.includes("eisen") || senderDomain.includes("witheisen"))) {
    return {
      outcome: "SKIP_INTERNAL",
      reason: `Internal email from ${senderDomain}`,
      companyName: null,
      matchedRecord: null,
      candidates: [],
    };
  }

  // Extract company from domain if available
  const candidates: string[] = [];
  if (senderDomain) {
    const domainName = senderDomain.replace(/\.(com|org|net|io|co|ai|us|bank)$/i, "").trim();
    if (domainName.length > 2) {
      candidates.push(normalizeCompany(domainName));
    }
  }

  // Also extract from subject
  const subjectCandidates = extractCompaniesFromTitle(subject);
  candidates.push(...subjectCandidates);

  // Deduplicate
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];

  if (uniqueCandidates.length === 0) {
    return {
      outcome: "SKIP_NO_COMPANY",
      reason: `Cannot extract company from email: "${subject}" (${senderDomain})`,
      companyName: null,
      matchedRecord: null,
      candidates: [],
    };
  }

  // Look up in index
  const lookup = lookupFromTitle(uniqueCandidates);

  if (!lookup) {
    return {
      outcome: "PROCESS_NEW",
      reason: `Company "${uniqueCandidates[0]}" not found in deal database (from email)`,
      companyName: uniqueCandidates[0],
      matchedRecord: null,
      candidates: uniqueCandidates,
    };
  }

  const { record, matchedCandidate } = lookup;

  if (record.hasActive) {
    return {
      outcome: "PROCESS_ACTIVE",
      reason: `Active deal for "${record.deals[0].companyName}" (email match via "${matchedCandidate}")`,
      companyName: record.canonical,
      matchedRecord: record,
      candidates: uniqueCandidates,
    };
  }

  if (record.hasClosedOnly) {
    return {
      outcome: "SKIP_CLOSED_ONLY",
      reason: `All deals for "${record.deals[0].companyName}" are closed (email)`,
      companyName: record.canonical,
      matchedRecord: record,
      candidates: uniqueCandidates,
    };
  }

  return {
    outcome: "REVIEW_AMBIGUOUS",
    reason: `Ambiguous email match for "${record.canonical}"`,
    companyName: record.canonical,
    matchedRecord: record,
    candidates: uniqueCandidates,
  };
}

/**
 * Should this routing decision result in Claude processing?
 */
export function shouldProcess(decision: RoutingDecision): boolean {
  return decision.outcome === "PROCESS_ACTIVE" || decision.outcome === "PROCESS_NEW";
}

/**
 * Should this routing decision be skipped entirely?
 */
export function shouldSkip(decision: RoutingDecision): boolean {
  return decision.outcome.startsWith("SKIP_");
}
