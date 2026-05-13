"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { fmtPct, fmtPctSigned, fmtAmerican, edgeColor, edgeBg, bookLabel } from "@/lib/format";

interface PlayerLeg {
  matchup_player_id: string;
  player_id: string;
  player: { id: string; name: string; dg_id: number | null };
  kalshi_ticker: string | null;
  kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null; last_price: number | null } | null;
  book_prices: Record<string, { american: number | null; novig: number | null; implied: number | null }>;
  book_count: number;
  books_median: number | null;
  books_min: number | null;
  edge_vs_books_median: number | null;
  edge_vs_best_book: number | null;
}

interface Matchup {
  id: string;
  matchup_type: "h2h" | "3ball" | "5ball";
  scope: string;
  round_number: number | null;
  title: string | null;
  kalshi_event_ticker: string | null;
  players: PlayerLeg[];
}

function MatchupsInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const [matchups, setMatchups] = useState<Matchup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "h2h" | "3ball" | "5ball">("all");
  const [roundFilter, setRoundFilter] = useState<number | "all">("all");
  const [minEdge, setMinEdge] = useState(0);
  const [tournamentName, setTournamentName] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/golfodds/tournament-info?id=${id}`).then((r) => r.json()).then((d) => setTournamentName(d.tournament?.name || null)).catch(() => {}),
      fetch(`/api/golfodds/matchups?tournament_id=${id}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
        .then((d) => setMatchups(d.matchups || []))
        .catch((e) => setError(String(e))),
    ]).finally(() => setLoading(false));
  }, [id]);

  const rounds = useMemo(() => Array.from(new Set(matchups.map((m) => m.round_number).filter((r): r is number => r != null))).sort(), [matchups]);

  const filtered = useMemo(() => {
    let xs = matchups;
    if (typeFilter !== "all") xs = xs.filter((m) => m.matchup_type === typeFilter);
    if (roundFilter !== "all") xs = xs.filter((m) => m.round_number === roundFilter);
    if (minEdge > 0) {
      xs = xs.filter((m) => m.players.some((p) => Math.abs(p.edge_vs_books_median ?? 0) >= minEdge));
    }
    return xs.sort((a, b) => {
      const maxA = Math.max(...a.players.map((p) => Math.abs(p.edge_vs_books_median ?? 0)));
      const maxB = Math.max(...b.players.map((p) => Math.abs(p.edge_vs_books_median ?? 0)));
      return maxB - maxA;
    });
  }, [matchups, typeFilter, roundFilter, minEdge]);

  if (!id) {
    return (
      <div className="min-h-screen">
        <NavBar />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <p className="text-neutral-400">No tournament selected. <Link href="/" className="text-green-400 hover:underline">Go back →</Link></p>
        </main>
      </div>
    );
  }

  const counts = {
    h2h: matchups.filter((m) => m.matchup_type === "h2h").length,
    "3ball": matchups.filter((m) => m.matchup_type === "3ball").length,
    "5ball": matchups.filter((m) => m.matchup_type === "5ball").length,
  };

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="max-w-[1800px] mx-auto px-6 py-6">
        <div className="mb-4 flex items-baseline gap-3 flex-wrap">
          <Link href="/" className="text-neutral-500 hover:text-neutral-300 text-sm">← Tournaments</Link>
          <Link href={`/tournament/?id=${id}`} className="text-neutral-500 hover:text-neutral-300 text-sm">← Outright table</Link>
          <h1 className="text-2xl font-bold text-neutral-100">{tournamentName || "Matchups"}</h1>
          <span className="text-xs text-neutral-500">Head-to-head & 3-ball markets</span>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
          <div className="flex items-center gap-1">
            {(["all", "h2h", "3ball", "5ball"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                disabled={t !== "all" && (counts as Record<string, number>)[t] === 0}
                className={[
                  "px-3 py-1 text-xs rounded transition",
                  typeFilter === t ? "bg-green-500/20 text-green-300 ring-1 ring-green-500/40"
                    : (t !== "all" && (counts as Record<string, number>)[t] === 0) ? "text-neutral-700 cursor-not-allowed"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/70",
                ].join(" ")}
              >
                {t === "all" ? `All (${matchups.length})` : `${t.toUpperCase()} (${(counts as Record<string, number>)[t] || 0})`}
              </button>
            ))}
          </div>
          {rounds.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-neutral-500 mr-1">Round:</span>
              <button
                onClick={() => setRoundFilter("all")}
                className={`px-2 py-1 text-xs rounded ${roundFilter === "all" ? "bg-amber-500/20 text-amber-300" : "text-neutral-400 hover:text-neutral-200"}`}
              >All</button>
              {rounds.map((r) => (
                <button
                  key={r}
                  onClick={() => setRoundFilter(r)}
                  className={`px-2 py-1 text-xs rounded ${roundFilter === r ? "bg-amber-500/20 text-amber-300" : "text-neutral-400 hover:text-neutral-200"}`}
                >R{r}</button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-neutral-400">
            Min |edge|:
            <select
              value={minEdge}
              onChange={(e) => setMinEdge(Number(e.target.value))}
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 text-xs"
            >
              <option value={0}>0%</option>
              <option value={0.01}>1%</option>
              <option value={0.02}>2%</option>
              <option value={0.05}>5%</option>
              <option value={0.1}>10%</option>
            </select>
          </label>
          <div className="ml-auto text-xs text-neutral-500">Showing {filtered.length} of {matchups.length}</div>
        </div>

        {loading && <div className="text-neutral-400 text-sm">Loading matchups…</div>}
        {error && <div className="text-rose-400 text-sm">{error}</div>}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((m) => <MatchupCard key={m.id} matchup={m} />)}
            {filtered.length === 0 && (
              <div className="col-span-full text-center text-neutral-500 py-8">No matchups match the current filters.</div>
            )}
          </div>
        )}

        <div className="mt-4 text-xs text-neutral-500">
          <p>
            Each card shows a matchup (2 players for H2H, 3 for 3-ball). For each player leg: Kalshi YES price,
            book median, and the buy edge (positive green = Kalshi is cheaper than book consensus → good buy).
            H2H is full-tournament; 3-ball is per-round.
          </p>
        </div>
      </main>
    </div>
  );
}

