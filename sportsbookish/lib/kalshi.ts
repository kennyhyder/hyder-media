// Kalshi trading fee model (as documented at kalshi.com/docs).
//
// Per-share fee formula:
//   fee_cents = max(1, ceil(0.07 × price × (1 − price) × 100))
//
// In words: 7% of the variance of the contract, rounded up to the next cent,
// floored at 1¢/share. Capped at 7¢/share in practice (Kalshi's cap rule).
//
// Worked examples:
//   50¢ contract: 0.07 × 0.5 × 0.5 × 100 = 1.75 → 2¢/share
//   25¢ contract: 0.07 × 0.25 × 0.75 × 100 = 1.31 → 2¢/share
//   10¢ contract: 0.07 × 0.10 × 0.90 × 100 = 0.63 → 1¢/share
//   80¢ contract: 0.07 × 0.80 × 0.20 × 100 = 1.12 → 2¢/share
//
// A 2¢ fee on a 50¢ contract = 4% effective overhead. On a 10¢ contract,
// 1¢ fee = 10% of price — long-shot bets get punished hardest in % terms.

export function kalshiFeeCents(priceCents: number): number {
  if (priceCents < 1 || priceCents > 99) return 0;
  const p = priceCents / 100;
  const fee = 0.07 * p * (1 - p) * 100;
  return Math.min(7, Math.max(1, Math.ceil(fee)));
}

/**
 * Fee as a fraction (e.g. 0.02 for 2¢/share).
 * Pass Kalshi implied probability in [0, 1]; we round to nearest cent.
 */
export function kalshiFeeFraction(kalshiProb: number | null | undefined): number {
  if (kalshiProb == null) return 0;
  const cents = Math.round(kalshiProb * 100);
  return kalshiFeeCents(cents) / 100;
}

/**
 * Net buy-edge after subtracting the Kalshi trading fee.
 * rawEdge = reference_prob − kalshi_prob (positive = buy-cheap on Kalshi).
 * After paying the fee to enter, the effective edge drops by `fee/$1 payout`.
 */
export function netBuyEdge(rawEdge: number | null | undefined, kalshiProb: number | null | undefined): number | null {
  if (rawEdge == null || kalshiProb == null) return null;
  return Number((rawEdge - kalshiFeeFraction(kalshiProb)).toFixed(5));
}

/**
 * Net sell-edge — selling YES on Kalshi (you bought YES at a low price OR
 * you're short the position). The fee is paid on the entry side; we treat
 * it identically to the buy fee for display purposes.
 */
export function netSellEdge(rawEdge: number | null | undefined, kalshiProb: number | null | undefined): number | null {
  if (rawEdge == null || kalshiProb == null) return null;
  // For a sell-edge, rawEdge is negative; the fee makes the absolute value smaller.
  return Number((rawEdge + kalshiFeeFraction(kalshiProb)).toFixed(5));
}
