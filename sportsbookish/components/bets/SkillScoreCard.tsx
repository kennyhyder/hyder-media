import { Card, CardContent } from "@/components/ui/card";
import type { SkillScore } from "@/lib/bet-score";
import { TIER_INFO } from "@/lib/bet-score";
import { fmtPctSigned } from "@/lib/format";

function fmt(v: number | null, digits = 1, suffix = ""): string {
  if (v == null) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

export default function SkillScoreCard({ score }: { score: SkillScore }) {
  const tier = score.skill_tier;
  const composite = score.composite_score;
  const tierInfo = tier ? TIER_INFO[tier] : null;

  return (
    <div className="space-y-3">
      {/* Hero score */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">SportsBookISH Skill Score</div>
              {composite != null && tier ? (
                <>
                  <div className="flex items-baseline gap-3 mt-1">
                    <div className="text-5xl font-bold tabular-nums" style={{ color: tierInfo!.color }}>
                      {composite}
                    </div>
                    <div className="text-sm text-muted-foreground">/ 1000</div>
                    <div
                      className="text-xs font-bold uppercase px-2 py-1 rounded"
                      style={{ background: `${tierInfo!.color}22`, color: tierInfo!.color }}
                    >
                      {tierInfo!.label}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 max-w-md">{tierInfo!.description}</p>
                </>
              ) : (
                <>
                  <div className="text-3xl font-bold mt-1 text-muted-foreground">No score yet</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Settle at least 5 bets ({score.settled_bets}/5) to unlock your composite score.
                  </p>
                </>
              )}
            </div>

            {score.components && (
              <div className="grid grid-cols-5 gap-3 text-center min-w-[400px]">
                <Component label="ROI" value={score.components.roi} max={300} />
                <Component label="CLV" value={score.components.clv} max={300} />
                <Component label="Calibration" value={score.components.brier} max={200} />
                <Component label="Difficulty" value={score.components.difficulty} max={100} />
                <Component label="Sharpe" value={score.components.sharpe} max={100} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-sm">
        <Stat label="Bets total" value={String(score.total_bets)} />
        <Stat label="Pending" value={String(score.pending_bets)} tone="muted" />
        <Stat label="W / L / P" value={`${score.won_bets} / ${score.lost_bets} / ${score.push_bets}`} />
        <Stat label="Win rate" value={score.win_rate != null ? fmt(score.win_rate * 100, 1, "%") : "—"} />
        <Stat label="ROI" value={score.roi != null ? fmtPctSigned(score.roi) : "—"} tone={score.roi != null && score.roi > 0 ? "up" : "down"} />
        <Stat label="Profit" value={`${score.total_profit_units >= 0 ? "+" : ""}${fmt(score.total_profit_units, 2)} u`} tone={score.total_profit_units > 0 ? "up" : score.total_profit_units < 0 ? "down" : "muted"} />
        <Stat label="CLV avg" value={score.clv_avg != null ? fmtPctSigned(score.clv_avg) : "—"} tone={score.clv_avg != null && score.clv_avg > 0 ? "up" : "muted"} />
      </div>
    </div>
  );
}

function Component({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = (value / max) * 100;
  return (
    <div className="flex flex-col items-center min-w-[60px]">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}<span className="text-xs text-muted-foreground">/{max}</span></div>
      <div className="w-full h-1 bg-muted rounded-full mt-1 overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "muted" }) {
  const cls = tone === "up" ? "text-emerald-500" : tone === "down" ? "text-rose-500" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="rounded border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
