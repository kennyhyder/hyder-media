// JSON-LD WebApplication schema generator — drop into lib/seo.ts (or equivalent).
// Mount in the root layout alongside organizationLd() and websiteLd().
//
// This is the schema Google AI Overview, Perplexity, and ChatGPT search use
// to populate their answers about your product. The `offers` array drives
// pricing answers; `sameAs` anchors your entity across Wikidata + HF + GitHub
// + social; `about[]` references related Wikidata Q-IDs so crawlers traverse
// the graph.

export interface Tier {
  name: string;
  price: number;
  interval: "month" | "year";
  category: string; // e.g. "subscription", "api_subscription"
  url: string;
}

interface WebApplicationLdOpts {
  siteUrl: string;                    // https://yoursite.com
  siteName: string;                   // "YourBrand"
  alternateNames: string[];           // ["yourbrand.com", "Yourbrand"]
  description: string;                // 1-2 sentence factual product description
  applicationCategory: string;        // "SportsApplication" | "FinanceApplication" | "BusinessApplication" | "UtilitiesApplication" etc
  applicationSubCategory?: string;    // free-form, e.g. "Odds comparison"
  wikidataQid: string;                // e.g. "Q139814938"
  huggingFaceDataset?: string;        // e.g. "kennyhyder/sportsbookish-daily-odds"
  xHandle?: string;                   // without @, e.g. "sportsbookish"
  githubDocsRepo?: string;            // e.g. "kennyhyder/sportsbookish-docs"
  features: string[];                 // bullet-point feature list
  tiers: Tier[];                      // pricing tiers — drives <offers>
  about: { name: string; wikidataQid?: string }[];  // related entities
  audienceType: string;               // e.g. "Sports bettors, prediction-market traders"
  publisherName: string;              // e.g. "Hyder Media"
  publisherUrl: string;               // e.g. "https://hyder.me"
}

export function webApplicationLd(opts: WebApplicationLdOpts) {
  const sameAs = [
    `https://www.wikidata.org/wiki/${opts.wikidataQid}`,
    opts.huggingFaceDataset && `https://huggingface.co/datasets/${opts.huggingFaceDataset}`,
    opts.xHandle && `https://x.com/${opts.xHandle}`,
    opts.xHandle && `https://twitter.com/${opts.xHandle}`,
    opts.githubDocsRepo && `https://github.com/${opts.githubDocsRepo}`,
  ].filter(Boolean);

  const prices = opts.tiers.map((t) => t.price);
  const lowPrice = Math.min(...prices).toString();
  const highPrice = Math.max(...prices).toString();

  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${opts.siteUrl}/#webapplication`,
    name: opts.siteName,
    alternateName: opts.alternateNames,
    url: opts.siteUrl,
    description: opts.description,
    applicationCategory: opts.applicationCategory,
    ...(opts.applicationSubCategory && { applicationSubCategory: opts.applicationSubCategory }),
    operatingSystem: "Web",
    browserRequirements: "Requires JavaScript",
    inLanguage: "en-US",
    countryOfOrigin: { "@type": "Country", name: "United States" },
    isAccessibleForFree: opts.tiers.some((t) => t.price === 0),
    creator: { "@type": "Organization", name: opts.publisherName, url: opts.publisherUrl },
    publisher: { "@type": "Organization", name: opts.publisherName, url: opts.publisherUrl },
    sameAs,
    featureList: opts.features,
    offers: {
      "@type": "AggregateOffer",
      lowPrice,
      highPrice,
      priceCurrency: "USD",
      offerCount: opts.tiers.length,
      offers: opts.tiers.map((t) => ({
        "@type": "Offer",
        name: t.name,
        price: t.price.toString(),
        priceCurrency: "USD",
        url: t.url,
        category: t.category,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: t.price.toString(),
          priceCurrency: "USD",
          unitText: t.interval === "year" ? "ANN" : "MON",
        },
      })),
    },
    about: opts.about.map((a) => ({
      "@type": "Thing",
      name: a.name,
      ...(a.wikidataQid && { sameAs: `https://www.wikidata.org/wiki/${a.wikidataQid}` }),
    })),
    audience: { "@type": "Audience", audienceType: opts.audienceType },
  };
}

// Example call:
//
// webApplicationLd({
//   siteUrl: "https://sportsbookish.com",
//   siteName: "SportsBookISH",
//   alternateNames: ["Sportsbookish", "sportsbookish.com"],
//   description: "Live Kalshi vs sportsbook odds comparison across 9 sports.",
//   applicationCategory: "SportsApplication",
//   applicationSubCategory: "Odds comparison",
//   wikidataQid: "Q139814938",
//   huggingFaceDataset: "kennyhyder/sportsbookish-daily-odds",
//   xHandle: "sportsbookish",
//   githubDocsRepo: "kennyhyder/sportsbookish-docs",
//   features: [
//     "Live Kalshi event-contract pricing across 9 sports",
//     "No-vig consensus from 11+ US sportsbooks",
//     "Polymarket prediction-market comparison",
//   ],
//   tiers: [
//     { name: "Free", price: 0, interval: "month", category: "subscription", url: "https://sportsbookish.com/pricing" },
//     { name: "Pro", price: 10, interval: "month", category: "subscription", url: "https://sportsbookish.com/pricing" },
//     { name: "Elite", price: 100, interval: "year", category: "subscription", url: "https://sportsbookish.com/pricing" },
//   ],
//   about: [
//     { name: "Kalshi", wikidataQid: "Q114586938" },
//     { name: "Polymarket", wikidataQid: "Q123502863" },
//     { name: "Prediction market", wikidataQid: "Q282283" },
//   ],
//   audienceType: "Sports bettors, prediction-market traders",
//   publisherName: "Hyder Media",
//   publisherUrl: "https://hyder.me",
// });
