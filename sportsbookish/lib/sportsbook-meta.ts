// Metadata for every regulated US sportsbook + Kalshi + Polymarket. Used
// by the /sportsbooks comparison + review pages and the sitemap.
//
// Only regulated US brands appear here. Keep in sync with
// REGULATED_US_BOOKS in lib/books.ts. Adding a new licensed book means
// touching this file, lib/books.ts, lib/format.ts, lib/affiliates.ts,
// and app/settings/page.tsx.

export interface SportsbookMeta {
  key: string;                    // canonical key used in URLs, API, DB
  name: string;                   // display name ("DraftKings")
  parent?: string;                // parent company
  launched: number;               // US launch year
  primary_states: string;         // short string like "39 states + DC"
  market_depth: "Broad" | "Medium" | "Niche";
  edge: string;                   // one-line USP
  cons: string;                   // one-line tradeoff
  license: string;                // primary US license authority
  promo_summary: string;          // current welcome offer headline (manually updatable)
  affiliate_status: "active" | "pending" | "unavailable";
}

export const SPORTSBOOKS: Record<string, SportsbookMeta> = {
  draftkings: {
    key: "draftkings",
    name: "DraftKings",
    parent: "DraftKings Inc. (NASDAQ: DKNG)",
    launched: 2018,
    primary_states: "Live in 25+ states",
    market_depth: "Broad",
    edge: "Industry-leading SGP (same-game parlay) market, deepest player-prop tree in MLB and NBA.",
    cons: "Limits sharps aggressively; price quality post-limit is mediocre vs Pinnacle.",
    license: "State-regulated (NJ DGE, NY GC, etc.). NASDAQ-listed.",
    promo_summary: "Bet $5, get $200 in bonus bets (standard new-user offer; varies by state)",
    affiliate_status: "pending",
  },
  fanduel: {
    key: "fanduel",
    name: "FanDuel",
    parent: "Flutter Entertainment plc",
    launched: 2018,
    primary_states: "Live in 25+ states",
    market_depth: "Broad",
    edge: "#1 US market share by revenue. Strong NFL/NBA totals & spreads. Best-in-class UX.",
    cons: "Player-prop pricing tends to mirror DraftKings (low edge between the two).",
    license: "State-regulated. Flutter is LSE/NYSE-listed.",
    promo_summary: "$200 in bonus bets on first $5 bet (offer varies by state)",
    affiliate_status: "pending",
  },
  betmgm: {
    key: "betmgm",
    name: "BetMGM",
    parent: "MGM Resorts International + Entain plc (JV)",
    launched: 2018,
    primary_states: "Live in 28 states",
    market_depth: "Broad",
    edge: "Strong NCAAF/NCAAB lines. MGM rewards tie-in (comps + Vegas perks).",
    cons: "App can lag during peak hours; limited Asian-handicap markets.",
    license: "State-regulated + Nevada Gaming Control Board (omnibus MGM license).",
    promo_summary: "First-bet offer up to $1,500 in bonus bets (state-dependent)",
    affiliate_status: "pending",
  },
  caesars: {
    key: "caesars",
    name: "Caesars Sportsbook",
    parent: "Caesars Entertainment Inc.",
    launched: 2019,
    primary_states: "Live in 25+ states",
    market_depth: "Broad",
    edge: "Caesars Rewards integration with the casino loyalty program is the best comps tie-in in betting.",
    cons: "Lines often lag DraftKings/FanDuel by 30-90s; not first-to-market.",
    license: "State-regulated + Nevada (Caesars properties).",
    promo_summary: "$1,000 first bet on Caesars (full refund as a bonus bet if your first bet loses)",
    affiliate_status: "pending",
  },
  betrivers: {
    key: "betrivers",
    name: "BetRivers",
    parent: "Rush Street Interactive (NYSE: RSI)",
    launched: 2018,
    primary_states: "Live in 16 states",
    market_depth: "Medium",
    edge: "iRush Rewards is the most generous loyalty program in regulated US betting.",
    cons: "Limited cash-out availability; slower to add new prop types.",
    license: "State-regulated. RSI is NYSE-listed.",
    promo_summary: "2nd-chance bet up to $500 (varies by state)",
    affiliate_status: "pending",
  },
  fanatics: {
    key: "fanatics",
    name: "Fanatics Sportsbook",
    parent: "Fanatics Inc.",
    launched: 2023,
    primary_states: "Live in 24 states (rapid expansion)",
    market_depth: "Medium",
    edge: "FanCash rewards convert directly to Fanatics retail credit — unique to apparel buyers.",
    cons: "Newest entrant; player-prop tree is shallower than DK/FD.",
    license: "State-regulated. Acquired the former PointsBet US assets in 2024.",
    promo_summary: "$100 in bonus bets per day for 10 days (new users, state-dependent)",
    affiliate_status: "pending",
  },
  pointsbet: {
    key: "pointsbet",
    name: "PointsBet (legacy)",
    parent: "Acquired by Fanatics in 2024",
    launched: 2019,
    primary_states: "Wound down — historical data only",
    market_depth: "Medium",
    edge: "Famous for PointsBetting (Australian spread-style markets). Brand effectively retired in the US.",
    cons: "US operations now part of Fanatics Sportsbook; legacy odds reference only.",
    license: "Historical state-regulated.",
    promo_summary: "No active US offers (brand absorbed by Fanatics)",
    affiliate_status: "unavailable",
  },
  circa: {
    key: "circa",
    name: "Circa Sports",
    parent: "Circa Resort & Casino (private)",
    launched: 2019,
    primary_states: "Nevada (kiosk + app); Colorado, Iowa, Illinois, Kentucky retail",
    market_depth: "Niche",
    edge: "Highest limits in the regulated US market. Sharp-friendly. Hosts the $14M+ Million contest.",
    cons: "Limited market depth on player props compared to DK/FD; no SGP.",
    license: "Nevada Gaming Control Board + state-specific (CO, IA, IL, KY).",
    promo_summary: "No traditional welcome bonus — competitive opening lines instead",
    affiliate_status: "pending",
  },
};

