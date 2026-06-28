import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { stateBySlug, stateName } from "@/lib/geo";
import {
  getSubstationByShortId,
  linesByHifldIds,
  nearbySitesByLatLng,
  type Substation,
  type TransmissionLine,
  type DcSite,
} from "@/lib/db";
import { parseShortId, siteProfilePath } from "@/lib/entity-slug";
import { fmtInt, fmtKv } from "@/lib/format";
import SitesTable from "@/components/SitesTable";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { Row, Card } from "@/components/EntityProfile";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import { freshness } from "@/lib/rollups";

// On-demand ISR: 38k+ substations must NOT prerender at build.
export const revalidate = 86400;
export const dynamicParams = true;
export function generateStaticParams() {
  return [] as Array<{ state: string; slug: string }>;
}

interface Resolved {
  sub: Substation;
  stateNm: string;
  stateSlug: string;
}

async function resolve(stateSlug: string, slug: string): Promise<Resolved | null> {
  const st = stateBySlug(stateSlug);
  if (!st) return null;
  const shortId = parseShortId(slug);
  if (!shortId) return null;
  const sub = await getSubstationByShortId(st.code, shortId);
  if (!sub) return null;
  return { sub, stateNm: st.name, stateSlug: st.slug };
}

/** Index gate: real (non-placeholder) name + coordinates + state. */
function shouldIndex(sub: Substation): boolean {
  const named = !!sub.name && !/^UNKNOWN/i.test(sub.name);
  return named && sub.state != null && sub.latitude != null && sub.longitude != null;
}

function voltageClass(kv: number | null | undefined): string {
  if (kv == null) return "Unclassified";
  if (kv >= 765) return "Extra-high-voltage (765 kV+)";
  if (kv >= 500) return "Extra-high-voltage (500 kV)";
  if (kv >= 345) return "High-voltage (345 kV)";
  if (kv >= 230) return "High-voltage (230 kV)";
  if (kv >= 138) return "Sub-transmission (138 kV)";
  if (kv >= 115) return "Sub-transmission (115 kV)";
  if (kv >= 69) return "Distribution (69–115 kV)";
  return "Distribution (<69 kV)";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; slug: string }>;
}): Promise<Metadata> {
  const { state, slug } = await params;
  const r = await resolve(state, slug);
  if (!r) return { title: "Substation not found", robots: { index: false, follow: false } };
  const { sub } = r;
  const name = sub.name || "Electric Substation";
  const kv = sub.max_voltage_kv != null ? `${Math.round(sub.max_voltage_kv)} kV` : null;
  const owner = sub.owners?.[0] || null;
  const descParts = [
    kv ? `${kv} substation` : "Substation",
    owner,
    sub.connected_line_count != null ? `${fmtInt(sub.connected_line_count)} connected transmission lines` : null,
  ].filter(Boolean);
  return {
    title: `${name} Substation — ${kv ? `${kv} · ` : ""}${r.stateNm} | GridCensus`,
    description: `${name}, a ${kv ? `${kv} ` : ""}electric transmission substation in ${r.stateNm}. ${descParts.join(
      " · "
    )}. Voltage class, operator, connected lines, and nearby datacenter candidate sites.`,
    alternates: { canonical: `${SITE_URL}/substations/${r.stateSlug}/${slug}` },
    robots: shouldIndex(sub) ? undefined : { index: false, follow: true },
  };
}

