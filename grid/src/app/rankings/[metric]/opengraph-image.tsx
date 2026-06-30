import { metricByKey } from "@/lib/rankings";
import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const revalidate = 86400;
export const alt = "GridCensus — Datacenter rankings";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ metric: string }>;
}) {
  const { metric } = await params;
  const m = metricByKey(metric);
  if (!m) {
    return ogCard({ eyebrow: "Rankings", title: "GridCensus" });
  }
  const rows = m.compute();
  const leader = rows[0];
  return ogCard({
    eyebrow: "Datacenter rankings",
    title: m.title,
    subtitle: leader ? `#1 ${leader.name} — ${leader.display}` : undefined,
    stats: leader
      ? [{ label: `#1 ${leader.name}`, value: leader.display }]
      : [],
  });
}
