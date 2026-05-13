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

export async function fetchEventsByLeague(league: string): Promise<SportsEvent[]> {
  const r = await fetch(`${DATA_HOST}/api/sports/events?league=${league}&status=open`, { next: { revalidate: 30 } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.events || [];
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
}

export interface EventDetail {
  event: SportsEvent;
  markets: MarketRow[];
}

export async function fetchEventDetail(eventId: string): Promise<EventDetail | null> {
  const r = await fetch(`${DATA_HOST}/api/sports/event?id=${eventId}`, { next: { revalidate: 15 } });
  if (!r.ok) return null;
  return r.json();
}
