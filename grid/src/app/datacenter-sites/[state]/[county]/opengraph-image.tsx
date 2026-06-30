import { stateBySlug, countySlug } from "@/lib/geo";
import { findCountyBySlug } from "@/lib/rollups";
import { fmtInt, fmtScore } from "@/lib/format";
import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const revalidate = 86400;
export const alt = "GridCensus — Datacenter sites by county";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ state: string; county: string }>;
}) {
  const { state, county } = await params;
  const st = stateBySlug(state);
  const found = st ? findCountyBySlug(st.code, county, countySlug) : undefined;
  if (!st || !found) {
    return ogCard({ eyebrow: "Datacenter sites", title: "GridCensus" });
  }
  const c = found.county;
  return ogCard({
    eyebrow: `Datacenter sites · ${st.name}`,
    title: c.countyName || "County",
    subtitle: "Hazard, tax incentives, electricity rates, fiber, water, and climate context.",
    stats: [
      { label: "Scored sites", value: fmtInt(c.count) },
      { label: "Avg DC Readiness", value: `${fmtScore(c.avgScore)}/100` },
    ],
  });
}
