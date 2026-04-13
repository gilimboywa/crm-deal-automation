import "dotenv/config";
import { db } from "./index.js";
import { deals, contacts, dealContacts } from "./schema.js";

const now = new Date().toISOString();

// Seed deals
const seedDeals = [
  {
    companyName: "Acme Financial Services",
    amount: 250000,
    closeDate: "2026-12-31",
    pipeline: "[NEW] Sales Pipeline",
    dealStage: "2",
    dealSourcePerson: "John Smith",
    primaryDealSource: "Conference",
    dealSourceDetails: "Money 20/20 2026",
    dealDescription: "Acme is a mid-size community bank looking for abandoned accounts and escheatment solutions. They currently manage ~15,000 customer accounts across 12 states.",
    icp: "ICP 1",
    dealType: "Abandoned Accounts",
    createDate: "2026-03-15T10:00:00.000Z",
    lastContacted: "2026-04-07T14:30:00.000Z",
    dealOwner: "Sarah Chen",
    forecastProbability: 45,
    numCustomerAccounts: 15000,
    numStateReports: "11-25",
    numDueDiligenceLetters: 0,
    contractTerm: null,
    disbursementPricing: null,
    escheatmentPricing: null,
    matchResult: "new",
    reviewStatus: "pending",
    rawInputData: JSON.stringify({ source: "fathom", meetingDate: "2026-04-07" }),
    claudeReasoning: "Company identified as community bank from Fathom transcript. Badge scanned at Money 20/20. ICP 1 classification based on banking industry. Stage 2 assigned because POC discussion occurred during the meeting.",
    createdAt: now,
    updatedAt: now,
  },
  {
    companyName: "TechCorp Solutions",
    amount: 100000,
    closeDate: "2026-12-31",
    pipeline: "[NEW] Sales Pipeline",
    dealStage: "1",
    dealSourcePerson: "Mike Davis",
    primaryDealSource: "Outbound",
    dealSourceDetails: "Mike Davis initiated cold outreach",
    dealDescription: "TechCorp is a mid-market SaaS company with significant AP/AR operations. Interested in stale checks processing.",
    icp: "ICP 2",
    dealType: "Stale Checks",
    createDate: "2026-04-01T09:00:00.000Z",
    lastContacted: "2026-04-05T16:00:00.000Z",
    dealOwner: "Mike Davis",
    forecastProbability: 25,
    numCustomerAccounts: null,
    numStateReports: "0-5",
    numDueDiligenceLetters: 0,
    contractTerm: null,
    disbursementPricing: null,
    escheatmentPricing: null,
    matchResult: "new",
    reviewStatus: "go_live",
    syncedToHubspot: true,
    hubspotDealId: "12345678",
    rawInputData: JSON.stringify({ source: "email", subject: "Re: Stale checks processing" }),
    claudeReasoning: "Corporate company identified from email domain lookup. ICP 2 based on AP/AR needs. Stage 1 qualified based on confirmed business need in email thread.",
    createdAt: now,
    updatedAt: now,
  },
  {
    companyName: "CryptoVault Inc",
    amount: 500000,
    closeDate: "2026-12-31",
    pipeline: "[NEW] Sales Pipeline",
    dealStage: "3",
    dealSourcePerson: "Sarah Chen",
    primaryDealSource: "Investor Network",
    dealSourceDetails: "Introduced by Sequoia Capital",
    dealDescription: "CryptoVault is a digital asset custodian needing crypto escheatment compliance. Large deal with complex regulatory requirements.",
    icp: "ICP 1",
    dealType: "Crypto",
    createDate: "2026-02-20T11:00:00.000Z",
    lastContacted: "2026-04-08T10:00:00.000Z",
    dealOwner: "Sarah Chen",
    forecastProbability: 65,
    numCustomerAccounts: 50000,
    numStateReports: "26-50",
    numDueDiligenceLetters: 3,
    contractTerm: "3 years",
    disbursementPricing: "$2.50 per disbursement",
    escheatmentPricing: "$1.75 per report",
    matchResult: "update",
    reviewStatus: "pending",
    rawInputData: JSON.stringify({ source: "fathom", meetingDate: "2026-04-08" }),
    claudeReasoning: "Existing deal updated after latest Fathom call. Terms discussion detected — advanced from Stage 2 to Stage 3. Pricing details extracted from proposal shared via email.",
    createdAt: now,
    updatedAt: now,
  },
  {
    companyName: "FirstNational Credit Union",
    amount: 50000,
    closeDate: "2026-12-31",
    pipeline: "[NEW] Sales Pipeline",
    dealStage: "0",
    dealSourcePerson: null,
    primaryDealSource: "Inbound",
    dealSourceDetails: "Website inquiry",
    dealDescription: "Small credit union inquiring about forced closures process.",
    icp: "ICP 1",
    dealType: "Forced Closures",
    createDate: "2026-04-09T08:00:00.000Z",
    lastContacted: "2026-04-09T08:00:00.000Z",
    dealOwner: null,
    forecastProbability: 10,
    numCustomerAccounts: 2000,
    numStateReports: "0-5",
    numDueDiligenceLetters: 0,
    contractTerm: null,
    disbursementPricing: null,
    escheatmentPricing: null,
    matchResult: "inconclusive",
    reviewStatus: "inconclusive",
    rawInputData: JSON.stringify({ source: "email", subject: "Inquiry about forced closures" }),
    claudeReasoning: "Partial company name match with 'First National Bank' in existing deals. Different entity type (credit union vs bank). Flagged as inconclusive for human review.",
    createdAt: now,
    updatedAt: now,
  },
];

