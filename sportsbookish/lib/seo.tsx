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
    nba: "Basketball", mlb: "Baseball", nhl: "Ice Hockey", epl: "Soccer", mls: "Soccer", pga: "Golf",
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

// Helper to render a <script type="application/ld+json"> in a server component
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
