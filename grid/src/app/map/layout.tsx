import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { national } from "@/lib/rollups";
import { fmtInt } from "@/lib/format";

// The interactive map page is a client island, so it can't export metadata
// directly. This server layout supplies unique title + description + canonical
// so /map isn't a duplicate-titled, canonical-less route alongside the homepage
// and /explore. Kept indexable because it's a primary nav destination.
export const metadata: Metadata = {
  title: "Interactive Datacenter Readiness Map",
  description: `Filterable interactive map of ${fmtInt(
    national.count
  )} scored US datacenter candidate sites — overlay substations, transmission lines, existing datacenters, IXPs, and fiber routes, then drill into any site's DC Readiness profile.`,
  alternates: { canonical: `${SITE_URL}/map` },
};

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
