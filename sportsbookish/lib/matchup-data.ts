const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

export interface MatchupLeg {
  matchup_player_id: string;
  player_id: string;
  player: { id: string; name: string; dg_id: number | null } | null;
  kalshi_ticker: string | null;
  kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null; last_price: number | null } | null;
  book_prices: Record<string, { american: number | null; novig: number | null; implied: number | null }>;
  book_count: number;
  books_median: number | null;
  books_min: number | null;
  edge_vs_books_median: number | null;
  edge_vs_best_book: number | null;
}

export interface Matchup {
  id: string;
  matchup_type: "h2h" | "3ball" | "5ball";
  scope: string;
  round_number: number | null;
  title: string | null;
  kalshi_event_ticker: string | null;
  players: MatchupLeg[];
}

export async function fetchMatchups(tournamentId: string, type?: string): Promise<{ matchups: Matchup[]; books: string[] }> {
  const url = new URL(`${DATA_HOST}/api/golfodds/matchups`);
  url.searchParams.set("tournament_id", tournamentId);
  if (type) url.searchParams.set("type", type);
  const r = await fetch(url.toString(), { next: { revalidate: 30 } });
  if (!r.ok) throw new Error(`matchups fetch: ${r.status}`);
  return r.json();
}

export interface PlayerMarket {
  market_id: string;
  market_type: string;
  kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null; last_price: number | null } | null;
  datagolf: { dg_prob: number | null; dg_fit_prob: number | null } | null;
  book_prices: Record<string, { american: number | null; novig: number | null; implied: number | null }>;
  book_count: number;
  books_median: number | null;
  books_min: number | null;
  edge_vs_books_median: number | null;
  edge_vs_best_book: number | null;
  edge_vs_dg: number | null;
}

export interface PlayerMatchupLeg extends MatchupLeg { is_self: boolean }
export interface PlayerMatchup {
  matchup_id: string;
  matchup_type: "h2h" | "3ball" | "5ball";
  scope: string;
  round_number: number | null;
  title: string | null;
  legs: PlayerMatchupLeg[];
}

export interface PlayerData {
  player: { id: string; name: string; dg_id: number | null; owgr_rank: number | null; country: string | null };
  tournament: { id: string; name: string; kalshi_event_ticker: string | null; is_major: boolean; start_date: string | null };
  markets: PlayerMarket[];
  matchups: PlayerMatchup[];
}

export async function fetchPlayer(playerId: string, tournamentId: string): Promise<PlayerData | null> {
  const url = `${DATA_HOST}/api/golfodds/player?player_id=${playerId}&tournament_id=${tournamentId}`;
  const r = await fetch(url, { next: { revalidate: 30 } });
  if (!r.ok) return null;
  return r.json();
}
