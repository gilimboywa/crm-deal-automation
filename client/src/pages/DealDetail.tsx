import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDeal, useReviewDeal } from "../lib/api";

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

function NumberedField({ num, label, value }: { num: number; label: string; value: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 mb-1">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-lg bg-black text-[10px] font-bold text-white shrink-0">
          {num}
        </span>
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
      </dt>
      <dd className="ml-6.5 text-sm text-gray-700">{value || "—"}</dd>
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm ${className ?? ""}`}>
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  );
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

export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useDeal(id);
  const reviewMutation = useReviewDeal();
  const [systemOpen, setSystemOpen] = useState(false);
  const [reviewResult, setReviewResult] = useState<string | null>(null);

  const deal = data?.deal;
  const contacts = data?.contacts ?? [];

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
  const sourceData = parseSource(deal.rawInputData);

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
        <div className="flex items-center gap-3 mt-3">
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
              deal.matchResult === "new"
                ? "bg-black text-white"
                : "bg-white text-gray-500 border border-[#e5e5e5]"
            }`}>
              {deal.matchResult}
            </span>
          )}
        </div>
      </div>

      {/* Deal Flow */}
      <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Deal Flow</h3>
        <div className="flex items-center gap-0 overflow-x-auto">
          {[
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
          ].map((step, i, arr) => {
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
                {i < arr.length - 1 && (
                  <svg className="w-5 h-5 text-gray-300 mx-1 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Review actions */}
      {isPending && (
        <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm flex items-center gap-4">
          <span className="text-sm text-gray-500 font-medium">Pending Review</span>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => handleReview("go_live")} disabled={reviewMutation.isPending}
              className="px-5 py-2.5 bg-black hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium rounded-2xl transition-colors cursor-pointer">
              Go Live
            </button>
            <button onClick={() => handleReview("review")} disabled={reviewMutation.isPending}
              className="px-5 py-2.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-2xl border border-[#e5e5e5] transition-colors cursor-pointer">
              Review
            </button>
            <button onClick={() => handleReview("inconclusive")} disabled={reviewMutation.isPending}
              className="px-5 py-2.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-2xl border border-[#e5e5e5] transition-colors cursor-pointer">
              Inconclusive
            </button>
          </div>
        </div>
      )}

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
      <Section title="Data Sources">
        {sourceData ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(() => {
                const icon = SOURCE_ICONS[sourceData.source] ?? "📄";
                return (
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl border border-[#e5e5e5] text-sm font-medium text-gray-700 bg-[#f5f5f5]">
                    <span>{icon}</span>
                    <span className="capitalize">{sourceData.source.replace("_", " ")}</span>
                  </span>
                );
              })()}
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

      {/* All 22 HubSpot Deal Properties */}
      <Section title="HubSpot Deal Properties (22 Fields)">
        <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          <NumberedField num={1} label="Company Name" value={deal.companyName} />
          <NumberedField num={2} label="Amount" value={formatCurrency(deal.amount)} />
          <NumberedField num={3} label="Close Date" value={formatDate(deal.closeDate)} />
          <NumberedField num={4} label="Pipeline" value={deal.pipeline} />
          <NumberedField num={5} label="Deal Stage" value={STAGE_LABELS[deal.dealStage] ?? deal.dealStage} />
          <NumberedField num={6} label="Deal Source Person" value={deal.dealSourcePerson ?? ""} />
          <NumberedField num={7} label="Primary Deal Source" value={deal.primaryDealSource ?? ""} />
          <NumberedField num={8} label="Deal Source Details" value={deal.dealSourceDetails ?? ""} />
          <NumberedField num={9} label="Deal Description" value={deal.dealDescription ?? ""} />
          <NumberedField num={10} label="ICP" value={deal.icp ?? ""} />
          <NumberedField num={11} label="Deal Type" value={deal.dealType ?? ""} />
          <NumberedField num={12} label="Create Date" value={formatDate(deal.createDate)} />
          <NumberedField num={13} label="Last Contacted" value={formatDate(deal.lastContacted)} />
          <NumberedField num={14} label="Deal Owner" value={deal.dealOwner ?? ""} />
          <NumberedField num={15} label="Forecast Probability" value={deal.forecastProbability != null ? `${deal.forecastProbability}%` : ""} />
          <NumberedField num={16} label="Number of Customer Accounts" value={deal.numCustomerAccounts?.toLocaleString() ?? ""} />
          <NumberedField num={17} label="Number of State Reports" value={deal.numStateReports ?? ""} />
          <NumberedField num={18} label="DD Letters Sent" value={deal.numDueDiligenceLetters?.toString() ?? ""} />
          <NumberedField num={19} label="Contract Term" value={deal.contractTerm ?? ""} />
          <NumberedField num={20} label="Disbursement Pricing" value={deal.disbursementPricing ?? ""} />
          <NumberedField num={21} label="Escheatment Pricing" value={deal.escheatmentPricing ?? ""} />
          <NumberedField num={22} label="Dollar Value / Item" value={deal.dollarValuePerItem ?? ""} />
          <NumberedField num={23} label="Annual Platform Fee" value={deal.annualPlatformFee != null ? formatCurrency(deal.annualPlatformFee) : ""} />
          <NumberedField num={24} label="Implementation Fee" value={deal.implementationFee != null ? formatCurrency(deal.implementationFee) : ""} />
          <NumberedField num={25} label="Escheatments / Year" value={deal.numEscheatmentsPerYear?.toLocaleString() ?? ""} />
        </dl>

        {/* Field 26: Associated Contacts */}
        <div className="mt-5 pt-4 border-t border-[#e5e5e5]">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-lg bg-black text-[10px] font-bold text-white shrink-0">26</span>
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
                      {/* Avatar */}
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
      </Section>

      {/* Claude Reasoning */}
      {deal.claudeReasoning && (
        <Section title="Claude's Reasoning">
          <div className="bg-[#f5f5f5] rounded-xl p-4 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
            {deal.claudeReasoning}
          </div>
        </Section>
      )}

      {/* System Info (collapsible) */}
      <div className="bg-white border border-[#e5e5e5] rounded-2xl shadow-sm">
        <button
          onClick={() => setSystemOpen(!systemOpen)}
          className="w-full flex items-center justify-between px-5 py-4 cursor-pointer"
        >
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">System Info</h3>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${systemOpen ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {systemOpen && (
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
    </div>
  );
}
