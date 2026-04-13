import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDeal, useReviewDeal, type Deal, type DealContact } from "../lib/api";

// ── Constants ──

const STAGE_LABELS: Record<string, string> = {
  "0": "0 - Prospect - Needs Analysis",
  "1": "1 - Qualified",
  "2": "2 - Business Case/Testing",
  "3": "3 - Terms",
  "4": "4 - Legal / Due Diligence",
  closed_won: "Closed-Won",
  closed_lost: "Closed-Lost",
};

const SOURCE_ICONS: Record<string, string> = {
  fathom: "🎙️",
  calendar: "📅",
  email: "📧",
  badge_scanner: "📛",
  hubspot: "🟠",
  gino: "📛",
};

const PIPELINE_OPTIONS = ["[NEW] Sales Pipeline"];
const DEAL_STAGE_OPTIONS = ["0", "1", "2", "3", "4", "closed_won", "closed_lost"];
const PRIMARY_DEAL_SOURCE_OPTIONS = ["Inbound", "Outbound", "Investor Network", "Channel Partner", "Conference", "Customer Referral"];
const ICP_OPTIONS = ["ICP 1", "ICP 2"];
const DEAL_TYPE_OPTIONS = ["Abandoned Accounts", "Forced Closures", "Stale Checks", "Crypto", "Stablecoin"];
const NUM_STATE_REPORTS_OPTIONS = ["0-5", "6-10", "11-25", "26-50"];

type FieldType = "text" | "number" | "date" | "select";

interface FieldDef {
  num: number;
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
}

const FIELD_DEFS: FieldDef[] = [
  { num: 1, key: "companyName", label: "Company Name", type: "text" },
  { num: 2, key: "amount", label: "Amount", type: "number" },
  { num: 3, key: "closeDate", label: "Close Date", type: "date" },
  { num: 4, key: "pipeline", label: "Pipeline", type: "select", options: PIPELINE_OPTIONS },
  { num: 5, key: "dealStage", label: "Deal Stage", type: "select", options: DEAL_STAGE_OPTIONS },
  { num: 6, key: "dealSourcePerson", label: "Deal Source Person", type: "text" },
  { num: 7, key: "primaryDealSource", label: "Primary Deal Source", type: "select", options: PRIMARY_DEAL_SOURCE_OPTIONS },
  { num: 8, key: "dealSourceDetails", label: "Deal Source Details", type: "text" },
  { num: 9, key: "dealDescription", label: "Deal Description", type: "text" },
  { num: 10, key: "icp", label: "ICP", type: "select", options: ICP_OPTIONS },
  { num: 11, key: "dealType", label: "Deal Type", type: "select", options: DEAL_TYPE_OPTIONS },
  { num: 12, key: "createDate", label: "Create Date", type: "date" },
  { num: 13, key: "lastContacted", label: "Last Contacted", type: "date" },
  { num: 14, key: "dealOwner", label: "Deal Owner", type: "text" },
  { num: 15, key: "forecastProbability", label: "Forecast Probability", type: "number" },
  { num: 16, key: "numCustomerAccounts", label: "Number of Customer Accounts", type: "number" },
  { num: 17, key: "numStateReports", label: "Number of State Reports", type: "select", options: NUM_STATE_REPORTS_OPTIONS },
  { num: 18, key: "numDueDiligenceLetters", label: "DD Letters Sent", type: "number" },
  { num: 19, key: "contractTerm", label: "Contract Term", type: "text" },
  { num: 20, key: "disbursementPricing", label: "Disbursement Pricing", type: "text" },
  { num: 21, key: "escheatmentPricing", label: "Escheatment Pricing", type: "text" },
  { num: 22, key: "dollarValuePerItem", label: "Dollar Value / Item", type: "text" },
  { num: 23, key: "annualPlatformFee", label: "Annual Platform Fee", type: "number" },
  { num: 24, key: "implementationFee", label: "Implementation Fee", type: "number" },
  { num: 25, key: "numEscheatmentsPerYear", label: "Escheatments / Year", type: "number" },
];

// ── Helpers ──

function formatCurrency(val: number | null): string {
  if (val == null) return "—";
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(val: string | null): string {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return val;
  }
}

