import { isoBySlug } from "@/lib/geo";
import { isoAgg } from "@/lib/rollups";
import { fmtInt, fmtScore } from "@/lib/format";
import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const revalidate = 86400;
export const alt = "GridCensus — Datacenter sites by grid region";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ region: string }>;
}) {
  const { region } = await params;
  const iso = isoBySlug(region);
  const agg = iso ? isoAgg(iso.key) : undefined;
  if (!iso || !agg) {
    return ogCard({ eyebrow: "Grid region", title: "GridCensus" });
  }
  return ogCard({
    eyebrow: "Grid region",
    title: iso.label,
    subtitle: iso.fullName,
    stats: [
      { label: "Scored sites", value: fmtInt(agg.count) },
      { label: "Avg DC Readiness", value: `${fmtScore(agg.avgScore)}/100` },
    ],
  });
}
