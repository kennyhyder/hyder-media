import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { SITE_TYPES, siteTypeBySlug, stateBySlug } from "@/lib/geo";
import { stateAgg } from "@/lib/rollups";
import { topSites } from "@/lib/db";
import { siteProfilePath } from "@/lib/entity-slug";
import { fmtInt, fmtScore } from "@/lib/format";
import StatBand from "@/components/StatBand";
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
export const dynamicParams = true;

// Combos where the state has >=5 sites of that type.
export function generateStaticParams() {
  const out: Array<{ type: string; state: string }> = [];
  for (const t of Object.values(SITE_TYPES)) {
    for (const s of stateSlugsWithType(t.key)) {
      out.push({ type: t.slug, state: s });
    }
  }
  return out;
}

import { STATES } from "@/lib/geo";
function stateSlugsWithType(typeKey: string): string[] {
  const slugs: string[] = [];
  for (const s of STATES) {
    const agg = stateAgg(s.code);
    if ((agg?.byType?.[typeKey] ?? 0) >= 5) slugs.push(s.slug);
  }
  return slugs;
}

function resolve(typeSlug: string, stateSlug: string) {
  const t = siteTypeBySlug(typeSlug);
  const st = stateBySlug(stateSlug);
  if (!t || !st) return null;
  const agg = stateAgg(st.code);
  const count = agg?.byType?.[t.key] ?? 0;
  return { t, st, count };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; state: string }>;
}): Promise<Metadata> {
  const { type, state } = await params;
  const r = resolve(type, state);
  if (!r || r.count < 5) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  return {
    title: `${r.t.label} Datacenter Sites in ${r.st.name}`,
    description: `${fmtInt(r.count)} ${r.t.label.toLowerCase()} datacenter candidate sites in ${r.st.name}. Top sites ranked by DC Readiness.`,
    alternates: { canonical: `${SITE_URL}/site-types/${type}/${state}` },
  };
}

export default async function TypeStatePage({
  params,
}: {
  params: Promise<{ type: string; state: string }>;
}) {
  const { type, state } = await params;
  const r = resolve(type, state);
  if (!r || r.count < 5) notFound();

  const sites = await topSites({ site_type: r.t.key, state: r.st.code }, 25);
  const avg = sites.length
    ? sites.reduce((s, x) => s + (x.dc_score ?? 0), 0) / sites.length
    : 0;

  const faq = [
    {
      q: `How many ${r.t.label.toLowerCase()} datacenter sites are in ${r.st.name}?`,
      a: `GridCensus catalogs ${fmtInt(r.count)} ${r.t.label.toLowerCase()} datacenter candidate sites in ${r.st.name}.`,
    },
    {
      q: `What is a ${r.t.label.toLowerCase()} datacenter site?`,
      a: r.t.blurb,
    },
  ];

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Site Types", url: "/site-types" },
            { name: r.t.label, url: `/site-types/${r.t.slug}` },
            { name: r.st.name, url: `/site-types/${r.t.slug}/${r.st.slug}` },
          ]),
          datasetSchema({
            name: `${r.t.label} datacenter sites in ${r.st.name}`,
            description: `${fmtInt(r.count)} ${r.t.label.toLowerCase()} datacenter candidate sites in ${r.st.name}.`,
            url: `${SITE_URL}/site-types/${r.t.slug}/${r.st.slug}`,
            spatialCoverage: r.st.name,
          }),
          itemListSchema(sites.map((s) => ({ name: s.name || "Site" }))),
          faqSchema(faq),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/site-types" className="hover:text-purple-600">Site Types</a> /{" "}
        <a href={`/site-types/${r.t.slug}`} className="hover:text-purple-600">{r.t.label}</a> / {r.st.name}
      </nav>

      <header className="mt-2">
        <h1 className="text-3xl font-bold text-gray-900">
          {r.t.label} Datacenter Sites in {r.st.name}
        </h1>
        <p className="mt-3 max-w-3xl text-gray-700">
          {r.st.name} has {fmtInt(r.count)} {r.t.label.toLowerCase()} datacenter
          candidate sites. {r.t.blurb}
        </p>
      </header>

      <section className="mt-6">
        <StatBand
          stats={[
            { label: `${r.t.label} sites`, value: fmtInt(r.count) },
            { label: "Avg score (top 25)", value: `${fmtScore(avg)}/100` },
            { label: "State", value: r.st.name },
            { label: "Type", value: r.t.label },
          ]}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold text-gray-900">
          Top {r.t.label.toLowerCase()} sites in {r.st.name}
        </h2>
        <div className="mt-3">
          <SitesTable
            sites={sites}
            showFormerUse={r.t.key === "brownfield"}
            caption={`Top ${r.t.label} sites in ${r.st.name}`}
            linkBuilder={siteProfilePath}
          />
        </div>
      </section>

      <section className="mt-10">
        <dl className="space-y-4">
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
      <UpgradeCTA context={`${r.t.label} sites in ${r.st.name}`} />
    </div>
  );
}
