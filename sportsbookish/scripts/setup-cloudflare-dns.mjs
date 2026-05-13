#!/usr/bin/env node
/**
 * One-shot Cloudflare DNS setup for sportsbookish.com.
 *
 * Pre-req: in CF dashboard, add `sportsbookish.com` as a Site (free plan is fine).
 * Then create an API token with `Zone:DNS:Edit` for the sportsbookish.com zone.
 *
 * Usage:
 *   CF_API_TOKEN=xxx node scripts/setup-cloudflare-dns.mjs
 *
 * Creates:
 *   A   @                76.76.21.21       (Vercel)
 *   CNAME staging        cname.vercel-dns.com
 *   CNAME www            sportsbookish.com  (proxied)
 *
 * Idempotent — finds existing records by name+type and updates them.
 */

const TOKEN = process.env.CF_API_TOKEN;
const ZONE_NAME = process.env.CF_ZONE_NAME || "sportsbookish.com";

if (!TOKEN) {
  console.error("CF_API_TOKEN required. Create one at https://dash.cloudflare.com/profile/api-tokens with Zone:DNS:Edit permission for this zone.");
  process.exit(1);
}

const API = "https://api.cloudflare.com/client/v4";
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function cf(path, opts = {}) {
  const r = await fetch(`${API}${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const data = await r.json();
  if (!data.success) throw new Error(`Cloudflare ${r.status}: ${JSON.stringify(data.errors)}`);
  return data;
}

const RECORDS = [
  { type: "A",     name: "@",       content: "76.76.21.21",            proxied: true,  ttl: 1, comment: "Vercel apex" },
  { type: "CNAME", name: "www",     content: ZONE_NAME,                proxied: true,  ttl: 1, comment: "www → apex" },
  { type: "CNAME", name: "staging", content: "cname.vercel-dns.com",   proxied: false, ttl: 1, comment: "Staging → Vercel preview" },
];

async function main() {
  console.log(`Looking up zone ${ZONE_NAME}…`);
  const zones = await cf(`/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  if (!zones.result.length) {
    console.error(`Zone ${ZONE_NAME} not found in Cloudflare. Add it via dashboard first: https://dash.cloudflare.com/?to=/:account/add-site`);
    process.exit(1);
  }
  const zone = zones.result[0];
  console.log(`  Zone: ${zone.id} (status: ${zone.status})`);
  if (zone.status !== "active") {
    console.log(`  ⚠️  Zone status is ${zone.status}. Set the nameservers below at your registrar.`);
    console.log(`  Nameservers: ${zone.name_servers.join(", ")}`);
  }

  const existing = await cf(`/zones/${zone.id}/dns_records?per_page=200`);

  for (const desired of RECORDS) {
    const fullName = desired.name === "@" ? ZONE_NAME : `${desired.name}.${ZONE_NAME}`;
    const found = existing.result.find((r) => r.type === desired.type && r.name === fullName);
    if (found) {
      console.log(`  Updating ${desired.type} ${fullName} → ${desired.content}`);
      await cf(`/zones/${zone.id}/dns_records/${found.id}`, { method: "PUT", body: JSON.stringify(desired) });
    } else {
      console.log(`  Creating ${desired.type} ${fullName} → ${desired.content}`);
      await cf(`/zones/${zone.id}/dns_records`, { method: "POST", body: JSON.stringify(desired) });
    }
  }

  console.log("\n✅ DNS records configured.");
  console.log(`\nNext steps if zone is still pending:`);
  console.log(`  1. At your registrar (GoDaddy), set the nameservers to:`);
  for (const ns of zone.name_servers) console.log(`     - ${ns}`);
  console.log(`  2. Wait 5-30 min for propagation.`);
  console.log(`  3. In Vercel project sportsbookish settings, add sportsbookish.com as a domain.`);
  console.log(`  4. Vercel will auto-issue an SSL cert via Cloudflare's proxy.`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
