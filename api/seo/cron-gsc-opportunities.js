// GSC opportunity engine — the self-feedback loop for the census fleet.
// 2x weekly: per domain, compare last-14d vs prior-14d Search Console data:
//   RISERS   — pages with meaningful click/impression growth
//   OPPS     — queries sitting in position 8–30 with rising impressions
//              (the page-1/2 boundary where small gains pay most)
//   CATEGORY — aggregate momentum by URL section (/state/, /rankings/, entity…)
// Actions: snapshot -> mc_seo_opportunities (dash + trending endpoint read it),
// IndexNow-ping riser pages (recrawl signal). No emails — this is fuel, not fire.
import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 300 };

const INDEXNOW_KEYS = {
  "gridcensus.com": "08991895ceb042ab8aacdc14bedff651cee608bf9c714b95967b284e815abe5d",
  "towercensus.com": "30c8b772747f5fe5e262baebd857555c5df2c7f4f3bdbbdf4927c915da3051df",
  "aquacensus.com": "d173d33f0a9e26ca6c3a42d106c4f85724cac03d0857f9e4916b88d61583d9b9",
  "buildingcensus.com": "ce619448a80d1bfef7e6c8579c69397a6f52f67840370a9fecbb9680befe621a",
  "carriercensus.com": "9d2fd3a134ceb65056248de802d0a5b6e299cd6de6980f33a3eb9f0c2f0879b5",
  "panelcensus.com": "1b7d5b1fb0c922a568b2de95a6a6fd301bebba7f8ec8f3f66193d6e5fcb50a59",
  "wellcensus.com": "11d5aca93edbb6fcccf723e8aef80bdf1c034debe155e65196b03e5bd19aea77",
};
const DOMAINS = Object.keys(INDEXNOW_KEYS);

async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GSC_CLIENT_ID.trim(),
      client_secret: process.env.GSC_CLIENT_SECRET.trim(),
      refresh_token: process.env.GSC_FLEET_REFRESH_TOKEN.trim(),
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`oauth ${r.status}`);
  return (await r.json()).access_token;
}

function iso(d) { return d.toISOString().slice(0, 10); }

async function sa(at, domain, startDate, endDate, dimension) {
  const site = encodeURIComponent(`sc-domain:${domain}`);
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate, endDate, dimensions: [dimension], rowLimit: 5000 }),
  });
  if (!r.ok) return [];
  return (await r.json()).rows || [];
}

function categorize(url) {
  try {
    const p = new URL(url).pathname;
    const seg = p.split("/").filter(Boolean);
    if (!seg.length) return "home";
    if (["state", "county", "city", "rankings", "operators", "owners", "carriers",
         "installers", "systems", "search"].includes(seg[0])) return `/${seg[0]}/`;
    return "entity";
  } catch { return "other"; }
}

async function analyzeDomain(at, domain) {
  const now = new Date();
  const end = new Date(now - 3 * 86400e3);         // GSC data lags ~2-3 days
  const midEnd = new Date(end - 14 * 86400e3);
  const start = new Date(end - 28 * 86400e3);
  const [pagesCur, pagesPrev, queriesCur, queriesPrev] = await Promise.all([
    sa(at, domain, iso(new Date(midEnd.getTime() + 86400e3)), iso(end), "page"),
    sa(at, domain, iso(start), iso(midEnd), "page"),
    sa(at, domain, iso(new Date(midEnd.getTime() + 86400e3)), iso(end), "query"),
    sa(at, domain, iso(start), iso(midEnd), "query"),
  ]);
  const prevByPage = new Map(pagesPrev.map((r) => [r.keys[0], r]));
  const risers = pagesCur
    .map((r) => {
      const prev = prevByPage.get(r.keys[0]) || { clicks: 0, impressions: 0 };
      return {
        page: r.keys[0],
        category: categorize(r.keys[0]),
        clicks: r.clicks, clicksPrev: prev.clicks,
        impressions: r.impressions, imprPrev: prev.impressions,
        position: Math.round(r.position * 10) / 10,
        growth: (r.impressions + 3 * r.clicks) - (prev.impressions + 3 * prev.clicks),
      };
    })
    .filter((r) => r.growth > 0 && r.impressions >= 5)
    .sort((a, b) => b.growth - a.growth)
    .slice(0, 25);

  const prevByQ = new Map(queriesPrev.map((r) => [r.keys[0], r]));
  const opps = queriesCur
    .filter((r) => r.position >= 8 && r.position <= 30 && r.impressions >= 10)
    .map((r) => {
      const prev = prevByQ.get(r.keys[0]) || { impressions: 0 };
      return {
        query: r.keys[0], impressions: r.impressions, imprPrev: prev.impressions,
        clicks: r.clicks, position: Math.round(r.position * 10) / 10,
        rising: r.impressions > prev.impressions,
      };
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25);

  // category momentum
  const cats = {};
  for (const r of risers) {
    cats[r.category] ??= { growth: 0, pages: 0 };
    cats[r.category].growth += r.growth;
    cats[r.category].pages += 1;
  }

  // IndexNow-ping top risers (freshness/recrawl nudge)
  let pinged = 0;
  const key = INDEXNOW_KEYS[domain];
  const urls = risers.slice(0, 20).map((r) => r.page).filter((u) => u.includes(domain));
  if (key && urls.length) {
    const r = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: domain, key, keyLocation: `https://${domain}/${key}.txt`, urlList: urls }),
    }).catch(() => null);
    pinged = r && r.ok ? urls.length : 0;
  }
  return { domain, risers, opportunities: opps, categories: cats, pinged };
}

export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret || (req.headers.authorization || "") !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const at = await accessToken();
    const results = [];
    for (const d of DOMAINS) results.push(await analyzeDomain(at, d));
    const mc = createClient(process.env.MC_SUPABASE_URL.trim(), process.env.MC_SUPABASE_SERVICE_KEY.trim());
    await mc.from("mc_seo_opportunities").insert(results.map((r) => ({
      domain: r.domain, risers: r.risers, opportunities: r.opportunities,
      categories: r.categories, pinged: r.pinged,
    })));
    return res.status(200).json({
      analyzed: results.length,
      pinged: results.reduce((s, r) => s + r.pinged, 0),
      top: Object.fromEntries(results.map((r) => [r.domain, r.risers[0]?.page || null])),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
