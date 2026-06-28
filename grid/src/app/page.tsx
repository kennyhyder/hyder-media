import type { Metadata } from "next";
import { SITE_NAME, SITE_URL, SITE_TAGLINE, SITE_DESCRIPTION } from "@/lib/site";
import { national } from "@/lib/rollups";
import { STATES, SITE_TYPES, ISO_REGIONS } from "@/lib/geo";
import { METRICS } from "@/lib/rankings";
import { topSites } from "@/lib/db";
import { siteProfilePath } from "@/lib/entity-slug";
import { fmtInt, fmtScore, fmtMw, fmtYears } from "@/lib/format";
import StatBand from "@/components/StatBand";
import SitesTable from "@/components/SitesTable";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import {
  webApplicationSchema,
  datasetSchema,
  organizationSchema,
  faqSchema,
} from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  alternates: { canonical: SITE_URL },
};

const FAQ = [
  {
    q: "What is GridCensus?",
    a: `${SITE_NAME} is a datacenter site-selection screening tool. It scores ${fmtInt(
      national.count
    )} candidate locations across the United States on power, speed-to-power, fiber, water, and hazard, using public infrastructure data.`,
  },
  {
    q: "How many datacenter sites are scored?",
    a: `${fmtInt(national.count)} candidate sites across all 50 states and DC, spanning nine site types and nine ISO/RTO regions.`,
  },
  {
    q: "What is 'speed-to-power'?",
    a: "Speed-to-power is how quickly a site can be energized — driven by proximity to existing transmission, substation adjacency, and interconnection-queue dynamics. It is the single biggest bottleneck in datacenter development today.",
  },
  {
    q: "Are the scores official capacity figures?",
    a: "No. Scores are screening estimates from public data, and catalogued candidate capacity is a theoretical aggregate of per-site estimates — not deliverable power. See the methodology page.",
  },
];

export default async function HomePage() {
  const top = await topSites({}, 20);

  return (
    <div>
      <JsonLd
        data={[
          organizationSchema(),
          webApplicationSchema(),
          datasetSchema({
            name: `${SITE_NAME} — US Datacenter Candidate Sites`,
            description: SITE_DESCRIPTION,
            url: SITE_URL,
            spatialCoverage: "United States",
          }),
          faqSchema(FAQ),
        ]}
      />

      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-2xl px-6 py-12 md:px-10 md:py-16"
        style={{
          background:
            "radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--accent) 22%, var(--surface)) 0%, var(--surface) 55%), var(--surface)",
          border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--border))",
        }}
      >
        <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
          Datacenter site intelligence
        </p>
        <h1 className="mt-2 max-w-3xl text-3xl font-extrabold leading-tight md:text-5xl" style={{ color: "var(--text)" }}>
          Find your next datacenter site — and how fast you can power it.
        </h1>
        <p className="mt-4 max-w-2xl" style={{ color: "var(--muted)" }}>
          {SITE_NAME} scores {fmtInt(national.count)} candidate locations across
          the US on power availability, speed-to-power, fiber, water, and
          hazard. Screen states, counties, grid regions, and site types in
          seconds.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="/datacenter-sites"
            className="accent-fill rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            Browse by location
          </a>
          <a
            href="/rankings"
            className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, var(--border))", color: "var(--accent)" }}
          >
            See the rankings
          </a>
        </div>
      </section>

      {/* National stat band */}
      <section className="mt-8">
        <StatBand
          stats={[
            { label: "Scored candidate sites", value: fmtInt(national.count) },
            { label: "Avg DC Readiness", value: `${fmtScore(national.avgScore)}/100` },
            {
              label: "Catalogued candidate capacity",
              value: fmtMw(national.totalCapacityMw),
              sub: "theoretical aggregate",
            },
            { label: "Avg queue wait", value: fmtYears(national.avgQueueWaitYears) },
          ]}
        />
      </section>

      {/* Hub links */}
      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-bold text-gray-900">Explore by location</h2>
          <p className="mt-1 text-sm text-gray-600">
            All 51 states, with per-county detail for {fmtInt(2886)} counties.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STATES.slice(0, 14).map((s) => (
              <a
                key={s.code}
                href={`/datacenter-sites/${s.slug}`}
                className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-purple-100 hover:text-purple-700"
              >
                {s.name}
              </a>
            ))}
            <a
              href="/datacenter-sites"
              className="rounded-md bg-purple-600 px-2 py-1 text-xs font-medium text-white hover:bg-purple-700"
            >
              All states →
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-bold text-gray-900">By grid region &amp; type</h2>
          <p className="mt-1 text-sm text-gray-600">
            Nine ISO/RTO regions and nine site types.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.values(ISO_REGIONS).map((r) => (
              <a
                key={r.key}
                href={`/iso/${r.slug}`}
                className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-purple-100 hover:text-purple-700"
              >
                {r.label}
              </a>
            ))}
            {Object.values(SITE_TYPES).map((t) => (
              <a
                key={t.key}
                href={`/site-types/${t.slug}`}
                className="rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600 hover:bg-purple-100 hover:text-purple-700"
              >
                {t.label}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Rankings teaser */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-gray-900">Datacenter rankings</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map((m) => (
            <a
              key={m.key}
              href={`/rankings/${m.key}`}
              className="rounded-lg border border-gray-200 bg-white p-3 text-sm font-medium text-gray-800 hover:border-purple-300 hover:text-purple-700"
            >
              {m.title} →
            </a>
          ))}
        </div>
      </section>

      {/* Top sites */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-gray-900">
          Top 20 highest-scored sites nationwide
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Ranked by DC Readiness across all {fmtInt(national.count)} candidate
          sites.
        </p>
        <div className="mt-3">
          <SitesTable sites={top} showState showCounty caption="Top scored US datacenter sites" linkBuilder={siteProfilePath} />
        </div>
      </section>

      {/* Methodology blurb */}
      <section className="mt-10 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-bold text-gray-900">How scoring works</h2>
        <p className="mt-2 text-sm text-gray-700">
          DC Readiness is a 0–100 weighted blend of ten factors — power (25%),
          speed-to-power (20%), fiber (15%), water (10%), hazard (10%), and
          smaller weights for labor, existing-datacenter ecosystem, land, tax,
          and climate. Scores are screening estimates from public data sources;
          catalogued capacity is a theoretical aggregate, not deliverable power.{" "}
          <a href="/methodology" className="font-medium text-purple-700 hover:underline">
            Read the full methodology →
          </a>
        </p>
      </section>

      <div className="mt-8">
        <Freshness />
      </div>

      <UpgradeCTA />
    </div>
  );
}
