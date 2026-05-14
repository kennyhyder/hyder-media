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
  bovada: {
    network: "Bovada Affiliates (direct)",
    baseUrl: process.env.AFFILIATE_BOVADA_URL || "https://www.bovada.lv/",
    signupHint: "https://www.bovadaaffiliates.com — offshore, no US licensing required",
    status: "pending",
    commission: "Rev share 25-45% lifetime",
  },
  betonline: {
    network: "Revenue Giants (BetOnline.ag)",
    baseUrl: process.env.AFFILIATE_BETONLINE_URL || "https://www.betonline.ag/",
    signupHint: "https://www.revenuegiants.com — multi-brand offshore network",
    status: "pending",
    commission: "Rev share 25-35% lifetime",
  },
  lowvig: {
    network: "Revenue Giants (LowVig.ag — same parent as BetOnline)",
    baseUrl: process.env.AFFILIATE_LOWVIG_URL || "https://www.lowvig.ag/",
    signupHint: "https://www.revenuegiants.com (joint program with BetOnline)",
    status: "pending",
    commission: "Rev share 25-35% lifetime",
  },
  mybookie: {
    network: "MyBookie Agents (direct)",
    baseUrl: process.env.AFFILIATE_MYBOOKIE_URL || "https://www.mybookie.ag/",
    signupHint: "https://www.mybookieagents.ag",
    status: "pending",
    commission: "Rev share 30-50% (high vs other networks)",
  },
  betus: {
    network: "BetUS Partners (direct)",
    baseUrl: process.env.AFFILIATE_BETUS_URL || "https://www.betus.com.pa/",
    signupHint: "https://www.betuspartners.com",
    status: "pending",
    commission: "Rev share 30-50% lifetime",
  },
  kalshi: {
    // Kalshi has a referral program rather than a traditional affiliate network
    network: "Kalshi Referral",
    baseUrl: process.env.AFFILIATE_KALSHI_URL || "https://kalshi.com/",
    signupHint: "https://kalshi.com/refer — invite-based referral, $25 per qualified signup historically",
    status: "pending",
    commission: "$10-25 per qualified signup",
  },
  polymarket: {
    network: "Polymarket — no public affiliate program",
    baseUrl: "https://polymarket.com/",
    signupHint: "Polymarket does not currently run a public affiliate program",
    status: "unavailable",
  },
};

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
