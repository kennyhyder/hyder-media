import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { SITE_TYPES, siteTypeBySlug, stateByCode, stateName } from "@/lib/geo";
import { siteTypeAgg } from "@/lib/rollups";
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
  itemListSchema,
  faqSchema,
} from "@/lib/schema";

export const revalidate = 86400;

export function generateStaticParams() {
  return Object.values(SITE_TYPES).map((t) => ({ type: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const { type } = await params;
  const t = siteTypeBySlug(type);
  const agg = t ? siteTypeAgg(t.key) : undefined;
  if (!t || !agg) return { title: "Type not found", robots: { index: false } };
  return {
    title: `${t.label} Datacenter Sites — ${fmtInt(agg.count)} Scored Locations`,
    description: `${fmtInt(agg.count)} ${t.label.toLowerCase()} datacenter candidate sites nationwide, averaging ${fmtScore(
      agg.avgScore
    )}/100 DC Readiness. What ${t.label.toLowerCase()} land means for datacenter siting, plus top states and sites.`,
    alternates: { canonical: `${SITE_URL}/site-types/${type}` },
  };
}

export default async function SiteTypePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const t = siteTypeBySlug(type);
  if (!t) notFound();
  const agg = siteTypeAgg(t.key);
  if (!agg) notFound();

  const isBrownfield = t.key === "brownfield";
  const sites = await topSites({ site_type: t.key }, 25);

  const stateRows = Object.entries(agg.byState).map(([code, n]) => ({
    label: stateName(code),
    count: n,
    href: stateByCode(code) ? `/site-types/${t.slug}/${stateByCode(code)!.slug}` : undefined,
  }));
  const topState = stateRows.slice().sort((a, b) => b.count - a.count)[0];

  const faq = [
    {
      q: `What is a ${t.label.toLowerCase()} datacenter site?`,
      a: t.blurb,
    },
    {
      q: `How many ${t.label.toLowerCase()} datacenter sites are there?`,
      a: `GridCensus catalogs ${fmtInt(agg.count)} ${t.label.toLowerCase()} candidate sites nationwide, averaging ${fmtScore(agg.avgScore)}/100 DC Readiness.`,
    },
    topState
      ? {
          q: `Which state has the most ${t.label.toLowerCase()} datacenter sites?`,
          a: `${topState.label} leads with ${fmtInt(topState.count)} ${t.label.toLowerCase()} candidate sites.`,
        }
      : null,
  ].filter(Boolean) as { q: string; a: string }[];

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Site Types", url: "/site-types" },
            { name: t.label, url: `/site-types/${t.slug}` },
          ]),
          datasetSchema({
            name: `${t.label} datacenter candidate sites`,
            description: `${fmtInt(agg.count)} ${t.label.toLowerCase()} datacenter candidate sites nationwide.`,
            url: `${SITE_URL}/site-types/${t.slug}`,
            spatialCoverage: "United States",
          }),
          itemListSchema(sites.map((s) => ({ name: s.name || "Site" }))),
          faqSchema(faq),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/site-types" className="hover:text-purple-600">Site Types</a> / {t.label}
      </nav>

      <header className="mt-2">
        <h1 className="text-3xl font-bold text-gray-900">
          {t.label} Datacenter Sites
        </h1>
        <p className="mt-3 max-w-3xl text-gray-700">{t.blurb}</p>
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
          <h2 className="mb-3 text-lg font-bold text-gray-900">Top states</h2>
          <Breakdown rows={stateRows} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Average sub-score profile</h2>
          <SubScoreProfile agg={agg} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold text-gray-900">
          Top 25 {t.label.toLowerCase()} datacenter sites
        </h2>
        <div className="mt-3">
          <SitesTable
            sites={sites}
            showState
            showFormerUse={isBrownfield}
            caption={`Top ${t.label} datacenter sites`}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-gray-900">{t.label} site FAQ</h2>
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
      <UpgradeCTA context={`${t.label} sites`} />
    </div>
  );
}
