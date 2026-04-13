import { useState } from "react";
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

export default function DealList() {
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useDeals(search ? { search } : undefined);
  const navigate = useNavigate();

  // Only show deals pending review (Claude-processed + not yet approved/rejected)
  const allDeals = data?.deals ?? [];
  const deals = allDeals.filter((d) => d.claudeReasoning && d.reviewStatus === "pending");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900">Review</h2>
          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-black text-white">
            {isLoading ? "..." : deals.length}
          </span>
        </div>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by company name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 pl-10 pr-4 py-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300 transition-colors"
          />
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
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Company</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Stage</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ICP</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Deal Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Match</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Review</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    Loading deals...
                  </td>
                </tr>
              ) : deals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    {search ? "No deals match your search." : "No deals found."}
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
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-black text-white whitespace-nowrap">
                        {STAGE_LABELS[deal.dealStage] ?? deal.dealStage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{deal.icp ?? "--"}</td>
                    <td className="px-4 py-3 text-gray-500">{deal.dealType ?? "--"}</td>
                    <td className="px-4 py-3 text-gray-500 capitalize">{deal.matchResult ?? "--"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        deal.reviewStatus === "pending"
                          ? "bg-black text-white"
                          : deal.reviewStatus === "go_live"
                            ? "bg-white text-gray-600 border border-[#e5e5e5]"
                            : deal.reviewStatus === "inconclusive"
                              ? "bg-red-50 text-red-600 border border-red-200"
                              : "bg-white text-gray-600 border border-[#e5e5e5]"
                      }`}>
                        {deal.reviewStatus.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 tabular-nums">{formatDate(deal.createdAt)}</td>
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
