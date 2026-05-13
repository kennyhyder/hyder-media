const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

export interface Movement {
  id: string;
  league: string;
  event_id: string;
  market_id: string;
  event_title: string | null;
  event_type: string | null;
  contestant_label: string | null;
  direction: "up" | "down";
  delta: number;
  prob_now: number;
  prob_baseline: number;
  minutes_ago: number;
  fired_at: string;
}

export async function fetchMovements({ sinceHours = 24, league, minDelta = 0, limit = 200 }: { sinceHours?: number; league?: string; minDelta?: number; limit?: number } = {}): Promise<Movement[]> {
  const url = new URL(`${DATA_HOST}/api/sports/movements`);
  url.searchParams.set("since_hours", String(sinceHours));
  url.searchParams.set("min_delta", String(minDelta));
  url.searchParams.set("limit", String(limit));
  if (league) url.searchParams.set("league", league);
  const r = await fetch(url.toString(), { next: { revalidate: 30 } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.movements || [];
}

export interface ContestantMarket {
  market_id: string;
  event: { id: string; title: string; event_type: string; start_time: string | null; status: string };
  market_type: string;
  contestant_label: string;
  kalshi_ticker: string | null;
  implied_prob: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  last_price: number | null;
  fetched_at: string | null;
}

export interface ContestantData {
  contestant: { id: string; league: string; name: string; abbreviation: string | null };
  markets: ContestantMarket[];
}

export async function fetchContestant(id: string): Promise<ContestantData | null> {
  const r = await fetch(`${DATA_HOST}/api/sports/contestant?id=${id}`, { next: { revalidate: 30 } });
  if (!r.ok) return null;
  return r.json();
}

export interface MarketHistoryPoint { t: string; p: number }
export interface MarketHistory { market_id: string; contestant_label: string; points: MarketHistoryPoint[] }

export async function fetchEventHistory(eventId: string, hours = 24): Promise<MarketHistory[]> {
  const r = await fetch(`${DATA_HOST}/api/sports/event-history?id=${eventId}&hours=${hours}`, { next: { revalidate: 60 } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.markets || [];
}
