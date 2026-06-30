#!/usr/bin/env node
/**
 * build-organizations.mjs — precompute the unified ORGANIZATION index.
 *
 * GridCensus's differentiator: every owner/operator across the whole dataset
 * (utilities, landowners, DC operators, IXP orgs, railroads, fiber carriers)
 * rolled up into ONE organization profile that aggregates ALL their assets and
 * is cross-linked from every entity. This script scans every owner/operator
 * column, normalizes each raw name to a canonical org (reusing the same alias
 * logic as src/lib/company-normalize.ts), and emits src/data/organizations.json.
 *
 * PostgREST aggregates are disabled on this project, so all grouping happens in
 * JS after bounded paginated REST fetches (same approach as build-rollups.mjs).
 *
 * Output shape (lean — counts + states + the raw-variant map live queries need):
 *   {
 *     generatedAt, dataLastUpdated, totalOrganizations, totalAssets,
 *     organizations: {
 *       "<slug>": {
 *         name, totalAssets,
 *         assets: { datacenters, candidate_sites, substations,
 *                   transmission_lines, fiber_routes, brownfields, ixps, parcels },
 *         states: ["VA", ...],
 *         // exact raw owner strings per source column, so the profile page can
 *         // do owner=in.(...) live queries to pull the actual asset rows:
 *         variants: { parcel_owner: [...], substations_owners: [...], ... }
 *       }
 *     }
 *   }
 *
 * Usage:  node scripts/build-organizations.mjs
 * Env:    SUPABASE_URL + SUPABASE_SERVICE_KEY (falls back to ./.env.local or ../.env.local)
 *
 * Re-run after every data refresh (and specifically after the concurrent
 * grid_substations / grid_transmission_lines re-ingest settles).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  let { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    for (const p of [resolve(__dirname, "../.env.local"), resolve(__dirname, "../../.env.local")]) {
      try {
        for (const line of readFileSync(p, "utf8").split("\n")) {
          const m = line.match(/^(SUPABASE_URL|SUPABASE_SERVICE_KEY)=(.*)$/);
          if (m) {
            const v = m[2].trim().replace(/^["']|["']$/g, "");
            if (m[1] === "SUPABASE_URL" && !SUPABASE_URL) SUPABASE_URL = v;
            if (m[1] === "SUPABASE_SERVICE_KEY" && !SUPABASE_SERVICE_KEY) SUPABASE_SERVICE_KEY = v;
          }
        }
      } catch { /* keep looking */ }
    }
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  return { SUPABASE_URL: SUPABASE_URL.replace(/\/$/, ""), SUPABASE_SERVICE_KEY };
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = loadEnv();
const HEADERS = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

