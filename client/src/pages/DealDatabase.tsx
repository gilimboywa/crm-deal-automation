import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDeals } from "../lib/api";

const STAGE_LABELS: Record<string, string> = {
  "0": "Prospect",
  "1": "Qualified",
  "2": "Business Case",
  "3": "Terms",
  "4": "Legal / DD",
  closed_won: "Closed-Won",
  closed_lost: "Closed-Lost",
};

function formatCurrency(val: number | null): string {
  if (val == null) return "--";
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(val: string | null): string {
  if (!val) return "--";
  try {
    return new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return val;
  }
}

type SortField = "companyName" | "amount" | "createDate" | "dealStage";
type SortDir = "asc" | "desc";

export default function DealDatabase() {
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useDeals(search ? { search } : undefined);
  const navigate = useNavigate();

  // Filters
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [icpFilter, setIcpFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("createDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const allDeals = data?.deals ?? [];
  const hubspotDeals = allDeals.filter((d) => d.hubspotDealId);

  // Get unique values for filter dropdowns
  const stages = useMemo(() => [...new Set(hubspotDeals.map((d) => d.dealStage))].sort(), [hubspotDeals]);
  const sources = useMemo(() => [...new Set(hubspotDeals.map((d) => d.primaryDealSource).filter(Boolean))].sort(), [hubspotDeals]);
  const icps = useMemo(() => [...new Set(hubspotDeals.map((d) => d.icp).filter(Boolean))].sort(), [hubspotDeals]);

  // Apply filters
  const deals = useMemo(() => {
    let filtered = hubspotDeals;

    if (stageFilter !== "all") {
      filtered = filtered.filter((d) => d.dealStage === stageFilter);
    }
    if (sourceFilter !== "all") {
      filtered = filtered.filter((d) => d.primaryDealSource === sourceFilter);
    }
    if (icpFilter !== "all") {
      filtered = filtered.filter((d) => d.icp === icpFilter);
    }
    if (dateFrom) {
      filtered = filtered.filter((d) => d.createDate >= dateFrom);
    }
    if (dateTo) {
      filtered = filtered.filter((d) => d.createDate <= dateTo + "T23:59:59");
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal: string | number | null;
      let bVal: string | number | null;

      switch (sortField) {
        case "amount":
          aVal = a.amount ?? 0;
          bVal = b.amount ?? 0;
          break;
        case "createDate":
          aVal = a.createDate;
          bVal = b.createDate;
          break;
        case "dealStage":
          aVal = a.dealStage;
          bVal = b.dealStage;
          break;
        default:
          aVal = a.companyName.toLowerCase();
          bVal = b.companyName.toLowerCase();
      }

      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [hubspotDeals, stageFilter, sourceFilter, icpFilter, dateFrom, dateTo, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-gray-900 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const hasFilters = stageFilter !== "all" || sourceFilter !== "all" || icpFilter !== "all" || dateFrom || dateTo;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900">Deal Database</h2>
          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-black text-white">
            {isLoading ? "..." : deals.length}
          </span>
          {hasFilters && deals.length !== hubspotDeals.length && (
            <span className="text-xs text-gray-400">of {hubspotDeals.length}</span>
          )}
        </div>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search deals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 pl-10 pr-4 py-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300 transition-colors"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-[#e5e5e5] rounded-2xl shadow-sm p-4 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Stage</label>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="text-sm bg-[#f5f5f5] border border-[#e5e5e5] rounded-xl px-3 py-1.5 text-gray-700 focus:outline-none focus:border-gray-400"
            >
              <option value="all">All</option>
              {stages.map((s) => (
                <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Source</label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="text-sm bg-[#f5f5f5] border border-[#e5e5e5] rounded-xl px-3 py-1.5 text-gray-700 focus:outline-none focus:border-gray-400"
            >
              <option value="all">All</option>
              {sources.map((s) => (
                <option key={s} value={s!}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">ICP</label>
            <select
              value={icpFilter}
              onChange={(e) => setIcpFilter(e.target.value)}
              className="text-sm bg-[#f5f5f5] border border-[#e5e5e5] rounded-xl px-3 py-1.5 text-gray-700 focus:outline-none focus:border-gray-400"
            >
              <option value="all">All</option>
              {icps.map((s) => (
                <option key={s} value={s!}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-sm bg-[#f5f5f5] border border-[#e5e5e5] rounded-xl px-3 py-1.5 text-gray-700 focus:outline-none focus:border-gray-400"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-sm bg-[#f5f5f5] border border-[#e5e5e5] rounded-xl px-3 py-1.5 text-gray-700 focus:outline-none focus:border-gray-400"
            />
          </div>

          {hasFilters && (
            <button
              onClick={() => { setStageFilter("all"); setSourceFilter("all"); setIcpFilter("all"); setDateFrom(""); setDateTo(""); }}
              className="text-xs text-gray-500 hover:text-gray-900 underline cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl px-4 py-3 text-sm mb-4">
          {error.message}
        </div>
      )}

      <div className="bg-white border border-[#e5e5e5] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort("companyName")}>
                  Company <SortIcon field="companyName" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort("amount")}>
                  Amount <SortIcon field="amount" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort("dealStage")}>
                  Stage <SortIcon field="dealStage" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ICP</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Deal Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Source</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort("createDate")}>
                  Created <SortIcon field="createDate" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading deals...</td>
                </tr>
              ) : deals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    {hasFilters || search ? "No deals match your filters." : "No HubSpot deals synced yet."}
                  </td>
                </tr>
              ) : (
                deals.map((deal) => (
                  <tr
                    key={deal.id}
                    onClick={() => navigate(`/deals/${deal.id}`)}
                    className="hover:bg-[#f9f9f9] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{deal.companyName}</td>
                    <td className="px-4 py-3 text-gray-600 tabular-nums">{formatCurrency(deal.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        deal.dealStage === "closed_won" ? "bg-green-50 text-green-700 border border-green-200" :
                        deal.dealStage === "closed_lost" ? "bg-red-50 text-red-600 border border-red-200" :
                        "bg-[#f5f5f5] text-gray-600 border border-[#e5e5e5]"
                      }`}>
                        {STAGE_LABELS[deal.dealStage] ?? deal.dealStage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{deal.icp ?? "--"}</td>
                    <td className="px-4 py-3 text-gray-500">{deal.dealType ?? "--"}</td>
                    <td className="px-4 py-3 text-gray-500">{deal.primaryDealSource ?? "--"}</td>
                    <td className="px-4 py-3 text-gray-400 tabular-nums">{formatDate(deal.createDate)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
