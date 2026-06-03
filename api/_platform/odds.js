// Shared odds-math primitives used across the sports + golf pipelines.
//
// Until 2026-06-03 these were copy-pasted across api/sports/_books.js,
// api/golfodds/cron-ingest-datagolf.js, and api/golfodds/cron-ingest-matchup-books.js
// — same math, three implementations. Now imported from here.
//
// The two pipelines have slightly different shapes for de-vig (array vs
// outcome objects), so both variants are exported. American/decimal/implied
// conversions are exposed individually so each call site can compose them.

/**
 * Convert American odds → decimal odds.
 *   +120  → 2.20
 *   -150  → 1.6667
 *   null/0/NaN → null
 */
export const americanToDecimal = (american) => {
  if (american == null) return null;
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1;
};

/**
 * Convert decimal odds → raw implied probability (no de-vig).
 *   2.20  → 0.4545
 *   null/0 → null
 */
export const decimalToImplied = (decimal) => {
  if (!decimal || !Number.isFinite(decimal)) return null;
  return 1 / decimal;
};

/**
 * Convert American odds → raw implied probability (no de-vig).
 * Equivalent to decimalToImplied(americanToDecimal(american)) but skips
 * the intermediate decimal — useful when the call site only cares about
 * probability.
 */
export const americanToProb = (american) => {
  if (american == null) return null;
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  if (a > 0) return 100 / (a + 100);
  return -a / (-a + 100);
};

/**
 * De-vig an array of raw probabilities so they sum to 1.
 *   devigProbs([0.55, 0.50])  → [0.524, 0.476]
 * null entries pass through as null. If sum is 0, all entries become null.
 * Used by golf matchups + outright ingests where data is a flat array.
 */
export const devigProbs = (probs) => {
  const total = probs.reduce((s, p) => s + (p || 0), 0);
  if (!total) return probs.map(() => null);
  return probs.map((p) => (p == null ? null : Number((p / total).toFixed(5))));
};

/**
 * De-vig an array of raw probabilities so they sum to a target value
 * other than 1. Used for outright pools like top-5 / top-10, where the
 * theoretical sum across all players is the field size (5, 10, etc.).
 *   devigToSum([0.10, 0.08, ...], 5)  → scaled so the sum = 5
 * Behaves identically to devigProbs when expectedSum=1.
 */
export const devigToSum = (probs, expectedSum) => {
  const total = probs.reduce((s, p) => s + (p || 0), 0);
  if (!total) return probs.map(() => null);
  const scale = expectedSum / total;
  return probs.map((p) => (p == null ? null : p * scale));
};

/**
 * De-vig outcome objects in place by adding prob_novig.
 *   devigOutcomes([{ name: 'a', prob_raw: 0.55 }, { name: 'b', prob_raw: 0.50 }])
 *   → [{ name: 'a', prob_raw: 0.55, prob_novig: 0.524 }, ...]
 * Used by sports/_books.js where outcomes carry side metadata.
 */
export const devigOutcomes = (outcomes) => {
  const sum = outcomes.reduce((s, o) => s + (o.prob_raw ?? 0), 0);
  if (sum <= 0) return outcomes.map((o) => ({ ...o, prob_novig: null }));
  return outcomes.map((o) => ({
    ...o,
    prob_novig: o.prob_raw != null ? Number((o.prob_raw / sum).toFixed(5)) : null,
  }));
};
