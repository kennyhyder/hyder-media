// Public read API: latest SEO opportunities per census domain, from the
// engine's snapshots. CORS * so the fleet apps and the admin dash can embed
// "trending" modules client-side without rebuilds. Cached at the edge 1h.
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  const domain = String(req.query.domain || "").toLowerCase();
  try {
    const mc = createClient(process.env.MC_SUPABASE_URL.trim(), process.env.MC_SUPABASE_SERVICE_KEY.trim());
    let q = mc.from("mc_seo_opportunities")
      .select("domain, created_at, risers, opportunities, categories, pinged, suggested_pages")
      .order("created_at", { ascending: false });
    if (domain) q = q.eq("domain", domain).limit(1);
    else q = q.limit(8);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    // latest row per domain when unfiltered
    const seen = new Set();
    const rows = (data || []).filter((r) => !seen.has(r.domain) && seen.add(r.domain));
    return res.status(200).json(domain ? rows[0] || null : rows);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
