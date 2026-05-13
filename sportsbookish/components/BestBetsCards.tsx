"use client";

import Link from "next/link";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel, MARKET_LABELS } from "@/lib/format";

interface PlayerRow {
  player_id: string;
  player: { id: string; name: string };
  kalshi: { implied_prob: number | null } | null;
  datagolf: { dg_prob: number | null } | null;
  books_median: number | null;
  book_count: number;
  best_book_for_bet: { book: string; novig_prob: number; price_american: number | null } | null;
  edge_vs_books_median: number | null;
  // Computed client-side based on user prefs (home_book / excluded_books)
  user_edge?: number | null;
}

interface Props {
  players: PlayerRow[];
  marketType: string;
  tournamentId: string;
  isPaidTier: boolean;
  edgeField?: "edge_vs_books_median" | "user_edge";
  minBooks?: number;
  minEdge?: number;
}

function topByEdge(players: PlayerRow[], n: number, direction: "buy" | "sell", edgeField: keyof PlayerRow, minBooks: number, minEdge: number) {
  const rows = players
    .filter((r) => {
      const e = (r[edgeField] as number | null | undefined) ?? null;
      return (
        r.kalshi?.implied_prob != null &&
        r.kalshi.implied_prob > 0.001 &&
        e != null &&
        r.book_count >= minBooks &&
        Math.abs(e) >= minEdge
      );
    })
    .slice();
  rows.sort((a, b) => {
    const av = (a[edgeField] as number) ?? -Infinity;
    const bv = (b[edgeField] as number) ?? -Infinity;
    return direction === "buy" ? bv - av : av - bv;
  });
  if (direction === "buy") return rows.filter((r) => ((r[edgeField] as number) ?? 0) > 0).slice(0, n);
  return rows.filter((r) => ((r[edgeField] as number) ?? 0) < 0).slice(0, n);
}

function Card({ row, direction, tournamentId, edgeField, isPaidTier }: { row: PlayerRow; direction: "buy" | "sell"; tournamentId: string; edgeField: keyof PlayerRow; isPaidTier: boolean }) {
  const edge = (row[edgeField] as number | null | undefined) ?? null;
  const isBuy = direction === "buy";
  const ringCls = isBuy ? "ring-emerald-500/30" : "ring-rose-500/30";
  const badgeBg = isBuy ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-rose-500/15 text-rose-300 border-rose-500/30";
  const labelCls = isBuy ? "text-emerald-400" : "text-rose-400";
  const PlayerName = isPaidTier ? (
    <Link href={`/golf/tournament/player?id=${tournamentId}&player_id=${row.player_id}`} className="text-sm font-semibold text-neutral-100 hover:text-emerald-400 hover:underline truncate" title={row.player?.name}>
      {row.player?.name}
    </Link>
  ) : (
    <div className="text-sm font-semibold text-neutral-100 truncate" title={row.player?.name}>{row.player?.name}</div>
  );

  return (
    <div className={`bg-neutral-900 border border-neutral-800 rounded-lg p-3 ring-1 ${ringCls}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        {PlayerName}
        <div className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded border ${badgeBg}`}>
          {isBuy ? "BUY" : "SELL"}
        </div>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${labelCls}`}>{fmtPctSigned(edge)}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-2">
        edge vs reference ({row.book_count}{` book${row.book_count === 1 ? "" : "s"}`})
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        <div className="text-neutral-500">Kalshi</div>
        <div className="text-right tabular-nums text-amber-300">{fmtPct(row.kalshi?.implied_prob)}</div>
        <div className="text-neutral-500">Books med</div>
        <div className="text-right tabular-nums text-neutral-300">{fmtPct(row.books_median)}</div>
        <div className="text-neutral-500">DG model</div>
        <div className="text-right tabular-nums text-sky-300">{fmtPct(row.datagolf?.dg_prob)}</div>
      </div>
      {row.best_book_for_bet && (
        <div className="mt-2 pt-2 border-t border-neutral-800 text-[11px] text-neutral-400">
          {isBuy ? "Cheapest book: " : "Best alt: "}
          <span className="text-neutral-200">{bookLabel(row.best_book_for_bet.book)}</span>{" "}
          <span className="tabular-nums text-neutral-300">{fmtAmerican(row.best_book_for_bet.price_american)}</span>
        </div>
      )}
    </div>
  );
}

export default function BestBetsCards({ players, marketType, tournamentId, isPaidTier, edgeField = "edge_vs_books_median", minBooks = 3, minEdge = 0.002 }: Props) {
  const buys = topByEdge(players, 5, "buy", edgeField, minBooks, minEdge);
  const sells = topByEdge(players, 3, "sell", edgeField, minBooks, minEdge);
  const label = MARKET_LABELS[marketType] || marketType;

  if (buys.length === 0 && sells.length === 0) {
    return (
      <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-4 mb-5 text-sm text-neutral-500">
        No actionable mispricings on the {label} market right now — Kalshi and books are within 0.2% across the field
        {minBooks > 1 ? ` (filtered to markets with ${minBooks}+ books)` : ""}.
      </div>
    );
  }

  return (
    <div className="mb-5 space-y-3">
      {buys.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-sm font-semibold text-emerald-400">★ Top buy opportunities</span>
            <span className="text-xs text-neutral-500">Kalshi cheaper than fair — buy YES</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {buys.map((r) => <Card key={r.player_id} row={r} direction="buy" tournamentId={tournamentId} edgeField={edgeField} isPaidTier={isPaidTier} />)}
          </div>
        </div>
      )}
      {sells.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-sm font-semibold text-rose-400">▼ Most overpriced on Kalshi</span>
            <span className="text-xs text-neutral-500">Sell YES on Kalshi, or bet at the books instead</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {sells.map((r) => <Card key={r.player_id} row={r} direction="sell" tournamentId={tournamentId} edgeField={edgeField} isPaidTier={isPaidTier} />)}
          </div>
        </div>
      )}
    </div>
  );
}
