"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { fmtPct, fmtPctSigned, edgeColor, edgeBg, MARKET_LABELS } from "@/lib/format";

interface Alert {
  id: string;
  tournament_id: string;
  player_id: string;
  market_id: string | null;
  market_type: string;
  direction: "buy" | "sell";
  edge_value: number;
  kalshi_prob: number;
  reference_prob: number;
  reference_source: string;
  book_count: number;
  fired_at: string;
  notified_at: string | null;
  golfodds_players: { name: string } | null;
  golfodds_tournaments: { name: string; kalshi_event_ticker: string | null } | null;
}

interface CronRun {
  job_name: string;
  started_at: string;
  finished_at: string | null;
  rows_inserted: number | null;
  errors: number | null;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");
  const [sinceHours, setSinceHours] = useState(24);

  useEffect(() => {
    setLoading(true);
    const url = `/api/golfodds/alerts?since_hours=${sinceHours}&limit=200`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => {
        setAlerts(d.alerts || []);
        setRuns(d.cron_runs || []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [sinceHours]);

  const filtered = useMemo(() => {
    let xs = alerts;
    if (filter !== "all") xs = xs.filter((a) => a.direction === filter);
    return xs;
  }, [alerts, filter]);

  const lastRun = runs[0];
  const lastSuccessByJob = useMemo(() => {
    const m: Record<string, CronRun | undefined> = {};
    for (const r of runs) {
      if (!m[r.job_name] && r.finished_at) m[r.job_name] = r;
    }
    return m;
  }, [runs]);

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        <header className="mb-5 flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-green-400">⚡ Live Edge Alerts</h1>
          <span className="text-xs text-neutral-500">{filtered.length} in last {sinceHours}h</span>
          {lastRun && (
            <span className="text-xs text-neutral-500 ml-auto">
              Last detector run: <span className="text-neutral-300">{timeAgo(lastRun.started_at)}</span>
            </span>
          )}
        </header>

        {/* Cron run health */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          {[
            { job: "cron-ingest-kalshi", label: "Kalshi", icon: "🔄" },
            { job: "cron-ingest-datagolf", label: "DataGolf", icon: "📊" },
            { job: "cron-detect-alerts", label: "Detector", icon: "⚡" },
          ].map(({ job, label, icon }) => {
            const r = lastSuccessByJob[job];
            return (
              <div key={job} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs text-neutral-400 mb-1">
                  <span>{icon}</span>
                  <span>{label} cron</span>
                </div>
                {r ? (
                  <>
                    <div className="text-sm text-neutral-200">
                      Last success: <span className="text-neutral-100">{timeAgo(r.started_at)}</span>
                    </div>
                    <div className="text-xs text-neutral-500">
                      {r.rows_inserted ?? 0} rows · {r.errors ?? 0} errors
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-amber-300">No successful run yet</div>
                )}
              </div>
            );
          })}
        </section>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
          <div className="flex items-center gap-1">
            {(["all", "buy", "sell"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setFilter(d)}
                className={[
                  "px-3 py-1 text-xs rounded transition",
                  filter === d
                    ? d === "buy"
                      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                      : d === "sell"
                        ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40"
                        : "bg-green-500/20 text-green-300 ring-1 ring-green-500/40"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/70",
                ].join(" ")}
              >
                {d === "all" ? "All" : d === "buy" ? "🟢 Buys" : "🔴 Sells"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-neutral-400">
            Since:
            <select
              value={sinceHours}
              onChange={(e) => setSinceHours(Number(e.target.value))}
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 text-xs"
            >
              <option value={1}>1h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
              <option value={72}>3d</option>
              <option value={168}>7d</option>
            </select>
          </label>
        </div>

        {loading && <div className="text-neutral-400 text-sm">Loading…</div>}
        {error && <div className="text-rose-400 text-sm">{error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-8 text-center text-neutral-400">
            No alerts in the selected window. The detector runs every 5 min; it&apos;ll fire when Kalshi crosses ±3-5% vs the book median on any market with 3+ books quoting.
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 border-b border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Player</th>
                  <th className="px-3 py-2 text-left">Market</th>
                  <th className="px-3 py-2 text-left">Tournament</th>
                  <th className="px-3 py-2 text-center">Direction</th>
                  <th className="px-3 py-2 text-right">Edge</th>
                  <th className="px-3 py-2 text-right text-amber-400">Kalshi</th>
                  <th className="px-3 py-2 text-right">Books med</th>
                  <th className="px-3 py-2 text-right">Books</th>
                  <th className="px-3 py-2 text-center">Notified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {filtered.map((a) => {
                  const url = `/player/?id=${a.player_id}&tournament_id=${a.tournament_id}`;
                  return (
                    <tr key={a.id} className={`hover:bg-neutral-900/40 ${edgeBg(a.direction === "buy" ? a.edge_value : -Math.abs(a.edge_value))}`}>
                      <td className="px-3 py-2 text-xs text-neutral-400 whitespace-nowrap">{timeAgo(a.fired_at)}</td>
                      <td className="px-3 py-2">
                        <Link href={url} className="text-neutral-100 hover:text-green-400 hover:underline">
                          {a.golfodds_players?.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{MARKET_LABELS[a.market_type] || a.market_type}</td>
                      <td className="px-3 py-2 text-xs text-neutral-500">{a.golfodds_tournaments?.name}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${
                          a.direction === "buy" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                        }`}>{a.direction}</span>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${edgeColor(a.direction === "buy" ? a.edge_value : -Math.abs(a.edge_value))}`}>
                        {fmtPctSigned(a.edge_value)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-300">{fmtPct(a.kalshi_prob)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{fmtPct(a.reference_prob)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-500 text-xs">{a.book_count}</td>
                      <td className="px-3 py-2 text-center text-xs">
                        {a.notified_at ? <span className="text-emerald-400">✓</span> : <span className="text-neutral-700">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-xs text-neutral-500 space-y-1">
          <p>
            Buy alerts fire when Kalshi is ≥3% <em>cheaper</em> than book median (positive edge → good buy).
            Sell alerts fire when Kalshi is ≥5% <em>more expensive</em> (Kalshi overpriced → sell, or bet at books).
            Same (player, market, direction) won&apos;t refire within 30 min.
            Minimum 3 books quoting required for reliability.
          </p>
        </div>
      </main>
    </div>
  );
}
