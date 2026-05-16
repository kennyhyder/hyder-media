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
  const r = await fetch(`${DATA_HOST}/api/sports/leagues`, { next: { revalidate: 15 } });
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

// Resolve canonical event URL by league + year + slug via the data-plane.
// sports_events lives in the hyder.me Supabase project, NOT in the
// sportsbookish-isolated auth project — so we go through the data plane.
export interface EventSlugRow {
  id: string;
  league: string;
  title: string;
  short_title: string | null;
  season_year: number;
  slug: string;
  start_time: string | null;
  event_type: string;
  status?: string;
  kalshi_event_ticker?: string | null;
  closed_at?: string | null;
}

export async function fetchEventBySlug(league: string, year: number, slug: string): Promise<EventSlugRow | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${DATA_HOST}/api/sports/event-by-slug?league=${encodeURIComponent(league)}&year=${year}&slug=${encodeURIComponent(slug)}`, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const data = await r.json();
    return data.event || null;
  } catch {
    return null;
  }
}

export interface TeamMarket {
  market_id: string;
  contestant_label: string;
  market_type: string;
  event: { id: string; title: string; event_type: string; slug: string | null; season_year: number | null; start_time: string | null; status: string; kalshi_event_ticker: string | null };
  kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null; last_price: number | null; fetched_at: string } | null;
  books: { count: number; median: number; min: number; max: number; best: { book: string; american: number | null } | null } | null;
}

export interface TeamDetail {
  team: { id: string; league: string; name: string; slug: string; kind: "team" | "player" | null; abbreviation: string | null; normalized_name: string };
  markets: TeamMarket[];
  counts: { games: number; futures: number; total: number };
}

export interface TeamListItem {
  id: string;
  league: string;
  name: string;
  slug: string;
  kind: "team" | "player" | null;
  abbreviation: string | null;
}

export async function fetchTeams(league?: string, kind?: "team" | "player"): Promise<TeamListItem[]> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const params = new URLSearchParams();
    if (league) params.set("league", league);
    if (kind) params.set("kind", kind);
    const url = `${DATA_HOST}/api/sports/teams${params.toString() ? "?" + params.toString() : ""}`;
    const r = await fetch(url, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return [];
    const data = await r.json();
    return data.teams || [];
  } catch {
    return [];
  }
}

export async function fetchTeamBySlug(league: string, slug: string): Promise<TeamDetail | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${DATA_HOST}/api/sports/team-by-slug?league=${encodeURIComponent(league)}&slug=${encodeURIComponent(slug)}`, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function fetchEventSlugById(id: string): Promise<{ league: string; season_year: number; slug: string } | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${DATA_HOST}/api/sports/event-by-slug?id=${encodeURIComponent(id)}`, { next: { revalidate: 15 }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const data = await r.json();
    if (!data.event?.slug || !data.event?.season_year) return null;
    return { league: data.event.league, season_year: data.event.season_year, slug: data.event.slug };
  } catch {
    return null;
  }
}

export async function fetchEventsByLeague(league: string): Promise<SportsEvent[]> {
  const r = await fetch(`${DATA_HOST}/api/sports/events?league=${league}&status=open`, { next: { revalidate: 15 } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.events || [];
}

export async function fetchLeagueData(league: string): Promise<SportsLeagueData> {
  const r = await fetch(`${DATA_HOST}/api/sports/events?league=${league}&status=open&with=markets`, { next: { revalidate: 15 } });
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

// Archive listing — for sitemap, year-index, and pSEO coverage.
// Cached longer than live data (snapshots don't change).
export async function fetchArchivedEventsByLeague(league: string, year?: number): Promise<SportsEvent[]> {
  const yq = year != null ? `&year=${year}` : "";
  const r = await fetch(`${DATA_HOST}/api/sports/archived-events?league=${encodeURIComponent(league)}${yq}`, { next: { revalidate: 600 } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.events || [];
}

// Per-side row inside the snapshot. Mirrors what cron-archive-events writes.
export interface ArchiveMarketSnap {
  market_id: string;
  contestant_label: string;
  market_type: string;
  kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null; last_price: number | null; fetched_at: string | null } | null;
  books: { count: number; median: number | null; per_book: { book: string; american: number | null; novig: number | null }[] };
}

export interface ArchiveSnapshot {
  title: string;
  event_type: string;
  start_time: string | null;
  kalshi_event_ticker: string | null;
  markets: ArchiveMarketSnap[];
}

export interface EventArchiveResult {
  event: SportsEvent | null;
  archive: { closed_at: string; final_snapshot: ArchiveSnapshot } | null;
}

export async function fetchEventArchive(league: string, year: number, slug: string): Promise<EventArchiveResult> {
  try {
    const r = await fetch(
      `${DATA_HOST}/api/sports/event-archive?league=${encodeURIComponent(league)}&year=${year}&slug=${encodeURIComponent(slug)}`,
      { next: { revalidate: 3600 } }
    );
    if (!r.ok) return { event: null, archive: null };
    return r.json();
  } catch {
    return { event: null, archive: null };
  }
}
