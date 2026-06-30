import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { ISO_REGIONS } from "@/lib/geo";
import { isoAgg } from "@/lib/rollups";
import { fmtInt, fmtScore, fmtYears } from "@/lib/format";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema, datasetSchema, itemListSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Datacenter Sites by ISO / RTO Region",
  description:
    "Datacenter candidate sites across the nine US grid operators — PJM, WECC, MISO, SPP, SERC, ERCOT, CAISO, ISO-NE, NYISO — with interconnection-queue and speed-to-power context.",
  alternates: { canonical: `${SITE_URL}/iso` },
};

export default function IsoHub() {
  const regions = Object.values(ISO_REGIONS)
    .map((r) => ({ r, agg: isoAgg(r.key) }))
    .filter((x) => x.agg)
    .sort((a, b) => b.agg!.count - a.agg!.count);

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "ISO Regions", url: "/iso" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — Datacenter sites by ISO/RTO region`,
            description: "Datacenter candidate-site counts and scores across nine US grid operators.",
            url: `${SITE_URL}/iso`,
            spatialCoverage: "United States",
          }),
          itemListSchema(regions.map((x) => ({ name: x.r.fullName, url: `${SITE_URL}/iso/${x.r.slug}` }))),
        ]}
      />

      <header>
        <h1 className="text-3xl font-bold text-gray-900">
          Datacenter Sites by ISO / RTO Region
        </h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          The grid operator that controls a site&apos;s interconnection queue is
          often the single biggest determinant of speed-to-power. Explore
          candidate sites across the nine US ISO/RTO regions.
        </p>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {regions.map(({ r, agg }) => (
          <a
            key={r.key}
            href={`/iso/${r.slug}`}
            className="rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-purple-300 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-gray-900">{r.label}</span>
              <span className="text-xs text-gray-400">{r.fullName}</span>
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-gray-600">{r.blurb}</p>
            <div className="mt-3 flex gap-4 text-xs text-gray-500">
              <span>{fmtInt(agg!.count)} sites</span>
              <span>avg {fmtScore(agg!.avgScore)}</span>
              <span>{fmtYears(agg!.avgQueueWaitYears)} queue</span>
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
