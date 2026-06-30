import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { topDatacenters, type Datacenter } from "@/lib/db";
import { datacenterProfilePath } from "@/lib/entity-slug";
import { fmtInt } from "@/lib/format";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Operating Datacenters — Operators, Locations & Capacity",
  description:
    "Browse operating datacenter facilities across the United States. Operator, location, footprint, nearby internet exchanges, and candidate sites for expansion around each datacenter.",
  alternates: { canonical: `${SITE_URL}/datacenters` },
};

export default async function DatacentersHub() {
  const dcs = await topDatacenters(120);

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Datacenters", url: "/datacenters" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Operating datacenters`,
            description: "Operating datacenter facilities across the US by operator, location, and footprint.",
            url: `${SITE_URL}/datacenters`,
            spatialCoverage: "United States",
          }),
          itemListSchema(dcs.slice(0, 25).map((d) => ({ name: d.name || "Datacenter", url: `${SITE_URL}${datacenterProfilePath(d)}` }))),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">Operating Datacenters</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          Existing datacenter clusters are a strong signal for new development — they confirm power
          availability, fiber peering, and permitting precedent. Browse the {SITE_NAME} catalog of
          operating datacenter facilities, ranked by footprint, each cross-linked to nearby internet
          exchanges and candidate sites for expansion.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {dcs.map((d: Datacenter) => (
          <a
            key={d.id}
            href={datacenterProfilePath(d)}
            className="rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-purple-300 hover:shadow-sm"
          >
            <div className="font-semibold text-gray-900 line-clamp-2">{d.name}</div>
            <div className="mt-1 text-xs text-gray-500">
              {[d.city, d.state].filter(Boolean).join(", ")}
              {d.operator ? ` · ${d.operator}` : ""}
            </div>
            <div className="mt-2 text-xs font-medium text-indigo-700">
              {d.sqft != null ? `${fmtInt(d.sqft)} sq ft` : d.capacity_mw != null ? `${fmtInt(d.capacity_mw)} MW` : "Footprint n/a"}
            </div>
          </a>
        ))}
      </div>

      <div className="mt-8">
        <Freshness />
      </div>
      <UpgradeCTA />
    </div>
  );
}
