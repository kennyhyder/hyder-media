"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import TournamentNav from "@/components/TournamentNav";
import { fmtPct, fmtPctSigned, edgeColor, edgeBg } from "@/lib/format";

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
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/golfodds/matchups?tournament_id=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => setMatchups(d.matchups || []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
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
      <TournamentNav tournamentId={id} activeView="matchups" />
      <main className="max-w-[1800px] mx-auto px-6 py-6">

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
            {filtered.map((m) => <MatchupCard key={m.id} matchup={m} tournamentId={id} />)}
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

function MatchupCard({ matchup, tournamentId }: { matchup: Matchup; tournamentId: string }) {
  const sortedPlayers = [...matchup.players].sort((a, b) => (b.kalshi?.implied_prob ?? 0) - (a.kalshi?.implied_prob ?? 0));
  const hasAnyBookData = matchup.players.some((p) => p.book_count > 0);
  const headerLabel: string = matchup.matchup_type === "h2h" ? "H2H"
    : matchup.matchup_type === "3ball" ? "3-Ball"
    : "5-Ball";
  const typeBg = matchup.matchup_type === "h2h" ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
    : matchup.matchup_type === "3ball" ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
    : "bg-pink-500/15 text-pink-300 border-pink-500/30";

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-2 bg-neutral-900/80 border-b border-neutral-800 flex items-start justify-between gap-2">
        <div className="text-xs text-neutral-400 leading-tight flex-1 min-w-0">{matchup.title}</div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${typeBg}`}>{headerLabel}</span>
          {matchup.round_number != null && (
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">R{matchup.round_number}</span>
          )}
          {!hasAnyBookData && (
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-amber-500/10 text-amber-400/80 border border-amber-500/20" title="DataGolf doesn't publish odds for this matchup">Kalshi only</span>
          )}
        </div>
      </div>

      {/* Player legs */}
      <div className="divide-y divide-neutral-800/60">
        {sortedPlayers.map((p) => {
          const edge = p.edge_vs_books_median;
          const kalshiP = p.kalshi?.implied_prob;
          const hasBooks = p.book_count > 0;
          return (
            <div key={p.matchup_player_id} className={`px-4 py-2.5 ${edgeBg(edge)}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <Link
                  href={`/player/?id=${p.player_id}&tournament_id=${tournamentId}`}
                  className="text-sm font-semibold text-neutral-100 hover:text-green-400 hover:underline truncate"
                >
                  {p.player?.name}
                </Link>
                {edge != null && (
                  <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${edgeColor(edge)}`}>{fmtPctSigned(edge)}</span>
                )}
              </div>
              {hasBooks ? (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <ProbBlock label="Kalshi" value={fmtPct(kalshiP)} tone="kalshi" />
                  <ProbBlock label={`Books med (${p.book_count})`} value={fmtPct(p.books_median)} tone="book" />
                  <ProbBlock label="Best book" value={fmtPct(p.books_min)} tone="book" />
                </div>
              ) : (
                // Kalshi-only: clean single-line layout with prob + barProgress
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500/60 rounded-full"
                      style={{ width: `${Math.max(0, Math.min(100, (kalshiP ?? 0) * 100))}%` }}
                    />
                  </div>
                  <span className="text-sm tabular-nums text-amber-300 font-medium">{fmtPct(kalshiP)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProbBlock({ label, value, tone }: { label: string; value: string; tone: "kalshi" | "book" }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`tabular-nums font-medium ${tone === "kalshi" ? "text-amber-300" : "text-neutral-200"}`}>{value}</div>
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
