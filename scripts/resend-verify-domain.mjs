#!/usr/bin/env node
/**
 * resend-verify-domain.mjs <domain> — one-command Resend domain setup.
 * Adds (or finds) the domain in Resend, writes its SPF/DKIM/MX/DMARC DNS
 * records into Cloudflare (the domain's zone), and triggers verification.
 * Reusable for every new site rollout so users NEVER get default-sender emails.
 *
 * Env (root .env.local): RESEND_API_KEY, CF_API_TOKEN.
 * Usage: node scripts/resend-verify-domain.mjs gridcensus.com
 */
import { readFileSync } from "node:fs";

const ROOT = "/Users/kennyhyder/Desktop/hyder-media";
// CF_API_TOKEN lives in automatedojo/.env.local; RESEND_API_KEY may be in either.
// Scan all known env files, first hit wins.
const ENV_FILES = [
  `${ROOT}/.env.local`,
  `${ROOT}/automatedojo/.env.local`,
  `${ROOT}/grid/.env.local`,
];
function env(key) {
  if (process.env[key]) return process.env[key].trim(); // inline env wins — lets secrets stay off disk
  for (const file of ENV_FILES) {
    let txt;
    try { txt = readFileSync(file, "utf8"); } catch { continue; }
    for (const line of txt.split("\n")) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
}
const RESEND = env("RESEND_API_KEY");
const CF = env("CF_API_TOKEN");
const domain = process.argv[2];
if (!domain) { console.error("usage: resend-verify-domain.mjs <domain>"); process.exit(1); }

const rHead = { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" };
const cHead = { Authorization: `Bearer ${CF}`, "Content-Type": "application/json" };

async function jget(url, h) { return (await fetch(url, { headers: h })).json(); }
async function jpost(url, h, body) { return (await fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) })).json(); }

// 0. sanity: a restricted (send-only) key can't manage domains — fail loud + clear
const probe = await jget("https://api.resend.com/domains", rHead);
if (probe?.name === "restricted_api_key" || probe?.message?.includes("restricted")) {
  console.error("✗ RESEND_API_KEY is restricted (send-only). Domain management needs a Full-access key.");
  console.error("  Create one at resend.com/api-keys (Permission: Full access), put it in .env.local, re-run.");
  process.exit(1);
}

// 1. find or create the Resend domain
let dom = probe.data?.find((d) => d.name === domain);
if (!dom) {
  console.log(`Adding ${domain} to Resend (region us-east-1)…`);
  dom = await jpost("https://api.resend.com/domains", rHead, { name: domain, region: "us-east-1" });
}
const id = dom.id;
const detail = await jget(`https://api.resend.com/domains/${id}`, rHead);
const records = detail.records || dom.records || [];
console.log(`Resend domain ${domain} (${id}) status=${detail.status}; ${records.length} DNS records`);

// 2. cloudflare zone
const zone = (await jget(`https://api.cloudflare.com/client/v4/zones?name=${domain}`, cHead)).result?.[0];
if (!zone) { console.error(`No Cloudflare zone for ${domain}`); process.exit(1); }

// 3. upsert each record into Cloudflare (Resend wants DNS-only/unproxied)
const existing = (await jget(`https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?per_page=200`, cHead)).result || [];
for (const r of records) {
  const type = r.type;
  const name = r.name; // full host
  const content = r.value;
  const dup = existing.find((e) => e.type === type && e.name === name && (e.content === content || type === "MX"));
  if (dup) { console.log(`  = ${type} ${name} already present`); continue; }
  const body = { type, name, content, ttl: 300, proxied: false };
  if (type === "MX") body.priority = r.priority ?? 10;
  const res = await jpost(`https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records`, cHead, body);
  console.log(`  ${res.success ? "+" : "✗"} ${type} ${name} ${res.success ? "" : JSON.stringify(res.errors)}`);
}

// 4. trigger verification
const v = await jpost(`https://api.resend.com/domains/${id}/verify`, rHead, {});
console.log(`Verification triggered. Re-check status: GET resend.com/domains/${id} (DNS can take a few min).`);
console.log(`Domain id for Supabase/other config: ${id}`);
