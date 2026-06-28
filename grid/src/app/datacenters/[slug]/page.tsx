import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { stateByCode, stateName } from "@/lib/geo";
import {
  getDatacenterByShortId,
  nearbySitesByLatLng,
  nearbyIxpsByLatLng,
  nearbyDatacentersByLatLng,
  type Datacenter,
  type DcSite,
} from "@/lib/db";
import {
  parseShortId,
  siteProfilePath,
  ixpProfilePath,
  datacenterProfilePath,
} from "@/lib/entity-slug";
import { fmtInt, fmtMwExact } from "@/lib/format";
import SitesTable from "@/components/SitesTable";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { Row, Card } from "@/components/EntityProfile";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import { freshness } from "@/lib/rollups";

export const revalidate = 86400;
export const dynamicParams = true;
export function generateStaticParams() {
  return [] as Array<{ slug: string }>;
}

async function resolve(slug: string): Promise<Datacenter | null> {
  const shortId = parseShortId(slug);
  if (!shortId) return null;
  return getDatacenterByShortId(shortId);
}

function shouldIndex(d: Datacenter): boolean {
  return !!d.name && d.state != null && (d.latitude != null || d.city != null);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const d = await resolve(slug);
  if (!d) return { title: "Datacenter not found", robots: { index: false, follow: false } };
  const name = d.name || "Datacenter";
  const loc = [d.city, d.state].filter(Boolean).join(", ") || (d.state ? stateName(d.state) : "");
  const descParts = [
    d.operator,
    d.capacity_mw != null ? `${fmtMwExact(d.capacity_mw)} capacity` : null,
    d.sqft != null ? `${fmtInt(d.sqft)} sq ft` : null,
  ].filter(Boolean);
  return {
    title: `${name} — Datacenter${loc ? ` in ${loc}` : ""}${d.operator ? ` (${d.operator})` : ""} | GridCensus`,
    description: `${name}${loc ? ` in ${loc}` : ""}, an operating datacenter facility. ${descParts.join(
      " · "
    )}. Operator, location, nearby internet exchanges, and candidate sites for expansion.`,
    alternates: { canonical: `${SITE_URL}/datacenters/${slug}` },
    robots: shouldIndex(d) ? undefined : { index: false, follow: true },
  };
}

