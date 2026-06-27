import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import JsonLd from "@/components/JsonLd";
import Freshness from "@/components/Freshness";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";
import { national } from "@/lib/rollups";
import { fmtInt } from "@/lib/format";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "DC Readiness Methodology",
  description: `How ${SITE_NAME} scores datacenter candidate sites: a weighted 0–100 model blending power, speed-to-power, fiber, water, hazard, labor, land, tax, climate, and existing-datacenter signals from public data sources.`,
  alternates: { canonical: `${SITE_URL}/methodology` },
};

const WEIGHTS = [
  { factor: "Power availability", weight: 25, note: "Estimated deliverable capacity, substation proximity, and headroom." },
  { factor: "Speed-to-power", weight: 20, note: "Interconnection-queue dynamics, substation adjacency, transmission distance." },
  { factor: "Fiber", weight: 15, note: "Count of nearby fiber providers and internet-exchange proximity." },
  { factor: "Water", weight: 10, note: "Water-stress index (cooling-water availability proxy)." },
  { factor: "Hazard", weight: 10, note: "FEMA National Risk Index and flood-zone exposure." },
  { factor: "Labor", weight: 5, note: "Construction-trades employment and wage data." },
  { factor: "Existing datacenter", weight: 5, note: "Proximity to existing datacenter clusters and ecosystem." },
  { factor: "Land", weight: 5, note: "Estimated land price per acre and parcel size." },
  { factor: "Tax", weight: 3, note: "Presence of datacenter tax incentives in the jurisdiction." },
  { factor: "Climate", weight: 2, note: "Cooling/heating degree days and mean temperature." },
];

const FAQ = [
  {
    q: "What does the DC Readiness score mean?",
    a: "It is a 0–100 screening estimate that blends ten weighted factors into a single number. A higher score means a site screens better across power, speed-to-power, fiber, water, and hazard. It is a starting point for site selection, not a substitute for site-specific engineering, environmental, or interconnection studies.",
  },
  {
    q: "Is the catalogued capacity actually available power?",
    a: "No. 'Catalogued candidate capacity' is the sum of per-site available-capacity estimates — a theoretical aggregate, not deliverable power and not power available now. Actual deliverable capacity depends on interconnection studies and utility commitments.",
  },
  {
    q: "Where does the data come from?",
    a: "Public sources including FEMA's National Risk Index, FCC fiber data, EIA electricity rates, FERC interconnection queues, parcel and land-use records, and climate normals. Scores are derived estimates and refresh monthly.",
  },
  {
    q: "How often is the dataset updated?",
    a: "The aggregate dataset refreshes monthly. Every page shows a machine-readable 'Dataset updated' timestamp.",
  },
];

export default function MethodologyPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Methodology", url: "/methodology" },
          ]),
          faqSchema(FAQ),
        ]}
      />
      <h1 className="text-3xl font-bold text-gray-900">DC Readiness Methodology</h1>
      <p className="mt-3 text-gray-700">
        {SITE_NAME} scores {fmtInt(national.count)} candidate datacenter
        locations on a single 0–100 <strong>DC Readiness</strong> score. The
        score is a weighted blend of ten factors derived from public data
        sources. It is a screening tool to triage where to look first — not a
        site-specific engineering, environmental, or interconnection
        assessment.
      </p>

      <h2 className="mt-8 text-xl font-bold text-gray-900">Scoring weights</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Factor</th>
              <th className="px-3 py-2">Weight</th>
              <th className="px-3 py-2">What it captures</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {WEIGHTS.map((w) => (
              <tr key={w.factor}>
                <td className="px-3 py-2 font-medium text-gray-900">{w.factor}</td>
                <td className="px-3 py-2 tabular-nums text-gray-700">{w.weight}%</td>
                <td className="px-3 py-2 text-gray-600">{w.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-xl font-bold text-gray-900">Honest limitations</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-gray-700">
        <li>
          Scores are <strong>screening estimates derived from public data</strong>,
          not verified, site-specific assessments.
        </li>
        <li>
          Catalogued candidate capacity is a <strong>theoretical aggregate</strong>{" "}
          of per-site estimates — never &quot;deliverable&quot; or &quot;available now.&quot;
        </li>
        <li>
          Interconnection feasibility, environmental remediation, and utility
          commitments require dedicated studies beyond this screen.
        </li>
      </ul>

      <h2 className="mt-8 text-xl font-bold text-gray-900">FAQ</h2>
      <dl className="mt-3 space-y-4">
        {FAQ.map((f) => (
          <div key={f.q}>
            <dt className="font-semibold text-gray-900">{f.q}</dt>
            <dd className="mt-1 text-gray-700">{f.a}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8">
        <Freshness />
      </div>
    </article>
  );
}
