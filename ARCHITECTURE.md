# CRM Deal Automation — System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                              │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐ │
│  │  Fathom   │  │ Gil's Gmail  │  │ Jerry's Gmail│  │  Gino   │ │
│  │  (calls)  │  │  & Calendar  │  │  & Calendar  │  │ (badge) │ │
│  └────┬─────┘  └──────┬───────┘  └──────┬───────┘  └────┬────┘ │
│       │               │                 │                │      │
└───────┼───────────────┼─────────────────┼────────────────┼──────┘
        │               │                 │                │
        ▼               ▼                 ▼                ▼
┌───────────────────────────────────────────────────────────────────┐
│                      INGESTION LAYER                              │
│                                                                   │
│  ┌─────────────────┐    ┌────────────────────────────────────┐   │
│  │  Fathom Poller   │    │           n8n Workflows             │   │
│  │  (every 30 min)  │    │                                    │   │
│  │                  │    │  • Gil Email & Calendar (30 min)   │   │
│  │  • Pull all      │    │  • Jerry Email & Calendar (30 min) │   │
│  │    transcripts   │    │  • HubSpot Sync (6 hours)          │   │
│  │  • Store in DB   │    │                                    │   │
│  │  • Skip closed   │    │  Sends to: POST /api/ingest        │   │
│  │    deals         │    │                                    │   │
│  └────────┬─────────┘    └──────────────┬─────────────────────┘   │
│           │                             │                         │
└───────────┼─────────────────────────────┼─────────────────────────┘
            │                             │
            ▼                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                    EXPRESS API SERVER                              │
│                    (Replit: crm-deal-automationzip.replit.app)     │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                    PRE-CHECK FILTER                         │   │
│  │                                                            │   │
│  │  1. Is company closed-won? → SKIP                         │   │
│  │  2. Is company closed-lost? → SKIP                        │   │
│  │  3. Is it an internal meeting? → SKIP                     │   │
│  │  4. Pass → send to Claude                                 │   │
│  └────────────────────────┬───────────────────────────────────┘   │
│                           │                                       │
│                           ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              CLAUDE REASONING ENGINE                        │   │
│  │              (Anthropic API - Sonnet)                       │   │
│  │                                                            │   │
│  │  Input: transcript + emails + calendar                     │   │
│  │  Output: 26-field Deal Box                                 │   │
│  │                                                            │   │
│  │  Fields extracted:                                         │   │
│  │   1. Company Name        14. Deal Owner                   │   │
│  │   2. Amount ($25K-$1M)   15. Forecast Probability         │   │
│  │   3. Close Date          16. Customer Accounts            │   │
│  │   4. Pipeline            17. State Reports                │   │
│  │   5. Deal Stage (0-4)    18. DD Letters Sent              │   │
│  │   6. Source Person       19. Contract Term                │   │
│  │   7. Primary Source      20. Disbursement Pricing         │   │
│  │   8. Source Details      21. Escheatment Pricing          │   │
│  │   9. Description         22. Dollar Value/Item            │   │
│  │  10. ICP (1 or 2)       23. Annual Platform Fee           │   │
│  │  11. Deal Type           24. Implementation Fee           │   │
│  │  12. Create Date         25. Escheatments/Year            │   │
│  │  13. Last Contacted      26. Associated Contacts          │   │
│  │                                                            │   │
│  │  Probability logic: Intent × Ability                      │   │
│  │  • Stage 0-1, first call: 5-30% max                      │   │
│  │  • Both intent + ability must be high for >50%            │   │
│  └────────────────────────┬───────────────────────────────────┘   │
│                           │                                       │
│                           ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                  DEAL MATCHER                               │   │
│  │                                                            │   │
│  │  Checks against: Active deals only (stages 0-4)           │   │
│  │  Ignores: closed-won, closed-lost                         │   │
│  │                                                            │   │
│  │  Composite key: Company Name + Deal Type                  │   │
│  │                                                            │   │
│  │  Results:                                                  │   │
│  │  ┌─────────────────┐                                      │   │
│  │  │ NEW             │ → No match found                     │   │
│  │  │ UPDATE          │ → Exact match, same deal type        │   │
│  │  │ INCONCLUSIVE    │ → Fuzzy match, needs human review    │   │
│  │  └─────────────────┘                                      │   │
│  └────────────────────────┬───────────────────────────────────┘   │
│                           │                                       │
│                           ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                   REVIEW ROUTING                            │   │
│  │                                                            │   │
│  │  • Save deal to SQLite DB                                 │   │
│  │  • Send Slack notification with:                          │   │
│  │    [Go Live] [Review] [Inconclusive]                      │   │
│  │  • Show in Dashboard → Review tab                         │   │
│  └────────────────────────┬───────────────────────────────────┘   │
│                           │                                       │
└───────────────────────────┼───────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌──────────────┐
        │ Go Live  │ │ Review   │ │ Inconclusive │
        │          │ │          │ │              │
        │ Write to │ │ Open in  │ │ Flag for     │
        │ HubSpot  │ │ HubSpot  │ │ human review │
        │          │ │ for edit │ │              │
        └──────────┘ └──────────┘ └──────────────┘


