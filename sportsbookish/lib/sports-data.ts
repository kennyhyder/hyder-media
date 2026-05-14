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
}

export interface SportsEventWithMarkets extends SportsEvent {
  markets: InlineMarket[];
}

export interface SportsLeagueData {
  events: SportsEventWithMarkets[];
  books: string[];
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
