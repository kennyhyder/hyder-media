// Thin gtag wrapper so callers don't have to deal with the global being
// undefined during SSR or before <GoogleAnalytics> mounts.
//
// The site's GA4 measurement ID is configured in app/layout.tsx via
// @next/third-parties/google. This file just exposes typed event helpers
// on top of the global gtag that script installs.

declare global {
  interface Window {
    gtag?: (
      command: "event" | "config" | "set" | "consent" | "js",
      action: string,
      params?: Record<string, unknown>,
    ) => void;
  }
}

function gtag(action: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;
  window.gtag("event", action, params);
}

// ---- Tier metadata used in purchase events ----
// Single source of truth for what GA4 sees per tier — keeps event payloads
// consistent across PricingCards (begin_checkout) and ConversionTracker
// (purchase). If the tier names or prices change in lib/tiers.ts, update
// here too.

export interface AnalyticsTier {
  id: string;
  name: string;
  category: "subscription" | "api_subscription";
  priceDollars: number;
}

export const TIER_FOR_ANALYTICS: Record<string, AnalyticsTier> = {
  free:        { id: "free",        name: "SportsBookish First Line", category: "subscription",     priceDollars: 0 },
  pro:         { id: "pro",         name: "SportsBookish Pro",        category: "subscription",     priceDollars: 10 },
  elite:       { id: "elite",       name: "SportsBookish Elite",      category: "subscription",     priceDollars: 100 },
  api_monthly: { id: "api_monthly", name: "SportsBookish API (mo)",   category: "api_subscription", priceDollars: 50 },
  api_annual:  { id: "api_annual",  name: "SportsBookish API (yr)",   category: "api_subscription", priceDollars: 500 },
};

// ---- Event helpers ----

export function trackSignUp(method: string = "magic_link", tier: string = "free") {
  gtag("sign_up", { method, tier });
}

export function trackBeginCheckout(tierKey: string) {
  const t = TIER_FOR_ANALYTICS[tierKey];
  if (!t || t.priceDollars === 0) return;
  gtag("begin_checkout", {
    currency: "USD",
    value: t.priceDollars,
    items: [{
      item_id: t.id,
      item_name: t.name,
      item_category: t.category,
      price: t.priceDollars,
      quantity: 1,
    }],
  });
}

// transactionId should be the Stripe subscription id (or invoice id if that's
// what you've got). GA4 dedupes purchases by transaction_id, so passing a
// stable per-subscription value prevents double-counting on a /dashboard
// refresh that still has ?upgraded=1 in the URL.
export function trackPurchase(tierKey: string, transactionId: string) {
  const t = TIER_FOR_ANALYTICS[tierKey];
  if (!t || t.priceDollars === 0) return;
  gtag("purchase", {
    transaction_id: transactionId,
    currency: "USD",
    value: t.priceDollars,
    items: [{
      item_id: t.id,
      item_name: t.name,
      item_category: t.category,
      price: t.priceDollars,
      quantity: 1,
    }],
  });
}
