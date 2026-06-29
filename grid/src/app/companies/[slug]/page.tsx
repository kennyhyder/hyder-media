import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_NAME, SITE_URL, CONTACT_EMAIL } from "@/lib/site";
import { stateName, stateByCode } from "@/lib/geo";
import {
  getOrgRecord,
  orgShouldIndex,
  topOrganizations,
  orgDatacenters,
  orgCandidateSites,
  orgSubstations,
  orgTransmissionLines,
  orgFiberRoutes,
  orgRailLines,
  orgBrownfields,
  orgIxps,
  type OrgAssets,
} from "@/lib/organizations";
import {
  datacenterProfilePath,
  ixpProfilePath,
  substationProfilePath,
  brownfieldProfilePath,
  siteProfilePath,
} from "@/lib/entity-slug";
import { fmtInt, fmtMwExact, fmtKv, fmtScore } from "@/lib/format";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { Card } from "@/components/EntityProfile";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import { freshness } from "@/lib/rollups";
import { getPageOverride, applyOverride } from "@/lib/gsc/page-override";

export const revalidate = 86400;
export const dynamicParams = true;

// Pre-render the top organizations at build; the long tail renders on-demand
// (ISR) on first request. There can be 10k+ orgs — prerendering them all would
// blow the build.
export async function generateStaticParams() {
  return topOrganizations(500).map((o) => ({ slug: o.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const rec = getOrgRecord(slug);
  if (!rec) return { title: "Organization not found", robots: { index: false, follow: false } };
  const stateBit =
    rec.states.length > 0
      ? ` across ${rec.states.length} ${rec.states.length === 1 ? "state" : "states"}`
      : "";
  const base = {
    title: `${rec.name} — Infrastructure Portfolio & Assets`,
    description: `${rec.name} owns or operates ${fmtInt(
      rec.totalAssets
    )} catalogued infrastructure assets${stateBit} — datacenters, candidate sites, substations, transmission, fiber, and more. Explore ${rec.name}'s full footprint cross-linked across the ${SITE_NAME} dataset.`,
  };
  const override = await getPageOverride(`/companies/${slug}`);
  return {
    ...applyOverride(base, override),
    alternates: { canonical: `${SITE_URL}/companies/${slug}` },
    robots: orgShouldIndex(rec) ? undefined : { index: false, follow: true },
  };
}

// ── Section asset-type metadata ──────────────────────────────────────────────
const ASSET_LABEL: Record<string, { label: string; singular: string }> = {
  datacenters: { label: "Datacenters", singular: "datacenter" },
  candidate_sites: { label: "Candidate Sites Owned", singular: "candidate site" },
  substations: { label: "Substations", singular: "substation" },
  transmission_lines: { label: "Transmission Lines", singular: "transmission line" },
  fiber_routes: { label: "Fiber Routes", singular: "fiber route" },
  rail_lines: { label: "Rail Lines", singular: "rail line" },
  brownfields: { label: "Brownfields", singular: "brownfield" },
  ixps: { label: "Internet Exchanges", singular: "internet exchange" },
  parcels: { label: "Parcels", singular: "parcel" },
};

function SectionShell({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-lg font-bold text-gray-900">
        {title} <span className="text-gray-400">({fmtInt(count)})</span>
      </h2>
      {children}
    </section>
  );
}

function loc(city: string | null, state: string | null): string {
  return [city, state].filter(Boolean).join(", ") || "—";
}

export default async function OrganizationProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const rec = getOrgRecord(slug);
  if (!rec) notFound();

  const profilePath = `/companies/${slug}`;
  const a = rec.assets;

  // Live per-asset pulls (capped) — counts come from the precomputed index, the
  // actual linked rows come from these. Run in parallel; each is a no-op when
  // the org has no variants for that column.
  const [dcs, sites, subs, lines, fiber, rail, brown, ixps] = await Promise.all([
    a.datacenters > 0 ? orgDatacenters(rec, 50) : Promise.resolve([]),
    a.candidate_sites > 0 ? orgCandidateSites(rec, 50) : Promise.resolve([]),
    a.substations > 0 ? orgSubstations(rec, 50) : Promise.resolve([]),
    a.transmission_lines > 0 ? orgTransmissionLines(rec, 40) : Promise.resolve([]),
    a.fiber_routes > 0 ? orgFiberRoutes(rec, 25) : Promise.resolve([]),
    a.rail_lines > 0 ? orgRailLines(rec, 25) : Promise.resolve([]),
    a.brownfields > 0 ? orgBrownfields(rec, 50) : Promise.resolve([]),
    a.ixps > 0 ? orgIxps(rec, 50) : Promise.resolve([]),
  ]);

  // Asset-type mix (only types the org actually has), for the hero strip.
  const mix = (Object.keys(ASSET_LABEL) as Array<keyof OrgAssets>)
    .filter((k) => a[k] > 0)
    .map((k) => ({ key: k as string, label: ASSET_LABEL[k].label, count: a[k] }));

  const owns = [
    ...dcs.map((d) => ({ "@type": "Organization", name: d.name || "Datacenter" })),
  ].slice(0, 25);

  const orgLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: rec.name,
    url: `${SITE_URL}${profilePath}`,
    description: `${rec.name} owns or operates ${fmtInt(
      rec.totalAssets
    )} catalogued infrastructure assets in the United States${
      rec.states.length ? ` across ${rec.states.length} states` : ""
    }.`,
    areaServed: rec.states.map((s) => ({ "@type": "State", name: stateName(s) })),
  };
  if (owns.length) orgLd.owns = owns;

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Organizations", url: "/companies" },
            { name: rec.name, url: profilePath },
          ]),
          orgLd,
          datasetSchema({
            name: `${rec.name} — infrastructure asset portfolio`,
            description: `Asset counts, state footprint, and full cross-linked asset list for ${rec.name}.`,
            url: `${SITE_URL}${profilePath}`,
            dateModified: freshness(),
            spatialCoverage: "United States",
          }),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <a href="/companies" className="hover:text-purple-600">Organizations</a> /{" "}
        <span className="text-gray-500">{rec.name}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{rec.name}</h1>
            <span className="rounded bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
              Organization
            </span>
          </div>
          <p className="mt-1 text-gray-600">
            {fmtInt(rec.totalAssets)} catalogued {rec.totalAssets === 1 ? "asset" : "assets"}
            {rec.states.length > 0
              ? ` · ${rec.states.length} ${rec.states.length === 1 ? "state" : "states"}`
              : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-gray-500">Total assets</div>
          <div className="inline-block rounded-lg bg-indigo-100 px-3 py-1 text-3xl font-bold text-indigo-800">
            {fmtInt(rec.totalAssets)}
          </div>
        </div>
      </header>

      <p className="mt-4 max-w-3xl text-gray-700">
        {rec.name} is an organization in the {SITE_NAME} infrastructure catalog,
        owning or operating {fmtInt(rec.totalAssets)} catalogued{" "}
        {rec.totalAssets === 1 ? "asset" : "assets"}
        {rec.states.length > 0
          ? ` across ${rec.states.length} ${rec.states.length === 1 ? "state" : "states"}`
          : ""}
        . An organization&rsquo;s existing footprint — its power assets, fiber,
        land, and facilities — is a strong signal of where it can expand and which
        markets it already controls. Every asset below links to its full profile.
      </p>

      {/* Asset-type mix strip */}
      {mix.length > 0 && (
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {mix.map((m) => (
            <a
              key={m.key}
              href={`#${m.key}`}
              className="rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-purple-300"
            >
              <div className="text-2xl font-bold text-indigo-800">{fmtInt(m.count)}</div>
              <div className="mt-0.5 text-xs font-medium text-gray-500">{m.label}</div>
            </a>
          ))}
        </section>
      )}

      <section className="mt-8">
        <Card title="Footprint">
          <div className="flex flex-wrap gap-2">
            {rec.states.length > 0 ? (
              rec.states.map((s) => {
                const st = stateByCode(s);
                const label = stateName(s);
                return st ? (
                  <a
                    key={s}
                    href={`/datacenter-sites/${st.slug}`}
                    className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-purple-100 hover:text-purple-800"
                    title={label}
                  >
                    {label}
                  </a>
                ) : (
                  <span key={s} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                    {label}
                  </span>
                );
              })
            ) : (
              <span className="text-sm text-gray-500">State footprint not catalogued.</span>
            )}
          </div>
        </Card>
      </section>

      {/* ── Datacenters ── */}
      {dcs.length > 0 && (
        <SectionShell id="datacenters" title="Datacenters" count={a.datacenters}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-medium">Facility</th>
                  <th className="py-2 pr-3 font-medium">Location</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 text-right font-medium">Capacity / Footprint</th>
                </tr>
              </thead>
              <tbody>
                {dcs.map((d) => (
                  <tr key={d.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3">
                      <a href={datacenterProfilePath(d)} className="font-medium text-purple-700 hover:underline">
                        {d.name || "Datacenter"}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{loc(d.city, d.state)}</td>
                    <td className="py-2 pr-3 text-gray-500">{d.dc_type || "—"}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">
                      {d.capacity_mw != null
                        ? fmtMwExact(d.capacity_mw)
                        : d.sqft != null
                        ? `${fmtInt(d.sqft)} sq ft`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.datacenters > dcs.length && (
            <p className="mt-3 text-xs text-gray-500">
              Showing {fmtInt(dcs.length)} of {fmtInt(a.datacenters)} datacenters.
            </p>
          )}
        </SectionShell>
      )}

      {/* ── Candidate sites owned ── */}
      {sites.length > 0 && (
        <SectionShell id="candidate_sites" title="Candidate Sites Owned" count={a.candidate_sites}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-medium">Site</th>
                  <th className="py-2 pr-3 font-medium">Location</th>
                  <th className="py-2 pr-3 text-right font-medium">DC Readiness</th>
                  <th className="py-2 pr-3 text-right font-medium">Candidate MW</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const path = siteProfilePath(s);
                  const name = s.name || "Candidate site";
                  return (
                    <tr key={s.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3">
                        {path ? (
                          <a href={path} className="font-medium text-purple-700 hover:underline">
                            {name}
                          </a>
                        ) : (
                          <span className="font-medium text-gray-700">{name}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-500">{loc(s.county, s.state)}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">
                        {s.dc_score != null ? `${fmtScore(s.dc_score)}/100` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-700">
                        {s.available_capacity_mw != null ? fmtMwExact(s.available_capacity_mw) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {a.candidate_sites > sites.length && (
            <p className="mt-3 text-xs text-gray-500">
              Showing {fmtInt(sites.length)} of {fmtInt(a.candidate_sites)} candidate sites where this
              organization is the catalogued parcel owner.
            </p>
          )}
        </SectionShell>
      )}

      {/* ── Substations ── */}
      {subs.length > 0 && (
        <SectionShell id="substations" title="Substations" count={a.substations}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-medium">Substation</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  <th className="py-2 pr-3 text-right font-medium">Max voltage</th>
                  <th className="py-2 pr-3 text-right font-medium">Connected lines</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => {
                  const path = substationProfilePath(s);
                  const name = s.name || "Substation";
                  return (
                    <tr key={s.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3">
                        {path ? (
                          <a href={path} className="font-medium text-purple-700 hover:underline">
                            {name}
                          </a>
                        ) : (
                          <span className="font-medium text-gray-700">{name}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-500">{s.state ? stateName(s.state) : "—"}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{fmtKv(s.max_voltage_kv)}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">
                        {s.connected_line_count != null ? fmtInt(s.connected_line_count) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {a.substations > subs.length && (
            <p className="mt-3 text-xs text-gray-500">
              Showing {fmtInt(subs.length)} of {fmtInt(a.substations)} substations.
            </p>
          )}
        </SectionShell>
      )}

      {/* ── Transmission lines ── */}
      {lines.length > 0 && (
        <SectionShell id="transmission_lines" title="Transmission Lines" count={a.transmission_lines}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-medium">Line</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  <th className="py-2 pr-3 text-right font-medium">Voltage</th>
                  <th className="py-2 pr-3 text-right font-medium">Length</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3 text-gray-700">
                      {l.hifld_id != null ? `Line #${l.hifld_id}` : "Transmission line"}
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{l.state ? stateName(l.state) : "—"}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">{fmtKv(l.voltage_kv)}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">
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
        </SectionShell>
      )}

      {/* ── Brownfields ── */}
      {brown.length > 0 && (
        <SectionShell id="brownfields" title="Brownfields" count={a.brownfields}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-medium">Site</th>
                  <th className="py-2 pr-3 font-medium">Location</th>
                  <th className="py-2 pr-3 font-medium">Former use</th>
                  <th className="py-2 pr-3 text-right font-medium">Legacy MW</th>
                </tr>
              </thead>
              <tbody>
                {brown.map((b) => {
                  const path = brownfieldProfilePath(b);
                  const name = b.name || "Brownfield site";
                  return (
                    <tr key={b.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3">
                        {path ? (
                          <a href={path} className="font-medium text-purple-700 hover:underline">
                            {name}
                          </a>
                        ) : (
                          <span className="font-medium text-gray-700">{name}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-500">{loc(b.city || b.county, b.state)}</td>
                      <td className="py-2 pr-3 text-gray-500">{b.former_use || "—"}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">
                        {b.existing_capacity_mw != null ? fmtMwExact(b.existing_capacity_mw) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {a.brownfields > brown.length && (
            <p className="mt-3 text-xs text-gray-500">
              Showing {fmtInt(brown.length)} of {fmtInt(a.brownfields)} brownfields.
            </p>
          )}
        </SectionShell>
      )}

      {/* ── Internet exchanges ── */}
      {ixps.length > 0 && (
        <SectionShell id="ixps" title="Internet Exchanges" count={a.ixps}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-medium">Facility</th>
                  <th className="py-2 pr-3 font-medium">Location</th>
                  <th className="py-2 pr-3 text-right font-medium">Networks</th>
                </tr>
              </thead>
              <tbody>
                {ixps.map((x) => (
                  <tr key={x.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3">
                      <a href={ixpProfilePath(x)} className="font-medium text-purple-700 hover:underline">
                        {x.name || "Internet exchange"}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{loc(x.city, x.state)}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">
                      {x.network_count != null ? fmtInt(x.network_count) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.ixps > ixps.length && (
            <p className="mt-3 text-xs text-gray-500">
              Showing {fmtInt(ixps.length)} of {fmtInt(a.ixps)} internet exchanges.
            </p>
          )}
        </SectionShell>
      )}

      {/* ── Fiber routes (no per-row profile; summarized) ── */}
      {fiber.length > 0 && (
        <SectionShell id="fiber_routes" title="Fiber Routes" count={a.fiber_routes}>
          <p className="mb-3 text-xs text-gray-500">
            {fmtInt(a.fiber_routes)} catalogued fiber route segments operated by {rec.name}. Sample:
          </p>
          <div className="flex flex-wrap gap-2">
            {fiber.map((r) => (
              <span key={r.id} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                {r.name || r.fiber_type || "Route"}
                {r.state ? ` · ${r.state}` : ""}
              </span>
            ))}
          </div>
        </SectionShell>
      )}

      {/* ── Rail lines (no per-row profile; summarized) ── */}
      {rail.length > 0 && (
        <SectionShell id="rail_lines" title="Rail Lines" count={a.rail_lines}>
          <p className="mb-3 text-xs text-gray-500">
            {fmtInt(a.rail_lines)} catalogued rail line segments owned by {rec.name}. Sample:
          </p>
          <div className="flex flex-wrap gap-2">
            {rail.map((r) => (
              <span key={r.id} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                {r.subdivision || "Rail segment"}
                {r.state ? ` · ${r.state}` : ""}
                {r.miles != null ? ` · ${r.miles.toFixed(1)} mi` : ""}
              </span>
            ))}
          </div>
        </SectionShell>
      )}

      {/* Claim CTA */}
      <section className="mt-8 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 p-5">
        <h2 className="text-lg font-bold text-gray-900">Is this your organization?</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Claim the {rec.name} profile to correct asset details, add capacity and
          availability, and surface your footprint to site-selection teams using {SITE_NAME}.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
              `Claim organization profile: ${rec.name}`
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
        Organization records are derived from public infrastructure datasets
        (EIA, HIFLD, FCC, PNNL, county parcels, PeeringDB) and may be incomplete or
        lag operational changes. Owner/operator names are normalized for grouping;
        counts and capacities are catalogued estimates. Confirm ownership and
        availability directly with the organization.
      </p>
      <UpgradeCTA context={rec.name} />
    </div>
  );
}
