import { stateBySlug, stateName } from "@/lib/geo";
import { getSiteByShortId } from "@/lib/db";
import { parseShortId } from "@/lib/entity-slug";
import { fmtScore, fmtMwExact } from "@/lib/format";
import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const revalidate = 86400;
export const alt = "GridCensus — Datacenter candidate site";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ state: string; county: string; slug: string }>;
}) {
  const { state, slug } = await params;
  const st = stateBySlug(state);
  const shortId = parseShortId(slug);
  const site = st && shortId ? await getSiteByShortId(st.code, undefined, shortId) : null;
  if (!st || !site) {
    return ogCard({ eyebrow: "Datacenter site", title: "GridCensus" });
  }
  const name = site.name || "Datacenter Candidate Site";
  const loc = [site.county, site.state ? stateName(site.state) : null]
    .filter(Boolean)
    .join(", ");
  const stats = [
    {
      label: "DC Readiness",
      value: site.dc_score != null ? `${fmtScore(site.dc_score)}/100` : "—",
    },
  ];
  if (site.available_capacity_mw != null) {
    stats.push({ label: "Candidate capacity", value: fmtMwExact(site.available_capacity_mw) });
  }
  return ogCard({
    eyebrow: loc || "Datacenter site",
    title: name,
    stats,
  });
}