// ── Normalization (ported from src/lib/company-normalize.ts — keep in sync) ──
// Curated alias map: cleaned-key (lowercase, suffix-stripped) → canonical name.
const ALIAS = {
  "amazon": "Amazon Web Services", "amazon aws": "Amazon Web Services",
  "amazon web services": "Amazon Web Services", "aws": "Amazon Web Services",
  "anthropic / amazon": "Amazon Web Services", "google llc": "Google",
  "microsoft azure": "Microsoft", "meta platforms": "Meta", "apple": "Apple",
  "quality technology services": "QTS", "qts data centers": "QTS", "qts realty trust": "QTS",
  "cyrusone": "CyrusOne", "equinix": "Equinix", "digital realty": "Digital Realty",
  "coresite": "CoreSite", "coresite real estate 1656 mccarthy": "CoreSite",
  "databank": "Databank", "aligned": "Aligned", "aligned data centers": "Aligned",
  "edgeconnex": "EdgeConneX", "edgecore": "EdgeCore", "edgecore digital infrastructure": "EdgeCore",
  "lumen": "Lumen Technologies", "lumen technologies": "Lumen Technologies",
  "centurylink": "Lumen Technologies", "cologix": "Cologix", "centersquare": "Centersquare",
  "flexential": "Flexential", "tierpoint": "TierPoint", "stack infrastructure": "Stack Infrastructure",
  "stream": "Stream Data Centers", "stream data centers": "Stream Data Centers",
  "sabey": "Sabey Data Centers", "sabey data centers": "Sabey Data Centers",
  "vantage": "Vantage Data Centers", "vantage data centers": "Vantage Data Centers",
  "t5": "T5 Data Centers", "t5 data centers": "T5 Data Centers",
  "h5": "H5 Data Centers", "h5 data centers": "H5 Data Centers",
  "iron mountain": "Iron Mountain", "iron mountain data centers": "Iron Mountain",
  "netrality": "Netrality Data Centers", "netrality data centers": "Netrality Data Centers",
  "serverfarm": "Serverfarm", "ntt": "NTT", "ntt limited": "NTT",
  "ragingwire data centers - ntt": "NTT", "rackspace us": "Rackspace", "rackspace": "Rackspace",
  "switch": "Switch", "firstlight": "FirstLight", "firstlight fiber": "FirstLight",
  "lightedge solutions": "LightEdge Solutions", "lightedge nfinit": "LightEdge Solutions",
  "lightedge cavern suites": "LightEdge Solutions", "cogent communications": "Cogent Communications",
  "crown castle": "Crown Castle", "crown castle fiber": "Crown Castle",
  "element critical": "Element Critical", "verizon wireless": "Verizon", "verizon": "Verizon",
  "expedient": "Expedient", "ark data centers": "Ark Data Centers", "datasite": "DataSite",
  "coreweave": "CoreWeave", "lifeline data centers": "Lifeline", "lifeline": "Lifeline",
  "att": "AT&T", "at&t": "AT&T", "american telephone & telegraph": "AT&T", "evocative": "Evocative",
  // Utilities / IOUs / public power / landowners.
  "georgia power": "Georgia Power", "alabama power": "Alabama Power",
  "mississippi power": "Mississippi Power", "gulf power": "Gulf Power",
  "commonwealth edison": "Commonwealth Edison", "comed": "Commonwealth Edison",
  "idaho power": "Idaho Power", "pacificorp": "PacifiCorp", "pacific power": "PacifiCorp",
  "rocky mountain power": "PacifiCorp", "avista": "Avista", "ameren illinois": "Ameren",
  "ameren missouri": "Ameren", "union electric - mo": "Ameren", "union electric": "Ameren",
  "oncor electric delivery": "Oncor", "oncor": "Oncor",
  "oklahoma gas & electric": "Oklahoma Gas & Electric", "oge energy": "Oklahoma Gas & Electric",
  "public service of oklahoma": "Public Service Co of Oklahoma",
  "public service of colorado": "Xcel Energy", "public service of new mexico": "PNM",
  "northern states power - minnesota": "Xcel Energy", "northern states power - wisconsin": "Xcel Energy",
  "northern states power": "Xcel Energy", "southwestern public service": "Xcel Energy",
  "xcel energy": "Xcel Energy", "pacific gas & electric": "Pacific Gas & Electric",
  "pacific gas and electric": "Pacific Gas & Electric", "pg&e": "Pacific Gas & Electric",
  "southern california edison": "Southern California Edison",
  "san diego gas & electric": "San Diego Gas & Electric",
  "bonneville power administration": "Bonneville Power Administration", "bpa": "Bonneville Power Administration",
  "tennessee valley authority": "Tennessee Valley Authority", "tva": "Tennessee Valley Authority",
  "american transmission": "American Transmission Co", "american electric power": "American Electric Power",
  "aep": "American Electric Power", "duke energy": "Duke Energy",
  "duke energy carolinas": "Duke Energy", "duke energy progress": "Duke Energy",
  "duke energy florida": "Duke Energy", "duke energy indiana": "Duke Energy",
  "duke energy ohio": "Duke Energy", "duke energy kentucky": "Duke Energy",
  "dominion": "Dominion Energy", "dominion energy": "Dominion Energy",
  "dominion energy virginia": "Dominion Energy", "dominion virginia power": "Dominion Energy",
  "virginia electric & power": "Dominion Energy", "virginia electric and power": "Dominion Energy",
  "florida power & light": "Florida Power & Light", "fpl": "Florida Power & Light",
  "nextera energy": "NextEra Energy", "tampa electric": "Tampa Electric", "teco": "Tampa Electric",
  "consolidated edison": "Consolidated Edison", "con edison": "Consolidated Edison",
  "coned": "Consolidated Edison", "exelon": "Exelon", "pseg": "PSEG",
  "public service electric & gas": "PSEG", "public service enterprise": "PSEG",
  "national grid": "National Grid", "eversource energy": "Eversource", "eversource": "Eversource",
  "entergy": "Entergy", "entergy arkansas": "Entergy", "entergy louisiana": "Entergy",
  "entergy mississippi": "Entergy", "entergy texas": "Entergy",
  "centerpoint energy": "CenterPoint Energy", "centerpoint": "CenterPoint Energy",
  "we energies": "WEC Energy Group", "wisconsin electric power": "WEC Energy Group",
  "wisconsin public service": "WEC Energy Group", "wec energy": "WEC Energy Group",
  "appalachian power": "American Electric Power", "indiana michigan power": "American Electric Power",
  "kentucky power": "American Electric Power", "ohio power": "American Electric Power",
  "public service of new hampshire": "Eversource",
  "arizona public service": "Arizona Public Service", "aps": "Arizona Public Service",
  "salt river project": "Salt River Project", "srp": "Salt River Project",
  "tucson electric power": "Tucson Electric Power", "nv energy": "NV Energy",
  "puget sound energy": "Puget Sound Energy", "portland general electric": "Portland General Electric",
  "georgia transmission": "Georgia Transmission Corp", "midamerican energy": "MidAmerican Energy",
  "berkshire hathaway energy": "Berkshire Hathaway Energy", "first energy": "FirstEnergy",
  "firstenergy": "FirstEnergy", "ppl electric utilities": "PPL", "ppl": "PPL",
  "evergy": "Evergy", "westar energy": "Evergy", "kansas city power & light": "Evergy",
  "los angeles department of water & power": "LADWP", "ladwp": "LADWP",
  "santee cooper": "Santee Cooper", "south carolina public service authority": "Santee Cooper",
  "south carolina electric & gas": "Dominion Energy", "scana": "Dominion Energy",
  // Class-I & regional railroads + major fiber carriers.
  "up": "Union Pacific", "uprr": "Union Pacific", "union pacific": "Union Pacific",
  "union pacific railroad": "Union Pacific", "bnsf": "BNSF Railway",
  "bnsf railway": "BNSF Railway", "bnsf railway company": "BNSF Railway",
  "burlington northern santa fe": "BNSF Railway", "csxt": "CSX Transportation",
  "csx": "CSX Transportation", "csx transportation": "CSX Transportation",
  "ns": "Norfolk Southern", "nsr": "Norfolk Southern", "norfolk southern": "Norfolk Southern",
  "norfolk southern railway": "Norfolk Southern", "kcs": "Kansas City Southern",
  "kansas city southern": "Kansas City Southern", "cn": "Canadian National",
  "canadian national": "Canadian National", "cn railway": "Canadian National",
  "cprs": "Canadian Pacific Kansas City", "cp": "Canadian Pacific Kansas City",
  "cpkc": "Canadian Pacific Kansas City", "canadian pacific": "Canadian Pacific Kansas City",
  "amtk": "Amtrak", "amtrak": "Amtrak", "soo": "Soo Line", "soo line": "Soo Line",
  "cox": "Cox Communications", "cox com": "Cox Communications",
  "cox communications": "Cox Communications", "zayo": "Zayo",
  "level 3": "Lumen Technologies", "level3": "Lumen Technologies",
  "windstream": "Windstream", "uniti": "Uniti Group", "uniti group": "Uniti Group",
  "frontier communications": "Frontier Communications", "comcast": "Comcast",
  "charter communications": "Charter Communications", "spectrum": "Charter Communications",
};

