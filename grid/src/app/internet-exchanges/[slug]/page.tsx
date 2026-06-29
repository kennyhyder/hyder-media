import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { stateByCode, stateName } from "@/lib/geo";
import {
  getIxpByShortId,
  nearbyIxps,
  nearbySitesByLatLng,
  nearbyDatacentersByLatLng,
  type IxpFacility,
  type DcSite,
} from "@/lib/db";
import {
  parseShortId,
  siteProfilePath,
  ixpProfilePath,
  datacenterProfilePath,
} from "@/lib/entity-slug";
import { fmtInt } from "@/lib/format";
import SitesTable from "@/components/SitesTable";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { Row, Card } from "@/components/EntityProfile";
import OrgLink from "@/components/OrgLink";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import { freshness } from "@/lib/rollups";

export const revalidate = 86400;
export const dynamicParams = true;
export function generateStaticParams() {
  return [] as Array<{ slug: string }>;
}

async function resolve(slug: string): Promise<IxpFacility | null> {
  const shortId = parseShortId(slug);
  if (!shortId) return null;
  return getIxpByShortId(shortId);
}

function shouldIndex(x: IxpFacility): boolean {
  return !!x.name && x.state != null && (x.latitude != null || x.city != null);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const x = await resolve(slug);
  if (!x) return { title: "Internet exchange not found", robots: { index: false, follow: false } };
  const name = x.name || "Internet Exchange Facility";
  const loc = [x.city, x.state].filter(Boolean).join(", ");
  const descParts = [
    x.network_count != null ? `${fmtInt(x.network_count)} connected networks` : null,
    x.ix_count != null && x.ix_count > 0 ? `${fmtInt(x.ix_count)} internet exchanges` : null,
    x.org_name,
  ].filter(Boolean);
  return {
    title: `${name} — Internet Exchange / Peering Facility${loc ? ` in ${loc}` : ""} | GridCensus`,
    description: `${name}${loc ? ` in ${loc}` : ""}, an internet exchange and peering facility. ${descParts.join(
      " · "
    )}. Carrier density, participant networks, and nearby datacenter candidate sites.`,
    alternates: { canonical: `${SITE_URL}/internet-exchanges/${slug}` },
    robots: shouldIndex(x) ? undefined : { index: false, follow: true },
  };
}

