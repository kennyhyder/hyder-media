import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { STATES, stateBySlug, countySlug, siteTypeLabel, SITE_TYPES, ISO_REGIONS, isoLabel } from "@/lib/geo";
import { stateAgg, countiesForState } from "@/lib/rollups";
import { topSites } from "@/lib/db";
import { siteProfilePath } from "@/lib/entity-slug";
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
  return STATES.map((s) => ({ state: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string }>;
}): Promise<Metadata> {
  const { state: slug } = await params;
  const st = stateBySlug(slug);
  const agg = st ? stateAgg(st.code) : undefined;
  if (!st || !agg) return { title: "State not found", robots: { index: false } };
  return {
    title: `Datacenter Sites in ${st.name} — ${fmtInt(agg.count)} Scored Locations`,
    description: `${fmtInt(agg.count)} scored datacenter candidate sites in ${st.name}, averaging ${fmtScore(
      agg.avgScore
    )}/100 DC Readiness with a ${fmtYears(agg.avgQueueWaitYears)} average interconnection-queue wait. Breakdown by site type, grid region, and county.`,
    alternates: { canonical: `${SITE_URL}/datacenter-sites/${slug}` },
  };
}

export default async function StatePage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state: slug } = await params;
  const st = stateBySlug(slug);
  if (!st) notFound();
  const agg = stateAgg(st.code);
  if (!agg) notFound();

  const sites = await topSites({ state: st.code }, 25);
  const counties = countiesForState(st.code)
    .filter((c) => c.count >= 5 && !!c.countyName)
    .sort((a, b) => b.count - a.count);

  const typeRows = Object.entries(agg.byType).map(([k, n]) => ({
    label: siteTypeLabel(k),
    count: n,
    href: SITE_TYPES[k] ? `/site-types/${SITE_TYPES[k].slug}/${st.slug}` : undefined,
  }));
  const isoRows = Object.entries(agg.byIso).map(([k, n]) => ({
    label: isoLabel(k),
    count: n,
    href: ISO_REGIONS[k] ? `/iso/${ISO_REGIONS[k].slug}` : undefined,
  }));

  const topType = typeRows.slice().sort((a, b) => b.count - a.count)[0];
  const topIso = isoRows.slice().sort((a, b) => b.count - a.count)[0];

  const faq = [
    {
      q: `How many datacenter sites are in ${st.name}?`,
      a: `GridCensus catalogs ${fmtInt(agg.count)} scored datacenter candidate sites in ${st.name}, with an average DC Readiness score of ${fmtScore(agg.avgScore)}/100.`,
    },
    {
      q: `What is the average interconnection-queue wait in ${st.name}?`,
      a: `Candidate sites in ${st.name} average a ${fmtYears(agg.avgQueueWaitYears)} interconnection-queue wait, with an average queue depth of ${fmtInt(agg.avgQueueDepth)} projects.`,
    },
    topType
      ? {
          q: `What kind of datacenter sites are most common in ${st.name}?`,
          a: `${topType.label} sites are the most common category in ${st.name} (${fmtInt(topType.count)} sites)${topIso ? `, and most sites fall within the ${topIso.label} grid region` : ""}.`,
        }
      : null,
  ].filter(Boolean) as { q: string; a: string }[];

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Locations", url: "/datacenter-sites" },
            { name: st.name, url: `/datacenter-sites/${st.slug}` },
          ]),
          placeSchema({ name: st.name, type: "State" }),
          datasetSchema({
            name: `Datacenter candidate sites in ${st.name}`,
            description: `${fmtInt(agg.count)} scored datacenter candidate sites in ${st.name}.`,
            url: `${SITE_URL}/datacenter-sites/${st.slug}`,
            spatialCoverage: st.name,
          }),
          itemListSchema(sites.map((s) => ({ name: s.name || "Site" }))),
          faqSchema(faq),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/datacenter-sites" className="hover:text-purple-600">Locations</a> / {st.name}
      </nav>

      <header className="mt-2">
        <h1 className="text-3xl font-bold text-gray-900">
          Datacenter Sites in {st.name}
        </h1>
        <p className="mt-2 max-w-3xl text-gray-700">
          {st.name} has {fmtInt(agg.count)} scored datacenter candidate sites
          averaging {fmtScore(agg.avgScore)}/100 DC Readiness.
          {topType ? ` ${topType.label} parcels lead the inventory (${fmtInt(topType.count)} sites).` : ""}
          {topIso ? ` Most sites interconnect through ${topIso.label}.` : ""} The
          state&apos;s candidate sites carry a catalogued aggregate of{" "}
          {fmtMw(agg.totalCapacityMw)} and average a{" "}
          {fmtYears(agg.avgQueueWaitYears)} interconnection-queue wait.
        </p>
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
          <h2 className="mb-3 text-lg font-bold text-gray-900">By site type</h2>
          <Breakdown rows={typeRows} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">By grid region</h2>
          <Breakdown rows={isoRows} />
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-bold text-gray-900">
          Average sub-score profile
        </h2>
        <p className="mb-4 text-sm text-gray-600">
          How {st.name}&apos;s candidate sites score on each DC Readiness
          dimension (0–100 average).
        </p>
        <SubScoreProfile agg={agg} />
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold text-gray-900">
          Top 25 datacenter sites in {st.name}
        </h2>
        <p className="mt-1 text-sm text-gray-600">Ranked by DC Readiness.</p>
        <div className="mt-3">
          <SitesTable sites={sites} caption={`Top datacenter sites in ${st.name}`} linkBuilder={siteProfilePath} />
        </div>
      </section>

      {counties.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-gray-900">
            Counties in {st.name}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {fmtInt(counties.length)} counties with five or more scored sites.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {counties.map((c) => (
              <a
                key={c.fips}
                href={`/datacenter-sites/${st.slug}/${countySlug(c.countyName)}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:border-purple-300"
              >
                <span className="text-gray-800">{c.countyName}</span>
                <span className="text-xs text-gray-500">
                  {fmtInt(c.count)} · {fmtScore(c.avgScore)}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-bold text-gray-900">
          {st.name} datacenter site selection FAQ
        </h2>
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
      <UpgradeCTA context={st.name} />
    </div>
  );
}
