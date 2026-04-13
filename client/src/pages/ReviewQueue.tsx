import { useState } from "react";
import { useReviewQueue, useReviewDeal } from "../lib/api";
import type { Deal } from "../lib/api";

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

function ReviewCard({ deal }: { deal: Deal }) {
  const reviewMutation = useReviewDeal();
  const [resolved, setResolved] = useState<string | null>(null);

  function handleReview(decision: string) {
    reviewMutation.mutate(
      { id: deal.id, decision, reviewedBy: "dashboard" },
      { onSuccess: () => setResolved(decision) },
    );
  }

  if (resolved) {
    return (
      <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-3 text-gray-900">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-medium">
            {deal.companyName} marked as <span className="capitalize">{resolved.replace("_", " ")}</span>
          </span>
        </div>
      </div>
    );
  }

  const reasoning = deal.claudeReasoning
    ? deal.claudeReasoning.length > 200
      ? deal.claudeReasoning.slice(0, 200) + "..."
      : deal.claudeReasoning
    : null;

  return (
    <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{deal.companyName}</h3>
          <div className="flex items-center gap-2.5 mt-1.5 text-sm text-gray-400">
            <span className="tabular-nums text-gray-700 font-medium">{formatCurrency(deal.amount)}</span>
            <span className="text-gray-300">&#183;</span>
            <span>{STAGE_LABELS[deal.dealStage] ?? deal.dealStage}</span>
            {deal.icp && (
              <>
                <span className="text-gray-300">&#183;</span>
                <span>{deal.icp}</span>
              </>
            )}
          </div>
        </div>
        {deal.matchResult && (
          <span
            className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
              deal.matchResult === "new"
                ? "bg-black text-white"
                : "bg-white text-gray-500 border border-[#e5e5e5]"
            }`}
          >
            {deal.matchResult}
          </span>
        )}
      </div>

      {reasoning && (
        <div className="bg-[#f5f5f5] rounded-xl px-4 py-3">
          <p className="text-xs font-medium text-gray-400 mb-1">Claude's Reasoning</p>
          <p className="text-sm text-gray-600 leading-relaxed">{reasoning}</p>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => handleReview("go_live")}
          disabled={reviewMutation.isPending}
          className="px-5 py-2.5 bg-black hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium rounded-2xl transition-colors cursor-pointer"
        >
          Go Live
        </button>
        <button
          onClick={() => handleReview("review")}
          disabled={reviewMutation.isPending}
          className="px-5 py-2.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-2xl border border-[#e5e5e5] transition-colors cursor-pointer"
        >
          Review
        </button>
        <button
          onClick={() => handleReview("inconclusive")}
          disabled={reviewMutation.isPending}
          className="px-5 py-2.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-2xl border border-[#e5e5e5] transition-colors cursor-pointer"
        >
          Inconclusive
        </button>
        {reviewMutation.isError && (
          <span className="text-sm text-red-500 ml-2">{reviewMutation.error.message}</span>
        )}
      </div>
    </div>
  );
}

export default function ReviewQueue() {
  const { data, isLoading, error } = useReviewQueue();
  const deals = data?.deals ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Review Queue</h2>
        {!isLoading && (
          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-black text-white">
            {deals.length}
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl px-4 py-3 text-sm mb-4">
          {error.message}
        </div>
      )}

      {!isLoading && deals.length === 0 && (
        <div className="bg-white border border-[#e5e5e5] rounded-2xl px-6 py-16 text-center shadow-sm">
          <svg className="mx-auto w-12 h-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-gray-400 text-sm">All caught up. No deals are pending review.</p>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-16 text-gray-400 text-sm">Loading...</div>
      )}

      <div className="space-y-3">
        {deals.map((deal) => (
          <ReviewCard key={deal.id} deal={deal} />
        ))}
      </div>
    </div>
  );
}
