import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";

// GET /api/v1/golf
//
// Returns Kalshi vs sportsbook vs DataGolf model probabilities for the active
// PGA Tour tournament. The golf-specific endpoint that has no equivalent in
// the-odds-api.com or any other public sports API.
//
// Query params:
//   market_type (optional) — win (default) | t5 | t10 | t20 | t40 | mc | r1lead | etc.
//   min_edge    (optional) — filter to players with Kalshi-vs-books edge ≥ X (default 0)
//
// Response:
// {
//   schema_version: "v1",
//   tournament: { name, slug, season_year, is_major, start_date },
//   market_type: "win",
//   generated_at: ISO 8601,
//   players: [
//     {
//       name, slug, owgr_rank,
//       kalshi_prob: 0.143,
//       datagolf_model_prob: 0.164,
//       books_median_novig: 0.155,
//       book_count: 12,
//       edge_vs_books_pct: 0.012,
//       edge_vs_datagolf_pct: 0.021,
//       best_book: { name, price_american },
//       url: "https://sportsbookish.com/golf/players/scottie-scheffler"
//     }
//   ]
// }

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

interface ComparisonPlayer {
  player: { name: string; slug: string; owgr_rank: number | null };
  kalshi: { implied_prob: number | null } | null;
  datagolf: { dg_prob: number | null; dg_fit_prob: number | null } | null;
  books_median: number | null;
  book_count: number;
  edge_vs_books_median: number | null;
  edge_vs_dg: number | null;
  best_book_for_bet: { book: string; price_american: number | null } | null;
}

export async function GET(req: Request) {
  const auth = await requireApiKey(req, "/v1/golf");
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const marketType = url.searchParams.get("market_type") || "win";
  const minEdge = Math.abs(parseFloat(url.searchParams.get("min_edge") || "0"));

  // Get the active tournament
  const tournamentsRes = await fetch(`${DATA_HOST}/api/golfodds/tournaments`, { cache: "no-store" });
  if (!tournamentsRes.ok) {
    return NextResponse.json({ error: "Tournament list unavailable" }, { status: 502 });
  }
  const { tournaments } = await tournamentsRes.json();
  const active = (tournaments || []).find((t: { status: string }) => t.status === "upcoming") || tournaments?.[0];
  if (!active) {
    return NextResponse.json({ schema_version: "v1", tournament: null, players: [] });
  }

  const comparisonRes = await fetch(
    `${DATA_HOST}/api/golfodds/comparison?tournament_id=${active.id}&market_type=${marketType}`,
    { cache: "no-store" }
  );
  if (!comparisonRes.ok) {
    return NextResponse.json({ error: "Comparison data unavailable" }, { status: 502 });
  }
  const comparison = await comparisonRes.json();

  const players = ((comparison.players || []) as ComparisonPlayer[])
    .filter((p) => {
      if (minEdge === 0) return true;
      return Math.abs(p.edge_vs_books_median ?? 0) >= minEdge;
    })
    .map((p) => ({
      name: p.player.name,
      slug: p.player.slug,
      owgr_rank: p.player.owgr_rank,
      kalshi_prob: p.kalshi?.implied_prob ?? null,
      datagolf_model_prob: p.datagolf?.dg_prob ?? p.datagolf?.dg_fit_prob ?? null,
      books_median_novig: p.books_median,
      book_count: p.book_count,
      edge_vs_books_pct: p.edge_vs_books_median,
      edge_vs_datagolf_pct: p.edge_vs_dg,
      best_book: p.best_book_for_bet ? { name: p.best_book_for_bet.book, price_american: p.best_book_for_bet.price_american } : null,
      url: `https://sportsbookish.com/golf/players/${p.player.slug}`,
    }));

  return NextResponse.json({
    schema_version: "v1",
    tournament: {
      name: active.name,
      slug: active.slug,
      season_year: active.season_year,
      is_major: active.is_major,
      start_date: active.start_date,
    },
    market_type: marketType,
    generated_at: new Date().toISOString(),
    request: { market_type: marketType, min_edge: minEdge, returned: players.length },
    players,
  }, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
  });
}
