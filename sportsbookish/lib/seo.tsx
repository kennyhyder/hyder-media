// SEO helpers — schema.org JSON-LD generators + canonical site constants.
// Goal: rank for "kalshi odds", "kalshi vs draftkings", "[team] kalshi odds",
// and feed Google AI Overview / Bing answer cards with structured data.

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
export const SITE_NAME = "SportsBookISH";
export const SITE_DESCRIPTION = "Live Kalshi odds vs sportsbook consensus. Compare every Kalshi event-contract price against DraftKings, FanDuel, BetMGM, Caesars and 8+ more books in real time. Find the edge across NBA, MLB, NHL, EPL, MLS, and PGA Tour.";
export const SOCIAL_HANDLE = "@sportsbookish";

// Organization + WebSite — emit once in the root layout so every page benefits
export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    sameAs: [
      `https://twitter.com/${SOCIAL_HANDLE.replace("@", "")}`,
      `https://x.com/${SOCIAL_HANDLE.replace("@", "")}`,
    ],
    description: SITE_DESCRIPTION,
  };
}

export function websiteLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/sports?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

// Per-page schemas
export function breadcrumbLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

export function itemListLd(name: string, items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      url: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url}`,
      name: item.name,
    })),
  };
}

// SportsEvent — for game pages. Google supports for major sports.
export function sportsEventLd(opts: {
  name: string;                            // e.g. "Lakers vs Spurs"
  homeTeam: string;
  awayTeam: string;
  startDate: string | null;                // ISO 8601
  league: string;                          // 'nba', 'mlb', etc.
  url: string;
  description: string;
}) {
  const SPORT_NAME: Record<string, string> = {
    nba: "Basketball", mlb: "Baseball", nhl: "Ice Hockey", nfl: "American Football",
    epl: "Soccer", mls: "Soccer", ucl: "Soccer", wc: "Soccer", pga: "Golf",
  };
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: opts.name,
    description: opts.description,
    startDate: opts.startDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    url: opts.url.startsWith("http") ? opts.url : `${SITE_URL}${opts.url}`,
    sport: SPORT_NAME[opts.league] || opts.league,
    homeTeam: { "@type": "SportsTeam", name: opts.homeTeam },
    awayTeam: { "@type": "SportsTeam", name: opts.awayTeam },
  };
}

// FAQ blocks — used on pricing, homepage, and league pages so Google has
// answer-ready content for "kalshi odds" / "what is kalshi" / "how does
// kalshi compare to draftkings" queries.
export function faqLd(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
}

// Software / SaaS product schema for the pricing tiers
export function productLd(tier: { name: string; priceCents: number; interval: "month" | "year"; description: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `SportsBookISH ${tier.name}`,
    description: tier.description,
    brand: { "@type": "Brand", name: SITE_NAME },
    offers: {
      "@type": "Offer",
      url: `${SITE_URL}/pricing`,
      priceCurrency: "USD",
      price: (tier.priceCents / 100).toFixed(2),
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: (tier.priceCents / 100).toFixed(2),
        priceCurrency: "USD",
        billingIncrement: 1,
        unitText: tier.interval === "year" ? "ANN" : "MON",
      },
      availability: "https://schema.org/InStock",
    },
  };
}

// Auto-generate FAQ items for a league page from real data. Each Q&A pair is
// rendered both as visible HTML (component below) and as FAQPage schema —
// answer engines (Perplexity, ChatGPT, Google AIO) pull these into responses.
export function faqForLeaguePage(opts: {
  leagueDisplayName: string;          // "NFL", "NBA", etc.
  totalGames: number;
  totalMarkets: number;
  booksTracked: number;
  bestEdgeContestant?: string | null; // longest-edge team/player
  bestEdgePct?: number | null;        // 0-1
  hasFutures?: boolean;
}): { question: string; answer: string }[] {
  const { leagueDisplayName, totalGames, totalMarkets, booksTracked } = opts;
  const items: { question: string; answer: string }[] = [];

  items.push({
    question: `What ${leagueDisplayName} markets does Kalshi offer?`,
    answer: `Kalshi currently lists ${totalGames} ${leagueDisplayName} game lines across ${totalMarkets} markets, plus championship, conference, division, MVP, and award futures depending on the season. SportsBookISH tracks every Kalshi market alongside ${booksTracked} US sportsbooks so you can see where Kalshi is priced cheaper or more expensive than the books.`,
  });

  if (opts.bestEdgeContestant && opts.bestEdgePct != null) {
    const pct = (opts.bestEdgePct * 100).toFixed(1);
    items.push({
      question: `Where is the biggest Kalshi edge in ${leagueDisplayName} right now?`,
      answer: `${opts.bestEdgeContestant} currently shows the largest pricing gap on Kalshi, ${pct} percentage points different from the sportsbook consensus. Edges shift constantly — refresh this page for the latest snapshot.`,
    });
  }

  items.push({
    question: `How often do ${leagueDisplayName} odds update?`,
    answer: `Kalshi prices are pulled every 5 minutes via the public Kalshi REST API. Sportsbook lines refresh every 15-30 minutes. References older than 30 minutes are filtered out so you never see stale comparisons on this page.`,
  });

  items.push({
    question: `What's the difference between Kalshi and traditional sportsbooks for ${leagueDisplayName}?`,
    answer: `Kalshi is a CFTC-regulated event-contract exchange — you buy YES or NO contracts that settle at $1 or $0. Sportsbooks set prices and bake in a vig (typically 4-8% on game lines). Kalshi's fee is max(1¢, ceil(0.07 × p × (1-p) × 100)) capped at 7¢ per contract. When Kalshi prices a side cheaper than the no-vig book consensus, that's a +EV opportunity.`,
  });

  if (opts.hasFutures !== false) {
    items.push({
      question: `Are ${leagueDisplayName} futures available on Kalshi?`,
      answer: `Yes. SportsBookISH tracks championship, conference, division, MVP, award, and (where applicable) win-total futures markets for ${leagueDisplayName}. Pro and Elite subscribers get full per-book pricing on every futures market; free users can see game-line comparisons.`,
    });
  }

  items.push({
    question: `Is betting on ${leagueDisplayName} on Kalshi legal in my state?`,
    answer: `Kalshi operates as a federally-regulated exchange under the CFTC, which means it's legally accessible from all 50 U.S. states (unlike most sportsbooks, which are state-by-state). A handful of states have raised challenges to specific market types — always check Kalshi's current state availability page before trading.`,
  });

  return items;
}

