import { createClient } from "@supabase/supabase-js";

// Sitemap-diff cron. Periodically snapshots the current /sitemap.xml URL
// list; on each subsequent run, any URL that DISAPPEARED from the
// sitemap is auto-registered in sb_url_redirects with a smart fallback
// target.
//
// Why this beats waiting for GSC to find the 404: the sitemap is the
// source of truth for "URLs we publish." When a player profile slug
// gets renamed, when an event closes, when a sport mid-season cleanup
// drops 100 stale game pages — the redirect appears the same day, not
// 2-3 weeks later after Google's recrawl.
//
// Schedule: every 6 hours (sitemap changes slowly).
//
// GET /api/seo/cron-sitemap-diff
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

const SITEMAP_URL = process.env.SB_SITEMAP_URL || "https://sportsbookish.com/sitemap.xml";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

// Conservative fallback rules only. The previous version included
// /sports/<league>/<year>/<slug> → /sports/<league>/<year> and
// /golf/<year>/<slug> → /golf/<year>, both of which described LIVE
// routes (event detail, tournament detail) and registered redirects
// that hijacked live pages. Removed.
const FALLBACK_RULES = [];

function fallbackTarget(path) {
  for (const { pattern, target } of FALLBACK_RULES) {
    const m = path.match(pattern);
    if (m) return target(m);
  }
  // Last resort: strip last segment
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 1) return `/${parts.slice(0, -1).join("/")}`;
  return "/";
}

async function fetchSitemapPaths() {
  const r = await fetch(SITEMAP_URL, { headers: { Accept: "application/xml" } });
  if (!r.ok) throw new Error(`sitemap ${r.status}`);
  const xml = await r.text();
  const urls = new Set();
  const rx = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    try {
      const u = new URL(m[1].trim());
      urls.add(u.pathname);
    } catch {}
  }
  return urls;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();

  let currentPaths;
  try {
    currentPaths = await fetchSitemapPaths();
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  // Pull last snapshot from the kv table (or upsert if first run)
  const { data: prior } = await supabase
    .from("sb_kv")
    .select("value")
    .eq("key", "sitemap_snapshot_paths")
    .maybeSingle();
  const priorPaths = new Set(prior?.value || []);

  // Diff
  const dropped = [];
  for (const p of priorPaths) {
    if (!currentPaths.has(p)) dropped.push(p);
  }
  const added = [];
  for (const p of currentPaths) {
    if (!priorPaths.has(p)) added.push(p);
  }

  // For every dropped path, register a redirect if one doesn't exist + the
  // fallback target IS in the current sitemap (otherwise we'd redirect to
  // another 404).
  const inserted = [];
  for (const path of dropped) {
    const target = fallbackTarget(path);
    if (!currentPaths.has(target) && target !== "/") continue;
    const { error } = await supabase
      .from("sb_url_redirects")
      .insert({
        from_path: path,
        to_path: target,
        status_code: 301,
        source: "sitemap_diff",
        notes: `auto-registered ${startedAt} after path left sitemap`,
      });
    if (!error) inserted.push({ from: path, to: target });
  }

  // Persist current snapshot for next run
  await supabase.from("sb_kv").upsert({
    key: "sitemap_snapshot_paths",
    value: Array.from(currentPaths),
    updated_at: startedAt,
  }, { onConflict: "key" });

  return res.status(200).json({
    started_at: startedAt,
    current_url_count: currentPaths.size,
    prior_url_count: priorPaths.size,
    dropped: dropped.length,
    added: added.length,
    redirects_inserted: inserted.length,
    sample_inserted: inserted.slice(0, 10),
  });
}
