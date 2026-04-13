import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ──

export interface Deal {
  id: number;
  hubspotDealId: string | null;
  companyName: string;
  amount: number | null;
  closeDate: string | null;
  pipeline: string;
  dealStage: string;
  dealSourcePerson: string | null;
  primaryDealSource: string | null;
  dealSourceDetails: string | null;
  dealDescription: string | null;
  icp: string | null;
  dealType: string | null;
  createDate: string;
  lastContacted: string | null;
  dealOwner: string | null;
  forecastProbability: number | null;
  numCustomerAccounts: number | null;
  numStateReports: string | null;
  numDueDiligenceLetters: number | null;
  contractTerm: string | null;
  disbursementPricing: string | null;
  escheatmentPricing: string | null;
  dollarValuePerItem: string | null;
  annualPlatformFee: number | null;
  implementationFee: number | null;
  numEscheatmentsPerYear: number | null;
  matchResult: string | null;
  matchedDealId: number | null;
  reviewStatus: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  syncedToHubspot: boolean;
  lastSyncedAt: string | null;
  rawInputData: string | null;
  claudeReasoning: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealContact {
  id: number;
  hubspotContactId: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  linkedinUrl: string | null;
  associationReason: string | null;
  firstSeenDate: string | null;
  createdAt: string;
  role: string;
}

interface DealsFilters {
  stage?: string;
  reviewStatus?: string;
  search?: string;
}

// ── Fetch wrapper ──

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Query Hooks ──

export function useDeals(filters?: DealsFilters) {
  return useQuery({
    queryKey: ["deals", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.stage) params.set("stage", filters.stage);
      if (filters?.reviewStatus) params.set("reviewStatus", filters.reviewStatus);
      if (filters?.search) params.set("search", filters.search);
      const qs = params.toString();
      return apiFetch<{ deals: Deal[] }>(`/api/deals${qs ? `?${qs}` : ""}`);
    },
  });
}

export function useDeal(id: string | undefined) {
  return useQuery({
    queryKey: ["deal", id],
    queryFn: () => apiFetch<{ deal: Deal; contacts: DealContact[] }>(`/api/deals/${id}`),
    enabled: !!id,
  });
}

export function useReviewQueue() {
  return useQuery({
    queryKey: ["reviewQueue"],
    queryFn: () => apiFetch<{ deals: Deal[] }>("/api/deals/review-queue"),
  });
}

export function usePipeline() {
  return useQuery({
    queryKey: ["pipeline"],
    queryFn: () => apiFetch<{ pipeline: Record<string, Deal[]> }>("/api/deals/pipeline"),
  });
}

// ── Mutation Hooks ──

export function useReviewDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reviewedBy }: { id: number; decision: string; reviewedBy: string }) =>
      apiFetch<{ deal: Deal; decision: string }>(`/api/deals/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, reviewedBy }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["reviewQueue"] });
      qc.invalidateQueries({ queryKey: ["deal"] });
    },
  });
}

export function useProcessDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceType: string; data: Record<string, unknown> }) =>
      apiFetch<{ deal: Deal; matchResult: unknown; reasoning: string }>("/api/deals/process", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["reviewQueue"] });
    },
  });
}
