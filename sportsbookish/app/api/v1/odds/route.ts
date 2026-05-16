import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";

// GET /api/v1/odds
//
// Returns live Kalshi event-contract prices alongside US sportsbook consensus
// for every active market across nine sports.
//
// Query params:
//   league   (optional) — filter to one league: nfl, nba, mlb, nhl, epl, mls, ucl, wc, golf
//   limit    (optional) — max events to return (default 100, max 500)
//
// Response shape:
// {
//   schema_version: "v1",
//   generated_at: ISO 8601,
//   events: [
//     {
//       league, event_type, event_title, event_slug, season_year, start_time,
//       sides: [
//         {
//           contestant: "Lakers",
//           kalshi_implied_prob: 0.42,
//           books_median_novig: 0.45,
//           books_count: 11,
//           edge_pct: 0.03,        // books_median - kalshi (positive = buy on Kalshi)
//           best_book: { name: "DraftKings", price_american: +150 }
//         }
//       ]
//     }
//   ]
// }

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

export async function GET(req: Request) {
  const auth = await requireApiKey(req, "/v1/odds");
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const leagueFilter = url.searchParams.get("league");
  const limit = Math.min(500, parseInt(url.searchParams.get("limit") || "100", 10));

  // Fetch from the data plane (which aggregates Kalshi + books across all sports)
  // We hit the per-league events endpoint with markets inlined
  const supabase = await fetch(`${DATA_HOST}/api/sports/leagues`, { cache: "no-store" })
    .then(r => r.json()).catch(() => ({ leagues: [] }));
  const allLeagues: { key: string }[] = supabase.leagues || [];
  const leagues = leagueFilter ? allLeagues.filter((l) => l.key === leagueFilter) : allLeagues;

  const events: object[] = [];
  for (const lg of leagues) {
    if (events.length >= limit) break;
    try {
      const r = await fetch(`${DATA_HOST}/api/sports/events?league=${lg.key}&status=open&with=markets`, { cache: "no-store" });
      if (!r.ok) continue;
      const data = await r.json();
      for (const e of data.events || []) {
        if (events.length >= limit) break;
        events.push({
          league: e.league,
          event_type: e.event_type,
          event_title: e.title,
          event_slug: e.slug,
          season_year: e.season_year,
          start_time: e.start_time,
          sides: (e.markets || []).map((m: { contestant_label: string; implied_prob: number | null; books_median: number | null; books_count: number; edge_vs_books_median: number | null; best_book: { book: string; american: number | null } | null }) => ({
            contestant: m.contestant_label,
            kalshi_implied_prob: m.implied_prob,
            books_median_novig: m.books_median,
            books_count: m.books_count,
            edge_pct: m.edge_vs_books_median,
            best_book: m.best_book ? { name: m.best_book.book, price_american: m.best_book.american } : null,
          })),
        });
      }
    } catch { /* skip league on error */ }
  }

  return NextResponse.json({
    schema_version: "v1",
    generated_at: new Date().toISOString(),
    request: { league: leagueFilter, limit, returned: events.length },
    events,
  }, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
  });
}
