// Server-side data access for the golf views. Calls the existing public
// /api/golfodds/* endpoints on hyder.me (the data plane), then applies
// tier + preference filtering before returning to the page.
//
// This keeps the ingestion + cron + alert pipeline running on the hyder-media
// project unchanged. SportsBookish is a tiered presentation layer on top.

import { createServiceClient } from "@/lib/supabase/server";

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

// Resolve canonical tournament URL by slug + year (Supabase direct).
// Cached for 60s to avoid hammering the DB on every visitor — the slugs
// change rarely.
export interface TournamentSlugRow {
  id: string;
  name: string;
  short_name: string | null;
  season_year: number;
  slug: string;
  start_date: string | null;
  is_major: boolean;
}

export async function fetchTournamentBySlug(year: number, slug: string): Promise<TournamentSlugRow | null> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("golfodds_tournaments")
    .select("id, name, short_name, season_year, slug, start_date, is_major")
    .eq("season_year", year)
    .eq("slug", slug)
    .maybeSingle();
  return data || null;
}

export async function fetchTournamentSlugById(id: string): Promise<{ season_year: number; slug: string } | null> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("golfodds_tournaments")
    .select("season_year, slug")
    .eq("id", id)
    .maybeSingle();
  if (!data?.slug || !data?.season_year) return null;
  return { season_year: data.season_year, slug: data.slug };
}

export interface Tournament {
  id: string;
  tour: string;
  name: string;
  short_name: string | null;
  start_date: string | null;
  end_date: string | null;
  is_major: boolean;
  status: string;
  kalshi_event_ticker: string | null;
  dg_event_id: number | null;
}

export async function fetchTournaments(): Promise<Tournament[]> {
  const r = await fetch(`${DATA_HOST}/api/golfodds/tournaments`, { next: { revalidate: 60 } });
  if (!r.ok) throw new Error(`tournaments fetch: ${r.status}`);
  const data = await r.json();
  return data.tournaments || [];
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
  const r = await fetch(`${DATA_HOST}/api/golfodds/tournament-info?id=${id}`, { next: { revalidate: 30 } });
  if (!r.ok) return null;
  return r.json();
}

export interface PlayerComparisonRow {
  player_id: string;
  player: { id: string; name: string; dg_id: number | null; owgr_rank: number | null };
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
  const r = await fetch(url, { next: { revalidate: 30 } });
  if (!r.ok) throw new Error(`comparison fetch: ${r.status}`);
  return r.json();
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