const STOP_SUFFIX = new Set([
  "inc", "incorporated", "llc", "l.l.c", "ltd", "limited", "corp", "corporation",
  "co", "company", "lp", "l.p", "llp", "plc", "holdings", "group", "the",
]);

function cleanRaw(raw) {
  let s = String(raw).trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\s*[([][^)\]]*[)\]]\s*$/g, "").trim();
    if (next === s) break;
    s = next;
  }
  s = s.replace(/[\s,;:/\\-]+$/g, "").trim();
  const parts = s.split(/[\s,]+/).map((p) => p.replace(/\.+$/, "")).filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase().replace(/[.,]/g, "");
    if (STOP_SUFFIX.has(last)) parts.pop();
    else break;
  }
  if (parts.length > 1 && parts[0].toLowerCase() === "the") parts.shift();
  return parts.join(" ").trim();
}

function titleCase(s) {
  return s.split(/\s+/).map((w) => {
    if (w.length <= 3 && w === w.toUpperCase()) return w;
    const isUniformCase = w === w.toUpperCase() || w === w.toLowerCase();
    const tail = isUniformCase ? w.slice(1).toLowerCase() : w.slice(1);
    return w.charAt(0).toUpperCase() + tail;
  }).join(" ");
}

function normalizeCompanyName(raw) {
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
  if (/^duke energy\b/.test(key)) return "Duke Energy";
  if (/^entergy\b/.test(key)) return "Entergy";
  if (/^dominion energy\b/.test(key)) return "Dominion Energy";
  if (/^(northern states power|southwestern public service)\b/.test(key)) return "Xcel Energy";
  if (/^georgia power\b/.test(key)) return "Georgia Power";
  if (/^alabama power\b/.test(key)) return "Alabama Power";
  return titleCase(cleaned);
}

