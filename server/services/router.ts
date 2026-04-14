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
// Eisen does unclaimed property/escheatment for financial institutions.
// Any company that is NOT a bank, credit union, fintech, or insurance company
// is almost certainly a vendor, tool, or irrelevant email.
const VENDOR_PATTERNS = [
  // Dev tools & hosting
  "hubspot", "salesforce", "zapier", "n8n", "slack", "notion",
  "figma", "linear", "jira", "confluence", "asana", "monday.com",
  "aws", "azure", "google cloud", "stripe", "plaid",
  "replit", "vercel", "netlify", "heroku", "railway", "render",
  "github", "gitlab", "bitbucket",
  // AI/ML tools
  "anthropic", "openai", "claude", "chatgpt",
  // Sales/marketing tools
  "clay", "apollo.io", "outreach", "salesloft", "gong",
  "mailchimp", "sendgrid", "twilio", "intercom", "zendesk",
  // Analytics & misc
  "posthog", "mixpanel", "amplitude", "segment", "datadog",
  "pagerduty", "sentry",
  // Generic non-financial
  "das london", "senders pediatrics", "medical imaging", "janitek",
];

// ── Vendor/tool DOMAINS — skip emails from these domains ──
const VENDOR_DOMAINS = [
  // Eisen's own domains
  "witheisen.com", "eisen.com",
  // Dev tools & hosting
  "replit.com", "github.com", "vercel.com", "netlify.com",
  "railway.app", "render.com", "heroku.com",
  // AI/ML
  "anthropic.com", "openai.com",
  // Sales/marketing tools
  "hubspot.com", "salesforce.com", "clay.com", "apollo.io",
  "gong.io", "outreach.io", "salesloft.com",
  "mailchimp.com", "sendgrid.net", "twilio.com",
  "intercom.io", "zendesk.com",
  // Platforms
  "slack.com", "notion.so", "figma.com", "linear.app",
  "atlassian.net", "asana.com", "monday.com",
  // Cloud
  "amazonaws.com", "azure.com", "google.com", "googleapis.com",
  // Analytics
  "posthog.com", "mixpanel.com", "amplitude.com", "segment.com",
  "datadog.com", "pagerduty.com", "sentry.io",
  // Payments (Eisen uses these, not prospects of)
  "stripe.com", "plaid.com", "braintreepayments.com",
  // Calendar / scheduling / notifications
  "calendly.com", "zoom.us", "fathom.video",
  "linkedin.com", "facebook.com", "twitter.com",
  // Generic email
  "gmail.com", "outlook.com", "yahoo.com", "hotmail.com",
  "noreply", "no-reply", "donotreply",
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
 * Extract domain from a "from" field.
 * Handles formats like: "Replit Support <support@replit.com>", "support@replit.com"
 */
export function extractDomainFromFrom(from: string): string | null {
  if (!from) return null;
  const match = from.match(/<([^>]+)>/) || from.match(/([^\s<]+@[^\s>]+)/);
  const email = match ? match[1].toLowerCase() : from.toLowerCase();
  const domain = email.split("@")[1];
  return domain || null;
}

/**
 * Check if a domain belongs to a vendor/tool (not a financial institution prospect).
 *
 * Eisen's prospects are: banks, credit unions, fintechs, insurance companies.
 * Everything else is a vendor, tool, or irrelevant.
 */
function isVendorDomain(domain: string): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return VENDOR_DOMAINS.some((vd) => d.includes(vd) || d.endsWith(vd));
}

/**
 * Route an email to a deterministic outcome.
 *
 * Accepts EITHER a pre-extracted senderDomain OR a raw "from" field.
 * The n8n workflow sends from: "Replit Support <support@replit.com>"
 * so we need to parse the domain ourselves.
 */
export function routeEmail(
  subject: string,
  senderDomainOrFrom: string | null
): RoutingDecision {
  // Extract domain — handle both "replit.com" and "Support <x@replit.com>" formats
  let senderDomain = senderDomainOrFrom;
  if (senderDomainOrFrom && senderDomainOrFrom.includes("@")) {
    senderDomain = extractDomainFromFrom(senderDomainOrFrom);
  }

  // ── Step 1: Skip Eisen-internal emails ──
  if (senderDomain && (senderDomain.includes("eisen") || senderDomain.includes("witheisen"))) {
    return {
      outcome: "SKIP_INTERNAL",
      reason: `Internal email from ${senderDomain}`,
      companyName: null,
      matchedRecord: null,
      candidates: [],
    };
  }

  // ── Step 2: Skip vendor/tool domains ──
  if (senderDomain && isVendorDomain(senderDomain)) {
    return {
      outcome: "SKIP_VENDOR_TOOL",
      reason: `Vendor/tool email from ${senderDomain} — not a financial institution prospect`,
      companyName: null,
      matchedRecord: null,
      candidates: [],
    };
  }

  // ── Step 3: Skip no-reply / notification emails ──
  const subjectLower = subject.toLowerCase();
  const noReplyPatterns = [
    "noreply", "no-reply", "donotreply", "do-not-reply",
    "unsubscribe", "newsletter", "digest", "notification",
    "password reset", "verify your", "welcome to", "confirm your",
    "invoice", "receipt", "payment confirmation", "subscription",
    "out of office", "ooo", "auto-reply", "automatic reply",
    "calendar:", "invitation:", "accepted:", "declined:", "tentative:",
    "support ticket", "ticket update", "case #",
  ];
  if (noReplyPatterns.some((p) => subjectLower.includes(p))) {
    return {
      outcome: "SKIP_VENDOR_TOOL",
      reason: `Automated/notification email: "${subject}"`,
      companyName: null,
      matchedRecord: null,
      candidates: [],
    };
  }

  // ── Step 4: Check subject against vendor patterns ──
  for (const pattern of VENDOR_PATTERNS) {
    if (subjectLower.includes(pattern)) {
      return {
        outcome: "SKIP_VENDOR_TOOL",
        reason: `Subject matches vendor pattern: "${pattern}"`,
        companyName: null,
        matchedRecord: null,
        candidates: [],
      };
    }
  }

  // ── Step 5: Extract company from domain + subject ──
  const candidates: string[] = [];
  if (senderDomain) {
    const domainRoot = senderDomain
      .replace(/\.(com|org|net|io|co|ai|us|bank|credit|financial)$/i, "")
      .trim();
    if (domainRoot.length > 2) {
      candidates.push(normalizeCompany(domainRoot));
    }
  }

  const subjectCandidates = extractCompaniesFromTitle(subject);
  candidates.push(...subjectCandidates);

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

  // ── Step 6: Look up in HubSpot index ──
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
