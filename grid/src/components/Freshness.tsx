// "Updated {Month YYYY}" freshness stamp backed by a machine-readable <time>.

import { freshness } from "@/lib/rollups";

export default function Freshness({ className = "" }: { className?: string }) {
  const iso = freshness();
  const d = new Date(iso);
  const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <p className={`text-xs text-gray-500 ${className}`}>
      Dataset updated{" "}
      <time dateTime={iso} className="font-medium text-gray-700">
        {label}
      </time>
      . Screening estimates derived from public data sources.
    </p>
  );
}
