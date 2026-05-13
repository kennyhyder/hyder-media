// Server-side data access for team sports — reads from the sports_* tables
// directly via Supabase (no intermediate API on hyder.me yet for sports).

import { createServiceClient } from "@/lib/supabase/server";

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
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("sports_leagues")
    .select("key, display_name, sport_category, icon, accent_color, active, display_order")
    .eq("active", true)
    .order("display_order", { ascending: true });
  return data || [];
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
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("sports_events")
    .select("id, league, event_type, title, short_title, start_time, status, kalshi_event_ticker")
    .eq("league", league)
    .eq("status", "open")
    .order("start_time", { ascending: true, nullsFirst: false })
    .range(0, 199);
  return data || [];
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
  const supabase = createServiceClient();
  const { data: event } = await supabase
    .from("sports_events")
    .select("id, league, event_type, title, short_title, start_time, status, kalshi_event_ticker")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;

  const { data: markets } = await supabase
    .from("sports_markets")
    .select("id, contestant_label, market_type, kalshi_ticker")
    .eq("event_id", eventId);
  if (!markets?.length) return { event, markets: [] };

  const ids = markets.map((m) => m.id);
  const { data: quotes } = await supabase
    .from("sports_v_latest_quotes")
    .select("market_id, yes_bid, yes_ask, last_price, implied_prob, fetched_at")
    .in("market_id", ids);
  const qByMarket = new Map((quotes || []).map((q) => [q.market_id, q]));

  const enriched: MarketRow[] = markets.map((m) => {
    const q = qByMarket.get(m.id);
    return {
      id: m.id,
      contestant_label: m.contestant_label,
      market_type: m.market_type,
      kalshi_ticker: m.kalshi_ticker,
      implied_prob: q?.implied_prob ?? null,
      yes_bid: q?.yes_bid ?? null,
      yes_ask: q?.yes_ask ?? null,
      last_price: q?.last_price ?? null,
      fetched_at: q?.fetched_at ?? null,
    };
  });
  enriched.sort((a, b) => (b.implied_prob ?? 0) - (a.implied_prob ?? 0));
  return { event, markets: enriched };
}
