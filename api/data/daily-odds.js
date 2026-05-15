import { createClient } from "@supabase/supabase-js";

// Public daily-odds export. Designed for researchers, journalists, and AI
// crawlers that want a stable JSON snapshot of the current edge landscape.
//
// GET /api/data/daily-odds
//   → {
//       generated_at, source: "sportsbookish.com",
//       license: "CC-BY-4.0 — attribution required",
//       golf: { tournament, players: [...] } | null,
//       sports: { [league]: [...] }
//     }
//
// Anonymized: no user data, no internal IDs. Stable schema versioned via
// schema_version field. Rate limited via Vercel edge caching (1h TTL).

export const config = { maxDuration: 30 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function num(v) { return v == null ? null : Number(v); }

export default async function handler(req, res) {
  const supabase = getSupabase();
  const t0 = Date.now();

  // Golf: most-recent tournament + top-30 players by Kalshi implied
  let golf = null;
  try {
    const { data: tournaments } = await supabase
      .from("golfodds_tournaments")
      .select("name, slug, season_year, start_date, status, is_major")
      .eq("status", "upcoming")
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(1);
    const t = tournaments?.[0];
    if (t) {
      const { data: tourn } = await supabase
        .from("golfodds_tournaments")
        .select("id")
        .eq("slug", t.slug)
        .eq("season_year", t.season_year)
        .maybeSingle();
      if (tourn?.id) {
        const { data: markets } = await supabase
          .from("golfodds_markets")
          .select("id, market_type, player:golfodds_players(name, slug, owgr_rank)")
          .eq("tournament_id", tourn.id)
          .eq("market_type", "win");
        const ids = (markets || []).map((m) => m.id);
        const { data: k } = await supabase
          .from("golfodds_v_latest_kalshi")
          .select("market_id, implied_prob")
          .in("market_id", ids);
        const kBy = new Map((k || []).map((x) => [x.market_id, x.implied_prob]));

        const players = (markets || [])
          .filter((m) => m.player && kBy.get(m.id) != null)
          .map((m) => ({
            name: m.player.name,
            slug: m.player.slug,
            owgr_rank: m.player.owgr_rank,
            kalshi_implied: num(kBy.get(m.id)),
          }))
          .sort((a, b) => (b.kalshi_implied || 0) - (a.kalshi_implied || 0))
          .slice(0, 30);

        golf = { tournament: t, players };
      }
    }
  } catch (e) { golf = { error: e.message }; }

  // Sports: per-league, current open game events with top-edge contestants
  const sports = {};
  try {
    const { data: leagues } = await supabase
      .from("sports_leagues")
      .select("key, display_name");
    for (const lg of leagues || []) {
      const { data: events } = await supabase
        .from("sports_events")
        .select("id, title, slug, season_year, start_time, event_type")
        .eq("league", lg.key)
        .eq("status", "open")
        .eq("event_type", "game")
        .order("start_time", { ascending: true, nullsFirst: false })
        .limit(20);

      const rows = [];
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
          rows.push({
            event_title: e.title,
            event_slug: e.slug,
            season_year: e.season_year,
            start_time: e.start_time,
            side: m.contestant_label,
            kalshi_implied: num(kp),
          });
        }
      }
      sports[lg.key] = { display_name: lg.display_name, events: rows };
    }
  } catch (e) { sports._error = e.message; }

  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({
    schema_version: 1,
    source: "sportsbookish.com",
    license: "CC-BY-4.0 — attribution required",
    citation: 'SportsBookISH (sportsbookish.com), accessed ' + new Date().toISOString().slice(0, 10),
    generated_at: new Date().toISOString(),
    elapsed_ms: Date.now() - t0,
    golf,
    sports,
  });
}
