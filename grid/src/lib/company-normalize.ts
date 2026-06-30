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

  // ── Utilities, IOUs, public power & landowners (owner/operator substrate) ──
  // The substation / transmission / parcel-owner columns are EIA/HIFLD legal
  // names in shouty caps with "CO"/"COMPANY" suffixes and per-subsidiary
  // variants ("DUKE ENERGY CAROLINAS LLC", "DUKE ENERGY INDIANA LLC", …). Fold
  // each family to a single canonical brand so an org hub aggregates the whole
  // operating company across substations, lines, and parcels.
  "georgia power": "Georgia Power",
  "alabama power": "Alabama Power",
  "mississippi power": "Mississippi Power",
  "gulf power": "Gulf Power",
  "commonwealth edison": "Commonwealth Edison",
  "comed": "Commonwealth Edison",
  "idaho power": "Idaho Power",
  "pacificorp": "PacifiCorp",
  "pacific power": "PacifiCorp",
  "rocky mountain power": "PacifiCorp",
  "avista": "Avista",
  "ameren illinois": "Ameren",
  "ameren missouri": "Ameren",
  "union electric - mo": "Ameren",
  "union electric": "Ameren",
  "oncor electric delivery": "Oncor",
  "oncor": "Oncor",
  "oklahoma gas & electric": "Oklahoma Gas & Electric",
  "oge energy": "Oklahoma Gas & Electric",
  "public service of oklahoma": "Public Service Co of Oklahoma",
  "public service of colorado": "Xcel Energy",
  "public service of new mexico": "PNM",
  "northern states power - minnesota": "Xcel Energy",
  "northern states power - wisconsin": "Xcel Energy",
  "northern states power": "Xcel Energy",
  "southwestern public service": "Xcel Energy",
  "xcel energy": "Xcel Energy",
  "pacific gas & electric": "Pacific Gas & Electric",
  "pacific gas and electric": "Pacific Gas & Electric",
  "pg&e": "Pacific Gas & Electric",
  "southern california edison": "Southern California Edison",
  "san diego gas & electric": "San Diego Gas & Electric",
  "bonneville power administration": "Bonneville Power Administration",
  "bpa": "Bonneville Power Administration",
  "tennessee valley authority": "Tennessee Valley Authority",
  "tva": "Tennessee Valley Authority",
  "american transmission": "American Transmission Co",
  "american electric power": "American Electric Power",
  "aep": "American Electric Power",
  "duke energy": "Duke Energy",
  "duke energy carolinas": "Duke Energy",
  "duke energy progress": "Duke Energy",
  "duke energy florida": "Duke Energy",
  "duke energy indiana": "Duke Energy",
  "duke energy ohio": "Duke Energy",
  "duke energy kentucky": "Duke Energy",
  "dominion": "Dominion Energy",
  "dominion energy": "Dominion Energy",
  "dominion energy virginia": "Dominion Energy",
  "dominion virginia power": "Dominion Energy",
  "virginia electric & power": "Dominion Energy",
  "virginia electric and power": "Dominion Energy",
  "florida power & light": "Florida Power & Light",
  "fpl": "Florida Power & Light",
  "nextera energy": "NextEra Energy",
  "tampa electric": "Tampa Electric",
  "teco": "Tampa Electric",
  "consolidated edison": "Consolidated Edison",
  "con edison": "Consolidated Edison",
  "coned": "Consolidated Edison",
  "exelon": "Exelon",
  "pseg": "PSEG",
  "public service electric & gas": "PSEG",
  "public service enterprise": "PSEG",
  "national grid": "National Grid",
  "eversource energy": "Eversource",
  "eversource": "Eversource",
  "entergy": "Entergy",
  "entergy arkansas": "Entergy",
  "entergy louisiana": "Entergy",
  "entergy mississippi": "Entergy",
  "entergy texas": "Entergy",
  "centerpoint energy": "CenterPoint Energy",
  "centerpoint": "CenterPoint Energy",
  "we energies": "WEC Energy Group",
  "wisconsin electric power": "WEC Energy Group",
  "wisconsin public service": "WEC Energy Group",
  "wec energy": "WEC Energy Group",
  "appalachian power": "American Electric Power",
  "indiana michigan power": "American Electric Power",
  "kentucky power": "American Electric Power",
  "ohio power": "American Electric Power",
  "public service of new hampshire": "Eversource",
  "arizona public service": "Arizona Public Service",
  "aps": "Arizona Public Service",
  "salt river project": "Salt River Project",
  "srp": "Salt River Project",
  "tucson electric power": "Tucson Electric Power",
  "nv energy": "NV Energy",
  "puget sound energy": "Puget Sound Energy",
  "portland general electric": "Portland General Electric",
  "georgia transmission": "Georgia Transmission Corp",
  "midamerican energy": "MidAmerican Energy",
  "berkshire hathaway energy": "Berkshire Hathaway Energy",
  "first energy": "FirstEnergy",
  "firstenergy": "FirstEnergy",
  "ppl electric utilities": "PPL",
  "ppl": "PPL",
  "evergy": "Evergy",
  "westar energy": "Evergy",
  "kansas city power & light": "Evergy",
  "los angeles department of water & power": "LADWP",
  "ladwp": "LADWP",
  "santee cooper": "Santee Cooper",
  "south carolina public service authority": "Santee Cooper",
  "south carolina electric & gas": "Dominion Energy",
  "scana": "Dominion Energy",

  // ── Class-I & regional railroads (rail_lines abbreviations vs fiber/parcel
  // full names) and major fiber carriers. Fold abbreviation + full name + the
  // "(… fiber)" parenthetical variants to one canonical railroad/carrier org. ──
  "up": "Union Pacific",
  "uprr": "Union Pacific",
  "union pacific": "Union Pacific",
  "union pacific railroad": "Union Pacific",
  "bnsf": "BNSF Railway",
  "bnsf railway": "BNSF Railway",
  "bnsf railway company": "BNSF Railway",
  "burlington northern santa fe": "BNSF Railway",
  "csxt": "CSX Transportation",
  "csx": "CSX Transportation",
  "csx transportation": "CSX Transportation",
  "ns": "Norfolk Southern",
  "nsr": "Norfolk Southern",
  "norfolk southern": "Norfolk Southern",
  "norfolk southern railway": "Norfolk Southern",
  "kcs": "Kansas City Southern",
  "kansas city southern": "Kansas City Southern",
  "cn": "Canadian National",
  "canadian national": "Canadian National",
  "cn railway": "Canadian National",
  "cprs": "Canadian Pacific Kansas City",
  "cp": "Canadian Pacific Kansas City",
  "cpkc": "Canadian Pacific Kansas City",
  "canadian pacific": "Canadian Pacific Kansas City",
  "amtk": "Amtrak",
  "amtrak": "Amtrak",
  "soo": "Soo Line",
  "soo line": "Soo Line",
  "cox": "Cox Communications",
  "cox com": "Cox Communications",
  "cox communications": "Cox Communications",
  "zayo": "Zayo",
  "level 3": "Lumen Technologies",
  "level3": "Lumen Technologies",
  "windstream": "Windstream",
  "uniti": "Uniti Group",
  "uniti group": "Uniti Group",
  "frontier communications": "Frontier Communications",
  "comcast": "Comcast",
  "charter communications": "Charter Communications",
  "spectrum": "Charter Communications",
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
  "llp",
  "plc",
  "holdings",
  "group",
  // Utility/landowner legal-form noise common in EIA/HIFLD owner columns.
  "the",
]);

