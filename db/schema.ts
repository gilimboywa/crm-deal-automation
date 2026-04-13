import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ── Deal Stages ──
export const DEAL_STAGES = [
  "0", // Prospect - Needs Analysis
  "1", // Qualified
  "2", // Business Case/Testing
  "3", // Terms
  "4", // Legal / Due Diligence
  "closed_won",
  "closed_lost",
] as const;

export const DEAL_STAGE_LABELS: Record<string, string> = {
  "0": "0 - Prospect - Needs Analysis",
  "1": "1 - Qualified",
  "2": "2 - Business Case/Testing",
  "3": "3 - Terms",
  "4": "4 - Legal / Due Diligence",
  closed_won: "Closed-Won",
  closed_lost: "Closed-Lost",
};

// ── Amount Tiers ──
export const AMOUNT_TIERS = [25000, 50000, 100000, 150000, 250000, 500000, 1000000] as const;

// ── Primary Deal Sources ──
export const PRIMARY_DEAL_SOURCES = [
  "Inbound",
  "Outbound",
  "Investor Network",
  "Channel Partner",
  "Conference",
  "Customer Referral",
] as const;

// ── ICP Types ──
export const ICP_TYPES = ["ICP 1", "ICP 2"] as const;

// ── Deal Types ──
export const DEAL_TYPES = [
  "Abandoned Accounts",
  "Forced Closures",
  "Stale Checks",
  "Crypto",
  "Stablecoin",
] as const;

// ── State Report Ranges ──
export const STATE_REPORT_RANGES = ["0-5", "6-10", "11-25", "26-50"] as const;

// ── Review Statuses ──
export const REVIEW_STATUSES = ["pending", "go_live", "review", "inconclusive"] as const;

// ── Match Results ──
export const MATCH_RESULTS = ["new", "update", "inconclusive"] as const;

// ════════════════════════════════════════════════════════════════
// DEALS TABLE — The Deal Box (22 HubSpot properties + metadata)
// ════════════════════════════════════════════════════════════════

