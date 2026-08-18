// "Dataset updated {Month YYYY}" stamp, backed by a machine-readable <time>.
//
// Reads the REAL latest data timestamp live (cached hourly) so the stamp tracks
// actual data freshness — including the automated monthly rescore that updates
// grid_dc_sites without a redeploy. Falls back to the build-time rollups date if
// the DB read fails, so it can never break a page. (No aggregate — grid disables
// PostgREST aggregates; we read the newest row via order+limit(1).)

import { freshness as staticFreshness } from "@/lib/rollups";
import { getSupabase } from "@/lib/grid-api/db";
import { unstable_cache } from "next/cache";

const getLiveFreshness = unstable_cache(
  async (): Promise<string> => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("grid_dc_sites")
        .select("updated_at")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .single();
      if (error || !data?.updated_at) return staticFreshness();
      return data.updated_at as string;
    } catch {
      return staticFreshness();
    }
  },
  ["grid-dataset-freshness"],
  { revalidate: 3600 },
);

export default async function Freshness({ className = "" }: { className?: string }) {
  const iso = await getLiveFreshness();
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