// Exchange / event-contract platforms — for kalshi-vs-X and polymarket-vs-X
// comparison pages. Same shape as SportsbookMeta minus the promo line.
export const EXCHANGES: Record<string, Omit<SportsbookMeta, "promo_summary" | "primary_states" | "market_depth"> & {
  market_depth: SportsbookMeta["market_depth"];
  primary_states: string;
}> = {
  kalshi: {
    key: "kalshi",
    name: "Kalshi",
    parent: "Kalshi Inc.",
    launched: 2021,
    primary_states: "All 50 states (CFTC-regulated event contracts)",
    market_depth: "Broad",
    edge: "CFTC-regulated event-contracts exchange — sports markets as event contracts, not 'bets'. No vig in the traditional sense; spread is bid/ask.",
    cons: "Liquidity concentrated in ~20% of markets; thin elsewhere.",
    license: "CFTC-regulated (US federal commodity exchange).",
    affiliate_status: "active",
  },
  polymarket: {
    key: "polymarket",
    name: "Polymarket",
    parent: "Polymarket Inc.",
    launched: 2020,
    primary_states: "Operates US after legal reentry mid-2025",
    market_depth: "Broad",
    edge: "Largest crypto-rails prediction market by volume. Sports verticals growing fast post-relaunch.",
    cons: "USDC settlement adds friction for non-crypto users. No SGPs / props in the traditional sense.",
    license: "CFTC-regulated event-contracts platform.",
    affiliate_status: "unavailable",
  },
};

export function getSportsbook(key: string): SportsbookMeta | null {
  return SPORTSBOOKS[key.toLowerCase()] || null;
}

export function getExchange(key: string): (typeof EXCHANGES)[keyof typeof EXCHANGES] | null {
  return EXCHANGES[key.toLowerCase()] || null;
}

// All regulated-US-book keys in canonical display order (used by hub +
// generateStaticParams for the programmatic comparison pages).
export const ALL_BOOK_KEYS = ["draftkings", "fanduel", "betmgm", "caesars", "betrivers", "fanatics", "circa"];
export const ALL_EXCHANGE_KEYS: Array<keyof typeof EXCHANGES> = ["kalshi", "polymarket"];

// Generate all valid /sportsbooks/[slug] slugs for sitemap +
// generateStaticParams.
export function allSportsbookSlugs(): string[] {
  const single = ALL_BOOK_KEYS.slice();
  const headToHead: string[] = [];
  for (let i = 0; i < ALL_BOOK_KEYS.length; i++) {
    for (let j = i + 1; j < ALL_BOOK_KEYS.length; j++) {
      headToHead.push(`${ALL_BOOK_KEYS[i]}-vs-${ALL_BOOK_KEYS[j]}`);
    }
  }
  const kalshiVs = ALL_BOOK_KEYS.map((k) => `kalshi-vs-${k}`);
  const polyVs = ALL_BOOK_KEYS.map((k) => `polymarket-vs-${k}`);
  return [...single, ...headToHead, ...kalshiVs, ...polyVs];
}

// Parse a slug into its components: { primary, secondary? } where
// secondary is either another book or null.
export interface ParsedSlug {
  type: "single" | "book_vs_book" | "kalshi_vs_book" | "polymarket_vs_book";
  primary: SportsbookMeta | (typeof EXCHANGES)[keyof typeof EXCHANGES];
  secondary: SportsbookMeta | null;
}

export function parseSlug(slug: string): ParsedSlug | null {
  const s = slug.toLowerCase();
  if (s.startsWith("kalshi-vs-")) {
    const book = getSportsbook(s.slice("kalshi-vs-".length));
    if (!book) return null;
    return { type: "kalshi_vs_book", primary: EXCHANGES.kalshi, secondary: book };
  }
  if (s.startsWith("polymarket-vs-")) {
    const book = getSportsbook(s.slice("polymarket-vs-".length));
    if (!book) return null;
    return { type: "polymarket_vs_book", primary: EXCHANGES.polymarket, secondary: book };
  }
  if (s.includes("-vs-")) {
    const [a, b] = s.split("-vs-");
    const bookA = getSportsbook(a);
    const bookB = getSportsbook(b);
    if (!bookA || !bookB) return null;
    return { type: "book_vs_book", primary: bookA, secondary: bookB };
  }
  const single = getSportsbook(s);
  if (!single) return null;
  return { type: "single", primary: single, secondary: null };
}