export default async function DatacenterProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const d = await resolve(slug);
  if (!d) notFound();

  const [sites, ixps, peers] = await Promise.all([
    nearbySitesByLatLng(d.latitude, d.longitude, 8),
    nearbyIxpsByLatLng(d.latitude, d.longitude, 5),
    nearbyDatacentersByLatLng(d.latitude, d.longitude, d.id, 5),
  ]);

  const name = d.name || "Datacenter";
  const loc = [d.city, d.state].filter(Boolean).join(", ") || (d.state ? stateName(d.state) : "");
  const profilePath = `/datacenters/${slug}`;
  const st = d.state ? stateByCode(d.state) : undefined;
  const nearbyLink = (s: DcSite) => siteProfilePath(s);

  const placeLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Place",
    name,
    description: `Operating datacenter facility${loc ? ` in ${loc}` : ""}${d.operator ? `, operated by ${d.operator}` : ""}.`,
    address: {
      "@type": "PostalAddress",
      addressRegion: d.state,
      addressLocality: d.city || undefined,
      streetAddress: d.address || undefined,
      postalCode: d.zipcode || undefined,
      addressCountry: "US",
    },
    url: `${SITE_URL}${profilePath}`,
  };
  if (d.latitude != null && d.longitude != null) {
    placeLd.geo = { "@type": "GeoCoordinates", latitude: d.latitude, longitude: d.longitude };
  }

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Datacenters", url: "/datacenters" },
            ...(st ? [{ name: st.name, url: `/datacenters?state=${st.code}` }] : []),
            { name, url: profilePath },
          ]),
          placeLd,
          datasetSchema({
            name: `${name} — datacenter facility profile`,
            description: `Operator, capacity, footprint, and location for ${name}${loc ? ` in ${loc}` : ""}.`,
            url: `${SITE_URL}${profilePath}`,
            dateModified: d.created_at ?? freshness(),
            spatialCoverage: loc || undefined,
          }),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <a href="/datacenters" className="hover:text-purple-600">Datacenters</a> /{" "}
        <span className="text-gray-500">{name}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{name}</h1>
            <span className="rounded bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
              Datacenter
            </span>
            {d.status && (
              <span className="rounded bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 capitalize">
                {d.status}
              </span>
            )}
          </div>
          <p className="mt-1 text-gray-600">
            {loc}
            {d.operator ? ` · ${d.operator}` : ""}
          </p>
        </div>
        {(d.capacity_mw != null || d.sqft != null) && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {d.capacity_mw != null ? "Capacity" : "Footprint"}
            </div>
            <div className="inline-block rounded-lg bg-indigo-100 px-3 py-1 text-3xl font-bold text-indigo-800">
              {d.capacity_mw != null ? fmtInt(d.capacity_mw) : fmtInt(d.sqft)}
            </div>
            <div className="mt-0.5 text-xs font-medium text-gray-500">
              {d.capacity_mw != null ? "MW" : "sq ft"}
            </div>
          </div>
        )}
      </header>

      <p className="mt-4 max-w-3xl text-gray-700">
        {name} is an operating datacenter facility{loc ? ` in ${loc}` : ""}
        {d.operator ? `, operated by ${d.operator}` : ""}.
        {d.sqft != null ? ` It spans approximately ${fmtInt(d.sqft)} square feet` : ""}
        {d.capacity_mw != null ? ` with a catalogued ${fmtMwExact(d.capacity_mw)} of capacity` : ""}
        {d.year_built != null ? `, built in ${d.year_built}` : ""}. Existing datacenter clusters are
        a strong signal for new development: they confirm power availability, fiber peering, and a
        permitting precedent — which is why nearby candidate sites often inherit the same
        speed-to-power advantages.
      </p>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card title="Facility">
          <Row label="Operator" value={d.operator} />
          <Row label="Type" value={d.dc_type} />
          <Row label="Capacity" value={d.capacity_mw != null ? fmtMwExact(d.capacity_mw) : null} />
          <Row label="Footprint" value={d.sqft != null ? `${fmtInt(d.sqft)} sq ft` : null} />
          <Row label="Year built" value={d.year_built != null ? `${d.year_built}` : null} />
          <Row label="Status" value={d.status} />
          <Row
            label="Website"
            value={
              d.website ? (
                <a href={d.website} rel="nofollow noopener" target="_blank" className="text-purple-700 hover:underline">
                  Visit ↗
                </a>
              ) : null
            }
          />
        </Card>

        <Card title="Location">
          <Row label="Address" value={d.address} />
          <Row label="City" value={d.city} />
          <Row label="State" value={st ? (
            <a href={`/datacenter-sites/${st.slug}`} className="text-purple-700 hover:underline">{st.name}</a>
          ) : d.state} />
          <Row label="ZIP" value={d.zipcode} />
          {d.latitude != null && d.longitude != null && (
            <Row label="Coordinates" value={`${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}`} />
          )}
        </Card>
      </section>

      {ixps.length > 0 && (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Nearby internet exchanges</h2>
          <ul className="space-y-1.5 text-sm">
            {ixps.map((x) => (
              <li key={x.id} className="flex justify-between gap-4 border-b border-gray-100 py-1.5 last:border-0">
                <a href={ixpProfilePath(x)} className="font-medium text-purple-700 hover:underline">
                  {x.name}
                </a>
                <span className="text-gray-500">
                  {[x.city, x.state].filter(Boolean).join(", ")}
                  {x.network_count != null ? ` · ${fmtInt(x.network_count)} networks` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {peers.length > 0 && (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Other datacenters nearby</h2>
          <ul className="space-y-1.5 text-sm">
            {peers.map((p) => (
              <li key={p.id} className="flex justify-between gap-4 border-b border-gray-100 py-1.5 last:border-0">
                <a href={datacenterProfilePath(p)} className="font-medium text-purple-700 hover:underline">
                  {p.name}
                </a>
                <span className="text-gray-500">
                  {[p.operator, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sites.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-gray-900">Nearby datacenter candidate sites</h2>
          <p className="mt-1 text-sm text-gray-600">
            Scored candidate sites near {name}, ranked by DC Readiness — useful for evaluating
            expansion or second-site options in the same power/fiber market.
          </p>
          <div className="mt-3">
            <SitesTable
              sites={sites}
              showState
              showCounty
              caption={`Candidate sites near ${name}`}
              linkBuilder={nearbyLink}
            />
          </div>
        </section>
      )}

      <div className="mt-8">
        <Freshness />
      </div>
      <p className="mt-2 max-w-3xl text-xs text-gray-400">
        Datacenter records are derived from public facility datasets (PNNL and related sources) and
        may be incomplete or lag operational changes. Capacity and footprint are catalogued
        estimates — confirm operator, capacity, and availability directly with the facility.
      </p>
      <UpgradeCTA context={`${name}${loc ? `, ${loc}` : ""}`} />
    </div>
  );
}