// FAQ generator for a single event/game page
export function faqForEventPage(opts: {
  eventTitle: string;
  startTimeISO: string | null;
  league: string;
  leagueDisplayName: string;
  bestSide?: string | null;
  bestEdgePct?: number | null;
  bookCount: number;
}): { question: string; answer: string }[] {
  const items: { question: string; answer: string }[] = [];
  const t = opts.eventTitle;

  if (opts.bestSide && opts.bestEdgePct != null) {
    const pct = (opts.bestEdgePct * 100).toFixed(1);
    items.push({
      question: `What are the best odds for ${t}?`,
      answer: `${opts.bestSide} currently has the largest edge — Kalshi is priced ${pct} percentage points different from the sportsbook consensus. Compare per-book pricing in the table above; longest American prices are highlighted.`,
    });
  } else {
    items.push({
      question: `What are the current odds for ${t}?`,
      answer: `Live Kalshi implied probability and per-book sportsbook prices for ${t} are shown above, updated every 5 minutes. Compare against the de-vigged book median to find the cheapest side.`,
    });
  }

  if (opts.startTimeISO) {
    const date = new Date(opts.startTimeISO);
    items.push({
      question: `When is ${t}?`,
      answer: `${t} starts at ${date.toUTCString()}. Markets close at kickoff/tip-off on most books; Kalshi typically keeps trading until the event resolves.`,
    });
  }

  items.push({
    question: `Where can I get the best price on ${t}?`,
    answer: `The "Best book" column above identifies the sportsbook offering the longest American price per side. We track ${opts.bookCount} books on this matchup; subscribe to Pro for full per-book pricing across all ${opts.leagueDisplayName} markets.`,
  });

  items.push({
    question: `Is ${t} on Kalshi?`,
    answer: `Yes — Kalshi lists ${opts.leagueDisplayName} game markets as event contracts. You buy YES or NO at the listed price; contracts settle at $1 or $0 when the game ends.`,
  });

  return items;
}

// Helper to render a <script type="application/ld+json"> in a server component
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
