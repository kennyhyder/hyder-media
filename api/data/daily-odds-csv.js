import { createClient } from "@supabase/supabase-js";

// CSV variant of /api/data/daily-odds. Same data, flat tabular shape that
// loads cleanly into Hugging Face Datasets, pandas, Excel, etc.
//
// GET /api/data/daily-odds-csv
//   → text/csv with columns:
//     source,league,event_title,event_slug,season_year,start_time,
//     side,kalshi_implied,owgr_rank,generated_at
//
// One row per (event, side). Public, 1h edge cache, CORS-enabled,
// CC-BY-4.0 licensed.

export const config = { maxDuration: 30 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(row) {
  return row.map(csvEscape).join(",");
}

export default async function handler(req, res) {
  const supabase = getSupabase();
  const generated = new Date().toISOString();

  const rows = [];

  // ---- Golf section ----
  try {
    const { data: tournaments } = await supabase
      .from("golfodds_tournaments")
      .select("id, name, slug, season_year, start_date, status, is_major")
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
      const { data: k } = await supabase
        .from("golfodds_kalshi_latest")
        .select("market_id, implied_prob")
        .in("market_id", ids);
      const kBy = new Map((k || []).map((x) => [x.market_id, x.implied_prob]));
      for (const m of markets || []) {
        if (!m.player) continue;
        const kp = kBy.get(m.id);
        if (kp == null) continue;
        rows.push([
          "golf",                          // source
          "pga",                            // league
          t.name,                           // event_title
          t.slug,                           // event_slug
          t.season_year,                    // season_year
          t.start_date || "",               // start_time
          m.player.name,                    // side (player)
          Number(kp).toFixed(4),            // kalshi_implied
          m.player.owgr_rank ?? "",         // owgr_rank
          generated,                        // generated_at
        ]);
      }
    }
  } catch {}

  // ---- Sports section ----
  try {
    const { data: leagues } = await supabase.from("sports_leagues").select("key");
    for (const lg of leagues || []) {
      const { data: events } = await supabase
        .from("sports_events")
        .select("id, title, slug, season_year, start_time")
        .eq("league", lg.key)
        .eq("status", "open")
        .eq("event_type", "game")
        .order("start_time", { ascending: true, nullsFirst: false })
        .limit(20);
      for (const e of events || []) {
        const { data: markets } = await supabase
          .from("sports_markets")
          .select("id, contestant_label")
          .eq("event_id", e.id)
          .eq("market_type", "winner");
        const ids = (markets || []).map((m) => m.id);
        if (!ids.length) continue;
        const { data: q } = await supabase
          .from("sports_quotes_latest")
          .select("market_id, implied_prob")
          .in("market_id", ids);
        const qBy = new Map((q || []).map((x) => [x.market_id, x.implied_prob]));
        for (const m of markets || []) {
          const kp = qBy.get(m.id);
          if (kp == null) continue;
          rows.push([
            "sports",                       // source
            lg.key,                          // league
            e.title,                         // event_title
            e.slug || "",                    // event_slug
            e.season_year,                   // season_year
            e.start_time || "",              // start_time
            m.contestant_label,              // side
            Number(kp).toFixed(4),           // kalshi_implied
            "",                              // owgr_rank (n/a)
            generated,                       // generated_at
          ]);
        }
      }
    }
  } catch {}

  const header = "source,league,event_title,event_slug,season_year,start_time,side,kalshi_implied,owgr_rank,generated_at";
  const body = rows.map(rowToCsv).join("\n");
  const csv = `${header}\n${body}\n`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Disposition", `attachment; filename="sportsbookish-daily-odds-${generated.slice(0, 10)}.csv"`);
  return res.status(200).send(csv);
}
