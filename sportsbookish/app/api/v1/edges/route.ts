import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";

// GET /api/v1/edges
//
// Returns currently-actionable pricing edges between Kalshi and US sportsbook
// consensus, sorted by edge size descending. The "what should I bet right now"
// endpoint.
//
// Query params:
//   min_edge   (optional) — minimum edge in percentage points (default 0.02 = 2pp)
//   league     (optional) — filter to one league
//   limit      (optional) — max results (default 50, max 200)
//
// Response:
// {
//   schema_version: "v1",
//   generated_at: ISO 8601,
//   edges: [
//     {
//       league, event_title, event_slug, contestant,
//       direction: "buy" | "sell",
//       kalshi_prob: 0.42,
//       reference_prob: 0.50,           // books median
//       edge_pct: 0.08,
//       books_count: 11,
//       best_book: { name, price_american },
//       url: "https://sportsbookish.com/sports/nba/2026/lakers-vs-celtics"
//     }
//   ]
// }

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

interface SideRow {
  contestant_label: string;
  implied_prob: number | null;
  books_median: number | null;
  books_count: number;
  edge_vs_books_median: number | null;
  best_book: { book: string; american: number | null } | null;
}

interface EventRow {
  league: string;
  title: string;
  slug: string | null;
  season_year: number | null;
  markets: SideRow[];
}

export async function GET(req: Request) {
  const auth = await requireApiKey(req, "/v1/edges");
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const minEdge = Math.abs(parseFloat(url.searchParams.get("min_edge") || "0.02"));
  const leagueFilter = url.searchParams.get("league");
  const limit = Math.min(200, parseInt(url.searchParams.get("limit") || "50", 10));

  const leaguesRes = await fetch(`${DATA_HOST}/api/sports/leagues`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ leagues: [] }));
  const leagues = (leaguesRes.leagues || []).filter((l: { key: string }) => !leagueFilter || l.key === leagueFilter);

  const allEdges: object[] = [];
  for (const lg of leagues) {
    const r = await fetch(`${DATA_HOST}/api/sports/events?league=${lg.key}&status=open&with=markets`, { cache: "no-store" });
    if (!r.ok) continue;
    const data = await r.json();
    for (const e of (data.events || []) as EventRow[]) {
      for (const m of e.markets || []) {
        if (m.implied_prob == null || m.edge_vs_books_median == null) continue;
        if (Math.abs(m.edge_vs_books_median) < minEdge) continue;
        const direction = m.edge_vs_books_median > 0 ? "buy" : "sell";
        const eventPath = e.slug && e.season_year ? `/sports/${e.league}/${e.season_year}/${e.slug}` : "/sports";
        allEdges.push({
          league: e.league,
          event_title: e.title,
          event_slug: e.slug,
          contestant: m.contestant_label,
          direction,
          kalshi_prob: m.implied_prob,
          reference_prob: m.books_median,
          edge_pct: m.edge_vs_books_median,
          books_count: m.books_count,
          best_book: m.best_book ? { name: m.best_book.book, price_american: m.best_book.american } : null,
          url: `https://sportsbookish.com${eventPath}`,
        });
      }
    }
  }

  // Sort by absolute edge descending
  allEdges.sort((a, b) => Math.abs((b as { edge_pct: number }).edge_pct) - Math.abs((a as { edge_pct: number }).edge_pct));
  const edges = allEdges.slice(0, limit);

  return NextResponse.json({
    schema_version: "v1",
    generated_at: new Date().toISOString(),
    request: { min_edge: minEdge, league: leagueFilter, limit, returned: edges.length },
    edges,
  }, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
  });
}
