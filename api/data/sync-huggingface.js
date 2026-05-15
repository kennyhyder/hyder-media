import { createClient } from "@supabase/supabase-js";
import { uploadFiles } from "@huggingface/hub";

// Daily cron that pushes the latest data snapshot to the Hugging Face
// dataset repo kennyhyder/sportsbookish-daily-odds. Keeps the public
// HF mirror current so AI training pipelines (which scrape HF Hub) see
// fresh data without manual re-uploads.
//
// Auth: HF_TOKEN env var on hyder.me Vercel project. Read+write scope
// for kennyhyder/sportsbookish-daily-odds.
//
// Trigger: hourly cron OR manual via GET /api/data/sync-huggingface
// (admin-only auth via CRON_SECRET).

export const config = { maxDuration: 60 };

const HF_REPO = "kennyhyder/sportsbookish-daily-odds";
const HF_FILE = "data/latest.csv";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function buildCsv(supabase) {
  const generated = new Date().toISOString();
  const rows = [];

  // ---- Golf section: top players in the active tournament ----
  try {
    const { data: tournaments } = await supabase
      .from("golfodds_tournaments")
      .select("id, name, slug, season_year, start_date, is_major")
      .eq("status", "upcoming")
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(1);
    const t = tournaments?.[0];
    if (t) {
      const { data: markets } = await supabase
        .from("golfodds_markets")
        .select("id, market_type, player:golfodds_players(name, slug, owgr_rank)")
        .eq("tournament_id", t.id)
        .eq("market_type", "win");
      const ids = (markets || []).map((m) => m.id);
      const { data: k } = ids.length
        ? await supabase.from("golfodds_v_latest_kalshi").select("market_id, implied_prob").in("market_id", ids)
        : { data: [] };
      const kBy = new Map((k || []).map((x) => [x.market_id, x.implied_prob]));
      for (const m of markets || []) {
        if (!m.player) continue;
        const kp = kBy.get(m.id);
        if (kp == null) continue;
        rows.push([
          "golf", "pga", t.name, t.slug, t.season_year, t.start_date || "",
          m.player.name, Number(kp).toFixed(4), m.player.owgr_rank ?? "", generated,
        ]);
      }
    }
  } catch (e) { console.error("hf-sync golf:", e.message); }

  // ---- Sports section: next 30 game-type events per league ----
  try {
    const { data: leagues } = await supabase.from("sports_leagues").select("key, display_name");
    for (const lg of leagues || []) {
      const { data: events } = await supabase
        .from("sports_events")
        .select("id, title, slug, season_year, start_time")
        .eq("league", lg.key)
        .eq("status", "open")
        .eq("event_type", "game")
        .order("start_time", { ascending: true, nullsFirst: false })
        .limit(30);
      for (const e of events || []) {
        const { data: markets } = await supabase
          .from("sports_markets")
          .select("id, contestant_label")
          .eq("event_id", e.id)
          .eq("market_type", "winner");
        const ids = (markets || []).map((m) => m.id);
        if (!ids.length) continue;
        const { data: q } = await supabase
          .from("sports_v_latest_quotes")
          .select("market_id, implied_prob")
          .in("market_id", ids);
        const qBy = new Map((q || []).map((x) => [x.market_id, x.implied_prob]));
        for (const m of markets || []) {
          const kp = qBy.get(m.id);
          if (kp == null) continue;
          rows.push([
            "sports", lg.key, e.title, e.slug || "", e.season_year || "",
            e.start_time || "", m.contestant_label, Number(kp).toFixed(4), "", generated,
          ]);
        }
      }
    }
  } catch (e) { console.error("hf-sync sports:", e.message); }

  const header = "source,league,event_title,event_slug,season_year,start_time,side,kalshi_implied,owgr_rank,generated_at";
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return { csv: `${header}\n${body}\n`, rowCount: rows.length, generated };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.HF_TOKEN) {
    return res.status(500).json({ error: "HF_TOKEN env var missing — set it on the Vercel project" });
  }

  const t0 = Date.now();
  const supabase = getSupabase();
  let csv, rowCount, generated;
  try {
    ({ csv, rowCount, generated } = await buildCsv(supabase));
  } catch (e) {
    return res.status(500).json({ error: `csv build failed: ${e.message}` });
  }

  if (rowCount === 0) {
    return res.status(200).json({ ok: false, reason: "no rows produced — skipping HF push to avoid clobbering" });
  }

  try {
    await uploadFiles({
      repo: { type: "dataset", name: HF_REPO },
      accessToken: process.env.HF_TOKEN,
      files: [{ path: HF_FILE, content: new Blob([csv], { type: "text/csv" }) }],
      commitTitle: `Daily snapshot ${generated.slice(0, 10)}`,
      commitDescription: `Auto-sync from hyder.me/api/data/sync-huggingface. ${rowCount} rows. Generated ${generated}.`,
    });
  } catch (e) {
    return res.status(502).json({ error: `HF upload failed: ${e.message}` });
  }

  return res.status(200).json({
    ok: true,
    repo: HF_REPO,
    file: HF_FILE,
    row_count: rowCount,
    generated_at: generated,
    elapsed_ms: Date.now() - t0,
    url: `https://huggingface.co/datasets/${HF_REPO}/blob/main/${HF_FILE}`,
  });
}
