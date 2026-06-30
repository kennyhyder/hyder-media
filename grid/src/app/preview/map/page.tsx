import type { Metadata } from "next";
import MapShell from "@/components/preview/map/MapShell";

// Map-first "front door" design preview. Full-bleed dark explorable map with
// glass intelligence panels floating over it. Scoped entirely to /preview/map —
// no shared/production files are touched. noindex (preview only).
export const metadata: Metadata = {
  title: "Atlas — Map-First Design Preview",
  robots: { index: false, follow: false },
};

export default function MapPreviewPage() {
  return <MapShell />;
}
