import { national } from "@/lib/rollups";
import { fmtInt, fmtScore } from "@/lib/format";
import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const revalidate = 86400;
export const alt = "GridCensus — Datacenter Site Intelligence";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Datacenter site intelligence",
    title: "Datacenter Site Intelligence",
    subtitle: "Power, speed-to-power, fiber, water, and hazard — scored nationwide.",
    stats: [
      { label: "Scored sites", value: fmtInt(national.count) },
      { label: "Avg DC Readiness", value: `${fmtScore(national.avgScore)}/100` },
      { label: "States", value: "51" },
    ],
  });
}
