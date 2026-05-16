// Server-side data access for the golf views. Calls the existing public
// /api/golfodds/* endpoints on hyder.me (the data plane), then applies
// tier + preference filtering before returning to the page.
//
// This keeps the ingestion + cron + alert pipeline running on the hyder-media
// project unchanged. SportsBookish is a tiered presentation layer on top.

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

// Resolve canonical tournament URL by slug + year via the data-plane endpoint.
// The golfodds_* tables live in the hyder.me Supabase project, NOT in the
// sportsbookish-isolated auth project — so we MUST go through the data plane.
export interface TournamentSlugRow {
  id: string;
  name: string;
  short_name: string | null;
  season_year: number;
  slug: string;
  start_date: string | null;
  is_major: boolean;
  status?: string;
}

// Golfer hub data + sitemap support
export interface GolferListItem {
  id: string;
  name: string;
  slug: string;
  dg_id: number | null;
  owgr_rank: number | null;
}

export interface GolferDetail {
  player: { id: string; name: string; slug: string; dg_id: number | null; owgr_rank: number | null; country: string | null };
  tournaments: Array<{
    tournament: { id: string; name: string; short_name: string | null; slug: string | null; season_year: number | null; start_date: string | null; is_major: boolean; status: string };
    markets: Array<{
      market_id: string;
      market_type: string;
      kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null; last_price: number | null; fetched_at: string } | null;
      dg: { dg_prob: number | null; dg_fit_prob: number | null; fetched_at: string } | null;
      books: { count: number; median: number | null; best: { book: string; american: number | null } | null } | null;
    }>;
  }>;
}

export async function fetchGolfers(): Promise<GolferListItem[]> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${DATA_HOST}/api/golfodds/players`, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return [];
    const data = await r.json();
    return data.players || [];
  } catch {
    return [];
  }
}

export async function fetchGolferBySlug(slug: string): Promise<GolferDetail | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${DATA_HOST}/api/golfodds/player-by-slug?slug=${encodeURIComponent(slug)}`, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function fetchTournamentBySlug(year: number, slug: string): Promise<TournamentSlugRow | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${DATA_HOST}/api/golfodds/tournament-by-slug?year=${year}&slug=${encodeURIComponent(slug)}`, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const data = await r.json();
    return data.tournament || null;
  } catch {
    return null;
  }
}

export async function fetchTournamentSlugById(id: string): Promise<{ season_year: number; slug: string } | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${DATA_HOST}/api/golfodds/tournament-by-slug?id=${encodeURIComponent(id)}`, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const data = await r.json();
    if (!data.tournament?.slug || !data.tournament?.season_year) return null;
    return { season_year: data.tournament.season_year, slug: data.tournament.slug };
  } catch {
    return null;
  }
}

export interface Tournament {
  id: string;
  tour: string;
  name: string;
  short_name: string | null;
  season_year: number | null;
  slug: string | null;
  start_date: string | null;
  end_date: string | null;
  is_major: boolean;
  status: string;
  kalshi_event_ticker: string | null;
  dg_event_id: number | null;
}

