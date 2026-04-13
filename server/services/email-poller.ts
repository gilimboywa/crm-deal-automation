/**
 * email-poller.ts — Gmail email poller for Gil and Jerry.
 *
 * Pulls sales-related emails from Gil and Jerry's Gmail accounts,
 * runs them through the deterministic router, and processes
 * qualifying emails through Claude for deal extraction.
 *
 * This is a FIRST-CLASS data source, equal in importance to Fathom transcripts.
 * Emails often contain deal details that Fathom misses:
 * - Pricing discussions
 * - Contract terms
 * - Follow-up actions
 * - Company introductions
 * - RFP/RFI responses
 *
 * Requires Google OAuth tokens for Gil and Jerry's accounts.
 * Both credentials are in the Eisen GTM Google Cloud project.
 */

import { google } from "googleapis";
import { getOAuth2Client, setTokens } from "./google-auth.js";
import { routeEmail, shouldProcess, shouldSkip } from "./router.js";
import { processDealData } from "./deal-processor.js";
import { matchDeal } from "./deal-matcher.js";
import { notifyDealReview } from "./slack-notifier.js";
import { rebuildIndex } from "./hubspot-index.js";
import { normalizeCompany } from "./company-matcher.js";
import { db, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";

// Sales team members whose emails we monitor
const SALES_ACCOUNTS = [
  { name: "Gil", email: "gil@witheisen.com" },
  { name: "Jerry", email: "jerry@witheisen.com" },
];

// Email patterns that are NEVER deals
const SKIP_SUBJECT_PATTERNS = [
  "out of office", "ooo", "auto-reply", "automatic reply",
  "unsubscribe", "newsletter", "weekly digest", "daily report",
  "calendar:", "invitation:", "accepted:", "declined:", "tentative:",
  "meeting notes", "internal", "team sync", "standup", "1:1",
  "invoice", "receipt", "payment confirmation", "subscription",
  "password reset", "verify your email", "welcome to",
  "onboarding", "implementation", "support ticket",
];

// Domains that are NEVER deals (vendors, tools, internal)
const SKIP_SENDER_DOMAINS = [
  "witheisen.com", "eisen.com",  // internal
  "google.com", "gmail.com", "outlook.com",  // platform
  "hubspot.com", "slack.com", "notion.so", "figma.com",  // tools
  "linkedin.com", "calendly.com", "zoom.us",  // scheduling
  "stripe.com", "plaid.com",  // payments
  "fathom.video", "gong.io",  // recording
  "clay.com", "apollo.io",  // prospecting tools
  "github.com", "vercel.com", "replit.com",  // dev tools
];

interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  fromDomain: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
  labels: string[];
}

/**
 * Extract email address and domain from a "From" header.
 */
function parseFromHeader(from: string): { email: string; domain: string } {
  const match = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
  const email = match ? match[1].toLowerCase() : from.toLowerCase();
  const domain = email.split("@")[1] || "";
  return { email, domain };
}

/**
 * Check if an email subject matches skip patterns.
 */
function isSkippableEmail(subject: string, senderDomain: string): boolean {
  const subjectLower = subject.toLowerCase();

  // Check subject patterns
  if (SKIP_SUBJECT_PATTERNS.some((p) => subjectLower.includes(p))) return true;

  // Check sender domain
  if (SKIP_SENDER_DOMAINS.some((d) => senderDomain.includes(d))) return true;

  return false;
}

/**
 * Pull recent emails from a Gmail account.
 * Requires OAuth tokens to be set on the client.
 */
async function pullEmails(
  tokens: any,
  accountName: string,
  afterDate: string
): Promise<EmailMessage[]> {
  const client = getOAuth2Client();
  setTokens(tokens);

  const gmail = google.gmail({ version: "v1", auth: client });

  // Search for emails after the given date, in INBOX or SENT
  const query = `after:${afterDate} in:inbox OR in:sent`;

  const messages: EmailMessage[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 50,
      pageToken,
    });

    for (const msg of res.data.messages || []) {
      try {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "full",
        });

        const headers = detail.data.payload?.headers || [];
        const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "(no subject)";
        const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
        const to = headers.find((h) => h.name?.toLowerCase() === "to")?.value || "";
        const date = headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";

        const { email: fromEmail, domain: fromDomain } = parseFromHeader(from);

        // Extract body (prefer plain text)
        let body = "";
        const parts = detail.data.payload?.parts || [];
        const textPart = parts.find((p) => p.mimeType === "text/plain");
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
        } else if (detail.data.payload?.body?.data) {
          body = Buffer.from(detail.data.payload.body.data, "base64").toString("utf-8");
        }

        // Truncate body to 4000 chars to fit Claude context
        if (body.length > 4000) {
          body = body.substring(0, 4000) + "\n... [truncated]";
        }

        messages.push({
          id: msg.id!,
          threadId: msg.threadId || msg.id!,
          subject,
          from,
          fromEmail,
          fromDomain,
          to,
          date,
          snippet: detail.data.snippet || "",
          body,
          labels: detail.data.labelIds || [],
        });
      } catch (e) {
        console.error(`[Email] Failed to fetch message ${msg.id}:`, e);
      }
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  console.log(`[Email] Pulled ${messages.length} emails for ${accountName}`);
  return messages;
}