export default async function IxpProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const x = await resolve(slug);
  if (!x) notFound();

  const [peers, sites, dcs] = await Promise.all([
    nearbyIxps(x, 6),
    nearbySitesByLatLng(x.latitude, x.longitude, 8),
    nearbyDatacentersByLatLng(x.latitude, x.longitude, null, 5),
  ]);

  const name = x.name || "Internet Exchange Facility";
  const loc = [x.city, x.state].filter(Boolean).join(", ");
  const profilePath = `/internet-exchanges/${slug}`;
  const st = x.state ? stateByCode(x.state) : undefined;
  const nearbyLink = (s: DcSite) => siteProfilePath(s);

  const placeLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Place",
    name,
    description: `Internet exchange / peering facility${loc ? ` in ${loc}` : ""}.`,
    address: {
      "@type": "PostalAddress",
      addressRegion: x.state,
      addressLocality: x.city || undefined,
      streetAddress: x.address || undefined,
      postalCode: x.zipcode || undefined,
      addressCountry: x.country || "US",
    },
    url: `${SITE_URL}${profilePath}`,
  };
  if (x.latitude != null && x.longitude != null) {
    placeLd.geo = { "@type": "GeoCoordinates", latitude: x.latitude, longitude: x.longitude };
  }

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Internet Exchanges", url: "/internet-exchanges" },
            ...(st ? [{ name: st.name, url: `/internet-exchanges?state=${st.code}` }] : []),
            { name, url: profilePath },
          ]),
          placeLd,
          datasetSchema({
            name: `${name} — internet exchange / peering profile`,
            description: `Participant networks, carrier density, and location for ${name}${loc ? ` in ${loc}` : ""}.`,
            url: `${SITE_URL}${profilePath}`,
            dateModified: x.created_at ?? freshness(),
            spatialCoverage: loc || undefined,
          }),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <a href="/internet-exchanges" className="hover:text-purple-600">Internet Exchanges</a> /{" "}
        <span className="text-gray-500">{name}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{name}</h1>
            <span className="rounded bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800">
              Internet Exchange
            </span>
          </div>
          <p className="mt-1 text-gray-600">
            {loc || (x.state ? stateName(x.state) : "")}
            {x.org_name ? ` · ${x.org_name}` : ""}
          </p>
        </div>
        {x.network_count != null && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-gray-500">Connected networks</div>
            <div className="inline-block rounded-lg bg-sky-100 px-3 py-1 text-3xl font-bold text-sky-800">
              {fmtInt(x.network_count)}
            </div>
            <div className="mt-0.5 text-xs font-medium text-gray-500">networks</div>
          </div>
        )}
      </header>

      <p className="mt-4 max-w-3xl text-gray-700">
        {name} is an internet exchange and peering facility{loc ? ` in ${loc}` : ""}
        {x.org_name ? `, operated by ${x.org_name}` : ""}.
        {x.network_count != null && x.network_count > 0
          ? ` It hosts ${fmtInt(x.network_count)} connected network${x.network_count === 1 ? "" : "s"}`
          : ""}
        {x.ix_count != null && x.ix_count > 0
          ? ` across ${fmtInt(x.ix_count)} internet exchange${x.ix_count === 1 ? "" : "s"}`
          : ""}
        . Carrier and peering density is a core fiber-connectivity input for datacenter siting:
        proximity to a well-peered exchange shortens the path to low-latency, multi-carrier transit
        and reduces backhaul cost for a new facility.
      </p>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card title="Peering & carrier density">
          <Row
            label="Connected networks"
            value={x.network_count != null ? fmtInt(x.network_count) : null}
          />
          <Row
            label="Internet exchanges (IX)"
            value={x.ix_count != null ? fmtInt(x.ix_count) : null}
          />
          <Row label="Operator / org" value={x.org_name ? <OrgLink owner={x.org_name} /> : null} />
          <Row
            label="Website"
            value={
              x.website ? (
                <a href={x.website} rel="nofollow noopener" target="_blank" className="text-purple-700 hover:underline">
                  Visit ↗
                </a>
              ) : null
            }
          />
        </Card>

        <Card title="Location">
          <Row label="Address" value={x.address} />
          <Row label="City" value={x.city} />
          <Row label="State" value={st ? (
            <a href={`/datacenter-sites/${st.slug}`} className="text-purple-700 hover:underline">{st.name}</a>
          ) : x.state} />
          <Row label="ZIP" value={x.zipcode} />
          {x.latitude != null && x.longitude != null && (
            <Row label="Coordinates" value={`${x.latitude.toFixed(4)}, ${x.longitude.toFixed(4)}`} />
          )}
        </Card>
      </section>

      {peers.length > 0 && (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Other exchanges in {x.city}</h2>
          <ul className="space-y-1.5 text-sm">
            {peers.map((p) => (
              <li key={p.id} className="flex justify-between gap-4 border-b border-gray-100 py-1.5 last:border-0">
                <a href={ixpProfilePath(p)} className="font-medium text-purple-700 hover:underline">
                  {p.name}
                </a>
                <span className="text-gray-500">
                  {p.network_count != null ? `${fmtInt(p.network_count)} networks` : "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dcs.length > 0 && (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Nearby datacenters</h2>
          <ul className="space-y-1.5 text-sm">
            {dcs.map((d) => (
              <li key={d.id} className="flex justify-between gap-4 border-b border-gray-100 py-1.5 last:border-0">
                <a href={datacenterProfilePath(d)} className="font-medium text-purple-700 hover:underline">
                  {d.name}
                </a>
                <span className="text-gray-500">
                  {[d.operator, [d.city, d.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
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
            Scored candidate sites near {name}, ranked by DC Readiness. Co-location near a
            well-peered exchange is a meaningful fiber-connectivity advantage.
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
        Exchange and peering data is sourced from public PeeringDB records and may lag facility
        changes. Network and IX counts are point-in-time figures; confirm current peering options
        and cross-connect availability directly with the facility operator.
      </p>
      <UpgradeCTA context={`${name}${loc ? `, ${loc}` : ""}`} />
    </div>
  );
}
