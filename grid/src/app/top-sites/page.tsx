import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { topSites } from "@/lib/db";
import { siteProfilePath } from "@/lib/entity-slug";
import SitesTable from "@/components/SitesTable";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Top 100 Datacenter Sites by Readiness Score",
  description:
    "The 100 highest-scoring US datacenter candidate sites, ranked by a ten-factor DC Readiness model — power, speed-to-power, fiber, water, hazard, land, labor, tax, and existing-datacenter ecosystem. Free, with full per-site profiles, refreshed daily.",
  alternates: { canonical: `${SITE_URL}/top-sites` },
};

export default async function TopSitesPage() {
  const sites = await topSites({}, 100);
  const linked = sites.filter((s) => siteProfilePath(s));

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Top 100 Sites", url: "/top-sites" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Top 100 datacenter sites`,
            description:
              "The 100 highest-scoring US datacenter candidate sites by DC Readiness score, with per-site profiles.",
            url: `${SITE_URL}/top-sites`,
            spatialCoverage: "United States",
          }),
          itemListSchema(
            linked.map((s) => ({
              name: s.name || "Datacenter site",
              url: `${SITE_URL}${siteProfilePath(s)}`,
            }))
          ),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">Top 100 Datacenter Sites</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          The 100 highest-scoring datacenter candidate sites in the United States, ranked by{" "}
          {SITE_NAME}&apos;s ten-factor DC Readiness score — power capacity, speed-to-power, fiber,
          water, natural-hazard risk, land, labor, tax, and existing-datacenter ecosystem. Each site
          links to its full profile with the underlying data. Free and refreshed daily.
        </p>
      </header>

      <div className="mt-6">
        <SitesTable
          sites={sites}
          showState
          showCounty
          caption="Top 100 scored US datacenter sites"
          linkBuilder={siteProfilePath}
        />
      </div>

      <div className="mt-8">
        <Freshness />
      </div>
      <UpgradeCTA />
    </div>
  );
}
