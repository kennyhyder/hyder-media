// A row of headline stats (label + value) — Voltage language: mono numerals,
// a thin lime left-rule as the signal, sharp 4px corners. The figure color uses
// --accent-ink so it stays AA-legible in light mode (lime fails text contrast).

export interface Stat {
  label: string;
  value: string;
  sub?: string;
}

export default function StatBand({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="p-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            borderLeft: "2px solid var(--accent)",
          }}
        >
          <div
            className="text-2xl font-semibold tabular-nums"
            style={{
              color: "var(--accent-ink)",
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              letterSpacing: "-0.02em",
            }}
          >
            {s.value}
          </div>
          <div
            className="mt-1 text-xs font-medium uppercase"
            style={{
              color: "var(--muted)",
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              letterSpacing: "0.08em",
            }}
          >
            {s.label}
          </div>
          {s.sub && (
            <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              {s.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
