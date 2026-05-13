"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { fmtPct, fmtPctSigned, edgeColor, edgeBg, MARKET_LABELS, MARKET_GROUPS } from "@/lib/format";

interface MarketRow {
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

interface MatchupLeg {
  matchup_player_id: string;
  player_id: string;
  player: { id: string; name: string; dg_id: number | null } | null;
  is_self: boolean;
  kalshi: { implied_prob: number | null } | null;
  books_median: number | null;
  book_count: number;
  edge_vs_books_median: number | null;
}

interface MatchupRow {
  matchup_id: string;
  matchup_type: "h2h" | "3ball" | "5ball";
  scope: string;
  round_number: number | null;
  title: string | null;
  legs: MatchupLeg[];
}

interface PlayerData {
  player: { id: string; name: string; dg_id: number | null; owgr_rank: number | null; country: string | null };
  tournament: { id: string; name: string; kalshi_event_ticker: string | null; is_major: boolean; start_date: string | null };
  markets: MarketRow[];
  matchups: MatchupRow[];
}

function PlayerInner() {
  const params = useSearchParams();
  const playerId = params.get("id");
  const tournamentId = params.get("tournament_id");
  const [data, setData] = useState<PlayerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId || !tournamentId) return;
    setLoading(true);
    fetch(`/api/golfodds/player?player_id=${playerId}&tournament_id=${tournamentId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [playerId, tournamentId]);

  if (!playerId || !tournamentId) {
    return (
      <div className="min-h-screen">
        <NavBar />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <p className="text-neutral-400">Missing player_id or tournament_id. <Link href="/" className="text-green-400 hover:underline">Go back →</Link></p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="mb-4">
          <Link href={`/tournament/?id=${tournamentId}`} className="text-neutral-500 hover:text-neutral-300 text-sm">
            ← {data?.tournament?.name || "Tournament"}
          </Link>
        </div>

        {loading && <div className="text-neutral-400 text-sm">Loading player data…</div>}
        {error && <div className="text-rose-400 text-sm">{error}</div>}

        {data && (
          <>
            {/* Player header */}
            <header className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 mb-6">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold text-neutral-100">{data.player.name}</h1>
                {data.player.country && (
                  <span className="text-sm text-neutral-500">{data.player.country}</span>
                )}
                {data.player.dg_id != null && (
                  <span className="text-[10px] text-neutral-600 font-mono">DG #{data.player.dg_id}</span>
                )}
                {data.player.owgr_rank != null && (
                  <span className="text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded">OWGR #{data.player.owgr_rank}</span>
                )}
                <span className="text-xs text-neutral-500 ml-auto">at {data.tournament.name}</span>
              </div>
            </header>

            {/* Markets grouped by category */}
            {MARKET_GROUPS.map((group) => {
              const groupRows = data.markets
                .filter((m) => group.types.includes(m.market_type))
                .sort((a, b) => group.types.indexOf(a.market_type) - group.types.indexOf(b.market_type));
              if (groupRows.length === 0) return null;
              return (
                <section key={group.label} className="mb-6">
                  <h2 className="text-sm uppercase tracking-wide text-neutral-400 mb-2">{group.label}</h2>
                  <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-900 border-b border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Market</th>
                          <th className="px-3 py-2 text-right text-amber-400">Kalshi</th>
                          <th className="px-3 py-2 text-right text-sky-400">DG model</th>
                          <th className="px-3 py-2 text-right">Books med</th>
                          <th className="px-3 py-2 text-right">Best book</th>
                          <th className="px-3 py-2 text-right">Buy edge vs med</th>
                          <th className="px-3 py-2 text-right">vs DG</th>
                          <th className="px-3 py-2 text-right">vs best book</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800/60">
                        {groupRows.map((r) => (
                          <tr key={r.market_id} className="hover:bg-neutral-900/40">
                            <td className="px-3 py-2 text-neutral-200">{MARKET_LABELS[r.market_type] || r.market_type}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-amber-300">{fmtPct(r.kalshi?.implied_prob)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-sky-300">{fmtPct(r.datagolf?.dg_prob)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{fmtPct(r.books_median)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{fmtPct(r.books_min)}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${edgeColor(r.edge_vs_books_median)} ${edgeBg(r.edge_vs_books_median)}`}>{fmtPctSigned(r.edge_vs_books_median)}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${edgeColor(r.edge_vs_dg)}`}>{fmtPctSigned(r.edge_vs_dg)}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${edgeColor(r.edge_vs_best_book)}`}>{fmtPctSigned(r.edge_vs_best_book)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}

            {/* Matchups the player is in */}
            {data.matchups.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm uppercase tracking-wide text-neutral-400 mb-2">
                  Matchups ({data.matchups.length})
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {data.matchups.map((m) => (
                    <div key={m.matchup_id} className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
                      <div className="px-4 py-2 border-b border-neutral-800 flex items-center justify-between gap-2">
                        <div className="text-xs text-neutral-400 truncate">{m.title}</div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${
                            m.matchup_type === "h2h" ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
                            : "bg-purple-500/15 text-purple-300 border-purple-500/30"
                          }`}>{m.matchup_type === "h2h" ? "H2H" : "3-Ball"}</span>
                          {m.round_number != null && (
                            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">R{m.round_number}</span>
                          )}
                        </div>
                      </div>
                      <div className="divide-y divide-neutral-800/60">
                        {m.legs.map((leg) => (
                          <div key={leg.matchup_player_id} className={`px-4 py-2 ${edgeBg(leg.edge_vs_books_median)} ${leg.is_self ? "bg-green-500/5 ring-1 ring-green-500/20" : ""}`}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className={`text-sm ${leg.is_self ? "font-semibold text-green-300" : "text-neutral-200"}`}>
                                {leg.is_self ? "→ " : ""}{leg.player?.name}
                              </span>
                              {leg.edge_vs_books_median != null && (
                                <span className={`text-xs tabular-nums ${edgeColor(leg.edge_vs_books_median)}`}>{fmtPctSigned(leg.edge_vs_books_median)}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                              <span className="text-amber-300 tabular-nums">K {fmtPct(leg.kalshi?.implied_prob)}</span>
                              {leg.book_count > 0 && (
                                <span className="text-neutral-400 tabular-nums">Books {fmtPct(leg.books_median)} ({leg.book_count})</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data.markets.length === 0 && data.matchups.length === 0 && (
              <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-8 text-center text-neutral-400">
                No markets found for this player at this tournament.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen"><NavBar /><div className="p-8 text-neutral-400">Loading…</div></div>}>
      <PlayerInner />
    </Suspense>
  );
}
