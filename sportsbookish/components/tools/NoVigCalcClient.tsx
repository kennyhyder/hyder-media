"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";

function americanToProb(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

function fmtPct(p: number | null): string {
  return p == null ? "—" : `${(p * 100).toFixed(2)}%`;
}

function fmtAmerican(p: number | null): string {
  if (p == null || p <= 0 || p >= 1) return "—";
  // Convert probability back to American odds
  const decimal = 1 / p;
  if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
  return `-${Math.round(100 / (decimal - 1))}`;
}

export default function NoVigCalcClient() {
  const [a, setA] = useState<string>("-110");
  const [b, setB] = useState<string>("-110");

  const result = useMemo(() => {
    const aN = parseFloat(a);
    const bN = parseFloat(b);
    const pA = americanToProb(aN);
    const pB = americanToProb(bN);
    if (pA == null || pB == null) return null;
    const sum = pA + pB;
    const vig = sum - 1;
    return {
      raw: { a: pA, b: pB, sum },
      vig,
      novig: { a: pA / sum, b: pB / sum },
      novigAmerican: { a: fmtAmerican(pA / sum), b: fmtAmerican(pB / sum) },
    };
  }, [a, b]);

  return (
    <Card className="border-emerald-500/30">
      <CardContent className="p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Side A (American odds)</span>
            <input
              type="text"
              inputMode="numeric"
              value={a}
              onChange={(e) => setA(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-2xl font-mono tabular-nums focus:border-emerald-500 focus:outline-none"
              placeholder="-110"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Side B (American odds)</span>
            <input
              type="text"
              inputMode="numeric"
              value={b}
              onChange={(e) => setB(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-2xl font-mono tabular-nums focus:border-emerald-500 focus:outline-none"
              placeholder="-110"
            />
          </label>
        </div>

        {result ? (
          <div className="space-y-4 pt-2 border-t border-border/40">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Raw implied probability (with vig)</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded bg-muted/40 px-3 py-2">
                  Side A <span className="font-mono tabular-nums float-right">{fmtPct(result.raw.a)}</span>
                </div>
                <div className="rounded bg-muted/40 px-3 py-2">
                  Side B <span className="font-mono tabular-nums float-right">{fmtPct(result.raw.b)}</span>
                </div>
                <div className="rounded bg-muted/40 px-3 py-2 col-span-2 text-muted-foreground">
                  Sum (total){" "}
                  <span className="font-mono tabular-nums float-right">
                    {fmtPct(result.raw.sum)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <span className="font-semibold text-amber-500">Vig:</span>{" "}
              <span className="font-mono tabular-nums">{(result.vig * 100).toFixed(2)}%</span>
              <span className="text-xs text-muted-foreground ml-2">
                (the book&apos;s margin — what you&apos;d need to overcome to break even)
              </span>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-emerald-500 mb-2">✓ No-vig probability (de-vigged)</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
                  <div className="text-xs text-muted-foreground">Side A</div>
                  <div className="text-2xl font-mono font-bold tabular-nums text-emerald-400">{fmtPct(result.novig.a)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Fair odds: <span className="font-mono">{result.novigAmerican.a}</span></div>
                </div>
                <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
                  <div className="text-xs text-muted-foreground">Side B</div>
                  <div className="text-2xl font-mono font-bold tabular-nums text-emerald-400">{fmtPct(result.novig.b)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Fair odds: <span className="font-mono">{result.novigAmerican.b}</span></div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Enter valid American odds for both sides (e.g. -110, +200, -150).</div>
        )}
      </CardContent>
    </Card>
  );
}
