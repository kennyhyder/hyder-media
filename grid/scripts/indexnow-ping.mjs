#!/usr/bin/env node
/**
 * indexnow-ping.mjs — submit GridCensus URLs to IndexNow (Bing, Yandex, etc.).
 * Reads the live sitemap index, expands every shard, and POSTs the URLs in
 * 10k batches. Run AFTER a deploy (the key file must be live):
 *   node scripts/indexnow-ping.mjs            # full sitemap submit
 *   node scripts/indexnow-ping.mjs <url> ...  # submit specific URLs
 *
 * Key file: public/<KEY>.txt must be deployed at https://gridcensus.com/<KEY>.txt
 */
const HOST = "gridcensus.com";
const KEY = "08991895ceb042ab8aacdc14bedff651cee608bf9c714b95967b284e815abe5d";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const BASE = `https://${HOST}`;

async function locs(url) {
  const xml = await (await fetch(url)).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function collectAll() {
  const shards = await locs(`${BASE}/sitemap-index.xml`);
  const urls = new Set();
  for (const s of shards) {
    try {
      for (const u of await locs(s)) urls.add(u);
    } catch (e) {
      console.error("  shard failed:", s, e.message);
    }
  }
  return [...urls];
}

async function submit(batch) {
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: batch }),
  });
  return res.status;
}

const argUrls = process.argv.slice(2);
const urls = argUrls.length ? argUrls : await collectAll();
console.log(`Submitting ${urls.length} URLs to IndexNow…`);
for (let i = 0; i < urls.length; i += 10000) {
  const batch = urls.slice(i, i + 10000);
  const status = await submit(batch);
  console.log(`  batch ${i / 10000 + 1} (${batch.length} urls): HTTP ${status}`);
  if (i + 10000 < urls.length) await new Promise((r) => setTimeout(r, 2000));
}
console.log("Done. (200/202 = accepted.)");
