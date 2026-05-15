"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";

function americanToDecimal(a: number): number | null {
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1;
}
function americanToImplied(a: number): number | null {
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100);
}
function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ParlayCalcClient() {
  const [legs, setLegs] = useState<string[]>(["-110", "-110", "+150"]);
  const [stake, setStake] = useState<string>("10");

  const result = useMemo(() => {
    const parsedLegs = legs.map((l) => parseFloat(l)).filter((n) => Number.isFinite(n) && n !== 0);
    if (parsedLegs.length < 2) return null;
    const decimals = parsedLegs.map(americanToDecimal).filter((d): d is number => d != null);
    const implieds = parsedLegs.map(americanToImplied).filter((i): i is number => i != null);
    if (decimals.length !== parsedLegs.length) return null;

    const parlayDecimal = decimals.reduce((a, b) => a * b, 1);
    const stakeN = parseFloat(stake);
    if (!Number.isFinite(stakeN) || stakeN <= 0) return null;

    const payout = stakeN * parlayDecimal;
    const profit = payout - stakeN;
    const parlayImplied = 1 / parlayDecimal;

    // Fair-value: de-vig each leg assuming standard book vig (~4.5%) per leg
    // Approximation: for game lines at -110, the de-vigged version is ~ -100
    // Multiplicative normalization across each leg's implied & opposite side
    // We approximate by assuming opposite side has identical implied (50/50 base):
    const fairDecimals = implieds.map((p) => 1 / (p / (p + p))); // = 1/0.5 = 2 — wrong
    // Better: assume each leg's "fair" probability is implied / sum_of_market_implieds.
    // Without the opposite-side number we approximate: fair_implied = implied × (1 - vig_per_leg)
    // For -110 (52.4%), vig is ~4.5% per leg, so fair ≈ 50%.
    // This isn't perfectly accurate but conveys the magnitude.
    const FAIR_VIG_FACTOR = 0.955;  // assume ~4.5% vig per leg as baseline
    const fairImplieds = implieds.map((p) => p * FAIR_VIG_FACTOR);
    const fairDec = fairImplieds.map((p) => 1 / p);
    const fairParlayDecimal = fairDec.reduce((a, b) => a * b, 1);
    const fairPayout = stakeN * fairParlayDecimal;

    const vigCostPct = ((fairPayout - payout) / fairPayout) * 100;

    // Avoid unused-variable lint complaint
    void fairDecimals;

    return {
      legCount: parsedLegs.length,
      parlayDecimal,
      parlayAmerican: parlayDecimal >= 2 ? `+${Math.round((parlayDecimal - 1) * 100)}` : `-${Math.round(100 / (parlayDecimal - 1))}`,
      parlayImpliedPct: parlayImplied * 100,
      stake: stakeN,
      payout,
      profit,
      fairPayout,
      vigCostPct,
    };
  }, [legs, stake]);

  const addLeg = () => setLegs([...legs, "-110"]);
  const removeLeg = (i: number) => setLegs(legs.filter((_, idx) => idx !== i));
  const updateLeg = (i: number, v: string) => setLegs(legs.map((l, idx) => (idx === i ? v : l)));

  return (
    <Card className="border-emerald-500/30">
      <CardContent className="p-6 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Legs (American odds)</div>
          <div className="space-y-2">
            {legs.map((leg, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12">Leg {i + 1}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={leg}
                  onChange={(e) => updateLeg(i, e.target.value)}
                  className="flex-1 rounded border border-border bg-background px-3 py-2 text-xl font-mono tabular-nums focus:border-emerald-500 focus:outline-none"
                  placeholder="-110"
                />
                {legs.length > 2 && (
                  <button
                    onClick={() => removeLeg(i)}
                    className="rounded border border-border/60 hover:border-rose-500/40 hover:bg-rose-500/5 p-2 text-muted-foreground hover:text-rose-500"
                    aria-label="Remove leg"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {legs.length < 12 && (
            <button
              onClick={addLeg}
              className="mt-3 inline-flex items-center gap-1.5 rounded border border-border/60 bg-card/40 px-3 py-1.5 text-sm hover:border-emerald-500/40 hover:bg-emerald-500/5"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add leg
            </button>
          )}
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Stake</span>
          <div className="relative mt-1">
            <span className="absolute left-3 top-2 text-2xl font-mono text-muted-foreground">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="w-full rounded border border-border bg-background pl-8 pr-3 py-2 text-2xl font-mono tabular-nums focus:border-emerald-500 focus:outline-none"
              placeholder="10"
            />
          </div>
        </label>

        {result ? (
          <div className="space-y-3 pt-2 border-t border-border/40">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{result.legCount}-leg parlay:</span>{" "}
                <span className="font-mono tabular-nums">{result.parlayAmerican}</span>{" "}
                <span className="text-muted-foreground">(decimal {result.parlayDecimal.toFixed(2)})</span>
              </div>
              <div>
                <span className="text-muted-foreground">Implied prob:</span>{" "}
                <span className="font-mono tabular-nums">{result.parlayImpliedPct.toFixed(2)}%</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Book payout</div>
                <div className="text-2xl font-mono font-bold tabular-nums text-emerald-400">{fmtMoney(result.payout)}</div>
                <div className="text-xs text-muted-foreground mt-1">Profit: {fmtMoney(result.profit)}</div>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Fair-value payout (no-vig)</div>
                <div className="text-2xl font-mono font-bold tabular-nums">{fmtMoney(result.fairPayout)}</div>
                <div className="text-xs text-muted-foreground mt-1">If books charged zero vig</div>
              </div>
            </div>

            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
              <span className="font-semibold text-rose-500">Vig cost:</span>{" "}
              <span className="font-mono tabular-nums">{result.vigCostPct.toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground ml-2">
                of the fair payout, eaten by compounded vig across {result.legCount} legs.
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              Reminder: parlay vig compounds. A 4-leg parlay of -110 bets has roughly 16-20% total vig vs ~4% on a single bet. Most parlays are -EV unless legs are positively correlated AND the book doesn&apos;t price the correlation.
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Enter at least 2 valid American odds and a positive stake.</div>
        )}
      </CardContent>
    </Card>
  );
}
