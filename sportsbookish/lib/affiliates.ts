// Affiliate / referral URL mapping per sportsbook.
//
// Each book gets its own outbound deeplink. We add ?utm_source=sportsbookish
// + ?utm_medium=odds-comparison so it's easy to track in each network's
// dashboard, plus a rel="sponsored noopener" on every render.
//
// To enable monetisation: sign up at each affiliate network (see
// /docs/AFFILIATE_SIGNUPS.md for the URLs and networks), get your tracking
// link from each, and paste the path here. Leaving a book set to its plain
// homepage means we'll still link out (good UX) but no commission.
//
// SET via env if you don't want IDs in git:
//   AFFILIATE_DRAFTKINGS_URL=https://your-tracking-link
// Code falls back to the in-code URL if the env var is missing.

export interface AffiliateInfo {
  network: string;
  baseUrl: string;            // The actual referral / deep link
  signupHint: string;         // Where to apply for the affiliate program
  status: "pending" | "active" | "unavailable";
  commission?: string;        // For internal reference
}

// Default URLs are non-affiliate (just plain homepages) — replace with your
// approved tracking link once each network approves your account.
const DEFAULTS: Record<string, AffiliateInfo> = {
  draftkings: {
    network: "DraftKings Affiliates (CAKE platform)",
    baseUrl: process.env.AFFILIATE_DRAFTKINGS_URL || "https://sportsbook.draftkings.com/",
    signupHint: "https://www.draftkings.com/about/affiliates",
    status: "pending",
    commission: "CPA $100-200 per FTD or 25-40% rev share (negotiable)",
  },
  fanduel: {
    network: "FanDuel Partners (Impact Radius)",
    baseUrl: process.env.AFFILIATE_FANDUEL_URL || "https://sportsbook.fanduel.com/",
    signupHint: "https://affiliates.fanduel.com — apply via Impact Radius",
    status: "pending",
    commission: "CPA $100-150 per FTD or 25-30% rev share",
  },
  betmgm: {
    network: "BetMGM Affiliates (Income Access)",
    baseUrl: process.env.AFFILIATE_BETMGM_URL || "https://sports.betmgm.com/",
    signupHint: "https://www.betmgm.com/affiliates — Income Access platform",
    status: "pending",
    commission: "CPA $100-200 or rev share negotiable",
  },
  caesars: {
    network: "Caesars Sportsbook Affiliates (Income Access)",
    baseUrl: process.env.AFFILIATE_CAESARS_URL || "https://www.caesars.com/sportsbook/",
    signupHint: "https://www.caesars.com/sportsbook/affiliates (legacy William Hill US affiliate program)",
    status: "pending",
    commission: "CPA up to $250 per FTD",
  },
  betrivers: {
    network: "Rush Street Affiliates (PlayUp / direct)",
    baseUrl: process.env.AFFILIATE_BETRIVERS_URL || "https://www.betrivers.com/",
    signupHint: "https://www.rushstreetinteractive.com/affiliates",
    status: "pending",
    commission: "CPA $80-150 or 25-35% rev share",
  },
  fanatics: {
    network: "Fanatics Sportsbook Partners (Income Access / Paysafe)",
    baseUrl: process.env.AFFILIATE_FANATICS_URL || "https://sportsbook.fanatics.com/",
    signupHint: "Email sportsbook-partners@fanatics.com — newer program, no public portal yet",
    status: "pending",
    commission: "TBD — newer launch",
  },
  // Offshore books (bovada, betonline, lowvig, mybookie, betus, pinnacle, etc.)
  // are intentionally NOT in this map. Vault Network + every regulated US
  // affiliate program forbids co-promoting regulated and offshore brands.
  // affiliateUrl() returns null for those keys; the UI bucket them into an
  // unnamed "Other" entry via lib/books.ts.
  kalshi: {
    // Kalshi has a referral program rather than a traditional affiliate network
    network: "Kalshi Referral",
    baseUrl: process.env.AFFILIATE_KALSHI_URL || "https://kalshi.com/",
    signupHint: "https://kalshi.com/refer — invite-based referral, $25 per qualified signup historically",
    status: "pending",
    commission: "$10-25 per qualified signup",
  },
  polymarket: {
    network: "Vault Network — Polymarket",
    baseUrl: process.env.AFFILIATE_POLYMARKET_URL || "https://affiliates.routy.app/route/367547?affId=10159&ts=5017819",
    signupHint: "https://vaultsportshq.com — Vault Network affiliate platform (offer code SPORTSBOOKISH)",
    status: "active",
    commission: "CPA — $20 deposit / $50 trading bonus (iOS only, US-eligible states); rev share via Vault Network",
  },
};

// Public constants used by promo components, drip emails, and outbound CTAs.
// The affiliate URL is universal — every device can click it. The promo
// bonus ($20 deposit → $50 trading bonus) is iOS-restricted, so visual ads
// that pitch the bonus are gated to iOS UA. Code "SPORTSBOOKISH" applies
// equivalently for users who land on the iOS app via search.
export const POLYMARKET_AFFILIATE_URL =
  process.env.AFFILIATE_POLYMARKET_URL || "https://affiliates.routy.app/route/367547?affId=10159&ts=5017819";
export const POLYMARKET_PROMO_CODE = "SPORTSBOOKISH";
export const POLYMARKET_PROMO_HEADLINE = "Deposit $20, get a $50 trading bonus";
export const POLYMARKET_PROMO_SUBLINE = "iOS only · code SPORTSBOOKISH";

export function getAffiliate(book: string): AffiliateInfo | null {
  const key = book.toLowerCase().trim();
  return DEFAULTS[key] || null;
}

/**
 * Wrap a sportsbook key into a full outbound URL with UTM tracking.
 * Returns null if the book isn't recognised (caller can render plain text).
 */
export function affiliateUrl(book: string, opts?: { source?: string; medium?: string; campaign?: string }): string | null {
  const info = getAffiliate(book);
  if (!info) return null;
  try {
    const u = new URL(info.baseUrl);
    u.searchParams.set("utm_source", opts?.source || "sportsbookish");
    u.searchParams.set("utm_medium", opts?.medium || "odds-comparison");
    if (opts?.campaign) u.searchParams.set("utm_campaign", opts.campaign);
    return u.toString();
  } catch {
    return info.baseUrl;
  }
}
