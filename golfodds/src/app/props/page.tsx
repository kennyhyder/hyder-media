"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import TournamentNav from "@/components/TournamentNav";
import { fmtPct, PROP_LABELS } from "@/lib/format";

interface Outcome {
  id: string;
  label: string;
  key: string;
  display_order: number;
  kalshi_ticker: string | null;
  kalshi: { yes_bid: number | null; yes_ask: number | null; last_price: number | null; implied_prob: number | null } | null;
}

interface Prop {
  id: string;
  prop_type: string;
  question: string;
  outcome_kind: "mutually_exclusive" | "cumulative_threshold";
  kalshi_event_ticker: string | null;
  outcomes: Outcome[];
  sum_implied: number;
}

function PropsInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const [props, setProps] = useState<Prop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/golfodds/props?tournament_id=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => setProps(d.props || []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

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
      <TournamentNav tournamentId={id} activeView="props" />
      <main className="max-w-[1800px] mx-auto px-6 py-6">
        {loading && <div className="text-neutral-400 text-sm">Loading props…</div>}
        {error && <div className="text-rose-400 text-sm">{error}</div>}

        {!loading && !error && props.length === 0 && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-8 text-center text-neutral-400">
            No multi-outcome props posted yet for this tournament.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {props.map((p) => <PropCard key={p.id} prop={p} />)}
        </div>

        <div className="mt-4 text-xs text-neutral-500 space-y-1">
          <p>
            Multi-outcome props are Kalshi-only — DataGolf doesn&apos;t publish odds for winning score, margin, region, or hole-in-one totals.
            For mutually exclusive props (winning score, margin, region) the implied probabilities should sum to ~1.00 — anything materially over is Kalshi&apos;s overround.
            Hole-in-One thresholds are cumulative (1+ includes 2+ includes 3+), so probabilities decrease as the threshold rises.
          </p>
        </div>
      </main>
    </div>
  );
}

function PropCard({ prop }: { prop: Prop }) {
  // Sort outcomes by implied prob desc for "what's most likely" reading
  const sorted = [...prop.outcomes].sort((a, b) => (b.kalshi?.implied_prob ?? 0) - (a.kalshi?.implied_prob ?? 0));
  const maxProb = Math.max(...sorted.map((o) => o.kalshi?.implied_prob ?? 0), 0.01);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800">
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-0.5">{PROP_LABELS[prop.prop_type] || prop.prop_type}</div>
        <div className="text-sm text-neutral-200">{prop.question}</div>
        <div className="flex items-center gap-3 mt-1 text-[10px]">
          <span className={`uppercase tracking-wide px-1.5 py-0.5 rounded ${
            prop.outcome_kind === "mutually_exclusive"
              ? "bg-sky-500/15 text-sky-300"
              : "bg-purple-500/15 text-purple-300"
          }`}>
            {prop.outcome_kind === "mutually_exclusive" ? "Pick one" : "Cumulative"}
          </span>
          <span className="text-neutral-500 tabular-nums">
            Sum: <span className={prop.sum_implied > 1.1 ? "text-amber-400" : prop.sum_implied < 0.9 ? "text-rose-400" : "text-neutral-300"}>{fmtPct(prop.sum_implied)}</span>
          </span>
        </div>
      </div>
      <div className="divide-y divide-neutral-800/60">
        {sorted.map((o) => (
          <div key={o.id} className="px-4 py-2">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-sm text-neutral-100">{o.label}</span>
              <span className="text-sm font-semibold tabular-nums text-amber-300">{fmtPct(o.kalshi?.implied_prob)}</span>
            </div>
            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500/60 rounded-full"
                style={{ width: `${Math.max(0, Math.min(100, ((o.kalshi?.implied_prob ?? 0) / maxProb) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PropsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen"><NavBar /><div className="p-8 text-neutral-400">Loading…</div></div>}>
      <PropsInner />
    </Suspense>
  );
}
