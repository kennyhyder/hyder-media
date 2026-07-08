#!/usr/bin/env node
/**
 * build-rollups.mjs — precompute aggregate rollups for the pSEO pages.
 *
 * Supabase has PostgREST aggregate functions disabled, so we paginate the full
 * grid_dc_sites table once (REST, service key) and roll up in JS. Output is a
 * single committed JSON file the server components read at build/ISR time — no
 * runtime DB hit for headline stats. Re-run after every data refresh
 * (wire into scripts/update-all.py as the final pSEO step).
 *
 * Usage:  node scripts/build-rollups.mjs
 * Env:    SUPABASE_URL + SUPABASE_SERVICE_KEY (falls back to ../.env.local)
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
  return { SUPABASE_URL, SUPABASE_SERVICE_KEY };
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = loadEnv();
const HEADERS = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

// FIPS prefix is the authoritative state. ~15k rows have a state column that
// contradicts their county FIPS (cross-source drift); derive state from FIPS
// whenever a fips_code is present so rollups are correct even before the
// source column is patched. Null-fips rows fall back to the stored state.
const FIPS2ST = { "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY" };
const stateOf = (r) => (r.fips_code && FIPS2ST[String(r.fips_code).slice(0, 2)]) || r.state;

const PAGE = 1000;
const COLS = [
  "state", "county", "fips_code", "site_type", "iso_region",
  "dc_score", "available_capacity_mw", "avg_queue_wait_years", "queue_depth",
  "substation_voltage_kv", "score_power", "score_speed_to_power", "score_fiber",
  "score_water", "score_hazard", "updated_at",
].join(",");

// --- accumulator helpers -------------------------------------------------
const newAgg = () => ({
  count: 0, scoreSum: 0, scoreN: 0, capSum: 0, capN: 0,
  waitSum: 0, waitN: 0, depthSum: 0, depthN: 0,
  byType: {}, byIso: {}, byState: {},
  sub: { power: [0, 0], speed: [0, 0], fiber: [0, 0], water: [0, 0], hazard: [0, 0] },
});
function add(a, r) {
  a.count++;
  if (r.dc_score != null) { a.scoreSum += r.dc_score; a.scoreN++; }
  if (r.available_capacity_mw != null) { a.capSum += +r.available_capacity_mw; a.capN++; }
  if (r.avg_queue_wait_years != null) { a.waitSum += r.avg_queue_wait_years; a.waitN++; }
  if (r.queue_depth != null) { a.depthSum += r.queue_depth; a.depthN++; }
  if (r.site_type) a.byType[r.site_type] = (a.byType[r.site_type] || 0) + 1;
  if (r.iso_region) a.byIso[r.iso_region] = (a.byIso[r.iso_region] || 0) + 1;
  if (r.state) a.byState[r.state] = (a.byState[r.state] || 0) + 1;
  const s = a.sub;
  for (const [k, col] of [["power","score_power"],["speed","score_speed_to_power"],["fiber","score_fiber"],["water","score_water"],["hazard","score_hazard"]]) {
    if (r[col] != null) { s[k][0] += r[col]; s[k][1]++; }
  }
}
const r1 = (x) => Math.round(x * 10) / 10;
function finalize(a) {
  const sub = {};
  for (const k of Object.keys(a.sub)) sub[k] = a.sub[k][1] ? r1(a.sub[k][0] / a.sub[k][1]) : null;
  return {
    count: a.count,
    avgScore: a.scoreN ? r1(a.scoreSum / a.scoreN) : null,
    totalCapacityMw: a.capN ? Math.round(a.capSum) : 0,
    avgQueueWaitYears: a.waitN ? r1(a.waitSum / a.waitN) : null,
    avgQueueDepth: a.depthN ? Math.round(a.depthSum / a.depthN) : null,
    byType: a.byType, byIso: a.byIso, byState: a.byState,
    avgSubScores: sub,
  };
}

// --- scan ----------------------------------------------------------------
const national = newAgg();
const states = {};   // ST -> agg
const iso = {};      // REGION -> agg
const types = {};    // type -> agg
const counties = {}; // fips -> { state, countyName, agg }
const voltage = {};  // tier -> count
let maxUpdated = "";

function voltTier(kv) {
  if (kv == null) return "none";
  if (kv >= 765) return "765kv-plus";
  if (kv >= 500) return "500kv";
  if (kv >= 345) return "345kv";
  if (kv >= 230) return "230kv";
  if (kv >= 138) return "138kv";
  if (kv >= 115) return "115kv";
  if (kv >= 69) return "69-115kv";
  return "sub-69kv";
}

console.log("Scanning grid_dc_sites…");
let offset = 0, total = 0;
for (;;) {
  const url = `${SUPABASE_URL}/rest/v1/grid_dc_sites?select=${COLS}&order=id.asc&limit=${PAGE}&offset=${offset}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) { console.error(`HTTP ${res.status} at offset ${offset}: ${await res.text()}`); process.exit(1); }
  const rows = await res.json();
  if (!rows.length) break;
  for (const r of rows) {
    r.state = stateOf(r); // canonicalize state from FIPS before any aggregation
    add(national, r);
    (states[r.state] ??= newAgg()) && add(states[r.state], r);
    if (r.iso_region) add((iso[r.iso_region] ??= newAgg()), r);
    if (r.site_type) add((types[r.site_type] ??= newAgg()), r);
    if (r.fips_code) {
      const c = (counties[r.fips_code] ??= { state: r.state, countyName: r.county, agg: newAgg() });
      add(c.agg, r);
    }
    voltage[voltTier(r.substation_voltage_kv)] = (voltage[voltTier(r.substation_voltage_kv)] || 0) + 1;
    if (r.updated_at && r.updated_at > maxUpdated) maxUpdated = r.updated_at;
  }
  total += rows.length;
  offset += PAGE;
  if (total % 20000 === 0) console.log(`  …${total} rows`);
  if (rows.length < PAGE) break;
}
console.log(`Scanned ${total} sites. Last updated_at: ${maxUpdated}`);

// --- shape output --------------------------------------------------------
const out = {
  generatedAt: new Date().toISOString(),
  dataLastUpdated: maxUpdated || null,
  totalSites: total,
  national: finalize(national),
  states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, finalize(v)])),
  iso: Object.fromEntries(Object.entries(iso).map(([k, v]) => [k, finalize(v)])),
  siteTypes: Object.fromEntries(Object.entries(types).map(([k, v]) => [k, finalize(v)])),
  voltageTiers: voltage,
  counties: Object.fromEntries(
    Object.entries(counties).map(([fips, c]) => [fips, {
      state: c.state, countyName: c.countyName,
      count: c.agg.count,
      avgScore: c.agg.scoreN ? r1(c.agg.scoreSum / c.agg.scoreN) : null,
      totalCapacityMw: c.agg.capN ? Math.round(c.agg.capSum) : 0,
      byType: c.agg.byType,
    }]),
  ),
};

const outDir = resolve(__dirname, "../src/data");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "rollups.json");
writeFileSync(outPath, JSON.stringify(out, null, 0));
console.log(`Wrote ${outPath}`);
console.log(`  states: ${Object.keys(out.states).length}, iso: ${Object.keys(out.iso).length}, types: ${Object.keys(out.siteTypes).length}, counties: ${Object.keys(out.counties).length}`);
