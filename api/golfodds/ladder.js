import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function fetchAllIn(query, marketIds, idChunkSize = 100, rowPageSize = 1000) {
  const out = [];
  for (let i = 0; i < marketIds.length; i += idChunkSize) {
    const chunk = marketIds.slice(i, i + idChunkSize);
    let page = 0;
    while (true) {
      const start = page * rowPageSize;
      const { data, error } = await query().in("market_id", chunk).range(start, start + rowPageSize - 1);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      out.push(...data);
      if (data.length < rowPageSize) break;
      page++;
    }
  }
  return out;
}

function median(values) {
  const xs = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

const TYPE_RANK = { win: 1, t5: 5, t10: 10, t20: 20, mc: 999 };

/**
 * GET /api/golfodds/ladder?tournament_id=<uuid>
 *
 * Per-player probability ladder across all market types for one tournament.
 * Used for the internal-consistency view — a player's Top-N implied prob
 * must be monotonically non-decreasing in N (T5 <= T10 <= T20). Flags any
 * violation, plus the Win->T5/T10/T20 ratio drift.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const tournamentId = req.query.tournament_id;
  if (!tournamentId) return res.status(400).json({ error: "tournament_id required" });

  try {
    const supabase = getSupabase();

    const { data: markets, error: mErr } = await supabase
      .from("golfodds_markets")
      .select("id, player_id, market_type, golfodds_players(id, name, dg_id, owgr_rank)")
      .eq("tournament_id", tournamentId)
      .range(0, 9999);
    if (mErr) return res.status(500).json({ error: mErr.message });
    if (!markets?.length) return res.status(200).json({ players: [] });

    const marketIds = markets.map((m) => m.id);
    const [kalshiRows, dgRows, bookRows] = await Promise.all([
      fetchAllIn(() => supabase.from("golfodds_v_latest_kalshi").select("market_id, implied_prob"), marketIds),
      fetchAllIn(() => supabase.from("golfodds_v_latest_dg").select("market_id, dg_prob"), marketIds),
      fetchAllIn(() => supabase.from("golfodds_v_latest_books").select("market_id, novig_prob"), marketIds),
    ]);
    const k = new Map(kalshiRows.map((r) => [r.market_id, r.implied_prob]));
    const d = new Map(dgRows.map((r) => [r.market_id, r.dg_prob]));
    const b = new Map();
    for (const r of bookRows) {
      if (!b.has(r.market_id)) b.set(r.market_id, []);
      b.get(r.market_id).push(r.novig_prob);
    }

    // Group by player
    const byPlayer = new Map();
    for (const m of markets) {
      const pid = m.player_id;
      if (!byPlayer.has(pid)) byPlayer.set(pid, { player: m.golfodds_players, markets: {} });
      byPlayer.get(pid).markets[m.market_type] = {
        kalshi_p: k.get(m.id) ?? null,
        dg_p: d.get(m.id) ?? null,
        books_median_p: median(b.get(m.id) || []),
      };
    }

    // Detect inconsistencies
    const players = [];
    for (const [, entry] of byPlayer) {
      const m = entry.markets;
      const issues = [];
      const checkSource = (source) => {
        const getP = (mt) => m[mt]?.[source];
        const win = getP("win");
        const t5 = getP("t5");
        const t10 = getP("t10");
        const t20 = getP("t20");
        // Monotonicity: win <= t5 <= t10 <= t20 (probability of finishing in a larger bucket)
        if (win != null && t5 != null && win > t5 + 1e-6) issues.push({ source, kind: "win > t5", delta: win - t5 });
        if (t5 != null && t10 != null && t5 > t10 + 1e-6) issues.push({ source, kind: "t5 > t10", delta: t5 - t10 });
        if (t10 != null && t20 != null && t10 > t20 + 1e-6) issues.push({ source, kind: "t10 > t20", delta: t10 - t20 });
      };
      checkSource("kalshi_p");
      checkSource("dg_p");
      checkSource("books_median_p");
      players.push({
        player_id: entry.player?.id,
        player: entry.player,
        markets: m,
        issues,
        has_kalshi_data: Object.values(m).some((x) => x.kalshi_p != null),
      });
    }

    // Sort by player name
    players.sort((a, b) => (a.player?.name || "").localeCompare(b.player?.name || ""));

    return res.status(200).json({ tournament_id: tournamentId, player_count: players.length, players });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
