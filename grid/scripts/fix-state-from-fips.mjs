#!/usr/bin/env node
/**
 * fix-state-from-fips.mjs — correct grid_dc_sites.state from the authoritative
 * FIPS prefix. ~15k rows have a state that contradicts their county FIPS
 * (Indiana counties labeled MI, California labeled NV, etc.) because different
 * ingest sources disagreed. The 5-digit county FIPS prefix is canonical, so
 * for every row WITH a fips_code we force state = FIPS-derived code.
 *
 * Rows with NULL fips_code (~49%) are left untouched — the state column is the
 * only signal there.
 *
 * Idempotent (only patches rows where state already disagrees). Re-run after
 * any re-ingest, and fix the upstream ingest state-assignment too so it stops
 * reintroducing the drift.
 *
 * Usage: node scripts/fix-state-from-fips.mjs [--dry]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

function env() {
  let { SUPABASE_URL: u, SUPABASE_SERVICE_KEY: k } = process.env;
  for (const p of [resolve(__dirname, "../.env.local"), resolve(__dirname, "../../.env.local")]) {
    if (u && k) break;
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^(SUPABASE_URL|SUPABASE_SERVICE_KEY)=(.*)$/);
        if (m) { const v = m[2].trim().replace(/^["']|["']$/g, "");
          if (m[1] === "SUPABASE_URL" && !u) u = v;
          if (m[1] === "SUPABASE_SERVICE_KEY" && !k) k = v; }
      }
    } catch {}
  }
  if (!u || !k) { console.error("missing supabase env"); process.exit(1); }
  return { u, k };
}
const { u: URL, k: KEY } = env();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const DRY = process.argv.includes("--dry");

const FIPS2ST = { "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY" };

async function countMismatch(pref, code) {
  const url = `${URL}/rest/v1/grid_dc_sites?select=id&fips_code=like.${pref}*&state=neq.${code}`;
  const r = await fetch(url, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
  const cr = r.headers.get("content-range") || "*/0";
  return parseInt(cr.split("/")[1] || "0", 10);
}
async function patch(pref, code) {
  const url = `${URL}/rest/v1/grid_dc_sites?fips_code=like.${pref}*&state=neq.${code}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json", Prefer: "count=exact,return=minimal", Range: "0-0" },
    body: JSON.stringify({ state: code }),
  });
  if (!r.ok) throw new Error(`PATCH ${pref}→${code} HTTP ${r.status}: ${await r.text()}`);
  const cr = r.headers.get("content-range") || "*/?";
  return cr.split("/")[1];
}

let totalBefore = 0, totalPatched = 0;
for (const [pref, code] of Object.entries(FIPS2ST)) {
  const n = await countMismatch(pref, code);
  if (!n) continue;
  totalBefore += n;
  if (DRY) { console.log(`  ${pref}→${code}: ${n} mismatched (dry)`); continue; }
  const updated = await patch(pref, code);
  totalPatched += n;
  console.log(`  ${pref}→${code}: corrected ${n} rows (server count=${updated})`);
}
console.log(DRY
  ? `\nDRY: ${totalBefore} rows would be corrected across mismatched prefixes.`
  : `\nDone. Corrected ~${totalPatched} rows (was ${totalBefore} mismatched).`);

// verify
let remain = 0;
for (const [pref, code] of Object.entries(FIPS2ST)) remain += await countMismatch(pref, code);
console.log(`Remaining mismatches after run: ${remain}`);
