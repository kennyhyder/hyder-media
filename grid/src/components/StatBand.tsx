// A row of headline stats (label + value).

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
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="text-2xl font-bold text-gray-900">{s.value}</div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            {s.label}
          </div>
          {s.sub && <div className="mt-0.5 text-xs text-gray-400">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}
