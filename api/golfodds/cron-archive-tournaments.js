import { createClient } from "@supabase/supabase-js";

// Archive completed golf tournaments to golfodds_tournament_archive.
// For each tournament past end_date + 24h grace, snapshots the final
// Kalshi prices, book consensus, and DataGolf model probabilities into
// final_snapshot JSONB, then marks the tournament status=closed.
//
// Cron schedule (vercel.json): hourly.
//
// GET /api/golfodds/cron-archive-tournaments
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

const ARCHIVE_DELAY_HOURS = 24; // tournaments end Sun; archive Mon afternoon

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  return req.headers.authorization === expected || req.headers.Authorization === expected;
}

async function snapshotTournament(supabase, t) {
  // 1) Markets for this tournament + player names
  const { data: markets } = await supabase
    .from("golfodds_markets")
    .select("id, market_type, player_id, golfodds_players ( id, name, dg_id )")
    .eq("tournament_id", t.id);
  if (!markets?.length) return null;

  const marketIds = markets.map((m) => m.id);
  const playerByMarket = new Map(markets.map((m) => [m.id, m.golfodds_players]));

  // 2) Latest Kalshi / DG / books per market
  const [kRes, dRes, bRes] = await Promise.all([
    supabase.from("golfodds_kalshi_latest").select("market_id, implied_prob, yes_bid, yes_ask, last_price, fetched_at").in("market_id", marketIds),
    supabase.from("golfodds_dg_latest").select("market_id, dg_prob, dg_fit_prob, fetched_at").in("market_id", marketIds),
    supabase.from("golfodds_v_latest_books").select("market_id, book, price_american, implied_prob, novig_prob").in("market_id", marketIds),
  ]);

  const kBy = new Map((kRes.data || []).map((r) => [r.market_id, r]));
  const dBy = new Map((dRes.data || []).map((r) => [r.market_id, r]));
  const bBy = new Map();
  for (const b of bRes.data || []) {
    const arr = bBy.get(b.market_id) || [];
    arr.push({ book: b.book, american: b.price_american, novig: b.novig_prob != null ? Number(b.novig_prob) : null });
    bBy.set(b.market_id, arr);
  }

  const rows = markets.map((m) => {
    const ks = kBy.get(m.id);
    const ds = dBy.get(m.id);
    const bs = bBy.get(m.id) || [];
    const novigs = bs.map((b) => b.novig).filter((v) => v != null).sort((a, b) => a - b);
    const median = novigs.length
      ? (novigs.length % 2 ? novigs[Math.floor(novigs.length / 2)] : (novigs[novigs.length / 2 - 1] + novigs[novigs.length / 2]) / 2)
      : null;
    const p = playerByMarket.get(m.id) || {};
    return {
      market_id: m.id,
      market_type: m.market_type,
      player: { id: p.id || null, name: p.name || null, dg_id: p.dg_id ?? null },
      kalshi: ks ? { implied_prob: ks.implied_prob, yes_bid: ks.yes_bid, yes_ask: ks.yes_ask, last_price: ks.last_price, fetched_at: ks.fetched_at } : null,
      datagolf: ds ? { dg_prob: ds.dg_prob, dg_fit_prob: ds.dg_fit_prob, fetched_at: ds.fetched_at } : null,
      books: { count: bs.length, median: median != null ? Number(median.toFixed(4)) : null, per_book: bs },
    };
  });

  return {
    tournament: {
      id: t.id,
      name: t.name,
      short_name: t.short_name,
      tour: t.tour,
      season_year: t.season_year,
      start_date: t.start_date,
      end_date: t.end_date,
      is_major: t.is_major,
      course_name: t.course_name,
      location: t.location,
      kalshi_event_ticker: t.kalshi_event_ticker,
      dg_event_id: t.dg_event_id,
    },
    rows,
    counts: {
      players: new Set(rows.map((r) => r.player.id).filter(Boolean)).size,
      markets: rows.length,
      with_kalshi: rows.filter((r) => r.kalshi).length,
      with_books: rows.filter((r) => r.books.count > 0).length,
      with_dg: rows.filter((r) => r.datagolf).length,
    },
  };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const supabase = getSupabase();
  const summary = { scanned: 0, archived: 0, errors: [] };
  const now = Date.now();

  const { data: tournaments } = await supabase
    .from("golfodds_tournaments")
    .select("id, tour, name, short_name, season_year, start_date, end_date, course_name, location, is_major, kalshi_event_ticker, dg_event_id, status, slug")
    .eq("status", "open")
    .not("end_date", "is", null);
  summary.scanned = tournaments?.length || 0;

  for (const t of tournaments || []) {
    const endMs = new Date(t.end_date).getTime() + (ARCHIVE_DELAY_HOURS * 3600 * 1000);
    if (now < endMs) continue;

    try {
      const snap = await snapshotTournament(supabase, t);
      if (!snap || !snap.rows.length) {
        summary.errors.push({ id: t.id, reason: "no rows to snapshot" });
        continue;
      }

      const { error: archiveErr } = await supabase
        .from("golfodds_tournament_archive")
        .upsert({
          tournament_id: t.id,
          final_snapshot: snap,
          closed_at: new Date().toISOString(),
        }, { onConflict: "tournament_id" });
      if (archiveErr) { summary.errors.push({ id: t.id, reason: archiveErr.message }); continue; }

      const { error: tErr } = await supabase
        .from("golfodds_tournaments")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", t.id);
      if (tErr) { summary.errors.push({ id: t.id, reason: tErr.message }); continue; }

      summary.archived++;
    } catch (e) {
      summary.errors.push({ id: t.id, reason: e.message });
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(summary);
}