function slugify(s) {
  if (!s) return "";
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Names we never want to index as an "organization" (junk / placeholders).
const NAME_BLOCKLIST = new Set([
  "unknown", "n/a", "na", "none", "null", "not available", "tbd", "private",
  "various", "multiple", "owner", "city", "county", "state", "us", "usa",
]);
function isJunkName(name) {
  if (!name) return true;
  const k = name.trim().toLowerCase();
  if (NAME_BLOCKLIST.has(k)) return true;
  if (!/[a-z0-9]/i.test(name)) return true;
  return false;
}

// ── Source columns to scan (table, raw owner column, asset key, variant key) ──
// `array` flips owners[] handling. `state` is the per-row state column (for the
// states footprint). All are paginated with Range headers.
const SOURCES = [
  { table: "grid_datacenters",        col: "operator",       asset: "datacenters",        variant: "datacenters_operator",       array: false },
  { table: "grid_dc_inventory",       col: "operator",       asset: "datacenters",        variant: "dc_inventory_operator",      array: false },
  { table: "grid_dc_sites",           col: "parcel_owner",   asset: "candidate_sites",    variant: "dc_sites_parcel_owner",      array: false },
  { table: "grid_substations",        col: "owners",         asset: "substations",        variant: "substations_owners",         array: true  },
  { table: "grid_transmission_lines", col: "owner",          asset: "transmission_lines", variant: "transmission_owner",         array: false },
  { table: "grid_fiber_routes",       col: "operator",       asset: "fiber_routes",       variant: "fiber_operator",             array: false },
  { table: "grid_rail_lines",         col: "railroad_owner", asset: "rail_lines",         variant: "rail_railroad_owner",        array: false },
  { table: "grid_brownfield_sites",   col: "operator_name",  asset: "brownfields",        variant: "brownfields_operator_name",  array: false },
  { table: "grid_ixp_facilities",     col: "org_name",       asset: "ixps",               variant: "ixp_org_name",               array: false },
  { table: "grid_parcels",            col: "owner_name",     asset: "parcels",            variant: "parcels_owner_name",         array: false },
];

const ASSET_KEYS = [
  "datacenters", "candidate_sites", "substations", "transmission_lines",
  "fiber_routes", "rail_lines", "brownfields", "ixps", "parcels",
];

const PAGE = 1000;

// org slug -> { nameVotes, assets{}, states:Set, variants:{ variantKey: Set } }
const orgs = new Map();
let dataLastUpdated = "";

function ensure(slug) {
  let o = orgs.get(slug);
  if (!o) {
    o = {
      slug,
      nameVotes: new Map(),
      assets: Object.fromEntries(ASSET_KEYS.map((k) => [k, 0])),
      states: new Set(),
      variants: {},
    };
    orgs.set(slug, o);
  }
  return o;
}

async function scanSource(src) {
  const selectCols = [src.col, "state", "created_at"].join(",");
  let offset = 0, scanned = 0, attributed = 0;
  console.log(`Scanning ${src.table}.${src.col} …`);
  for (;;) {
    const url =
      `${SUPABASE_URL}/rest/v1/${src.table}` +
      `?select=${selectCols}&${src.col}=not.is.null&order=id.asc`;
    const res = await fetch(url, {
      headers: { ...HEADERS, Range: `${offset}-${offset + PAGE - 1}` },
    });
    if (!res.ok) {
      console.error(`  HTTP ${res.status} at offset ${offset}: ${(await res.text()).slice(0, 200)}`);
      process.exit(1);
    }
    const rows = await res.json();
    if (!rows.length) break;
    for (const r of rows) {
      scanned++;
      if (r.created_at && r.created_at > dataLastUpdated) dataLastUpdated = r.created_at;
      const rawVals = src.array
        ? (Array.isArray(r[src.col]) ? r[src.col] : [])
        : [r[src.col]];
      const seenSlugs = new Set(); // one asset credit per row per org
      for (const raw of rawVals) {
        if (raw == null || raw === "") continue;
        const name = normalizeCompanyName(raw);
        if (!name || isJunkName(name)) continue;
        const slug = slugify(name);
        if (!slug) continue;
        const o = ensure(slug);
        o.nameVotes.set(name, (o.nameVotes.get(name) ?? 0) + 1);
        // Record the exact raw string so the profile page can live-query it.
        (o.variants[src.variant] ??= new Set()).add(String(raw));
        if (r.state) o.states.add(r.state);
        if (!seenSlugs.has(slug)) {
          o.assets[src.asset] += 1;
          seenSlugs.add(slug);
          attributed++;
        }
      }
    }
    offset += PAGE;
    if (scanned % 50000 < PAGE) console.log(`  …${scanned} rows`);
    if (rows.length < PAGE) break;
  }
  console.log(`  ${src.table}: ${scanned} rows scanned, ${attributed} asset credits.`);
}

// Cap how many raw variant strings we persist per org per column. Keeps the
// JSON lean while preserving enough for live in.() queries to find the rows.
// (An org with hundreds of distinct raw spellings in one column is rare; the
// live query also re-filters, and the org index counts are the source of truth.)
const MAX_VARIANTS_PER_COLUMN = 60;

console.log("Building organization index from owner/operator substrate…\n");
for (const src of SOURCES) {
  await scanSource(src);
}

// ── Shape output ─────────────────────────────────────────────────────────────
const organizations = {};
let totalAssets = 0;
let indexed = 0;
for (const o of orgs.values()) {
  // Canonical display name = most-voted variant (ties → shortest, then alpha).
  const name = [...o.nameVotes.entries()].sort(
    (x, y) => y[1] - x[1] || x[0].length - y[0].length || x[0].localeCompare(y[0])
  )[0][0];
  if (isJunkName(name)) continue;
  const total = ASSET_KEYS.reduce((s, k) => s + o.assets[k], 0);
  if (total < 1) continue;
  const variants = {};
  for (const [k, set] of Object.entries(o.variants)) {
    variants[k] = [...set].slice(0, MAX_VARIANTS_PER_COLUMN);
  }
  organizations[o.slug] = {
    name,
    totalAssets: total,
    assets: o.assets,
    states: [...o.states].sort(),
    variants,
  };
  totalAssets += total;
  indexed++;
}

const out = {
  generatedAt: new Date().toISOString(),
  dataLastUpdated: dataLastUpdated || null,
  totalOrganizations: indexed,
  totalAssets,
  organizations,
};

const outDir = resolve(__dirname, "../src/data");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "organizations.json");
writeFileSync(outPath, JSON.stringify(out));
console.log(`\nWrote ${outPath}`);
console.log(`  organizations: ${indexed}, total asset attributions: ${totalAssets}`);

// Quick top-10 sanity print.
const top = Object.entries(organizations)
  .sort((a, b) => b[1].totalAssets - a[1].totalAssets)
  .slice(0, 10);
console.log("\nTop 10 organizations by total assets:");
for (const [slug, o] of top) {
  const mix = ASSET_KEYS.filter((k) => o.assets[k] > 0).map((k) => `${k}:${o.assets[k]}`).join(" ");
  console.log(`  ${o.name} (${slug}) — ${o.totalAssets} — ${mix}`);
}
