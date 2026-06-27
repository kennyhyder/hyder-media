import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { ISO_REGIONS, isoBySlug, siteTypeLabel, SITE_TYPES, stateByCode, stateName } from "@/lib/geo";
import { isoAgg } from "@/lib/rollups";
import { topSites } from "@/lib/db";
import { fmtInt, fmtScore, fmtMw, fmtYears } from "@/lib/format";
import StatBand from "@/components/StatBand";
import SubScoreProfile from "@/components/SubScoreProfile";
import Breakdown from "@/components/Breakdown";
import SitesTable from "@/components/SitesTable";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import {
  breadcrumbSchema,
  datasetSchema,
  placeSchema,
  itemListSchema,
  faqSchema,
} from "@/lib/schema";

export const revalidate = 86400;

export function generateStaticParams() {
  return Object.values(ISO_REGIONS).map((r) => ({ region: r.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ region: string }>;
}): Promise<Metadata> {
  const { region } = await params;
  const iso = isoBySlug(region);
  const agg = iso ? isoAgg(iso.key) : undefined;
  if (!iso || !agg) return { title: "Region not found", robots: { index: false } };
  return {
    title: `${iso.label} Datacenter Sites — ${iso.fullName}`,
    description: `${fmtInt(agg.count)} scored datacenter candidate sites in ${iso.label} (${iso.fullName}), averaging ${fmtScore(
      agg.avgScore
    )}/100 DC Readiness with a ${fmtYears(agg.avgQueueWaitYears)} average interconnection-queue wait.`,
    alternates: { canonical: `${SITE_URL}/iso/${region}` },
  };
}

export default async function IsoRegionPage({
  params,
}: {
  params: Promise<{ region: string }>;
}) {
  const { region } = await params;
  const iso = isoBySlug(region);
  if (!iso) notFound();
  const agg = isoAgg(iso.key);
  if (!agg) notFound();

  const sites = await topSites({ iso_region: iso.key }, 25);

  const typeRows = Object.entries(agg.byType).map(([k, n]) => ({
    label: siteTypeLabel(k),
    count: n,
    href: SITE_TYPES[k] ? `/site-types/${SITE_TYPES[k].slug}` : undefined,
  }));
  const stateRows = Object.entries(agg.byState).map(([code, n]) => ({
    label: stateName(code),
    count: n,
    href: stateByCode(code) ? `/datacenter-sites/${stateByCode(code)!.slug}` : undefined,
  }));

  const faq = [
    {
      q: `What is ${iso.label}?`,
      a: `${iso.fullName} (${iso.label}) ${iso.blurb}`,
    },
    {
      q: `How many datacenter sites are in the ${iso.label} region?`,
      a: `GridCensus catalogs ${fmtInt(agg.count)} scored datacenter candidate sites in ${iso.label}, averaging ${fmtScore(agg.avgScore)}/100 DC Readiness.`,
    },
    {
      q: `What is the average interconnection-queue wait in ${iso.label}?`,
      a: `Candidate sites in ${iso.label} average a ${fmtYears(agg.avgQueueWaitYears)} queue wait with an average queue depth of ${fmtInt(agg.avgQueueDepth)} projects.`,
    },
  ];

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "ISO Regions", url: "/iso" },
            { name: iso.label, url: `/iso/${iso.slug}` },
          ]),
          placeSchema({ name: iso.fullName, type: "Place" }),
          datasetSchema({
            name: `Datacenter candidate sites in ${iso.label}`,
            description: `${fmtInt(agg.count)} scored datacenter candidate sites in ${iso.fullName}.`,
            url: `${SITE_URL}/iso/${iso.slug}`,
          }),
          itemListSchema(sites.map((s) => ({ name: s.name || "Site" }))),
          faqSchema(faq),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/iso" className="hover:text-purple-600">ISO Regions</a> / {iso.label}
      </nav>

      <header className="mt-2">
        <h1 className="text-3xl font-bold text-gray-900">
          {iso.label} Datacenter Sites
        </h1>
        <p className="mt-1 text-sm text-gray-500">{iso.fullName}</p>
        <p className="mt-3 max-w-3xl text-gray-700">{iso.blurb}</p>
      </header>

      <section className="mt-6">
        <StatBand
          stats={[
            { label: "Candidate sites", value: fmtInt(agg.count) },
            { label: "Avg DC Readiness", value: `${fmtScore(agg.avgScore)}/100` },
            { label: "Catalogued capacity", value: fmtMw(agg.totalCapacityMw), sub: "theoretical aggregate" },
            { label: "Avg queue wait", value: fmtYears(agg.avgQueueWaitYears) },
          ]}
        />
      </section>

      <section className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Member states</h2>
          <Breakdown rows={stateRows} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">By site type</h2>
          <Breakdown rows={typeRows} />
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-bold text-gray-900">Average sub-score profile</h2>
        <SubScoreProfile agg={agg} />
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold text-gray-900">
          Top 25 datacenter sites in {iso.label}
        </h2>
        <div className="mt-3">
          <SitesTable sites={sites} showState caption={`Top datacenter sites in ${iso.label}`} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-gray-900">{iso.label} FAQ</h2>
        <dl className="mt-3 space-y-4">
          {faq.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold text-gray-900">{f.q}</dt>
              <dd className="mt-1 text-gray-700">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-8">
        <Freshness />
      </div>
      <UpgradeCTA context={iso.label} />
    </div>
  );
}
