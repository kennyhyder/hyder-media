import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { national } from "@/lib/rollups";
import { fmtInt } from "@/lib/format";
import SiteFinder from "@/components/SiteFinder";
import Freshness from "@/components/Freshness";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";

export const revalidate = 604800; // 7d — the finder itself is live (client-fetched); page shell caches

export const metadata: Metadata = {
  title: "Find Datacenter Sites by Build Size (MW)",
  description: `Size your build and find matching datacenter sites. Set a target megawatt capacity (25 MW to 2 GW), optionally filter by state and site type, and get ${fmtInt(
    national.count
  )} scored US candidate sites ranked by DC Readiness — free.`,
  alternates: { canonical: `${SITE_URL}/find` },
};

export default function FindPage() {
  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Find Sites by Size", url: "/find" },
          ]),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <span className="text-gray-500">Find sites by size</span>
      </nav>

      <header className="mt-3">
        <h1 className="text-3xl font-bold text-gray-900">Size your build — find matching sites</h1>
        <p className="mt-2 max-w-3xl text-gray-700">
          Pick how big you want to build — from tens of megawatts to multi-gigawatt campuses — and
          GridCensus ranks the candidate sites that can support it by DC Readiness. Narrow by state
          or site type to match a specific search, or vet a market at a glance.
        </p>
      </header>

      <section className="mt-6">
        <SiteFinder />
      </section>

      <div className="mt-8">
        <Freshness />
      </div>
      <p className="mt-2 max-w-3xl text-xs text-gray-400">
        {SITE_NAME} scores are 0–100 screening estimates from public data — a starting point for
        site selection, not a substitute for interconnection, environmental, or engineering studies.
      </p>
    </div>
  );
}
