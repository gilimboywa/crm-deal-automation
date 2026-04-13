// ── DealBox: All 22 fields as returned by Claude ──

export interface DealBox {
  // Field 1
  companyName: string;
  // Field 2
  amount: number | null;
  // Field 3
  closeDate: string | null;
  // Field 4
  pipeline: string;
  // Field 5
  dealStage: string;
  // Field 6
  dealSourcePerson: string | null;
  // Field 7
  primaryDealSource: string | null;
  // Field 8
  dealSourceDetails: string | null;
  // Field 9
  dealDescription: string | null;
  // Field 10
  icp: string | null;
  // Field 11
  dealType: string | null;
  // Field 12
  createDate: string;
  // Field 13
  lastContacted: string | null;
  // Field 14
  dealOwner: string | null;
  // Field 15
  forecastProbability: number | null;
  // Field 16
  numCustomerAccounts: number | null;
  // Field 17
  numStateReports: string | null;
  // Field 18
  numDueDiligenceLetters: number | null;
  // Field 19
  contractTerm: string | null;
  // Field 20
  disbursementPricing: string | null;
  // Field 21
  escheatmentPricing: string | null;
  // Field 22
  dollarValuePerItem: string | null;
  // Field 23
  annualPlatformFee: number | null;
  // Field 24
  implementationFee: number | null;
  // Field 25
  numEscheatmentsPerYear: number | null;
  // Field 26
  associatedContacts: AssociatedContact[];
}

export interface AssociatedContact {
  firstName: string;
  lastName: string | null;
  email: string | null;
  title: string | null;
  company: string | null;
  associationReason: string | null;
  firstSeenDate: string | null;
  role: "primary" | "secondary";
}

// ── Processing Input from n8n / manual / any source ──

export interface MeetingMetadata {
  title?: string;
  date?: string;
  attendees?: string[];
  organizer?: string;
}

export interface ProcessingInput {
  sourceType: "fathom" | "email" | "calendar" | "gino_badge" | "manual" | "combined";
  data: {
    transcript?: string;
    summary?: string;
    meetingMetadata?: MeetingMetadata;
    emailThread?: string;
    badgeScan?: string;
    [key: string]: unknown;
  };
}

// ── Match Result ──

export type MatchResult = {
  result: "new" | "update" | "inconclusive";
  matchedDealId?: number;
  confidence: number;
  reason: string;
};
