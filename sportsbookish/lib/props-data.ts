const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

export interface PropOutcome {
  id: string;
  label: string;
  key: string;
  display_order: number;
  kalshi_ticker: string | null;
  kalshi: { yes_bid: number | null; yes_ask: number | null; last_price: number | null; implied_prob: number | null } | null;
}

export interface PropEvent {
  id: string;
  prop_type: string;
  question: string;
  outcome_kind: "mutually_exclusive" | "cumulative_threshold";
  kalshi_event_ticker: string | null;
  outcomes: PropOutcome[];
  sum_implied: number;
}

export async function fetchProps(tournamentId: string): Promise<PropEvent[]> {
  const r = await fetch(`${DATA_HOST}/api/golfodds/props?tournament_id=${tournamentId}`, { cache: "no-store" });
  if (!r.ok) return [];
  const data = await r.json();
  return data.props || [];
}

export interface LadderMarketEntry {
  kalshi_p: number | null;
  dg_p: number | null;
  books_median_p: number | null;
}

export interface LadderRow {
  player_id: string;
  player: { id: string; name: string };
  markets: Record<string, LadderMarketEntry>;
  issues: { source: string; kind: string; delta: number }[];
  has_kalshi_data: boolean;
}

export async function fetchLadder(tournamentId: string): Promise<LadderRow[]> {
  const r = await fetch(`${DATA_HOST}/api/golfodds/ladder?tournament_id=${tournamentId}`, { cache: "no-store" });
  if (!r.ok) return [];
  const data = await r.json();
  return data.players || [];
}