/** Strip trailing legal suffixes and stray punctuation, collapse whitespace. */
function cleanRaw(raw: string): string {
  let s = raw.trim();
  // Drop trailing parenthetical / bracketed qualifiers, possibly repeated:
  // "Union Electric Co - (MO)" → "Union Electric Co -", "(formerly X)" → "".
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\s*[([][^)\]]*[)\]]\s*$/g, "").trim();
    if (next === s) break;
    s = next;
  }
  // Drop trailing dangling separators left behind ("Union Electric Co -").
  s = s.replace(/[\s,;:/\\-]+$/g, "").trim();
  const parts = s
    .split(/[\s,]+/)
    .map((p) => p.replace(/\.+$/, ""))
    .filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase().replace(/[.,]/g, "");
    if (STOP_SUFFIX.has(last)) parts.pop();
    else break;
  }
  // Strip a leading "The " on multi-word names ("The Empire District…").
  if (parts.length > 1 && parts[0].toLowerCase() === "the") parts.shift();
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

  // Utility-family leading-keyword folds: catch per-subsidiary legal names not
  // enumerated in ALIAS (e.g. "Duke Energy Tennessee", "Entergy New Orleans").
  if (/^duke energy\b/.test(key)) return "Duke Energy";
  if (/^entergy\b/.test(key)) return "Entergy";
  if (/^dominion energy\b/.test(key)) return "Dominion Energy";
  if (/^(northern states power|southwestern public service)\b/.test(key)) return "Xcel Energy";
  if (/^georgia power\b/.test(key)) return "Georgia Power";
  if (/^alabama power\b/.test(key)) return "Alabama Power";

  return titleCase(cleaned);
}

/** Stable slug for a canonical company name (reuses geo slugify). */
export function companySlug(name: string): string {
  return slugify(name);
}