export async function fetchTournaments(): Promise<Tournament[]> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${DATA_HOST}/api/golfodds/tournaments`, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return [];
    const data = await r.json();
    return data.tournaments || [];
  } catch {
    return [];
  }
}

export async function fetchArchivedTournaments(year?: number): Promise<Tournament[]> {
  try {
    const yq = year != null ? `?year=${year}` : "";
    const r = await fetch(`${DATA_HOST}/api/golfodds/archived-tournaments${yq}`, { next: { revalidate: 600 } });
    if (!r.ok) return [];
    const data = await r.json();
    return data.tournaments || [];
  } catch {
    return [];
  }
}

export interface ArchivedPlayerRow {
  market_id: string;
  market_type: string;
  player: { id: string | null; name: string | null; dg_id: number | null };
  kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null; last_price: number | null; fetched_at: string | null } | null;
  datagolf: { dg_prob: number | null; dg_fit_prob: number | null; fetched_at: string | null } | null;
  books: { count: number; median: number | null; per_book: { book: string; american: number | null; novig: number | null }[] };
}

export interface TournamentArchiveSnapshot {
  tournament: Tournament;
  rows: ArchivedPlayerRow[];
  counts: { players: number; markets: number; with_kalshi: number; with_books: number; with_dg: number };
}

export interface TournamentArchiveResult {
  tournament: Tournament | null;
  archive: { closed_at: string; final_snapshot: TournamentArchiveSnapshot } | null;
}

export async function fetchTournamentArchive(year: number, slug: string): Promise<TournamentArchiveResult> {
  try {
    const r = await fetch(
      `${DATA_HOST}/api/golfodds/tournament-archive?year=${year}&slug=${encodeURIComponent(slug)}`,
      { next: { revalidate: 3600 } }
    );
    if (!r.ok) return { tournament: null, archive: null };
    return r.json();
  } catch {
    return { tournament: null, archive: null };
  }
}

export interface TournamentInfo {
  tournament: { id: string; name: string; is_major: boolean; start_date: string | null; kalshi_event_ticker: string | null };
  stats: {
    total_markets: number;
    unique_players: number;
    markets_by_type: Record<string, number>;
    kalshi_markets_by_type: Record<string, number>;
    kalshi_quote_count: number;
    dg_quote_count: number;
    book_quote_count: number;
    total_matchups: number;
    matchups_by_type: Record<string, number>;
    total_props: number;
  };
  books: string[];
}

export async function fetchTournamentInfo(id: string): Promise<TournamentInfo | null> {
  // Hard-cap upstream latency. Without this, a slow data-plane response on
  // a cold start blocks the page render until the function's maxDuration,
  // resulting in a Vercel FUNCTION_INVOCATION_FAILED error rather than a
  // graceful empty state.
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`${DATA_HOST}/api/golfodds/tournament-info?id=${id}`, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export interface PlayerComparisonRow {
  player_id: string;
  player: { id: string; name: string; slug?: string | null; dg_id: number | null; owgr_rank: number | null };
  market_type: string;
  kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null; last_price: number | null } | null;
  datagolf: { dg_prob: number | null; dg_fit_prob: number | null } | null;
  book_prices: Record<string, { american: number | null; decimal: number | null; implied: number | null; novig: number | null }>;
  book_count: number;
  books_median: number | null;
  books_min: number | null;
  books_max: number | null;
  best_book_for_bet: { book: string; novig_prob: number; price_american: number | null } | null;
  edge_vs_books_median: number | null;
  edge_vs_best_book: number | null;
  edge_vs_dg: number | null;
}

export interface ComparisonResponse {
  tournament_id: string;
  market_type: string;
  books: string[];
  player_count: number;
  players: PlayerComparisonRow[];
}

export async function fetchComparison(tournamentId: string, marketType: string): Promise<ComparisonResponse> {
  const url = `${DATA_HOST}/api/golfodds/comparison?tournament_id=${tournamentId}&market_type=${marketType}`;
  // next: { revalidate: 15 } — bypass Next.js Data Cache entirely. The previous
  // revalidate:30 approach had a failure mode where if fetchComparison ever
  // succeeded with an empty/partial response (during a transient data-plane
  // hiccup), Next would cache that empty response for 30s and serve it to
  // every visitor. no-store guarantees fresh data per request. The
  // upstream itself has a 1h Vercel edge cache via Cache-Control headers,
  // so we still benefit from caching at the right layer.
  //
  // 25s hard cap. Comparison runs 1.5-11s depending on cold start.
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(url, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) throw new Error(`comparison fetch: ${r.status}`);
    return await r.json();
  } catch {
    return { tournament_id: tournamentId, market_type: marketType, books: [], player_count: 0, players: [] };
  }
}

/**
 * Helper for recomputing median over a tier-filtered book set. When a Pro+
 * user excludes books, the books_median field from the upstream API doesn't
 * reflect their preference, so we recompute from the per-book breakdown.
 */
export function recomputeMedianForRow(row: PlayerComparisonRow, excludedBooks: string[]): number | null {
  if (!excludedBooks.length) return row.books_median;
  const vals: number[] = [];
  for (const [book, prices] of Object.entries(row.book_prices)) {
    if (excludedBooks.includes(book)) continue;
    if (prices.novig != null) vals.push(prices.novig);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * Compute edge_vs_reference where reference is either:
 *   - The user's home_book's no-vig prob (if set)
 *   - Otherwise the recomputed books_median (after applying excluded_books)
 * Edge convention: positive = Kalshi cheaper than reference → good buy.
 */
export function computeEdgeForRow(
  row: PlayerComparisonRow,
  homeBook: string | null,
  excludedBooks: string[]
): { edge: number | null; reference: number | null; source: string } {
  const kalshi = row.kalshi?.implied_prob ?? null;
  if (kalshi == null) return { edge: null, reference: null, source: "kalshi_missing" };

  if (homeBook) {
    const ref = row.book_prices[homeBook]?.novig ?? null;
    if (ref != null) return { edge: Number((ref - kalshi).toFixed(4)), reference: ref, source: `book:${homeBook}` };
  }
  const med = recomputeMedianForRow(row, excludedBooks);
  if (med == null) return { edge: null, reference: null, source: "no_books" };
  return { edge: Number((med - kalshi).toFixed(4)), reference: med, source: "books_median" };
}
