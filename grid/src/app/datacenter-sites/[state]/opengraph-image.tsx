import { stateBySlug } from "@/lib/geo";
import { stateAgg } from "@/lib/rollups";
import { fmtInt, fmtScore } from "@/lib/format";
import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const revalidate = 86400;
export const alt = "GridCensus — Datacenter sites by state";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  const st = stateBySlug(state);
  const agg = st ? stateAgg(st.code) : undefined;
  if (!st || !agg) {
    return ogCard({ eyebrow: "Datacenter sites", title: "GridCensus" });
  }
  return ogCard({
    eyebrow: "Datacenter sites",
    title: st.name,
    subtitle: "Scored candidate sites — power, speed-to-power, fiber, water, hazard.",
    stats: [
      { label: "Scored sites", value: fmtInt(agg.count) },
      { label: "Avg DC Readiness", value: `${fmtScore(agg.avgScore)}/100` },
    ],
  });
}
