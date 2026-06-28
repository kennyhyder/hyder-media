// Renders the average sub-score profile (power/speed/fiber/water/hazard) as bars.

import type { Agg } from "@/lib/rollups";

const DIMS: Array<{ key: keyof Agg["avgSubScores"]; label: string }> = [
  { key: "power", label: "Power availability" },
  { key: "speed", label: "Speed-to-power" },
  { key: "fiber", label: "Fiber" },
  { key: "water", label: "Water" },
  { key: "hazard", label: "Hazard resilience" },
];

export default function SubScoreProfile({ agg }: { agg: Agg }) {
  return (
    <div className="space-y-2">
      {DIMS.map((d) => {
        const v = agg.avgSubScores[d.key];
        const pct = Math.max(0, Math.min(100, v));
        const color =
          v >= 70 ? "var(--score-top)" : v >= 55 ? "var(--score-high)" : v >= 40 ? "var(--score-mid)" : "var(--score-low)";
        return (
          <div key={d.key} className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-xs text-gray-600">{d.label}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-gray-700">
              {v.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
