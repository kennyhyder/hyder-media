// Pure operator-name normalization (NO server-only deps).
//
// Split out from companies.ts so both the server aggregation lib AND client-safe
// modules (entity-slug → map/types) can import the canonicalizer + slug helper
// without pulling in the service-key REST layer.
//
// The `operator` / `org_name` columns are partial and dirty: casing drift
// ("DataBank" vs "Databank"), corporate suffixes ("CyrusOne Inc."), brand-vs-
// legal-name ("Lumen" vs "Lumen Technologies"), and per-facility codenames
// ("Amazon IAD75"). We canonicalize in two passes: a curated alias map keyed on
// the cleaned (suffix-stripped, lowercased) form, then a generic suffix-stripper
// + Title-caser for everything else.

import { slugify } from "@/lib/geo";

/** Curated alias map: cleaned-key (lowercase) → canonical display name. */
const ALIAS: Record<string, string> = {
  // Hyperscalers — fold codenames + brand variants.
  "amazon": "Amazon Web Services",
  "amazon aws": "Amazon Web Services",
  "amazon web services": "Amazon Web Services",
  "aws": "Amazon Web Services",
  "anthropic / amazon": "Amazon Web Services",
  "google llc": "Google",
  "microsoft azure": "Microsoft",
  "meta platforms": "Meta",
  "apple": "Apple",
  // Wholesale / colo operators with brand-vs-legal drift.
  "quality technology services": "QTS",
  "qts data centers": "QTS",
  "qts realty trust": "QTS",
  "cyrusone": "CyrusOne",
  "equinix": "Equinix",
  "digital realty": "Digital Realty",
  "coresite": "CoreSite",
  "coresite real estate 1656 mccarthy": "CoreSite",
  "databank": "Databank",
  "aligned": "Aligned",
  "aligned data centers": "Aligned",
  "edgeconnex": "EdgeConneX",
  "edgecore": "EdgeCore",
  "edgecore digital infrastructure": "EdgeCore",
  "lumen": "Lumen Technologies",
  "lumen technologies": "Lumen Technologies",
  "centurylink": "Lumen Technologies", // CenturyLink rebranded to Lumen
  "cologix": "Cologix",
  "centersquare": "Centersquare",
  "flexential": "Flexential",
  "tierpoint": "TierPoint",
  "stack infrastructure": "Stack Infrastructure",
  "stream": "Stream Data Centers",
  "stream data centers": "Stream Data Centers",
  "sabey": "Sabey Data Centers",
  "sabey data centers": "Sabey Data Centers",
  "vantage": "Vantage Data Centers",
  "vantage data centers": "Vantage Data Centers",
  "t5": "T5 Data Centers",
  "t5 data centers": "T5 Data Centers",
  "h5": "H5 Data Centers",
  "h5 data centers": "H5 Data Centers",
  "iron mountain": "Iron Mountain",
  "iron mountain data centers": "Iron Mountain",
  "netrality": "Netrality Data Centers",
  "netrality data centers": "Netrality Data Centers",
  "serverfarm": "Serverfarm",
  "ntt": "NTT",
  "ntt limited": "NTT",
  "ragingwire data centers - ntt": "NTT",
  "rackspace us": "Rackspace",
  "rackspace": "Rackspace",
  "switch": "Switch",
  "firstlight": "FirstLight",
  "firstlight fiber": "FirstLight",
  "lightedge solutions": "LightEdge Solutions",
  "lightedge nfinit": "LightEdge Solutions",
  "lightedge cavern suites": "LightEdge Solutions",
  "cogent communications": "Cogent Communications",
  "crown castle": "Crown Castle",
  "crown castle fiber": "Crown Castle",
  "element critical": "Element Critical",
  "verizon wireless": "Verizon",
  "verizon": "Verizon",
  "expedient": "Expedient",
  "ark data centers": "Ark Data Centers",
  "datasite": "DataSite",
  "coreweave": "CoreWeave",
  "lifeline data centers": "Lifeline",
  "lifeline": "Lifeline",
  "att": "AT&T",
  "at&t": "AT&T",
  "american telephone & telegraph": "AT&T",
  "evocative": "Evocative",
};

const STOP_SUFFIX = new Set([
  "inc",
  "incorporated",
  "llc",
  "l.l.c",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "lp",
  "l.p",
  "plc",
  "holdings",
  "group",
]);

/** Strip trailing legal suffixes and stray punctuation, collapse whitespace. */
function cleanRaw(raw: string): string {
  let s = raw.trim();
  // Drop a parenthetical "(formerly ...)" / "(AWS)" tail.
  s = s.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  const parts = s
    .split(/[\s,]+/)
    .map((p) => p.replace(/\.+$/, ""))
    .filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase().replace(/[.,]/g, "");
    if (STOP_SUFFIX.has(last)) parts.pop();
    else break;
  }
  return parts.join(" ").trim();
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => {
      // Keep short all-caps acronyms (QTS, NTT, AT&T, DLI) uppercase.
      if (w.length <= 3 && w === w.toUpperCase()) return w;
      // Preserve internal-caps brand spellings (CyrusOne, OneNeck, LightSpeed):
      // only re-case words that are entirely upper- or lower-case. This keeps
      // camelCase brands intact while folding "ONE"/"one" → "One" so casing
      // variants of the same raw name produce one canonical slug.
      const isUniformCase = w === w.toUpperCase() || w === w.toLowerCase();
      const tail = isUniformCase ? w.slice(1).toLowerCase() : w.slice(1);
      return w.charAt(0).toUpperCase() + tail;
    })
    .join(" ");
}

/**
 * Canonical display name for a raw operator/org string. Returns null for empty
 * input. Codename prefixes like "Amazon IAD75" fold via a leading-keyword check
 * after the alias map misses.
 */
export function normalizeCompanyName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = cleanRaw(raw);
  if (!cleaned) return null;
  const key = cleaned.toLowerCase();
  if (ALIAS[key]) return ALIAS[key];

  if (/^amazon\b/.test(key)) return "Amazon Web Services";
  if (/^microsoft\b/.test(key)) return "Microsoft";
  if (/^google\b/.test(key)) return "Google";
  if (/^meta\b/.test(key)) return "Meta";
  if (/^apple\b/.test(key)) return "Apple";

  return titleCase(cleaned);
}

/** Stable slug for a canonical company name (reuses geo slugify). */
export function companySlug(name: string): string {
  return slugify(name);
}
