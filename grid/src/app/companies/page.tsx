import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { topOrganizations, orgIndexMeta, ASSET_KEYS } from "@/lib/organizations";
import { fmtInt } from "@/lib/format";
import { stateName } from "@/lib/geo";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Organizations — Infrastructure Owners & Operators",
  description:
    "Browse every organization in the datacenter-siting dataset — utilities like Duke Energy, Dominion and PacifiCorp, hyperscalers like AWS and Equinix, plus landowners, railroads and fiber carriers. Each profile aggregates ALL of an organization's assets — datacenters, candidate sites, substations, transmission, fiber and more — cross-linked across the dataset.",
  alternates: { canonical: `${SITE_URL}/companies` },
};

// Cap the hub list — there are tens of thousands of orgs; show the densest.
const HUB_LIMIT = 600;

const ASSET_SHORT: Record<string, string> = {
  datacenters: "DCs",
  candidate_sites: "sites",
  substations: "subs",
  transmission_lines: "lines",
  fiber_routes: "fiber",
  rail_lines: "rail",
  brownfields: "brownfields",
  ixps: "IXPs",
  parcels: "parcels",
};

export default async function OrganizationsHub() {
  const ranked = topOrganizations();
  const meta = orgIndexMeta();
  const shown = ranked.slice(0, HUB_LIMIT);

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Organizations", url: "/companies" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Infrastructure organizations`,
            description:
              "Organizations owning or operating datacenter-siting infrastructure across the US — utilities, hyperscalers, landowners, railroads and fiber carriers — each with full asset counts and state footprint.",
            url: `${SITE_URL}/companies`,
            spatialCoverage: "United States",
          }),
          itemListSchema(
            shown.slice(0, 25).map((c) => ({ name: c.name, url: `${SITE_URL}/companies/${c.slug}` }))
          ),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">Organizations</h1>
        <p className="mt-2 max-w-3xl text-gray-600">
          {fmtInt(meta.totalOrganizations)} organizations own or operate the{" "}
          {fmtInt(meta.totalAssets)} catalogued infrastructure assets in the{" "}
          {SITE_NAME} dataset — from utilities like Duke Energy, Dominion and
          PacifiCorp to hyperscalers like AWS and Equinix, plus landowners,
          railroads and fiber carriers. Each profile rolls up an
          organization&rsquo;s <em>entire</em> footprint — datacenters, candidate
          sites, substations, transmission, fiber, brownfields and exchanges —
          with every asset cross-linked. Showing the {fmtInt(shown.length)}{" "}
          densest organizations by total assets.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => {
          const types = ASSET_KEYS.filter((k) => c.assets[k] > 0);
          return (
            <a
              key={c.slug}
              href={`/companies/${c.slug}`}
              className="rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-purple-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-gray-900 line-clamp-2">{c.name}</div>
                <span className="shrink-0 rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800">
                  {fmtInt(c.totalAssets)}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {fmtInt(c.totalAssets)} {c.totalAssets === 1 ? "asset" : "assets"}
                {c.states.length > 0
                  ? ` · ${c.states.length} ${c.states.length === 1 ? "state" : "states"}`
                  : ""}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs">
                {types.slice(0, 4).map((k) => (
                  <span key={k} className="font-medium text-indigo-700">
                    {fmtInt(c.assets[k])} {ASSET_SHORT[k]}
                  </span>
                ))}
              </div>
              {c.states.length > 0 && (
                <div className="mt-1 text-xs text-gray-500">
                  {c.states.slice(0, 4).map((s) => stateName(s)).join(", ")}
                  {c.states.length > 4 ? ` +${c.states.length - 4}` : ""}
                </div>
              )}
            </a>
          );
        })}
      </div>

      <div className="mt-8">
        <Freshness />
      </div>
      <UpgradeCTA />
    </div>
  );
}
