import { getOrgRecord } from "@/lib/organizations";
import { fmtInt } from "@/lib/format";
import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const revalidate = 86400;
export const alt = "GridCensus — Organization infrastructure portfolio";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const rec = getOrgRecord(slug);
  if (!rec) {
    return ogCard({ eyebrow: "Organization", title: "GridCensus" });
  }
  const stats = [{ label: "Catalogued assets", value: fmtInt(rec.totalAssets) }];
  if (rec.states.length > 0) {
    stats.push({ label: "States", value: fmtInt(rec.states.length) });
  }
  return ogCard({
    eyebrow: "Infrastructure portfolio",
    title: rec.name,
    subtitle: "Datacenters, sites, substations, transmission, fiber, and more.",
    stats,
  });
}
