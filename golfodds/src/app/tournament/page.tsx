"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import MarketTabs from "@/components/MarketTabs";
import { fmtPct, fmtPctSigned, fmtAmerican, edgeColor, edgeBg, bookLabel, MARKET_LABELS } from "@/lib/format";

interface PlayerRow {
  player_id: string;
  player: { id: string; name: string; dg_id: number | null; owgr_rank: number | null };
  market_type: string;
  kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null; last_price: number | null } | null;
  datagolf: { dg_prob: number | null; dg_fit_prob: number | null } | null;
  book_prices: Record<string, { american: number | null; decimal: number | null; implied: number | null; novig: number | null }>;
  book_count: number;
  books_median: number | null;
  books_min: number | null;
  books_max: number | null;
  best_book_for_bet: { book: string; novig_prob: number; price_american: number | null } | null;
  edge_vs_books_median: number | null;
  edge_vs_best_book: number | null;
  edge_vs_dg: number | null;
}

interface TournamentInfo {
  tournament: { id: string; name: string; start_date: string | null; end_date: string | null; is_major: boolean; kalshi_event_ticker: string | null };
  stats: {
    total_markets: number;
    unique_players: number;
    markets_by_type: Record<string, number>;
    kalshi_markets_by_type: Record<string, number>;
    kalshi_quote_count: number;
    dg_quote_count: number;
    book_quote_count: number;
  };
  books: string[];
}

type SortKey =
  | "name"
  | "kalshi"
  | "dg"
  | "books_med"
  | "edge_books"
  | "edge_dg"
  | "edge_best";

function TournamentInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const initialMt = params.get("mt") || "win";

  const [info, setInfo] = useState<TournamentInfo | null>(null);
  const [marketType, setMarketType] = useState(initialMt);
  const [comparison, setComparison] = useState<{ players: PlayerRow[]; books: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("kalshi");
  const [sortDesc, setSortDesc] = useState(true);
  const [onlyKalshi, setOnlyKalshi] = useState(false);
  const [minEdge, setMinEdge] = useState(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/golfodds/tournament-info?id=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetch(`/api/golfodds/comparison?tournament_id=${id}&market_type=${marketType}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setComparison)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id, marketType]);

  const sorted = useMemo(() => {
    if (!comparison) return [];
    let rows = [...comparison.players];
    if (onlyKalshi) rows = rows.filter((r) => r.kalshi?.implied_prob != null);
    if (minEdge > 0) rows = rows.filter((r) => Math.abs(r.edge_vs_books_median ?? 0) >= minEdge);

    const getKey = (r: PlayerRow): number | string | null => {
      switch (sortKey) {
        case "name": return r.player?.name || "";
        case "kalshi": return r.kalshi?.implied_prob ?? null;
        case "dg": return r.datagolf?.dg_prob ?? null;
        case "books_med": return r.books_median;
        case "edge_books": return r.edge_vs_books_median;
        case "edge_dg": return r.edge_vs_dg;
        case "edge_best": return r.edge_vs_best_book;
      }
    };
    rows.sort((a, b) => {
      const av = getKey(a);
      const bv = getKey(b);
      // null pushes to bottom regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    return rows;
  }, [comparison, sortKey, sortDesc, onlyKalshi, minEdge]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDesc((d) => !d);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const SortHeader = ({ k, children, align = "right" }: { k: SortKey; children: React.ReactNode; align?: "left" | "right" }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-2 py-2 cursor-pointer select-none text-xs uppercase tracking-wide text-neutral-400 hover:text-neutral-200 text-${align}`}
    >
      <span>{children}</span>
      {sortKey === k && <span className="ml-1">{sortDesc ? "↓" : "↑"}</span>}
    </th>
  );

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

  const books = comparison?.books || [];

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="max-w-[1800px] mx-auto px-6 py-6">
        <div className="mb-4 flex items-baseline gap-3 flex-wrap">
          <Link href="/" className="text-neutral-500 hover:text-neutral-300 text-sm">← Tournaments</Link>
          <h1 className="text-2xl font-bold text-neutral-100">{info?.tournament?.name || "…"}</h1>
          {info?.tournament?.is_major && (
            <span className="text-[10px] uppercase tracking-wide bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">Major</span>
          )}
          {info?.tournament?.kalshi_event_ticker && (
            <span className="text-xs text-neutral-500">{info.tournament.kalshi_event_ticker}</span>
          )}
          {id && (
            <Link
              href={`/ladder/?id=${id}`}
              className="ml-auto text-sm px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700"
            >Ladder view →</Link>
          )}
        </div>

        {info && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
            <Stat label="Players" value={String(info.stats.unique_players)} />
            <Stat label="Total markets" value={String(info.stats.total_markets)} />
            <Stat label="Kalshi quotes" value={String(info.stats.kalshi_quote_count)} tone="kalshi" />
            <Stat label="Book quotes" value={String(info.stats.book_quote_count)} />
            <Stat label="DG model rows" value={String(info.stats.dg_quote_count)} tone="dg" />
            <Stat label="Books tracked" value={String(info.books.length)} />
          </div>
        )}

        <MarketTabs
          active={marketType}
          available={info?.stats.markets_by_type}
          kalshiCounts={info?.stats.kalshi_markets_by_type}
          onSelect={setMarketType}
        />

        <div className="flex items-center gap-4 mb-3 text-sm">
          <label className="flex items-center gap-2 text-neutral-400">
            <input
              type="checkbox"
              checked={onlyKalshi}
              onChange={(e) => setOnlyKalshi(e.target.checked)}
              className="accent-green-500"
            />
            Only players with Kalshi price
          </label>
          <label className="flex items-center gap-2 text-neutral-400">
            Min |edge vs books|:
            <select
              value={minEdge}
              onChange={(e) => setMinEdge(Number(e.target.value))}
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 text-xs"
            >
              <option value={0}>0%</option>
              <option value={0.005}>0.5%</option>
              <option value={0.01}>1%</option>
              <option value={0.02}>2%</option>
              <option value={0.05}>5%</option>
            </select>
          </label>
          <div className="ml-auto text-xs text-neutral-500">
            Showing {sorted.length} of {comparison?.players.length ?? 0} • {books.length} books
          </div>
        </div>

        {loading && <div className="text-neutral-400 text-sm py-6">Loading {MARKET_LABELS[marketType]} market…</div>}
        {error && <div className="text-rose-400 text-sm py-6">{error}</div>}

        {!loading && !error && (
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 sticky top-0 z-10">
                <tr>
                  <SortHeader k="name" align="left">Player</SortHeader>
                  <SortHeader k="kalshi">Kalshi</SortHeader>
                  <SortHeader k="dg">DG model</SortHeader>
                  <SortHeader k="books_med">Books median</SortHeader>
                  <SortHeader k="edge_books">Edge vs med</SortHeader>
                  <SortHeader k="edge_dg">Edge vs DG</SortHeader>
                  <SortHeader k="edge_best">Edge vs best</SortHeader>
                  {books.map((b) => (
                    <th key={b} className="px-2 py-2 text-right text-xs uppercase tracking-wide text-neutral-500" title={bookLabel(b)}>
                      {bookLabel(b)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.player_id} className="border-t border-neutral-800/60 hover:bg-neutral-900/40">
                    <td className="px-2 py-1.5 text-neutral-100 whitespace-nowrap">
                      {r.player?.name}
                      {r.kalshi?.implied_prob != null && <span className="ml-2 text-[10px] text-amber-400/70">●K</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-amber-300">
                      {fmtPct(r.kalshi?.implied_prob)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-sky-300">
                      {fmtPct(r.datagolf?.dg_prob)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-neutral-300">
                      {fmtPct(r.books_median)}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${edgeColor(r.edge_vs_books_median)} ${edgeBg(r.edge_vs_books_median)}`}>
                      {fmtPctSigned(r.edge_vs_books_median)}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${edgeColor(r.edge_vs_dg)} ${edgeBg(r.edge_vs_dg)}`}>
                      {fmtPctSigned(r.edge_vs_dg)}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${edgeColor(r.edge_vs_best_book)} ${edgeBg(r.edge_vs_best_book)}`}>
                      {fmtPctSigned(r.edge_vs_best_book)}
                      {r.best_book_for_bet && (
                        <div className="text-[10px] text-neutral-500">
                          {bookLabel(r.best_book_for_bet.book)} {fmtAmerican(r.best_book_for_bet.price_american)}
                        </div>
                      )}
                    </td>
                    {books.map((b) => {
                      const px = r.book_prices[b];
                      return (
                        <td key={b} className="px-2 py-1.5 text-right tabular-nums text-neutral-400">
                          {px ? (
                            <span title={`american ${fmtAmerican(px.american)}, no-vig ${fmtPct(px.novig)}`}>
                              {fmtPct(px.novig)}
                            </span>
                          ) : (
                            <span className="text-neutral-700">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={books.length + 7} className="px-2 py-8 text-center text-neutral-500">
                      No data for this market type. {!onlyKalshi && "Kalshi T5/T10/T20 coverage is inconsistent outside majors — try the Win or Make Cut tab."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 text-xs text-neutral-500 space-y-1">
          <p>
            <span className="text-amber-300">Kalshi</span> = implied probability from bid/ask mid (or last trade if spread is wide).{" "}
            <span className="text-sky-300">DG model</span> = DataGolf baseline. <span className="text-neutral-300">Books</span> = de-vigged implied probability per book.
          </p>
          <p>
            Edge = Kalshi prob − reference. Positive edge means Kalshi is pricing the player higher than the reference; consider buying YES on the cheaper side or selling on Kalshi depending on direction.
          </p>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "kalshi" | "dg" }) {
  const cls = tone === "kalshi" ? "text-amber-300" : tone === "dg" ? "text-sky-300" : "text-neutral-100";
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

export default function TournamentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen"><NavBar /><div className="p-8 text-neutral-400">Loading…</div></div>}>
      <TournamentInner />
    </Suspense>
  );
}