/**
 * Process a batch of emails through the deterministic router + Claude.
 * Returns stats on what was processed/skipped.
 */
export async function processEmails(
  tokens: any,
  accountName: string,
  afterDate: string
): Promise<{
  total: number;
  skippedInternal: number;
  skippedClosed: number;
  skippedDuplicate: number;
  processed: number;
  errors: number;
  details: Array<{ subject: string; outcome: string; reason: string }>;
}> {
  const emails = await pullEmails(tokens, accountName, afterDate);

  const stats = {
    total: emails.length,
    skippedInternal: 0,
    skippedClosed: 0,
    skippedDuplicate: 0,
    processed: 0,
    errors: 0,
    details: [] as Array<{ subject: string; outcome: string; reason: string }>,
  };

  for (const email of emails) {
    try {
      // Pre-filter: skip obvious non-deal emails
      if (isSkippableEmail(email.subject, email.fromDomain)) {
        stats.skippedInternal++;
        stats.details.push({ subject: email.subject, outcome: "SKIP_INTERNAL", reason: `Skippable pattern or domain: ${email.fromDomain}` });
        continue;
      }

      // Deterministic routing
      const routing = routeEmail(email.subject, email.fromDomain);

      if (shouldSkip(routing)) {
        if (routing.outcome === "SKIP_CLOSED_ONLY") stats.skippedClosed++;
        else stats.skippedInternal++;
        stats.details.push({ subject: email.subject, outcome: routing.outcome, reason: routing.reason });
        continue;
      }

      // Check if already processed (by email thread ID)
      const existingDeals = await db.select().from(schema.deals);
      const isDuplicate = existingDeals.some((d) => {
        if (!d.rawInputData) return false;
        try {
          const raw = JSON.parse(d.rawInputData);
          return raw.emailId === email.id || raw.threadId === email.threadId;
        } catch {
          return false;
        }
      });

      if (isDuplicate) {
        stats.skippedDuplicate++;
        stats.details.push({ subject: email.subject, outcome: "SKIP_DUPLICATE", reason: "Already processed" });
        continue;
      }

      // Process through Claude
      if (shouldProcess(routing)) {
        const { dealBox, reasoning } = await processDealData({
          sourceType: "email",
          data: {
            title: email.subject,
            emailThread: `From: ${email.from}\nTo: ${email.to}\nDate: ${email.date}\nSubject: ${email.subject}\n\n${email.body}`,
            created_at: email.date,
          },
        });

        // Post-Claude closed check
        const norm = normalizeCompany(dealBox.companyName);
        const companyDeals = existingDeals.filter((d) => normalizeCompany(d.companyName) === norm);
        const hasActive = companyDeals.some((d) => d.dealStage !== "closed_won" && d.dealStage !== "closed_lost");
        const hasClosed = companyDeals.length > 0 && !hasActive;

        if (hasClosed) {
          stats.skippedClosed++;
          stats.details.push({ subject: email.subject, outcome: "SKIP_CLOSED_ONLY", reason: `Post-Claude: ${dealBox.companyName} is closed` });
          continue;
        }

        // Match against active deals
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
          matchedDealId: matchResult.matchedDealId ?? null,
          reviewStatus: "pending",
          rawInputData: JSON.stringify({
            source: "email",
            emailId: email.id,
            threadId: email.threadId,
            from: email.from,
            subject: email.subject,
            accountName,
            routingOutcome: routing.outcome,
          }),
          claudeReasoning: reasoning,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).returning();

        // Save contacts
        if (dealBox.associatedContacts?.length) {
          for (const contact of dealBox.associatedContacts) {
            const [savedContact] = await db.insert(schema.contacts).values({
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email,
              company: contact.company,
              title: contact.title,
              associationReason: contact.associationReason,
              firstSeenDate: contact.firstSeenDate,
              createdAt: new Date().toISOString(),
            }).returning();

            await db.insert(schema.dealContacts).values({
              dealId: savedDeal.id,
              contactId: savedContact.id,
              role: contact.role,
            });
          }
        }

        // Rebuild index and notify
        rebuildIndex();
        try {
          await notifyDealReview(savedDeal, matchResult);
        } catch (e) {
          console.error("[Email] Slack notification failed:", e);
        }

        stats.processed++;
        stats.details.push({
          subject: email.subject,
          outcome: routing.outcome,
          reason: `Created deal #${savedDeal.id} "${dealBox.companyName}" (${matchResult.result})`,
        });
      }

      // Rate limit: 15s between Claude calls
      await new Promise((r) => setTimeout(r, 15_000));
    } catch (error) {
      stats.errors++;
      const msg = error instanceof Error ? error.message : "Unknown error";
      stats.details.push({ subject: email.subject, outcome: "ERROR", reason: msg });
      console.error(`[Email] Error processing "${email.subject}":`, msg);
    }
  }

  return stats;
}
