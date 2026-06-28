// "Updated {Month YYYY}" freshness stamp backed by a machine-readable <time>.

import { freshness } from "@/lib/rollups";

export default function Freshness({ className = "" }: { className?: string }) {
  const iso = freshness();
  const d = new Date(iso);
  const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <p className={`text-xs ${className}`} style={{ color: "var(--muted)" }}>
      Dataset updated{" "}
      {/* HTML5 datetime allows at most 3 fractional-second digits; the raw
          Postgres timestamptz has 6 → toISOString() normalizes to a valid value. */}
      <time dateTime={d.toISOString()} className="font-medium" style={{ color: "var(--text)" }}>
        {label}
      </time>
      . Screening estimates derived from public data sources.
    </p>
  );
}