export default async function SubstationProfilePage({
  params,
}: {
  params: Promise<{ state: string; slug: string }>;
}) {
  const { state, slug } = await params;
  const r = await resolve(state, slug);
  if (!r) notFound();
  const { sub } = r;

  const [lines, nearby] = await Promise.all([
    sub.connected_line_ids?.length ? linesByHifldIds(sub.connected_line_ids, 12) : Promise.resolve([] as TransmissionLine[]),
    nearbySitesByLatLng(sub.latitude, sub.longitude, 8),
  ]);

  const name = sub.name || "Electric Substation";
  const kv = sub.max_voltage_kv;
  const owner = sub.owners?.[0] || null;
  const profilePath = `/substations/${r.stateSlug}/${slug}`;
  const stateHref = `/datacenter-sites/${r.stateSlug}`;
  const nearbyLink = (s: DcSite) => siteProfilePath(s);

  const placeLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: `${name} Substation`,
    description: `Electric transmission substation in ${r.stateNm}${
      kv != null ? `, ${Math.round(kv)} kV` : ""
    }.`,
    address: { "@type": "PostalAddress", addressRegion: sub.state, addressCountry: "US" },
    url: `${SITE_URL}${profilePath}`,
  };
  if (sub.latitude != null && sub.longitude != null) {
    placeLd.geo = { "@type": "GeoCoordinates", latitude: sub.latitude, longitude: sub.longitude };
  }

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Substations", url: "/substations" },
            { name: r.stateNm, url: `/substations/${r.stateSlug}` },
            { name, url: profilePath },
          ]),
          placeLd,
          datasetSchema({
            name: `${name} substation — grid infrastructure profile`,
            description: `Voltage class, operator, and connected transmission lines for ${name} substation in ${r.stateNm}.`,
            url: `${SITE_URL}${profilePath}`,
            dateModified: sub.created_at ?? freshness(),
            spatialCoverage: r.stateNm,
          }),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <a href="/substations" className="hover:text-purple-600">Substations</a> /{" "}
        <a href={`/substations/${r.stateSlug}`} className="hover:text-purple-600">{r.stateNm}</a> /{" "}
        <span className="text-gray-500">{name}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{name}</h1>
            <span className="rounded bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Substation
            </span>
          </div>
          <p className="mt-1 text-gray-600">
            {stateName(sub.state || "")}
            {owner ? ` · ${owner}` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-gray-500">Max voltage</div>
          <div className="inline-block rounded-lg bg-amber-100 px-3 py-1 text-3xl font-bold text-amber-800">
            {kv != null ? `${Math.round(kv)}` : "—"}
          </div>
          <div className="mt-0.5 text-xs font-medium text-gray-500">kV</div>
        </div>
      </header>

      <p className="mt-4 max-w-3xl text-gray-700">
        {name} is an electric transmission substation in {r.stateNm}
        {owner ? `, operated by ${owner}` : ""}. It is classified as{" "}
        {voltageClass(kv).toLowerCase()}
        {sub.connected_line_count != null
          ? ` and connects ${fmtInt(sub.connected_line_count)} transmission line${
              sub.connected_line_count === 1 ? "" : "s"
            }`
          : ""}
        . Substation proximity is one of the strongest speed-to-power signals for siting a
        datacenter — interconnection distance to an energized, high-voltage bus is often the
        binding constraint on time-to-energization.
      </p>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card title="Voltage & classification">
          <Row label="Max voltage" value={fmtKv(kv)} />
          <Row label="Min voltage" value={fmtKv(sub.min_voltage_kv)} />
          <Row label="Voltage class" value={voltageClass(kv)} />
          <Row
            label="Connected lines"
            value={sub.connected_line_count != null ? fmtInt(sub.connected_line_count) : null}
          />
        </Card>

        <Card title="Ownership & operation">
          {sub.owners && sub.owners.length > 0 ? (
            sub.owners.map((o, i) => <Row key={i} label={i === 0 ? "Operator" : "Co-owner"} value={o} />)
          ) : (
            <p className="text-sm text-gray-500">Operator not catalogued for this substation.</p>
          )}
          <Row label="State" value={
            <a href={stateHref} className="text-purple-700 hover:underline">{r.stateNm}</a>
          } />
          {sub.latitude != null && sub.longitude != null && (
            <Row label="Coordinates" value={`${sub.latitude.toFixed(4)}, ${sub.longitude.toFixed(4)}`} />
          )}
        </Card>
      </section>

      {lines.length > 0 && (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-1 text-lg font-bold text-gray-900">Connected transmission lines</h2>
          <p className="mb-3 text-xs text-gray-500">
            Lines terminating at or passing through this substation, by HIFLD line ID, highest voltage first.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Line ID</th>
                  <th className="px-3 py-2">Voltage</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Length</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">#{l.hifld_id}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtKv(l.voltage_kv)}</td>
                    <td className="px-3 py-2 text-gray-600">{l.owner || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{l.status || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {l.length_miles != null ? `${l.length_miles.toFixed(1)} mi` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm">
            <a href="/lines" className="font-medium text-purple-700 hover:underline">
              Browse the full transmission-line map →
            </a>
          </p>
        </section>
      )}

      {nearby.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-gray-900">Nearby datacenter candidate sites</h2>
          <p className="mt-1 text-sm text-gray-600">
            Scored candidate sites within roughly 25 miles of {name}, ranked by DC Readiness.
            Sites this close to an energized substation carry a strong speed-to-power advantage.
          </p>
          <div className="mt-3">
            <SitesTable
              sites={nearby}
              showState
              showCounty
              caption={`Candidate sites near ${name} substation`}
              linkBuilder={nearbyLink}
            />
          </div>
        </section>
      )}

      <div className="mt-8">
        <Freshness />
      </div>
      <p className="mt-2 max-w-3xl text-xs text-gray-400">
        Substation attributes are derived from public HIFLD / EIA infrastructure data and may lag
        real-world upgrades or retirements. Voltage and connected-line counts are screening
        figures — confirm available capacity and interconnection terms directly with the
        operating utility and ISO.
      </p>
      <UpgradeCTA context={`${name} substation, ${r.stateNm}`} />
    </div>
  );
}