┌───────────────────────────────────────────────────────────────────┐
│                       DASHBOARD                                   │
│                       (React + Vite)                              │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐        │
│  │   Review     │  │ Active Deals │  │  Deal Database   │        │
│  │             │  │              │  │                  │        │
│  │ Claude-     │  │ Stages 0-4   │  │ All 310 HubSpot │        │
│  │ processed   │  │ only         │  │ deals            │        │
│  │ deals       │  │              │  │                  │        │
│  │ pending     │  │ No closed-   │  │ Filters: stage,  │        │
│  │ Go Live /   │  │ won/lost     │  │ source, ICP,     │        │
│  │ Review /    │  │              │  │ date range       │        │
│  │ Inconclusive│  │              │  │                  │        │
│  └─────────────┘  └──────────────┘  └──────────────────┘        │
│                                                                   │
│  Deal Detail: 26 numbered fields + Deal Flow + Data Sources      │
│  + Claude's Reasoning + Associated Contacts                      │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────┐
│                       DATA STORES                                 │
│                                                                   │
│  SQLite (Drizzle ORM)                                            │
│  ├── deals (38 columns — 26 fields + metadata)                   │
│  ├── contacts                                                     │
│  ├── deal_contacts (join table)                                   │
│  ├── fathom_transcripts (993 stored, ~286 to process)            │
│  └── workflow_runs                                                │
│                                                                   │
│  External:                                                        │
│  ├── HubSpot CRM (source of truth for existing deals)            │
│  ├── Fathom AI (meeting transcripts)                             │
│  ├── Gmail (email threads)                                        │
│  ├── Google Calendar (meeting metadata)                           │
│  └── Slack (review notifications)                                │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────┐
│                    STARTUP SEQUENCE                               │
│                                                                   │
│  1. Load environment variables                                    │
│  2. Pull ALL HubSpot deals (know what's closed)                  │
│  3. Batch-skip closed + internal Fathom transcripts              │
│  4. Start Fathom poller (30 min interval)                        │
│  5. Process pending transcripts (1 every ~2 min, rate limited)   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────┐
│                    API ENDPOINTS                                  │
│                                                                   │
│  GET  /api/health                                                 │
│  GET  /api/deals              — list all deals                    │
│  GET  /api/deals/:id          — deal + contacts                   │
│  POST /api/deals              — create deal                       │
│  PUT  /api/deals/:id          — update deal                       │
│  POST /api/deals/process      — Claude process → match → save     │
│  POST /api/deals/:id/review   — go_live / review / inconclusive   │
│  POST /api/hubspot/pull-deals — sync HubSpot → local DB          │
│  POST /api/hubspot/sync-deal/:id — push deal → HubSpot           │
│  POST /api/ingest             — receive data from n8n             │
│  POST /api/slack/webhook      — Slack button actions              │
│  POST /api/fathom/poll        — manual Fathom pull                │
│  POST /api/fathom/batch-skip  — batch filter transcripts          │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```
