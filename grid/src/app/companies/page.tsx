import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { getCompanies } from "@/lib/companies";
import { fmtInt, fmtMw } from "@/lib/format";
import { stateName } from "@/lib/geo";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Datacenter Operating Companies — Operators & Portfolios",
  description:
    "Browse datacenter operating companies across the United States — AWS, Equinix, Digital Realty, QTS, CoreSite, Lumen and hundreds more. Facility counts, total capacity, and state footprint for each operator, with every facility cross-linked.",
  alternates: { canonical: `${SITE_URL}/companies` },
};

export default async function CompaniesHub() {
  const all = await getCompanies();
  // Only surface real, named companies with at least one facility.
  const companies = all.filter((c) => c.name && c.facilityCount >= 1);

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Companies", url: "/companies" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Datacenter operating companies`,
            description:
              "Datacenter and internet-exchange operating companies across the US, with facility counts, total capacity, and state footprint.",
            url: `${SITE_URL}/companies`,
            spatialCoverage: "United States",
          }),
          itemListSchema(
            companies
              .slice(0, 25)
              .map((c) => ({ name: c.name, url: `${SITE_URL}/companies/${c.slug}` }))
          ),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">
          Datacenter Operating Companies
        </h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          {fmtInt(companies.length)} operating companies run the datacenters and
          internet-exchange facilities in the {SITE_NAME} catalog — from
          hyperscalers like AWS, Google and Meta to wholesale and colocation
          operators like Equinix, Digital Realty, QTS and CoreSite. Each profile
          rolls up an operator&rsquo;s facility count, total catalogued capacity,
          and state footprint, with every facility cross-linked.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {companies.map((c) => (
          <a
            key={c.slug}
            href={`/companies/${c.slug}`}
            className="rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-purple-300 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-gray-900 line-clamp-2">{c.name}</div>
              <span className="shrink-0 rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800">
                {fmtInt(c.facilityCount)}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {fmtInt(c.facilityCount)} {c.facilityCount === 1 ? "facility" : "facilities"}
              {c.states.length > 0
                ? ` · ${c.states.length} ${c.states.length === 1 ? "state" : "states"}`
                : ""}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-indigo-700">
              {c.totalCapacityMw > 0 && <span>{fmtMw(c.totalCapacityMw)}</span>}
              {c.states.length > 0 && (
                <span className="text-gray-500">
                  {c.states.slice(0, 4).map((s) => stateName(s)).join(", ")}
                  {c.states.length > 4 ? ` +${c.states.length - 4}` : ""}
                </span>
              )}
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
