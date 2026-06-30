import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { national } from "@/lib/rollups";
import { fmtInt } from "@/lib/format";
import ReadinessMap from "@/components/map/ReadinessMap";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Explore the datacenter readiness atlas",
  description: `Full-screen interactive map of ${fmtInt(
    national.count
  )} scored US datacenter candidate sites. Browse states by average DC Readiness, then zoom in to individual sites and open their full profiles.`,
  alternates: { canonical: `${SITE_URL}/explore` },
};

// Full-screen immersive explorer. The map is a client island (Leaflet via
// dynamic ssr:false inside ReadinessMap) layered over a server-rendered intro
// paragraph + crawlable links so this route still carries real SSR content.
export default function ExplorePage() {
  return (
    <div>
      {/* SSR substance — visible to crawlers with no JS. */}
      <header>
        <h1 className="text-2xl font-bold text-gray-900">
          Explore the {SITE_NAME} readiness atlas
        </h1>
        <p className="mt-2 max-w-3xl text-gray-700">
          An interactive map of {fmtInt(national.count)} scored US datacenter
          candidate sites. The national view colors every state by its average
          DC Readiness; zoom in to reveal individual sites, color-coded by score,
          and click any site to open its full profile. Prefer to browse by list?
          Start from{" "}
          <a href="/datacenter-sites" className="font-medium text-purple-700 hover:underline">
            locations
          </a>
          ,{" "}
          <a href="/rankings" className="font-medium text-purple-700 hover:underline">
            rankings
          </a>
          , or the{" "}
          <a href="/methodology" className="font-medium text-purple-700 hover:underline">
            methodology
          </a>
          .
        </p>
      </header>

      <div className="mt-5">
        <ReadinessMap height="calc(100vh - 220px)" showChoropleth showPoints rounded />
      </div>

      <p className="mt-3 max-w-3xl text-xs text-gray-400">
        Pan and zoom to explore. State colors and site scores are screening
        estimates from public infrastructure data — confirm all values with the
        utility, ISO, and on-the-ground due diligence.
      </p>
    </div>
  );
}
