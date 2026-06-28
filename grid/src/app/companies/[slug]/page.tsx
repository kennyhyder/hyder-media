import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_NAME, SITE_URL, CONTACT_EMAIL } from "@/lib/site";
import { stateName } from "@/lib/geo";
import { getCompanies, getCompanyBySlug, type Company, type CompanyFacility } from "@/lib/companies";
import { datacenterProfilePath, ixpProfilePath } from "@/lib/entity-slug";
import { fmtInt, fmtMw, fmtMwExact } from "@/lib/format";
import RegionMap from "@/components/map/RegionMap";
import type { MapSite } from "@/components/map/types";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { Row, Card } from "@/components/EntityProfile";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import { freshness } from "@/lib/rollups";

export const revalidate = 86400;
export const dynamicParams = true;

// Companies are a few hundred — generate them all at build (each is one
// getCompanies() pass, deduped by Next's request memoization within the build).
export async function generateStaticParams() {
  const companies = await getCompanies();
  return companies
    .filter((c) => c.name && c.facilityCount >= 1)
    .map((c) => ({ slug: c.slug }));
}

function shouldIndex(c: Company): boolean {
  return !!c.name && c.facilityCount >= 1;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCompanyBySlug(slug);
  if (!c) return { title: "Company not found", robots: { index: false, follow: false } };
  const stateBit =
    c.states.length > 0
      ? ` across ${c.states.length} ${c.states.length === 1 ? "state" : "states"}`
      : "";
  const capBit = c.totalCapacityMw > 0 ? ` and ${fmtMw(c.totalCapacityMw)} of catalogued capacity` : "";
  return {
    title: `${c.name} — Datacenter Portfolio`,
    description: `${c.name} operates ${fmtInt(c.facilityCount)} catalogued ${
      c.facilityCount === 1 ? "facility" : "facilities"
    }${stateBit}${capBit}. Explore ${c.name}'s datacenter and internet-exchange footprint, locations, and contact details.`,
    alternates: { canonical: `${SITE_URL}/companies/${slug}` },
    robots: shouldIndex(c) ? undefined : { index: false, follow: true },
  };
}

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const c = await getCompanyBySlug(slug);
  if (!c) notFound();

  const profilePath = `/companies/${slug}`;
  const dcs = c.facilities.filter((f) => f.kind === "datacenter");
  const ixps = c.facilities.filter((f) => f.kind === "ixp");

  // Up-to-200 facilities with coordinates → static map points.
  const mapSites: MapSite[] = c.facilities
    .filter((f) => f.latitude != null && f.longitude != null)
    .slice(0, 200)
    .map((f) => ({
      id: f.id,
      name: f.name,
      site_type: f.kind === "ixp" ? "exchange" : "datacenter",
      state: f.state,
      county: f.city,
      latitude: f.latitude,
      longitude: f.longitude,
      dc_score: null,
    }));

  const facilityLink = (f: CompanyFacility): string =>
    f.kind === "ixp"
      ? ixpProfilePath({ id: f.id, name: f.name })
      : datacenterProfilePath({ id: f.id, name: f.name });

  const orgLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: c.name,
    url: c.website || `${SITE_URL}${profilePath}`,
    description: `${c.name} operates ${fmtInt(c.facilityCount)} catalogued datacenter and internet-exchange ${
      c.facilityCount === 1 ? "facility" : "facilities"
    } in the United States${
      c.states.length ? ` across ${c.states.length} states` : ""
    }.`,
    numberOfEmployees: undefined,
    areaServed: c.states.map((s) => ({ "@type": "State", name: stateName(s) })),
  };
  if (c.salesEmail) orgLd.email = c.salesEmail;
  if (c.salesPhone) orgLd.telephone = c.salesPhone;
  if (c.website) orgLd.sameAs = [c.website];

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Companies", url: "/companies" },
            { name: c.name, url: profilePath },
          ]),
          orgLd,
          datasetSchema({
            name: `${c.name} — datacenter portfolio`,
            description: `Facility count, total capacity, and state footprint for ${c.name}.`,
            url: `${SITE_URL}${profilePath}`,
            dateModified: freshness(),
            spatialCoverage: "United States",
          }),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <a href="/companies" className="hover:text-purple-600">Companies</a> /{" "}
        <span className="text-gray-500">{c.name}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{c.name}</h1>
            <span className="rounded bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
              Operating company
            </span>
          </div>
          <p className="mt-1 text-gray-600">
            {fmtInt(c.facilityCount)} catalogued {c.facilityCount === 1 ? "facility" : "facilities"}
            {c.states.length > 0
              ? ` · ${c.states.length} ${c.states.length === 1 ? "state" : "states"}`
              : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-gray-500">Facilities</div>
          <div className="inline-block rounded-lg bg-indigo-100 px-3 py-1 text-3xl font-bold text-indigo-800">
            {fmtInt(c.facilityCount)}
          </div>
          {c.totalCapacityMw > 0 && (
            <div className="mt-0.5 text-xs font-medium text-gray-500">{fmtMw(c.totalCapacityMw)} total</div>
          )}
        </div>
      </header>

      <p className="mt-4 max-w-3xl text-gray-700">
        {c.name} is an operating company in the {SITE_NAME} infrastructure
        catalog, running {fmtInt(c.facilityCount)}{" "}
        {c.facilityCount === 1 ? "facility" : "facilities"}
        {dcs.length > 0 && ixps.length > 0
          ? ` (${fmtInt(dcs.length)} datacenter ${dcs.length === 1 ? "site" : "sites"} and ${fmtInt(
              ixps.length
            )} internet-exchange ${ixps.length === 1 ? "facility" : "facilities"})`
          : ""}
        {c.states.length > 0 ? ` across ${c.states.length} ${c.states.length === 1 ? "state" : "states"}` : ""}
        {c.totalCapacityMw > 0 ? `, totalling ${fmtMwExact(c.totalCapacityMw)} of catalogued capacity` : ""}. A
        company&rsquo;s existing footprint is a strong signal of where it can
        expand — established power, fiber peering, and permitting precedent
        cluster around an operator&rsquo;s current sites.
      </p>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card title="Portfolio">
          <Row label="Total facilities" value={fmtInt(c.facilityCount)} />
          <Row label="Datacenters" value={dcs.length > 0 ? fmtInt(dcs.length) : null} />
          <Row label="Internet exchanges" value={ixps.length > 0 ? fmtInt(ixps.length) : null} />
          <Row label="Catalogued capacity" value={c.totalCapacityMw > 0 ? fmtMwExact(c.totalCapacityMw) : null} />
          <Row label="Footprint" value={c.totalSqft > 0 ? `${fmtInt(c.totalSqft)} sq ft` : null} />
          <Row label="States" value={c.states.length > 0 ? fmtInt(c.states.length) : null} />
        </Card>

        <Card title="Contact">
          <Row
            label="Website"
            value={
              c.website ? (
                <a href={c.website} rel="nofollow noopener" target="_blank" className="text-purple-700 hover:underline">
                  Visit ↗
                </a>
              ) : null
            }
          />
          <Row
            label="Sales email"
            value={
              c.salesEmail ? (
                <a href={`mailto:${c.salesEmail}`} className="text-purple-700 hover:underline">
                  {c.salesEmail}
                </a>
              ) : null
            }
          />
          <Row
            label="Sales phone"
            value={
              c.salesPhone ? (
                <a href={`tel:${c.salesPhone}`} className="text-purple-700 hover:underline">
                  {c.salesPhone}
                </a>
              ) : null
            }
          />
          <Row
            label="States served"
            value={
              c.states.length > 0
                ? c.states.map((s) => stateName(s)).join(", ")
                : null
            }
          />
        </Card>
      </section>

      {mapSites.length > 0 && (
        <section className="mt-8" aria-label={`Map of ${c.name} facilities`}>
          <RegionMap
            sites={mapSites}
            height={420}
            label={`${c.name} · ${mapSites.length} mapped`}
          />
        </section>
      )}

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-bold text-gray-900">
          Facilities ({fmtInt(c.facilities.length)})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{c.name} facilities</caption>
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-3 font-medium">Facility</th>
                <th className="py-2 pr-3 font-medium">Location</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 text-right font-medium">Capacity / Footprint</th>
              </tr>
            </thead>
            <tbody>
              {c.facilities.slice(0, 300).map((f) => (
                <tr key={f.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-3">
                    <a href={facilityLink(f)} className="font-medium text-purple-700 hover:underline">
                      {f.name || (f.kind === "ixp" ? "Internet exchange" : "Datacenter")}
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-gray-500">
                    {[f.city, f.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="py-2 pr-3 text-gray-500">
                    {f.kind === "ixp" ? "Internet exchange" : f.dc_type || "Datacenter"}
                  </td>
                  <td className="py-2 pr-3 text-right text-gray-700">
                    {f.capacity_mw != null
                      ? fmtMwExact(f.capacity_mw)
                      : f.sqft != null
                      ? `${fmtInt(f.sqft)} sq ft`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {c.facilities.length > 300 && (
          <p className="mt-3 text-xs text-gray-500">
            Showing the first 300 of {fmtInt(c.facilities.length)} facilities.
          </p>
        )}
      </section>

      {/* Claim-this-profile CTA (placeholder; the real claim flow is a separate build). */}
      <section className="mt-8 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 p-5">
        <h2 className="text-lg font-bold text-gray-900">Is this your company?</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Claim the {c.name} profile to correct facility details, add capacity
          and contact information, and surface availability to site-selection
          teams using {SITE_NAME}.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
              `Claim company profile: ${c.name}`
            )}`}
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Claim this profile
          </a>
          <a
            href="/pricing"
            className="inline-flex items-center rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            See plans
          </a>
        </div>
      </section>

      <div className="mt-8">
        <Freshness />
      </div>
      <p className="mt-2 max-w-3xl text-xs text-gray-400">
        Operator records are derived from public facility datasets and may be
        incomplete or lag operational changes. Operator names are normalized for
        grouping; capacity and footprint are catalogued estimates. Confirm
        operator, capacity, and availability directly with the company.
      </p>
      <UpgradeCTA context={c.name} />
    </div>
  );
}
