// SportsBookish tier definitions — single source of truth used by Stripe
// setup, API filtering, UI, and pricing page.
//
// UI tiers (free / pro / elite) gate the WEB experience.
// API tier (api_monthly / api_annual) is an INDEPENDENT add-on for developers
// who want to consume our data via the /api/v1/* REST endpoints. A user can
// hold a UI tier AND an API subscription simultaneously (two separate Stripe
// subscriptions). API access is gated by sb_api_keys, not sb_subscriptions.tier.

export type TierKey = "free" | "pro" | "elite";
export type ApiTierKey = "free" | "api_monthly" | "api_annual" | "enterprise";

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

// ---- API tier definitions ----

export interface ApiPlan {
  key: ApiTierKey;
  name: string;
  priceCents: number;
  interval: "month" | "year" | null;
  monthlyQuota: number;
  tagline: string;
  features: string[];
  stripeProductName: string | null;
  stripePriceEnv: string | null;
}

export const API_PLANS: ApiPlan[] = [
  {
    key: "free",
    name: "Demo",
    priceCents: 0,
    interval: null,
    monthlyQuota: 1000,
    tagline: "Public shared key — no signup, AI-friendly",
    features: [
      "Shared demo key in /api/docs",
      "1,000 requests/month total (shared across all users)",
      "Full read access to /v1/odds, /v1/edges, /v1/golf",
      "Perfect for AI tool evaluation + small experiments",
    ],
    stripeProductName: null,
    stripePriceEnv: null,
  },
  {
    key: "api_monthly",
    name: "API",
    priceCents: 5000,
    interval: "month",
    monthlyQuota: 20000,
    tagline: "For developers building on our data",
    features: [
      "20,000 requests/month per key",
      "Personal API key (rotate any time)",
      "Commercial usage rights",
      "OpenAPI 3.1 spec + Python/JS examples",
      "Edge-cached responses (sub-100ms steady state)",
      "All endpoints: odds, edges, golf, future v1 additions",
    ],
    stripeProductName: "SportsBookISH API",
    stripePriceEnv: "STRIPE_PRICE_API_MONTHLY",
  },
  {
    key: "api_annual",
    name: "API (annual)",
    priceCents: 50000,
    interval: "year",
    monthlyQuota: 20000,
    tagline: "Save $100/year on the API add-on",
    features: [
      "Everything in monthly",
      "$500/yr ($41.67/mo equivalent — save $100/yr)",
      "Same 20,000/mo quota",
      "Priority email support",
    ],
    stripeProductName: "SportsBookISH API",
    stripePriceEnv: "STRIPE_PRICE_API_ANNUAL",
  },
  {
    key: "enterprise",
    name: "Enterprise",
    priceCents: 0,                  // contact-sales — no Stripe product
    interval: null,
    monthlyQuota: 0,                // custom
    tagline: "Custom volume + WebSocket + historical archive",
    features: [
      "50,000+ requests/month (negotiable)",
      "WebSocket streaming for real-time updates",
      "Full historical archive (past 12+ months of quotes)",
      "Dedicated SLA + Slack channel",
      "Custom data exports + per-book detail",
    ],
    stripeProductName: null,
    stripePriceEnv: null,
  },
];

export const API_PLAN_BY_KEY: Record<ApiTierKey, ApiPlan> =
  Object.fromEntries(API_PLANS.map((p) => [p.key, p])) as Record<ApiTierKey, ApiPlan>;

export function apiTierFromPriceId(priceId: string | null | undefined): ApiTierKey {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_API_MONTHLY) return "api_monthly";
  if (priceId === process.env.STRIPE_PRICE_API_ANNUAL) return "api_annual";
  return "free";
}

export function priceIdForApiTier(tier: ApiTierKey): string | null {
  if (tier === "api_monthly") return process.env.STRIPE_PRICE_API_MONTHLY || null;
  if (tier === "api_annual") return process.env.STRIPE_PRICE_API_ANNUAL || null;
  return null;
}
