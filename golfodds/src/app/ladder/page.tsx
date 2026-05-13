"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import TournamentNav from "@/components/TournamentNav";
import { fmtPct, fmtPctSigned, edgeColor, MARKET_LABELS } from "@/lib/format";

interface MarketEntry {
  kalshi_p: number | null;
  dg_p: number | null;
  books_median_p: number | null;
}

interface LadderRow {
  player_id: string;
  player: { id: string; name: string; dg_id: number | null };
  markets: Record<string, MarketEntry>;
  issues: { source: string; kind: string; delta: number }[];
  has_kalshi_data: boolean;
}

const TYPES = ["win", "t5", "t10", "t20", "mc"];

const SOURCE_LABEL: Record<string, string> = {
  kalshi_p: "Kalshi",
  dg_p: "DG model",
  books_median_p: "Books median",
};

function LadderInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const [rows, setRows] = useState<LadderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [onlyKalshi, setOnlyKalshi] = useState(false);
  const [tournament, setTournament] = useState<{ name: string; kalshi_event_ticker: string | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/golfodds/tournament-info?id=${id}`)
      .then((r) => r.json())
      .then((d) => setTournament(d.tournament))
      .catch(() => {});
    fetch(`/api/golfodds/ladder?tournament_id=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => setRows(d.players || []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const filtered = useMemo(() => {
    let xs = rows;
    if (filter) xs = xs.filter((r) => r.player?.name.toLowerCase().includes(filter.toLowerCase()));
    if (onlyIssues) xs = xs.filter((r) => r.issues.length > 0);
    if (onlyKalshi) xs = xs.filter((r) => r.has_kalshi_data);
    return xs;
  }, [rows, filter, onlyIssues, onlyKalshi]);

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

  return (
    <div className="min-h-screen">
      <NavBar />
      <TournamentNav tournamentId={id} activeView="ladder" />
      <main className="max-w-[1800px] mx-auto px-6 py-6">

        <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
          <input
            type="text"
            placeholder="Filter player..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-neutral-200 placeholder-neutral-600 text-sm w-56"
          />
          <label className="flex items-center gap-2 text-neutral-400">
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} className="accent-rose-500" />
            Only show inconsistencies
          </label>
          <label className="flex items-center gap-2 text-neutral-400">
            <input type="checkbox" checked={onlyKalshi} onChange={(e) => setOnlyKalshi(e.target.checked)} className="accent-amber-500" />
            Only with Kalshi data
          </label>
          <div className="ml-auto text-xs text-neutral-500">
            {filtered.length} of {rows.length} players
          </div>
        </div>

        {loading && <div className="text-neutral-400 text-sm">Loading…</div>}
        {error && <div className="text-rose-400 text-sm">{error}</div>}

        {!loading && !error && (
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 sticky top-0">
                <tr>
                  <th rowSpan={2} className="px-2 py-2 text-left text-xs uppercase tracking-wide text-neutral-400 border-r border-neutral-800">Player</th>
                  {TYPES.map((mt) => (
                    <th key={mt} colSpan={3} className="px-2 py-1 text-center text-xs uppercase tracking-wide text-neutral-300 border-r border-neutral-800">
                      {MARKET_LABELS[mt]}
                    </th>
                  ))}
                  <th rowSpan={2} className="px-2 py-2 text-right text-xs uppercase tracking-wide text-neutral-400">Issues</th>
                </tr>
                <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                  {TYPES.map((mt) => (
                    <>
                      <th key={`${mt}-k`} className="px-1 py-1 text-right text-amber-400">K</th>
                      <th key={`${mt}-d`} className="px-1 py-1 text-right text-sky-400">DG</th>
                      <th key={`${mt}-b`} className="px-1 py-1 text-right text-neutral-400 border-r border-neutral-800">Bk</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.player_id} className="border-t border-neutral-800/60 hover:bg-neutral-900/40">
                    <td className="px-2 py-1.5 text-neutral-100 border-r border-neutral-800/60 whitespace-nowrap">
                      {r.player?.name}
                      {r.has_kalshi_data && <span className="ml-2 text-[10px] text-amber-400/70">●K</span>}
                    </td>
                    {TYPES.map((mt) => {
                      const e = r.markets[mt];
                      return (
                        <>
                          <td key={`${r.player_id}-${mt}-k`} className="px-1 py-1.5 text-right tabular-nums text-amber-300">
                            {fmtPct(e?.kalshi_p, 2)}
                          </td>
                          <td key={`${r.player_id}-${mt}-d`} className="px-1 py-1.5 text-right tabular-nums text-sky-300">
                            {fmtPct(e?.dg_p, 2)}
                          </td>
                          <td key={`${r.player_id}-${mt}-b`} className="px-1 py-1.5 text-right tabular-nums text-neutral-400 border-r border-neutral-800/60">
                            {fmtPct(e?.books_median_p, 2)}
                          </td>
                        </>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right text-xs">
                      {r.issues.length === 0 ? (
                        <span className="text-neutral-700">—</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          {r.issues.map((iss, i) => (
                            <span key={i} className={`${edgeColor(-iss.delta)} text-[10px]`}>
                              {SOURCE_LABEL[iss.source] || iss.source}: {iss.kind} ({fmtPctSigned(-iss.delta, 2)})
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={17} className="px-2 py-8 text-center text-neutral-500">No matches.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 text-xs text-neutral-500 space-y-1">
          <p>
            Each cell shows implied probability per source (<span className="text-amber-400">K</span>alshi, <span className="text-sky-400">DG</span> model, <span className="text-neutral-300">Bk</span>=book median) per market type.
            A coherent set has Win ≤ T5 ≤ T10 ≤ T20 — any violation means the source is mispricing one tier relative to another and is flagged in the Issues column.
            Kalshi T5/T10/T20 are inconsistent outside majors, so most issues will fire on DG / book data right now.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LadderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen"><NavBar /><div className="p-8 text-neutral-400">Loading…</div></div>}>
      <LadderInner />
    </Suspense>
  );
}
