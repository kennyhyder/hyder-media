// JSON-LD schema builders. Each returns a plain object to be rendered by
// <JsonLd>. dateModified flows from rollups freshness so AI/answer engines
// see honest data-recency signals.

import { SITE_NAME, SITE_URL, SITE_DESCRIPTION, ORG_LEGAL_NAME, CONTACT_EMAIL } from "./site";
import { freshness } from "./rollups";

type Json = Record<string, unknown>;

export function organizationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    legalName: ORG_LEGAL_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    email: CONTACT_EMAIL,
    sameAs: [],
  };
}

export function webApplicationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: SITE_DESCRIPTION,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free tier with public site-screening data; paid plans for full dataset + API.",
    },
  };
}

export interface DatasetOpts {
  name: string;
  description: string;
  url: string;
  dateModified?: string;
  spatialCoverage?: string;
}

export function datasetSchema(opts: DatasetOpts): Json {
  const out: Json = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    dateModified: opts.dateModified ?? freshness(),
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    license: "https://megawattsite.com/methodology",
    keywords: [
      "datacenter site selection",
      "speed to power",
      "interconnection queue",
      "power availability",
      "data center real estate",
    ],
  };
  if (opts.spatialCoverage) {
    out.spatialCoverage = { "@type": "Place", name: opts.spatialCoverage };
  }
  return out;
}

export function placeSchema(opts: { name: string; type?: "State" | "AdministrativeArea" | "Place" }): Json {
  return {
    "@context": "https://schema.org",
    "@type": opts.type ?? "AdministrativeArea",
    name: opts.name,
    address: { "@type": "PostalAddress", addressCountry: "US" },
  };
}

export interface ListItem {
  name: string;
  url?: string;
  position?: number;
}

export function itemListSchema(items: ListItem[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: it.position ?? i + 1,
      name: it.name,
      ...(it.url ? { url: it.url } : {}),
    })),
  };
}

export interface Crumb {
  name: string;
  url: string;
}

export function breadcrumbSchema(crumbs: Crumb[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url.startsWith("http") ? c.url : `${SITE_URL}${c.url}`,
    })),
  };
}

export interface QaPair {
  q: string;
  a: string;
}

export function faqSchema(pairs: QaPair[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((p) => ({
      "@type": "Question",
      name: p.q,
      acceptedAnswer: { "@type": "Answer", text: p.a },
    })),
  };
}
