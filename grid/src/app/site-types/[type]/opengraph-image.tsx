import { siteTypeBySlug } from "@/lib/geo";
import { siteTypeAgg } from "@/lib/rollups";
import { fmtInt, fmtScore } from "@/lib/format";
import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const revalidate = 86400;
export const alt = "GridCensus — Datacenter sites by type";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const t = siteTypeBySlug(type);
  const agg = t ? siteTypeAgg(t.key) : undefined;
  if (!t || !agg) {
    return ogCard({ eyebrow: "Site type", title: "GridCensus" });
  }
  return ogCard({
    eyebrow: "Site type",
    title: `${t.label} Sites`,
    subtitle: "Scored datacenter candidate sites nationwide.",
    stats: [
      { label: "Scored sites", value: fmtInt(agg.count) },
      { label: "Avg DC Readiness", value: `${fmtScore(agg.avgScore)}/100` },
    ],
  });
}
