// ── Eisen domain pattern for filtering internal contacts ──
export const EISEN_DOMAIN_PATTERN = /@eisen\./i;

// ── Amount tiers (in dollars) ──
export const AMOUNT_TIERS = [25_000, 50_000, 100_000, 150_000, 250_000, 500_000, 1_000_000] as const;

// ── Deal stage advancement rules ──
export const STAGE_ADVANCEMENT_RULES: Record<string, { nextStage: string; triggers: string[] }> = {
  "0": {
    nextStage: "1",
    triggers: [
      "confirmed business need",
      "budget discussed",
      "authority identified",
      "timeline discussed",
      "BANT criteria partially met",
    ],
  },
  "1": {
    nextStage: "2",
    triggers: [
      "demo discussed or scheduled",
      "POC or pilot discussed",
      "demo completed",
      "pilot initiated",
      "technical evaluation underway",
    ],
  },
  "2": {
    nextStage: "3",
    triggers: [
      "pricing introduced",
      "contract terms discussed",
      "proposal sent",
      "commercial negotiation started",
    ],
  },
  "3": {
    nextStage: "4",
    triggers: [
      "legal review initiated",
      "redlines exchanged",
      "due diligence underway",
      "compliance review started",
      "security questionnaire received",
    ],
  },
  "4": {
    nextStage: "closed_won",
    triggers: [
      "signed contract received",
      "explicit confirmation of deal closure",
      "PO issued",
    ],
  },
};

// ── Closed-Lost triggers ──
export const CLOSED_LOST_TRIGGERS = [
  "prospect explicitly declined",
  "competitor chosen",
  "90+ days with no contact",
  "budget pulled",
  "project cancelled",
];

// ── ICP classification keywords ──
export const ICP_KEYWORDS = {
  "ICP 1": {
    label: "Financial Services",
    keywords: [
      "bank",
      "banking",
      "sponsor bank",
      "community bank",
      "credit union",
      "fintech",
      "crypto",
      "neobank",
      "broker dealer",
      "broker-dealer",
      "wealth management",
      "wealth manager",
      "financial services",
      "financial institution",
      "payments",
      "lending",
      "insurance",
    ],
  },
  "ICP 2": {
    label: "Corporates",
    keywords: [
      "corporate",
      "accounts payable",
      "accounts receivable",
      "AP/AR",
      "treasury",
      "enterprise",
      "fortune 500",
      "manufacturing",
      "retail",
      "healthcare",
      "technology",
    ],
  },
} as const;

// ── Deal stage labels for display ──
export const DEAL_STAGE_DISPLAY: Record<string, string> = {
  "0": "0 - Prospect - Needs Analysis",
  "1": "1 - Qualified",
  "2": "2 - Business Case/Testing",
  "3": "3 - Terms",
  "4": "4 - Legal / Due Diligence",
  closed_won: "Closed-Won",
  closed_lost: "Closed-Lost",
};

// ── HubSpot property name mappings ──
export const HUBSPOT_DEAL_PROPERTY_MAP: Record<string, string> = {
  companyName: "dealname",
  amount: "amount",
  closeDate: "closedate",
  pipeline: "pipeline",
  dealStage: "dealstage",
  dealSourcePerson: "deal_source_person",
  primaryDealSource: "primary_deal_source",
  dealSourceDetails: "deal_source_details",
  dealDescription: "description",
  icp: "icp",
  dealType: "deal_type",
  createDate: "createdate",
  lastContacted: "notes_last_contacted",
  dealOwner: "hubspot_owner_id",
  forecastProbability: "hs_forecast_probability",
  numCustomerAccounts: "num_customer_accounts",
  numStateReports: "num_state_reports",
  numDueDiligenceLetters: "num_due_diligence_letters",
  contractTerm: "contract_term",
  disbursementPricing: "disbursement_pricing",
  escheatmentPricing: "escheatment_pricing",
};
