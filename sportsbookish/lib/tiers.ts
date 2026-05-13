// SportsBookish tier definitions — single source of truth used by Stripe
// setup, API filtering, UI, and pricing page.

export type TierKey = "free" | "pro" | "elite";

export interface Tier {
  key: TierKey;
  name: string;
  tagline: string;
  priceMonthly: number; // USD dollars
  description: string;
  features: { included: boolean; text: string }[];
  stripeProductName: string;
}

export const TIERS: Tier[] = [
  {
    key: "free",
    name: "First Line",
    tagline: "See the headline odds",
    priceMonthly: 0,
    description: "Public access — top-line markets only. Great for casual fans.",
    stripeProductName: "SportsBookish First Line",
    features: [
      { included: true, text: "Tournament/game winner lines only" },
      { included: true, text: "Kalshi vs book consensus (median)" },
      { included: true, text: "1 tournament at a time" },
      { included: false, text: "Top-5/10/20, props, matchups" },
      { included: false, text: "Live edge alerts (email/SMS)" },
      { included: false, text: "Pick your home sportsbook" },
      { included: false, text: "Filter which books count in the median" },
    ],
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "Every market, every book",
    priceMonthly: 19,
    description: "Full data access — all market types, all books, all sports, all tournaments.",
    stripeProductName: "SportsBookish Pro",
    features: [
      { included: true, text: "All bet types: outrights, top-N, make cut, props, matchups, round leaders" },
      { included: true, text: "Per-book prices side-by-side (all 14+ books)" },
      { included: true, text: "DataGolf model prob + sharp-line benchmarks" },
      { included: true, text: "Pick your home sportsbook to compare edges against" },
      { included: true, text: "Filter books in/out of consensus median" },
      { included: true, text: "Player detail view — every line for any player" },
      { included: false, text: "Live edge alerts (email + SMS)" },
      { included: false, text: "Custom alert thresholds" },
    ],
  },
  {
    key: "elite",
    name: "Elite",
    tagline: "Alerts, automation, every edge",
    priceMonthly: 39,
    description: "Everything in Pro, plus minute-by-minute alerts to email and SMS with custom thresholds.",
    stripeProductName: "SportsBookish Elite",
    features: [
      { included: true, text: "Everything in Pro" },
      { included: true, text: "Live edge alerts via email + SMS" },
      { included: true, text: "Custom alert thresholds per market type" },
      { included: true, text: "Movement alerts (Kalshi price moves ≥X% in N min)" },
      { included: true, text: "Sub-minute Kalshi WebSocket updates (when in play)" },
      { included: true, text: "Watchlist: bookmark players/games for priority alerts" },
      { included: true, text: "Historical line movement charts" },
      { included: true, text: "Early access to new sports" },
    ],
  },
];

export const TIER_BY_KEY: Record<TierKey, Tier> = Object.fromEntries(TIERS.map((t) => [t.key, t])) as Record<TierKey, Tier>;

export function tierFromPriceId(priceId: string | null | undefined): TierKey {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ELITE) return "elite";
  return "free";
}

export function priceIdForTier(tier: TierKey): string | null {
  if (tier === "pro") return process.env.STRIPE_PRICE_PRO || null;
  if (tier === "elite") return process.env.STRIPE_PRICE_ELITE || null;
  return null;
}