export const deals = sqliteTable("deals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hubspotDealId: text("hubspot_deal_id"),

  // ── Field 1: Company Name ──
  companyName: text("company_name").notNull(),

  // ── Field 2: Amount ($25K - $1M tiers) ──
  amount: real("amount"),

  // ── Field 3: Close Date ──
  closeDate: text("close_date"),

  // ── Field 4: Pipeline (hardcoded) ──
  pipeline: text("pipeline").notNull().default("[NEW] Sales Pipeline"),

  // ── Field 5: Deal Stage ──
  dealStage: text("deal_stage").notNull().default("0"),

  // ── Field 6: Deal Source Person ──
  dealSourcePerson: text("deal_source_person"),

  // ── Field 7: Primary Deal Source ──
  primaryDealSource: text("primary_deal_source"),

  // ── Field 8: Deal Source Details ──
  dealSourceDetails: text("deal_source_details"),

  // ── Field 9: Deal Description ──
  dealDescription: text("deal_description"),

  // ── Field 10: ICP 1 or 2 ──
  icp: text("icp"),

  // ── Field 11: Deal Type ──
  dealType: text("deal_type"),

  // ── Field 12: Create Date ──
  createDate: text("create_date").notNull(),

  // ── Field 13: Last Contacted ──
  lastContacted: text("last_contacted"),

  // ── Field 14: Deal Owner ──
  dealOwner: text("deal_owner"),

  // ── Field 15: Forecast Probability (0-100) ──
  forecastProbability: real("forecast_probability"),

  // ── Field 16: Number of Customer Accounts ──
  numCustomerAccounts: integer("num_customer_accounts"),

  // ── Field 17: Number of State Reports ──
  numStateReports: text("num_state_reports"),

  // ── Field 18: Number of Due Diligence Letters Sent ──
  numDueDiligenceLetters: integer("num_due_diligence_letters"),

  // ── Field 19: Contract Term ──
  contractTerm: text("contract_term"),

  // ── Field 20: Disbursement Pricing ──
  disbursementPricing: text("disbursement_pricing"),

  // ── Field 21: Escheatment Pricing ──
  escheatmentPricing: text("escheatment_pricing"),

  // ── Field 22: Dollar Value per Item ──
  dollarValuePerItem: text("dollar_value_per_item"),

  // ── Field 23: Annual Platform Fee ──
  annualPlatformFee: real("annual_platform_fee"),

  // ── Field 24: Implementation Fee ──
  implementationFee: real("implementation_fee"),

  // ── Field 25: Number of Escheatments per Year ──
  numEscheatmentsPerYear: integer("num_escheatments_per_year"),

  // Field 26: Associated Contacts → see deal_contacts join table

  // ── System Metadata ──
  matchResult: text("match_result"), // new | update | inconclusive
  matchedDealId: integer("matched_deal_id"), // ID of the deal this matched against
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  syncedToHubspot: integer("synced_to_hubspot", { mode: "boolean" }).notNull().default(false),
  lastSyncedAt: text("last_synced_at"),
  rawInputData: text("raw_input_data"), // JSON blob of original source data
  claudeReasoning: text("claude_reasoning"), // Claude's reasoning trace
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ════════════════════════════════════════════════════════════════
// CONTACTS TABLE
// ════════════════════════════════════════════════════════════════

export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hubspotContactId: text("hubspot_contact_id"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  title: text("title"),
  linkedinUrl: text("linkedin_url"),
  associationReason: text("association_reason"),
  firstSeenDate: text("first_seen_date"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ════════════════════════════════════════════════════════════════
// DEAL-CONTACTS JOIN TABLE
// ════════════════════════════════════════════════════════════════

export const dealContacts = sqliteTable("deal_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id")
    .notNull()
    .references(() => deals.id),
  contactId: integer("contact_id")
    .notNull()
    .references(() => contacts.id),
  role: text("role").notNull().default("secondary"), // primary | secondary
});

// ════════════════════════════════════════════════════════════════
// WORKFLOW RUNS TABLE
// ════════════════════════════════════════════════════════════════

export const workflowRuns = sqliteTable("workflow_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workflowType: text("workflow_type").notNull(), // creation_matching | crm_sync
  status: text("status").notNull(), // running | completed | failed
  dealId: integer("deal_id").references(() => deals.id),
  triggeredBy: text("triggered_by"), // n8n | manual | scheduled
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  errorMessage: text("error_message"),
  metadata: text("metadata"), // JSON
});

// ════════════════════════════════════════════════════════════════
// FATHOM TRANSCRIPTS TABLE — raw transcripts pulled from Fathom
// ════════════════════════════════════════════════════════════════

export const fathomTranscripts = sqliteTable("fathom_transcripts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordingId: integer("recording_id").notNull().unique(),
  title: text("title").notNull(),
  meetingUrl: text("meeting_url"),
  scheduledStart: text("scheduled_start"),
  scheduledEnd: text("scheduled_end"),
  recordingStart: text("recording_start"),
  recordingEnd: text("recording_end"),
  transcript: text("transcript").notNull(), // JSON array of speaker/text/timestamp
  eisenSpeakers: text("eisen_speakers"), // JSON array of internal speakers
  isSalesCall: integer("is_sales_call", { mode: "boolean" }).notNull().default(false),
  salesPerson: text("sales_person"),
  status: text("status").notNull().default("pending"), // pending | processing | processed | skipped | error
  dealId: integer("deal_id").references(() => deals.id),
  errorMessage: text("error_message"),
  pulledAt: text("pulled_at").notNull().$defaultFn(() => new Date().toISOString()),
  processedAt: text("processed_at"),
});

// ── Type exports ──
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type DealContact = typeof dealContacts.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type FathomTranscript = typeof fathomTranscripts.$inferSelect;