function formatDisplayValue(key: string, val: unknown): string {
  if (val == null || val === "") return "—";
  if (key === "amount" || key === "annualPlatformFee" || key === "implementationFee") return formatCurrency(Number(val));
  if (key === "closeDate" || key === "createDate" || key === "lastContacted") return formatDate(String(val));
  if (key === "dealStage") return STAGE_LABELS[String(val)] ?? String(val);
  if (key === "forecastProbability") return `${val}%`;
  if (key === "numCustomerAccounts" || key === "numEscheatmentsPerYear") return Number(val).toLocaleString();
  return String(val);
}

function getDealValue(deal: Deal, key: string): string {
  const val = (deal as Record<string, unknown>)[key];
  if (val == null) return "";
  return String(val);
}

function toDateInputValue(val: string | null): string {
  if (!val) return "";
  try {
    return new Date(val).toISOString().split("T")[0];
  } catch {
    return val;
  }
}

function formatJson(raw: string | null): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function parseSource(rawInputData: string | null): { source: string; details: Record<string, unknown> } | null {
  if (!rawInputData) return null;
  try {
    const parsed = JSON.parse(rawInputData);
    const source = parsed.source ?? "unknown";
    return { source, details: parsed };
  } catch {
    return null;
  }
}

// ── Shared Sub-components ──

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm ${className ?? ""}`}>
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  );
}

function FieldBadge({ num }: { num: number }) {
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-lg bg-black text-[10px] font-bold text-white shrink-0">
      {num}
    </span>
  );
}

function EditableField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (val: string) => void;
}) {
  const base = "w-full bg-white border border-[#e5e5e5] rounded-xl px-3 py-2 text-sm text-gray-700 focus:border-black focus:outline-none transition-colors";

  if (field.type === "select") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">—</option>
        {field.options?.map((opt) => (
          <option key={opt} value={opt}>
            {field.key === "dealStage" ? (STAGE_LABELS[opt] ?? opt) : opt}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "date") {
    return (
      <input
        type="date"
        value={toDateInputValue(value)}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      />
    );
  }

  if (field.type === "number") {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={base}
    />
  );
}

// ── Deal Flow Indicator ──

function DealFlowIndicator({ deal }: { deal: Deal }) {
  const steps = [
    { key: "ingested", label: "Data Ingested", done: true },
    { key: "processed", label: "Claude Processed", done: !!deal.claudeReasoning },
    { key: "matched", label: "Match Check", done: !!deal.matchResult },
    {
      key: "reviewed",
      label: deal.reviewStatus === "pending" ? "Awaiting Review" : "Reviewed",
      done: deal.reviewStatus !== "pending",
      active: deal.reviewStatus === "pending",
    },
    { key: "synced", label: "HubSpot Synced", done: deal.syncedToHubspot },
  ];

  return (
    <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Deal Flow</h3>
      <div className="flex items-center gap-0 overflow-x-auto">
        {steps.map((step, i) => {
          const isActive = "active" in step && step.active;
          const bg = step.done
            ? "bg-black text-white"
            : isActive
              ? "bg-gray-400 text-white"
              : "bg-[#f5f5f5] text-gray-400 border border-[#e5e5e5]";
          return (
            <div key={step.key} className="flex items-center shrink-0">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${bg}`}>
                {step.done ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : isActive ? (
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-gray-300" />
                )}
                {step.label}
              </div>
              {i < steps.length - 1 && (
                <svg className="w-5 h-5 text-gray-300 mx-1 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Data Sources Section ──

function DataSourcesSection({ deal }: { deal: Deal }) {
  const sourceData = parseSource(deal.rawInputData);
  return (
    <Section title="Data Sources">
      {sourceData ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl border border-[#e5e5e5] text-sm font-medium text-gray-700 bg-[#f5f5f5]">
              <span>{SOURCE_ICONS[sourceData.source] ?? "📄"}</span>
              <span className="capitalize">{sourceData.source.replace("_", " ")}</span>
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {Object.entries(sourceData.details)
              .filter(([key, val]) => key !== "source" && typeof val !== "object")
              .map(([key, val]) => (
                <div key={key} className="bg-[#f5f5f5] rounded-xl px-3 py-2">
                  <span className="text-xs text-gray-400 capitalize">{key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</span>
                  <p className="text-gray-700 mt-0.5">{String(val)}</p>
                </div>
              ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400">No source data recorded</p>
      )}
    </Section>
  );
}

// ── Contacts Section ──

function ContactsSection({ contacts }: { contacts: DealContact[] }) {
  return (
    <div className="mt-5 pt-4 border-t border-[#e5e5e5]">
      <div className="flex items-center gap-1.5 mb-3">
        <FieldBadge num={26} />
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Associated Contacts</span>
        <span className="text-xs text-gray-400 ml-1">({contacts.length})</span>
      </div>
      {contacts.length > 0 ? (
        <div className="space-y-2 ml-6.5">
          {contacts.map((contact) => {
            const initials = `${(contact.firstName?.[0] ?? "").toUpperCase()}${(contact.lastName?.[0] ?? "").toUpperCase()}`;
            return (
              <div key={contact.id} className="flex items-center justify-between bg-[#f5f5f5] rounded-2xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-black flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-white">{initials}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {contact.firstName} {contact.lastName ?? ""}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                      {contact.email && <span>{contact.email}</span>}
                      {contact.title && (
                        <>
                          <span className="text-gray-300">&#183;</span>
                          <span>{contact.title}</span>
                        </>
                      )}
                      {contact.company && (
                        <>
                          <span className="text-gray-300">&#183;</span>
                          <span>{contact.company}</span>
                        </>
                      )}
                    </div>
                    {contact.associationReason && (
                      <p className="text-xs text-gray-400 mt-1">{contact.associationReason}</p>
                    )}
                  </div>
                </div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                  contact.role === "primary"
                    ? "bg-black text-white"
                    : "bg-white text-gray-500 border border-[#e5e5e5]"
                }`}>
                  {contact.role}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="ml-6.5 text-sm text-gray-400">No contacts associated</p>
      )}
    </div>
  );
}

// ── Claude Reasoning (collapsible) ──

function ClaudeReasoningSection({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-2xl shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 cursor-pointer"
      >
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Claude's Reasoning</h3>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-[#e5e5e5] pt-4">
          <div className="bg-[#f5f5f5] rounded-xl p-4 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
            {reasoning}
          </div>
        </div>
      )}
    </div>
  );
}

// ── System Info (collapsible) ──

function SystemInfoSection({ deal }: { deal: Deal }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-2xl shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 cursor-pointer"
      >
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">System Info</h3>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-[#e5e5e5] pt-4">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider">Match Result</dt>
              <dd className="mt-1 text-sm text-gray-700 capitalize">{deal.matchResult ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider">Matched Deal ID</dt>
              <dd className="mt-1 text-sm text-gray-700">{deal.matchedDealId?.toString() ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider">Synced to HubSpot</dt>
              <dd className="mt-1 text-sm text-gray-700">{deal.syncedToHubspot ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider">HubSpot Deal ID</dt>
              <dd className="mt-1 text-sm text-gray-700">{deal.hubspotDealId ?? "—"}</dd>
            </div>
          </dl>
          {deal.rawInputData && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Raw Input Data</p>
              <pre className="bg-[#f5f5f5] rounded-xl p-4 text-xs text-gray-600 overflow-x-auto max-h-80 font-mono leading-relaxed">
                {formatJson(deal.rawInputData)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ── FLOW 1: NEW DEAL ──
// ════════════════════════════════════════════════════════════

function NewDealFields({
  deal,
  contacts,
  onApprove,
  onReject,
  isPending,
  isMutating,
}: {
  deal: Deal;
  contacts: DealContact[];
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  isMutating: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of FIELD_DEFS) {
      init[f.key] = getDealValue(deal, f.key);
    }
    return init;
  });

  function setField(key: string, val: string) {
    setEdits((prev) => ({ ...prev, [key]: val }));
  }

  return (
    <>
      <Section title="New Deal Fields (25 Fields)">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          {FIELD_DEFS.map((field) => (
            <div key={field.key}>
              <label className="flex items-center gap-1.5 mb-1.5">
                <FieldBadge num={field.num} />
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{field.label}</span>
              </label>
              <EditableField
                field={field}
                value={edits[field.key] ?? ""}
                onChange={(val) => setField(field.key, val)}
              />
            </div>
          ))}
        </div>
        <ContactsSection contacts={contacts} />
      </Section>

      {/* Action buttons */}
      {isPending && (
        <div className="flex items-center gap-3">
          <button
            onClick={onApprove}
            disabled={isMutating}
            className="px-6 py-2.5 bg-black hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium rounded-2xl transition-colors cursor-pointer"
          >
            Approve & Send to HubSpot
          </button>
          <button
            onClick={onReject}
            disabled={isMutating}
            className="px-6 py-2.5 bg-white hover:bg-red-50 disabled:opacity-50 text-red-600 text-sm font-medium rounded-2xl border border-red-300 transition-colors cursor-pointer"
          >
            Reject
          </button>
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════
// ── FLOW 2: UPDATE / DIFF VIEW ──
// ════════════════════════════════════════════════════════════

function UpdateDiffView({
  deal,
  oldDeal,
  contacts,
  onUpdateAll,
  onUpdateSelected,
  onReject,
  isPending,
  isMutating,
}: {
  deal: Deal;
  oldDeal: Deal | null;
  contacts: DealContact[];
  onUpdateAll: () => void;
  onUpdateSelected: () => void;
  onReject: () => void;
  isPending: boolean;
  isMutating: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of FIELD_DEFS) {
      init[f.key] = getDealValue(deal, f.key);
    }
    return init;
  });

  const changedFields = useMemo(() => {
    const set = new Set<string>();
    for (const f of FIELD_DEFS) {
      const oldVal = oldDeal ? getDealValue(oldDeal, f.key) : "";
      const newVal = getDealValue(deal, f.key);
      if (oldVal !== newVal) set.add(f.key);
    }
    return set;
  }, [deal, oldDeal]);

  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const f of FIELD_DEFS) {
      init[f.key] = changedFields.has(f.key);
    }
    return init;
  });

  function setField(key: string, val: string) {
    setEdits((prev) => ({ ...prev, [key]: val }));
  }

  function toggleField(key: string) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <>
      <Section title="Update Diff View">
        {/* Table header */}
        <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-3 items-center px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#e5e5e5] mb-2">
          <span className="w-5" />
          <span>Field</span>
          <span>Current Value</span>
          <span>New Value</span>
          <span className="w-8 text-center">Include</span>
        </div>

        <div className="divide-y divide-[#f5f5f5]">
          {FIELD_DEFS.map((field) => {
            const oldVal = oldDeal ? getDealValue(oldDeal, field.key) : "";
            const isChanged = changedFields.has(field.key);

            return (
              <div
                key={field.key}
                className={`grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-3 items-center px-3 py-2.5 rounded-xl ${
                  isChanged ? "bg-green-50" : "opacity-60"
                }`}
              >
                <FieldBadge num={field.num} />

                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{field.label}</span>

                {/* Old value */}
                <span className="text-sm text-gray-400">
                  {formatDisplayValue(field.key, oldVal) || "—"}
                </span>

                {/* New value (editable) */}
                <div>
                  <EditableField
                    field={field}
                    value={edits[field.key] ?? ""}
                    onChange={(val) => setField(field.key, val)}
                  />
                </div>

                {/* Checkbox */}
                <div className="w-8 flex justify-center">
                  <input
                    type="checkbox"
                    checked={selected[field.key] ?? false}
                    onChange={() => toggleField(field.key)}
                    className="w-4 h-4 rounded border-[#e5e5e5] text-black focus:ring-black cursor-pointer accent-black"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <ContactsSection contacts={contacts} />
      </Section>

      {/* Action buttons */}
      {isPending && (
        <div className="flex items-center gap-3">
          <button
            onClick={onUpdateAll}
            disabled={isMutating}
            className="px-6 py-2.5 bg-black hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium rounded-2xl transition-colors cursor-pointer"
          >
            Update All Changed ({changedFields.size})
          </button>
          <button
            onClick={onUpdateSelected}
            disabled={isMutating || selectedCount === 0}
            className="px-6 py-2.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-2xl border border-[#e5e5e5] transition-colors cursor-pointer"
          >
            Update Selected ({selectedCount})
          </button>
          <button
            onClick={onReject}
            disabled={isMutating}
            className="px-6 py-2.5 bg-white hover:bg-red-50 disabled:opacity-50 text-red-600 text-sm font-medium rounded-2xl border border-red-300 transition-colors cursor-pointer"
          >
            Reject
          </button>
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════
// ── MAIN COMPONENT ──
// ════════════════════════════════════════════════════════════

export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useDeal(id);
  const reviewMutation = useReviewDeal();
  const [reviewResult, setReviewResult] = useState<string | null>(null);

  const deal = data?.deal;
  const contacts = data?.contacts ?? [];

  // For update flow: fetch matched deal
  const matchedDealId = deal?.matchedDealId;
  const isUpdateFlow = deal?.matchResult === "update" || deal?.matchResult === "inconclusive";
  const { data: matchedData, isLoading: matchedLoading } = useDeal(
    isUpdateFlow && matchedDealId ? String(matchedDealId) : undefined,
  );
  const oldDeal = matchedData?.deal ?? null;

  function handleReview(decision: string) {
    if (!deal) return;
    reviewMutation.mutate(
      { id: deal.id, decision, reviewedBy: "dashboard" },
      { onSuccess: (res) => setReviewResult(res.decision) },
    );
  }

  if (isLoading) return <p className="text-gray-400 py-12 text-center">Loading deal...</p>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl px-4 py-3 text-sm">{error.message}</div>;
  if (!deal) return <p className="text-gray-400 py-12 text-center">Deal not found.</p>;

  const isPending = deal.reviewStatus === "pending" && !reviewResult;
  const isNew = deal.matchResult === "new";

  return (
    <div className="space-y-5 pb-12">
      {/* Back button */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Deals
      </button>

      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold text-gray-900">{deal.companyName}</h2>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <span className="text-xl font-semibold text-gray-700 tabular-nums">{formatCurrency(deal.amount)}</span>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-black text-white">
            {STAGE_LABELS[deal.dealStage] ?? deal.dealStage}
          </span>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
            deal.reviewStatus === "pending"
              ? "bg-black text-white"
              : "bg-white text-gray-500 border border-[#e5e5e5]"
          }`}>
            {deal.reviewStatus.replace("_", " ")}
          </span>
          {deal.matchResult && (
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium capitalize ${
              isNew
                ? "bg-black text-white"
                : "bg-white text-gray-500 border border-[#e5e5e5]"
            }`}>
              {deal.matchResult}
            </span>
          )}
        </div>
      </div>

      {/* Deal Flow Indicator */}
      <DealFlowIndicator deal={deal} />

      {/* Review result banner */}
      {reviewResult && (
        <div className="bg-white border border-[#e5e5e5] rounded-2xl px-5 py-4 shadow-sm flex items-center gap-3">
          <svg className="w-5 h-5 text-gray-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm text-gray-700">
            Deal marked as <span className="font-semibold capitalize">{reviewResult.replace("_", " ")}</span>
          </span>
        </div>
      )}

      {/* Data Sources */}
      <DataSourcesSection deal={deal} />

      {/* Main content: New Deal vs Update Diff */}
      {isNew ? (
        <NewDealFields
          deal={deal}
          contacts={contacts}
          onApprove={() => handleReview("go_live")}
          onReject={() => handleReview("inconclusive")}
          isPending={isPending}
          isMutating={reviewMutation.isPending}
        />
      ) : isUpdateFlow ? (
        matchedLoading ? (
          <p className="text-gray-400 py-8 text-center">Loading matched deal for comparison...</p>
        ) : (
          <UpdateDiffView
            deal={deal}
            oldDeal={oldDeal}
            contacts={contacts}
            onUpdateAll={() => handleReview("go_live")}
            onUpdateSelected={() => handleReview("go_live")}
            onReject={() => handleReview("inconclusive")}
            isPending={isPending}
            isMutating={reviewMutation.isPending}
          />
        )
      ) : (
        /* Fallback for deals with no matchResult yet — show as new */
        <NewDealFields
          deal={deal}
          contacts={contacts}
          onApprove={() => handleReview("go_live")}
          onReject={() => handleReview("inconclusive")}
          isPending={isPending}
          isMutating={reviewMutation.isPending}
        />
      )}

      {/* Claude Reasoning (collapsible) */}
      {deal.claudeReasoning && <ClaudeReasoningSection reasoning={deal.claudeReasoning} />}

      {/* System Info (collapsible) */}
      <SystemInfoSection deal={deal} />
    </div>
  );
}