// Seed contacts
const seedContacts = [
  {
    firstName: "Alice",
    lastName: "Johnson",
    email: "alice.johnson@acmefinancial.com",
    phone: "+1-555-0101",
    company: "Acme Financial Services",
    title: "VP of Operations",
    associationReason: "Initial meeting attendee",
    firstSeenDate: "2026-03-15",
    createdAt: now,
  },
  {
    firstName: "Bob",
    lastName: "Williams",
    email: "bob.williams@acmefinancial.com",
    company: "Acme Financial Services",
    title: "Head of Compliance",
    associationReason: "Subsequent meeting participant",
    firstSeenDate: "2026-04-07",
    createdAt: now,
  },
  {
    firstName: "Carol",
    lastName: "Martinez",
    email: "carol@techcorp.io",
    phone: "+1-555-0202",
    company: "TechCorp Solutions",
    title: "CFO",
    associationReason: "Email thread participant",
    firstSeenDate: "2026-04-01",
    createdAt: now,
  },
  {
    firstName: "David",
    lastName: "Park",
    email: "david.park@cryptovault.com",
    phone: "+1-555-0303",
    company: "CryptoVault Inc",
    title: "CEO",
    linkedinUrl: "https://linkedin.com/in/davidpark",
    associationReason: "Badge scan contact",
    firstSeenDate: "2026-02-20",
    createdAt: now,
  },
];

async function seed() {
  console.log("Seeding database...");

  // Clear existing data
  db.delete(dealContacts).run();
  db.delete(contacts).run();
  db.delete(deals).run();

  // Insert deals
  for (const deal of seedDeals) {
    db.insert(deals).values(deal).run();
  }
  console.log(`Inserted ${seedDeals.length} deals`);

  // Insert contacts
  for (const contact of seedContacts) {
    db.insert(contacts).values(contact).run();
  }
  console.log(`Inserted ${seedContacts.length} contacts`);

  // Associate contacts with deals
  const associations = [
    { dealId: 1, contactId: 1, role: "primary" },
    { dealId: 1, contactId: 2, role: "secondary" },
    { dealId: 2, contactId: 3, role: "primary" },
    { dealId: 3, contactId: 4, role: "primary" },
  ];

  for (const assoc of associations) {
    db.insert(dealContacts).values(assoc).run();
  }
  console.log(`Created ${associations.length} deal-contact associations`);

  console.log("Seed complete!");
}

seed();
