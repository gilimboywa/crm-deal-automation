/**
 * company-matcher.ts — Deterministic company name normalization and matching.
 *
 * This is the SINGLE source of truth for company name comparisons.
 * No other file should normalize company names independently.
 *
 * Rules:
 * 1. Normalize: lowercase, strip suffixes, trim whitespace
 * 2. Alias map: known alternate names (WaFd = Washington Federal, etc.)
 * 3. Short-name guard: names ≤ 2 chars after normalization are NEVER matched
 * 4. "Eisen" guard: our own company name is NEVER treated as a match target
 */

// ── Known aliases (lowercased, normalized) ──
// Maps alternate names to canonical names
const ALIASES: Record<string, string> = {
  "washington federal": "wafd",
  "washington federal bank": "wafd",
  "wafd bank": "wafd",
  "wafd": "wafd",
  "bitgo": "bitgo",
  "bit go": "bitgo",
  "schoolsfirst": "schoolsfirst federal credit union",
  "schoolsfirst fcu": "schoolsfirst federal credit union",
  "sfcu": "schoolsfirst federal credit union",
  "lpl": "lpl financial",
  "mvcu": "mountain view credit union",
  "mountain view cu": "mountain view credit union",
};

// ── Suffix removal regex ──
const SUFFIX_REGEX =
  /\s*(,?\s*(inc\.?|llc\.?|corp\.?|corporation|ltd\.?|limited|co\.?|company|plc\.?|l\.?p\.?|lp|n\.?a\.?|na|bancshares|bancorp|financial group|holding(s)?|group))\s*$/gi;

// ── Our own company — NEVER match against this ──
const SELF_NAMES = new Set(["eisen", "witheisen", "eisen group"]);

/**
 * Normalize a company name for comparison.
 * Returns empty string for names that should never match.
 */
export function normalizeCompany(raw: string): string {
  if (!raw) return "";
  let name = raw.toLowerCase().trim();

  // Strip suffixes iteratively (handles "Inc. LLC" etc.)
  let prev = "";
  while (prev !== name) {
    prev = name;
    name = name.replace(SUFFIX_REGEX, "").trim();
  }

  // Remove common noise words at the start
  name = name.replace(/^the\s+/i, "").trim();

  // Resolve alias
  if (ALIASES[name]) {
    name = ALIASES[name];
  }

  return name;
}

/**
 * Check if a normalized name is our own company (Eisen).
 */
export function isSelfCompany(normalized: string): boolean {
  return SELF_NAMES.has(normalized);
}

/**
 * Check if a name is too short to match reliably.
 * Names ≤ 2 chars after normalization produce false positives
 * (e.g., "Rho" matching "Rhode Island Housing").
 */
export function isTooShort(normalized: string): boolean {
  return normalized.length <= 2;
}

/**
 * Compare two company names. Returns a match score:
 * - 1.0 = exact match (after normalization + alias resolution)
 * - 0.7-0.9 = high confidence fuzzy (substring/startsWith)
 * - 0.5-0.7 = medium confidence fuzzy (Levenshtein)
 * - 0 = no match
 *
 * Guards:
 * - Self company → always 0
 * - Too-short names → always 0
 * - Substring matching only if the shorter name is ≥ 4 chars
 */
export function compareCompanies(a: string, b: string): {
  score: number;
  matchType: "exact" | "alias" | "substring" | "levenshtein" | "none";
} {
  const normA = normalizeCompany(a);
  const normB = normalizeCompany(b);

  // Guards
  if (!normA || !normB) return { score: 0, matchType: "none" };
  if (isSelfCompany(normA) || isSelfCompany(normB))
    return { score: 0, matchType: "none" };
  if (isTooShort(normA) || isTooShort(normB))
    return { score: 0, matchType: "none" };

  // Exact match (including after alias resolution)
  if (normA === normB) {
    return { score: 1.0, matchType: "exact" };
  }

  // Substring match — only if the shorter string is at least 4 chars
  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length <= normB.length ? normB : normA;

  if (shorter.length >= 4 && longer.includes(shorter)) {
    // Score based on length ratio to penalize very partial matches
    const ratio = shorter.length / longer.length;
    const score = Math.min(0.9, 0.6 + ratio * 0.3);
    return { score, matchType: "substring" };
  }

  // Levenshtein similarity
  const sim = levenshteinSimilarity(normA, normB);
  if (sim > 0.7) {
    return { score: sim, matchType: "levenshtein" };
  }

  return { score: 0, matchType: "none" };
}

/**
 * Extract potential company names from a Fathom meeting title.
 * Titles look like: "Eisen | Company Name" or "Company - Eisen | Demo"
 *
 * Returns normalized candidate names (Eisen stripped out).
 */
export function extractCompaniesFromTitle(title: string): string[] {
  const lower = title.toLowerCase();

  // Split on common delimiters
  const segments = lower
    .split(/[|/&<>]/)
    .concat(lower.split(" - "))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const candidates: string[] = [];
  for (const seg of segments) {
    // Remove "eisen" mentions from segment
    const cleaned = seg
      .replace(/\beisen\b/gi, "")
      .replace(/\bwitheisen\b/gi, "")
      .trim();

    if (!cleaned || cleaned.length <= 2) continue;

    // Skip segments that are just meeting-type labels
    const skipWords = [
      "demo",
      "intro",
      "proposal",
      "follow up",
      "followup",
      "call",
      "meeting",
      "check in",
      "checkin",
      "touchpoint",
      "kick off",
      "kickoff",
    ];
    const isJustLabel = skipWords.some((w) => cleaned === w);
    if (isJustLabel) continue;

    const normalized = normalizeCompany(cleaned);
    if (normalized && !isSelfCompany(normalized) && !isTooShort(normalized)) {
      candidates.push(normalized);
    }
  }

  // Deduplicate
  return [...new Set(candidates)];
}

// ── Internal helpers ──

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}
