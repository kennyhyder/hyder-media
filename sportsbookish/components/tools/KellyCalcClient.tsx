"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";

function americanToDecimal(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function KellyCalcClient() {
  const [probabilityPct, setProbabilityPct] = useState<string>("55");
  const [oddsAmerican, setOddsAmerican] = useState<string>("-110");
  const [bankroll, setBankroll] = useState<string>("10000");

  const result = useMemo(() => {
    const p = parseFloat(probabilityPct) / 100;
    const american = parseFloat(oddsAmerican);
    const br = parseFloat(bankroll);
    if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
    const decimal = americanToDecimal(american);
    if (decimal == null) return null;
    if (!Number.isFinite(br) || br <= 0) return null;

    const b = decimal - 1;
    const q = 1 - p;
    const fStar = (b * p - q) / b;
    const fairProb = 1 / decimal;
    const edgePct = (p - fairProb) * 100;

    return {
      fStar,
      edgePct,
      fairProb,
      full: { fraction: fStar, stake: Math.max(0, fStar) * br },
      half: { fraction: fStar / 2, stake: Math.max(0, fStar / 2) * br },
      quarter: { fraction: fStar / 4, stake: Math.max(0, fStar / 4) * br },
    };
  }, [probabilityPct, oddsAmerican, bankroll]);

  return (
    <Card className="border-emerald-500/30">
      <CardContent className="p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Your true probability</span>
            <div className="relative mt-1">
              <input
                type="text"
                inputMode="decimal"
                value={probabilityPct}
                onChange={(e) => setProbabilityPct(e.target.value)}
                className="w-full rounded border border-border bg-background pl-3 pr-8 py-2 text-2xl font-mono tabular-nums focus:border-emerald-500 focus:outline-none"
                placeholder="55"
              />
              <span className="absolute right-3 top-2 text-2xl font-mono text-muted-foreground">%</span>
            </div>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">American odds</span>
            <input
              type="text"
              inputMode="numeric"
              value={oddsAmerican}
              onChange={(e) => setOddsAmerican(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-2xl font-mono tabular-nums focus:border-emerald-500 focus:outline-none"
              placeholder="-110"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Bankroll</span>
            <div className="relative mt-1">
              <span className="absolute left-3 top-2 text-2xl font-mono text-muted-foreground">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={bankroll}
                onChange={(e) => setBankroll(e.target.value)}
                className="w-full rounded border border-border bg-background pl-8 pr-3 py-2 text-2xl font-mono tabular-nums focus:border-emerald-500 focus:outline-none"
                placeholder="10000"
              />
            </div>
          </label>
        </div>

        {result ? (
          <div className="space-y-4 pt-2 border-t border-border/40">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Fair (no-vig) prob:</span>{" "}
                <span className="font-mono tabular-nums">{(result.fairProb * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Edge:</span>{" "}
                <span className={`font-mono tabular-nums font-semibold ${result.edgePct > 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  {result.edgePct > 0 ? "+" : ""}{result.edgePct.toFixed(2)}pp
                </span>
              </div>
            </div>

            {result.fStar <= 0 ? (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 text-sm">
                <span className="font-semibold text-rose-500">No edge — don&apos;t bet.</span>
                <span className="text-muted-foreground ml-2">
                  Your estimated probability is at or below the price&apos;s fair odds. Kelly recommends staying out.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <KellyResult title="Quarter Kelly" subtitle="Conservative" data={result.quarter} highlighted />
                <KellyResult title="Half Kelly" subtitle="Balanced" data={result.half} />
                <KellyResult title="Full Kelly" subtitle="Aggressive — high variance" data={result.full} />
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Quarter Kelly is the most-recommended sizing in professional sports betting because it preserves most of the long-run growth while keeping drawdowns manageable. Full Kelly is the mathematically optimal answer if you knew <em>p</em> exactly — but you never do.
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Enter a probability between 0 and 100%, valid American odds, and a positive bankroll.</div>
        )}
      </CardContent>
    </Card>
  );
}

function KellyResult({ title, subtitle, data, highlighted }: { title: string; subtitle: string; data: { fraction: number; stake: number }; highlighted?: boolean }) {
  const cls = highlighted ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-card/50";
  return (
    <div className={`rounded-lg border ${cls} p-4`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      <div className="text-[10px] text-muted-foreground mb-2">{subtitle}</div>
      <div className="text-2xl font-mono font-bold tabular-nums">{(data.fraction * 100).toFixed(2)}%</div>
      <div className="text-sm tabular-nums mt-1">{fmtMoney(data.stake)}</div>
    </div>
  );
}
