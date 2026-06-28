import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { topIxps, type IxpFacility } from "@/lib/db";
import { ixpProfilePath } from "@/lib/entity-slug";
import { fmtInt } from "@/lib/format";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Internet Exchanges & Peering Facilities — Carrier Density | GridCensus",
  description:
    "Browse 1,300+ internet exchange and peering facilities across the United States. Connected networks, carrier density, location, and nearby datacenter candidate sites for each exchange.",
  alternates: { canonical: `${SITE_URL}/internet-exchanges` },
};

export default async function IxpHub() {
  const ixps = await topIxps(120);

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Internet Exchanges", url: "/internet-exchanges" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Internet exchanges & peering facilities`,
            description:
              "Internet exchange and peering facilities across the US by connected-network count and carrier density.",
            url: `${SITE_URL}/internet-exchanges`,
            spatialCoverage: "United States",
          }),
          itemListSchema(ixps.slice(0, 25).map((x) => ({ name: x.name || "IXP", url: `${SITE_URL}${ixpProfilePath(x)}` }))),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">Internet Exchanges & Peering Facilities</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          Carrier and peering density is a core fiber-connectivity input for datacenter siting.
          Proximity to a well-peered internet exchange shortens the path to low-latency, multi-carrier
          transit and cuts backhaul cost. Browse the {SITE_NAME} catalog of internet exchange and
          peering facilities, ranked by connected networks.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ixps.map((x: IxpFacility) => (
          <a
            key={x.id}
            href={ixpProfilePath(x)}
            className="rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-purple-300 hover:shadow-sm"
          >
            <div className="font-semibold text-gray-900 line-clamp-2">{x.name}</div>
            <div className="mt-1 text-xs text-gray-500">
              {[x.city, x.state].filter(Boolean).join(", ")}
            </div>
            <div className="mt-2 text-xs font-medium text-sky-700">
              {x.network_count != null ? `${fmtInt(x.network_count)} networks` : "Networks n/a"}
              {x.ix_count != null && x.ix_count > 0 ? ` · ${fmtInt(x.ix_count)} IX` : ""}
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
