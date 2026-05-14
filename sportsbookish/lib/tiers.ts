// SportsBookish tier definitions — single source of truth used by Stripe
// setup, API filtering, UI, and pricing page.

export type TierKey = "free" | "pro" | "elite";

export interface Tier {
  key: TierKey;
  name: string;
  tagline: string;
  priceCents: number;       // amount charged per billing cycle
  interval: "month" | "year";
  description: string;
  features: { included: boolean; text: string }[];
  stripeProductName: string;
}

export const TIERS: Tier[] = [
  {
    key: "free",
    name: "First Line",
    tagline: "See the headline odds",
    priceCents: 0,
    interval: "month",
    description: "Public access — top-line markets only. Great for casual fans.",
    stripeProductName: "SportsBookish First Line",
    features: [
      { included: true, text: "Live Kalshi vs book consensus across every sport" },
      { included: true, text: "Game H2H + Spread + Total · books median + 5 major books" },
      { included: true, text: "Watchlist — bookmark teams and players" },
      { included: true, text: "Daily edge digest email (top 3 buy edges)" },
      { included: false, text: "All 11+ books, every market type, golf depth" },
      { included: false, text: "Custom alert rules and SMS delivery" },
      { included: false, text: "Smart preset alerts (one-click big-mover etc.)" },
    ],
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "Every market, every book",
    priceCents: 1000,         // $10/mo
    interval: "month",
    description: "Full data access — all markets, all books, all sports, email alerts you configure.",
    stripeProductName: "SportsBookish Pro",
    features: [
      { included: true, text: "Everything in First Line" },
      { included: true, text: "All bet types: golf outrights, top-N, make cut, props, matchups, round leaders" },
      { included: true, text: "All 11+ books for H2H, Spread, Total" },
      { included: true, text: "DataGolf model prob + sharp-line benchmarks" },
      { included: true, text: "Pick your home sportsbook to compare edges against" },
      { included: true, text: "Filter books in/out of consensus median" },
      { included: true, text: "Player / team detail pages" },
      { included: true, text: "Manual alert rules — email only, you configure each one" },
      { included: false, text: "Smart preset alerts (one-click bundles)" },
      { included: false, text: "SMS delivery + multi-channel" },
    ],
  },
  {
    key: "elite",
    name: "Elite",
    tagline: "Smart alerts, every edge",
    priceCents: 10000,        // $100/year
    interval: "year",
    description: "Annual plan — cheaper than Pro on a yearly basis. Everything in Pro plus smart preset alerts, SMS delivery, and watchlist push.",
    stripeProductName: "SportsBookish Elite",
    features: [
      { included: true, text: "Everything in Pro" },
      { included: true, text: "Smart preset alerts — one-click toggles for Big Movers, Daily Top Buys, My Watchlist, Sharp Action" },
      { included: true, text: "Email + SMS delivery on every alert" },
      { included: true, text: "Custom thresholds per market type (e.g. 3% on H2H, 1.5% on totals)" },
      { included: true, text: "Watchlist push — alerts only on your bookmarked teams/players" },
      { included: true, text: "Sub-minute Kalshi WebSocket updates when in play" },
      { included: true, text: "Historical line movement charts" },
      { included: true, text: "Early access to new sports and markets" },
    ],
  },
];

export const TIER_BY_KEY: Record<TierKey, Tier> = Object.fromEntries(TIERS.map((t) => [t.key, t])) as Record<TierKey, Tier>;

// Backwards-compat helper for existing UI code that reads priceMonthly.
// Returns the per-MONTH equivalent so the "$X/mo" display still works for
// both monthly and annual plans.
export function getPricePerMonth(tier: Tier): number {
  if (tier.priceCents === 0) return 0;
  if (tier.interval === "month") return tier.priceCents / 100;
  if (tier.interval === "year") return Math.round((tier.priceCents / 100 / 12) * 100) / 100;
  return tier.priceCents / 100;
}

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
