import type { Metadata } from "next";
import type { ReactNode } from "react";
import { topSites, getSiteByShortId, nearbySites, type FullDcSite } from "@/lib/db";
import { stateName, SITE_TYPES } from "@/lib/geo";
import {
  fmtKv,
  fmtMwExact,
  fmtYears,
  fmtInt,
} from "@/lib/format";
import { rollups } from "@/lib/rollups";
import Wrapper, { styles } from "@/components/preview/editorial/Wrapper";
import Masthead from "@/components/preview/editorial/Masthead";
import {
  Kicker,
  Rule,
  SectionHead,
  SubScoreBreakdown,
} from "@/components/preview/editorial/primitives";
import { SiteMiniMap } from "@/components/preview/editorial/MapLoaders";
import { C } from "@/components/preview/editorial/theme";

export const metadata: Metadata = {
  title: "Editorial Light — Site Profile Preview",
  robots: { index: false, follow: false },
};

function monthYear(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

/** Pull a real high-score VA site (with its full column set). */
async function loadSite(): Promise<FullDcSite | null> {
  const [top] = await topSites({ state: "VA" }, 1);
  if (!top) return null;
  const shortId = top.id.slice(0, 8);
  return getSiteByShortId("VA", top.fips_code ?? undefined, shortId);
}

export default async function EditorialSite() {
  const site = await loadSite();
  const updated = monthYear(rollups.dataLastUpdated);

  if (!site) {
    return (
      <Wrapper>
        <Masthead dateline={`Updated ${updated}`} />
        <div className={styles.shell} style={{ padding: "4rem 0" }}>
          <p className={styles.serif} style={{ color: C.muted }}>
            No site available for preview (database unreachable).
          </p>
        </div>
      </Wrapper>
    );
  }

  const nearby = await nearbySites(site, 8);
  const typeLabel = SITE_TYPES[site.site_type ?? ""]?.label ?? site.site_type ?? "Site";
  const title = site.name || `${typeLabel} parcel`;

  const markers = [
    site.latitude != null && site.longitude != null
      ? {
          lat: site.latitude,
          lng: site.longitude,
          name: title,
          score: site.dc_score,
          primary: true,
        }
      : null,
    ...nearby
      .filter((n) => n.latitude != null && n.longitude != null)
      .map((n) => ({
        lat: n.latitude as number,
        lng: n.longitude as number,
        name: n.name || "Nearby parcel",
        score: n.dc_score,
        primary: false,
      })),
  ].filter(Boolean) as {
    lat: number;
    lng: number;
    name: string;
    score?: number | null;
    primary?: boolean;
  }[];

  return (
    <Wrapper>
      <Masthead dateline={`Updated ${updated}`} />

      <article className={styles.shell} style={{ padding: "2.5rem 0 1rem" }}>
        {/* Breadcrumb kicker */}
        <div
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: C.tealInk,
            marginBottom: "1.25rem",
          }}
        >
          Site Intelligence
          <span style={{ color: C.hairline, margin: "0 0.5rem" }}>/</span>
          {stateName(site.state ?? "VA")}
          <span style={{ color: C.hairline, margin: "0 0.5rem" }}>/</span>
          {site.county ?? "County"}
          <span style={{ color: C.hairline, margin: "0 0.5rem" }}>/</span>
          <span style={{ color: C.muted }}>Profile</span>
        </div>

        {/* Title block + score, side by side */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) auto",
            gap: "2.5rem",
            alignItems: "end",
            paddingBottom: "1.75rem",
            borderBottom: `2px solid ${C.text}`,
          }}
        >
          <div>
            <Kicker>{typeLabel} · {site.iso_region ?? "—"}</Kicker>
            <h1
              className={styles.serif}
              style={{
                fontSize: "clamp(2rem, 4vw, 2.9rem)",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
                color: C.text,
                margin: "0.5rem 0 0",
              }}
            >
              {title}
            </h1>
            <p
              className={styles.serif}
              style={{ fontSize: "1rem", color: C.muted, margin: "0.6rem 0 0", fontStyle: "italic" }}
            >
              {site.county ? `${site.county}, ` : ""}
              {stateName(site.state ?? "VA")}
              {site.latitude != null && site.longitude != null
                ? ` · ${site.latitude.toFixed(3)}°, ${site.longitude.toFixed(3)}°`
                : ""}
            </p>
          </div>

          {/* Elegant score: big mono number + composite caption */}
          <div style={{ textAlign: "right", minWidth: "9rem" }}>
            <div
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                fontSize: "0.625rem",
                fontWeight: 600,
                color: C.muted,
              }}
            >
              Composite Score
            </div>
            <div
              className={styles.mono}
              style={{
                fontSize: "4.25rem",
                fontWeight: 500,
                lineHeight: 1,
                color: C.teal,
                letterSpacing: "-0.03em",
                marginTop: "0.2rem",
              }}
            >
              {site.dc_score != null ? site.dc_score.toFixed(1) : "—"}
              <span style={{ fontSize: "1.25rem", color: C.muted, fontWeight: 400 }}>/100</span>
            </div>
          </div>
        </div>

        {/* Sub-score breakdown — refined horizontal bars */}
        <div style={{ marginTop: "1.75rem", maxWidth: "40rem" }}>
          <Kicker>Score composition</Kicker>
          <div style={{ marginTop: "0.85rem" }}>
            <SubScoreBreakdown
              scores={[
                { label: "Power", value: site.score_power },
                { label: "Speed-to-power", value: site.score_speed_to_power },
                { label: "Fiber", value: site.score_fiber },
                { label: "Water", value: site.score_water },
                { label: "Hazard resilience", value: site.score_hazard },
                ...(site.score_land != null ? [{ label: "Land", value: site.score_land }] : []),
                ...(site.score_climate != null ? [{ label: "Climate", value: site.score_climate }] : []),
              ]}
            />
          </div>
        </div>
      </article>

      {/* ── BODY: two-column broadsheet ──────────────────────────────────── */}
      <div className={styles.shell} style={{ paddingBottom: "3rem" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)",
            gap: "3rem",
            marginTop: "2.5rem",
            alignItems: "start",
          }}
        >
          {/* LEFT — ruled prose sections */}
          <div>
            <DataSection
              kicker="Section I"
              title="Power & interconnection"
              rows={[
                ["Substation voltage", fmtKv(site.substation_voltage_kv)],
                ["Available capacity", fmtMwExact(site.available_capacity_mw)],
                ["Nearest substation", site.nearest_substation_name ?? "—"],
                [
                  "Distance to substation",
                  site.nearest_substation_distance_km != null
                    ? `${site.nearest_substation_distance_km.toFixed(1)} km`
                    : "—",
                ],
                ["Serving utility", site.utility_name ?? "—"],
                [
                  "Wholesale LMP",
                  site.lmp_wholesale_mwh != null ? `$${site.lmp_wholesale_mwh.toFixed(0)}/MWh` : "—",
                ],
              ]}
            />

            <DataSection
              kicker="Section II"
              title="Speed to power"
              rows={[
                ["ISO / RTO", site.iso_region ?? "—"],
                ["Queue depth", site.queue_depth != null ? `${fmtInt(site.queue_depth)} projects` : "—"],
                ["Average queue wait", fmtYears(site.avg_queue_wait_years)],
                ["Recent queue wait", fmtYears(site.recent_queue_wait_years)],
                [
                  "Completion rate",
                  site.queue_completion_rate != null
                    ? `${(site.queue_completion_rate * 100).toFixed(0)}%`
                    : "—",
                ],
              ]}
            />

            <DataSection
              kicker="Section III"
              title="Connectivity"
              rows={[
                ["Nearest IXP", site.nearest_ixp_name ?? "—"],
                [
                  "Distance to IXP",
                  site.nearest_ixp_distance_km != null
                    ? `${site.nearest_ixp_distance_km.toFixed(1)} km`
                    : "—",
                ],
                [
                  "Fiber providers",
                  site.fcc_fiber_providers != null ? fmtInt(site.fcc_fiber_providers) : "—",
                ],
                [
                  "Fiber coverage",
                  site.fcc_fiber_pct != null ? `${(site.fcc_fiber_pct).toFixed(0)}%` : "—",
                ],
                ["Nearest cloud region", site.nearest_cloud_region ?? site.nearest_cloud_provider ?? "—"],
              ]}
            />

            <DataSection
              kicker="Section IV"
              title="Risk & environment"
              rows={[
                ["Flood zone", site.flood_zone ?? "—"],
                [
                  "Water stress (WRI)",
                  site.wri_water_stress != null ? site.wri_water_stress.toFixed(2) : "—",
                ],
                ["Basin", site.wri_basin_name ?? "—"],
                ["Wetland present", boolText(site.wetland_present)],
                ["Critical habitat", boolText(site.critical_habitat)],
                ["Superfund nearby", boolText(site.superfund_nearby)],
              ]}
            />

            <DataSection
              kicker="Section V"
              title="Location context"
              rows={[
                ["Parcel owner", site.parcel_owner ?? "—"],
                ["Acreage", site.acreage != null ? `${fmtInt(site.acreage)} ac` : "—"],
                ["Nearest datacenter", site.nearest_dc_name ?? "—"],
                [
                  "Distance to nearest DC",
                  site.nearest_dc_distance_km != null
                    ? `${site.nearest_dc_distance_km.toFixed(1)} km`
                    : "—",
                ],
                [
                  "Nearest rail",
                  site.nearest_rail_km != null ? `${site.nearest_rail_km.toFixed(1)} km` : "—",
                ],
                [
                  "Nearest gas pipeline",
                  site.nearest_gas_pipeline_km != null
                    ? `${site.nearest_gas_pipeline_km.toFixed(1)} km`
                    : "—",
                ],
              ]}
            />
          </div>

          {/* RIGHT — sticky map + comparables */}
          <aside style={{ position: "sticky", top: "1.5rem" }}>
            <Kicker>Figure · Location</Kicker>
            <div
              style={{
                marginTop: "0.75rem",
                background: C.surface,
                border: `1px solid ${C.hairline}`,
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              }}
            >
              <SiteMiniMap markers={markers} />
            </div>
            <p
              className={styles.serif}
              style={{ fontSize: "0.75rem", fontStyle: "italic", color: C.muted, margin: "0.6rem 0 0" }}
            >
              The screened parcel (teal) shown with the {nearby.length} nearest
              comparable candidates (amber). Positron base tiles &copy; CARTO.
            </p>

            {nearby.length > 0 && (
              <div style={{ marginTop: "1.75rem" }}>
                <Rule weight="bold" style={{ marginBottom: "0.75rem" }} />
                <Kicker>Comparable parcels nearby</Kicker>
                <div style={{ marginTop: "0.6rem" }}>
                  {nearby.slice(0, 6).map((n, i) => (
                    <div
                      key={n.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: "0.75rem",
                        padding: "0.55rem 0",
                        borderTop: i === 0 ? "none" : `1px solid ${C.hairlineSoft}`,
                      }}
                    >
                      <span
                        className={styles.serif}
                        style={{ fontSize: "0.875rem", color: C.text, lineHeight: 1.3 }}
                      >
                        {n.name || "Unnamed parcel"}
                        <span style={{ color: C.muted, fontSize: "0.75rem", display: "block" }}>
                          {SITE_TYPES[n.site_type ?? ""]?.label ?? n.site_type ?? "—"}
                        </span>
                      </span>
                      <span
                        className={styles.mono}
                        style={{ fontSize: "0.875rem", color: C.teal, fontWeight: 600 }}
                      >
                        {n.dc_score != null ? n.dc_score.toFixed(1) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* Footnote */}
      <footer style={{ background: C.surface, borderTop: `2px solid ${C.text}` }}>
        <div className={styles.shell} style={{ padding: "1.75rem 0 2.5rem" }}>
          <p
            className={styles.serif}
            style={{
              fontSize: "0.8125rem",
              fontStyle: "italic",
              lineHeight: 1.65,
              color: C.muted,
              maxWidth: "46rem",
              margin: 0,
            }}
          >
            Figures are desktop screening estimates compiled from public grid,
            hazard, and connectivity datasets. Available capacity reflects nearby
            grid headroom — an indication of opportunity, not a guarantee of firm,
            deliverable power. Confirm with an interconnection study and the
            serving utility before any siting decision.
          </p>
        </div>
      </footer>
    </Wrapper>
  );
}

/* ── helpers ───────────────────────────────────────────────────────────── */

function boolText(v: boolean | null | undefined): string {
  if (v == null) return "—";
  return v ? "Yes" : "No";
}

/** A ruled (not boxed) data block: section head + hairline definition rows. */
function DataSection({
  kicker,
  title,
  rows,
}: {
  kicker: string;
  title: string;
  rows: [string, ReactNode][];
}) {
  return (
    <section style={{ marginBottom: "2.25rem" }}>
      <SectionHead kicker={kicker} title={title} />
      <div>
        {rows.map(([k, v], i) => (
          <div
            key={k}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "1rem",
              alignItems: "baseline",
              padding: "0.6rem 0",
              borderTop: i === 0 ? `1px solid ${C.hairline}` : `1px solid ${C.hairlineSoft}`,
              borderBottom: i === rows.length - 1 ? `1px solid ${C.hairline}` : "none",
            }}
          >
            <span className={styles.serif} style={{ fontSize: "0.9375rem", color: C.text }}>
              {k}
            </span>
            <span
              className={styles.mono}
              style={{ fontSize: "0.875rem", color: C.text, fontWeight: 500, textAlign: "right" }}
            >
              {v}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
