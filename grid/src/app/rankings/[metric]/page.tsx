import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { METRICS, METRIC_KEYS, metricByKey } from "@/lib/rankings";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import {
  breadcrumbSchema,
  itemListSchema,
  datasetSchema,
  faqSchema,
} from "@/lib/schema";

export const revalidate = 86400;

export function generateStaticParams() {
  return METRIC_KEYS.map((metric) => ({ metric }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ metric: string }>;
}): Promise<Metadata> {
  const { metric } = await params;
  const m = metricByKey(metric);
  if (!m) return { title: "Ranking not found", robots: { index: false } };
  return {
    title: m.title,
    description: m.description,
    alternates: { canonical: `${SITE_URL}/rankings/${metric}` },
  };
}

export default async function RankingPage({
  params,
}: {
  params: Promise<{ metric: string }>;
}) {
  const { metric } = await params;
  const m = metricByKey(metric);
  if (!m) notFound();

  const rows = m.compute();
  const leader = rows[0];
  const runnerUp = rows[1];

  const faq = [
    {
      q: `What state ranks #1 for "${m.title.toLowerCase()}"?`,
      a: leader
        ? `${leader.name} ranks first with ${leader.display} (${m.unit})${
            runnerUp ? `, followed by ${runnerUp.name} (${runnerUp.display})` : ""
          }.`
        : "Insufficient data.",
    },
    {
      q: "How is this ranking calculated?",
      a: `${m.description} Figures are screening estimates derived from public data sources and refresh monthly.`,
    },
  ];

  const related = METRICS.filter((x) => x.key !== m.key).slice(0, 4);

  return (
    <article>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Rankings", url: "/rankings" },
            { name: m.title, url: `/rankings/${m.key}` },
          ]),
          datasetSchema({
            name: m.title,
            description: m.description,
            url: `${SITE_URL}/rankings/${m.key}`,
            spatialCoverage: "United States",
          }),
          itemListSchema(rows.map((r) => ({ name: r.name }))),
          faqSchema(faq),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/rankings" className="hover:text-purple-600">Rankings</a> / {m.title}
      </nav>

      <header className="mt-2">
        <h1 className="text-3xl font-bold text-gray-900">{m.title}</h1>
        <p className="mt-3 max-w-3xl text-gray-700">
          {m.description}
          {leader ? (
            <>
              {" "}
              <strong>{leader.name}</strong> leads with{" "}
              <strong>{leader.display}</strong> ({m.unit})
              {runnerUp ? `, ahead of ${runnerUp.name} (${runnerUp.display})` : ""}.
            </>
          ) : null}
        </p>
      </header>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 w-12">#</th>
              <th className="px-3 py-2">
                {m.subject === "iso" ? "Region" : m.subject === "site-type" ? "Site type" : "State"}
              </th>
              <th className="px-3 py-2 text-right">{capitalize(m.unit)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={r.name} className={i < 3 ? "bg-purple-50/40" : ""}>
                <td className="px-3 py-2 font-semibold tabular-nums text-gray-500">{i + 1}</td>
                <td className="px-3 py-2 font-medium text-gray-900">
                  {r.href ? (
                    <a href={r.href} className="hover:text-purple-700 hover:underline">
                      {r.name}
                    </a>
                  ) : (
                    r.name
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-bold text-gray-900">Methodology</h2>
        <p className="mt-2 text-sm text-gray-700">
          This ranking is computed directly from the MegaWatt Site dataset of
          164,098 scored candidate sites. Values are screening estimates derived
          from public data sources — not site-specific assessments. Catalogued
          capacity is a theoretical aggregate, not deliverable power.{" "}
          <a href="/methodology" className="font-medium text-purple-700 hover:underline">
            Full methodology →
          </a>
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold text-gray-900">Ranking FAQ</h2>
        <dl className="mt-3 space-y-4">
          {faq.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold text-gray-900">{f.q}</dt>
              <dd className="mt-1 text-gray-700">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8">
        <h3 className="text-sm font-semibold text-gray-700">Related rankings</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {related.map((x) => (
            <a
              key={x.key}
              href={`/rankings/${x.key}`}
              className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-purple-100 hover:text-purple-700"
            >
              {x.title}
            </a>
          ))}
        </div>
      </section>

      <div className="mt-8">
        <Freshness />
      </div>
      <UpgradeCTA />
    </article>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