function MatchupCard({ matchup }: { matchup: Matchup }) {
  const sortedPlayers = [...matchup.players].sort((a, b) => (b.kalshi?.implied_prob ?? 0) - (a.kalshi?.implied_prob ?? 0));
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="text-sm text-neutral-200 font-medium leading-tight">{matchup.title}</div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
            matchup.matchup_type === "h2h" ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
            : matchup.matchup_type === "3ball" ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
            : "bg-pink-500/15 text-pink-300 border-pink-500/30"
          }`}>{matchup.matchup_type.toUpperCase()}</span>
          {matchup.round_number != null && <span className="text-[10px] text-amber-400">R{matchup.round_number}</span>}
        </div>
      </div>
      <div className="space-y-1.5">
        {sortedPlayers.map((p) => {
          const edge = p.edge_vs_books_median;
          return (
            <div key={p.matchup_player_id} className={`rounded p-2 ${edgeBg(edge)}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-neutral-100">{p.player?.name}</span>
                {edge != null && (
                  <span className={`text-xs tabular-nums ${edgeColor(edge)}`}>{fmtPctSigned(edge)}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1 text-[11px]">
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-neutral-500">Kalshi</div>
                  <div className="tabular-nums text-amber-300">{fmtPct(p.kalshi?.implied_prob)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-neutral-500">Books med ({p.book_count})</div>
                  <div className="tabular-nums text-neutral-300">{fmtPct(p.books_median)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-neutral-500">Best book</div>
                  <div className="tabular-nums text-neutral-300">{fmtPct(p.books_min)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MatchupsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen"><NavBar /><div className="p-8 text-neutral-400">Loading…</div></div>}>
      <MatchupsInner />
    </Suspense>
  );
}
