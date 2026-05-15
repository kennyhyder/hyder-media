// Server-side data access for team sports. Fetches via hyder.me/api/sports/*
// instead of querying Supabase directly — this keeps SportsBookish auth/users
// isolated from the data-plane Supabase project.

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

export interface League {
  key: string;
  display_name: string;
  sport_category: string;
  icon: string | null;
  accent_color: string | null;
  active: boolean;
  display_order: number;
}

export async function fetchLeagues(): Promise<League[]> {
  const r = await fetch(`${DATA_HOST}/api/sports/leagues`, { next: { revalidate: 60 } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.leagues || [];
}

export interface SportsEvent {
  id: string;
  league: string;
  event_type: string;
  title: string;
  short_title: string | null;
  season_year: number | null;
  slug: string | null;
  start_time: string | null;
  status: string;
  kalshi_event_ticker: string | null;
}

export interface InlineMarket {
  id: string;
  contestant_label: string;
  implied_prob: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  books_count: number;
  books_median: number | null;
  books_min: number | null;
  edge_vs_books_median: number | null;
  edge_vs_best_book: number | null;
  best_book: { book: string; implied_prob_novig: number | null; american: number | null } | null;
  book_prices: Record<string, { american: number | null; novig: number | null }>;
  polymarket_prob?: number | null;
  polymarket_volume_usd?: number | null;
  edge_kalshi_vs_polymarket?: number | null;
}

export interface SportsEventWithMarkets extends SportsEvent {
  markets: InlineMarket[];
}

export interface SportsLeagueData {
  events: SportsEventWithMarkets[];
  books: string[];
}

// Resolve canonical event URL by league + year + slug. Service-role read.
export interface EventSlugRow {
  id: string;
  league: string;
  title: string;
  short_title: string | null;
  season_year: number;
  slug: string;
  start_time: string | null;
  event_type: string;
}

export async function fetchEventBySlug(league: string, year: number, slug: string): Promise<EventSlugRow | null> {
  const { createServiceClient } = await import("@/lib/supabase/server");
  const sb = createServiceClient();
  const { data } = await sb
    .from("sports_events")
    .select("id, league, title, short_title, season_year, slug, start_time, event_type")
    .eq("league", league)
    .eq("season_year", year)
    .eq("slug", slug)
    .maybeSingle();
  return data || null;
}

export async function fetchEventSlugById(id: string): Promise<{ league: string; season_year: number; slug: string } | null> {
  const { createServiceClient } = await import("@/lib/supabase/server");
  const sb = createServiceClient();
  const { data } = await sb
    .from("sports_events")
    .select("league, season_year, slug")
    .eq("id", id)
    .maybeSingle();
  if (!data?.slug || !data?.season_year) return null;
  return { league: data.league, season_year: data.season_year, slug: data.slug };
}

export async function fetchEventsByLeague(league: string): Promise<SportsEvent[]> {
  const r = await fetch(`${DATA_HOST}/api/sports/events?league=${league}&status=open`, { next: { revalidate: 30 } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.events || [];
}

export async function fetchLeagueData(league: string): Promise<SportsLeagueData> {
  const r = await fetch(`${DATA_HOST}/api/sports/events?league=${league}&status=open&with=markets`, { next: { revalidate: 30 } });
  if (!r.ok) return { events: [], books: [] };
  const data = await r.json();
  return { events: data.events || [], books: data.books || [] };
}

export interface BookPrice {
  book: string;
  implied_prob_novig: number | null;
  american: number | null;
  fetched_at: string | null;
}

export interface MarketRow {
  id: string;
  contestant_label: string;
  market_type: string;
  kalshi_ticker: string | null;
  implied_prob: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  last_price: number | null;
  fetched_at: string | null;
  // Book overlay (only populated for h2h-equivalent markets where Odds API data exists)
  books_count?: number;
  books_median?: number | null;
  books_min?: number | null;
  books_max?: number | null;
  book_prices?: BookPrice[];
  best_book?: { book: string; implied_prob_novig: number | null; american: number | null } | null;
  edge_vs_books_median?: number | null;
  edge_vs_best_book?: number | null;
  // Polymarket (peer-to-peer; same fee-free structure as Kalshi)
  polymarket_prob?: number | null;
  polymarket_volume_usd?: number | null;
  edge_kalshi_vs_polymarket?: number | null;
  edge_polymarket_vs_books?: number | null;
}

export interface SpreadRow {
  label: string;
  books: Record<string, { point: number | null; american: number | null; implied_prob_novig: number | null }>;
}

export interface TotalRow {
  point: number | null;
  side: string;                // "Over" | "Under"
  books: Record<string, { american: number | null; implied_prob_novig: number | null }>;
}

export interface EventDetail {
  event: SportsEvent;
  markets: MarketRow[];
  spreads?: SpreadRow[];
  totals?: TotalRow[];
}

export async function fetchEventDetail(eventId: string): Promise<EventDetail | null> {
  const r = await fetch(`${DATA_HOST}/api/sports/event?id=${eventId}`, { next: { revalidate: 15 } });
  if (!r.ok) return null;
  return r.json();
}
