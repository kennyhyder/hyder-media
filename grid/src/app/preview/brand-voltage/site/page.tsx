import type { Metadata } from "next";
import Link from "next/link";
import { topSites, getSiteByShortId } from "@/lib/db";
import type { FullDcSite } from "@/lib/db";
import { stateName } from "@/lib/geo";
import { V, mono } from "@/components/preview/brand-voltage/theme";
import { Shell, TopBar } from "@/components/preview/brand-voltage/Shell";
import {
  Card,
  Chip,
  Label,
  ScoreLockup,
  Stat,
  SubScore,
} from "@/components/preview/brand-voltage/ui";

export const metadata: Metadata = {
  title: "Voltage — Site Profile",
  robots: { index: false, follow: false },
};

export const revalidate = 86400;

function titleCase(s: string | null) {
  if (!s) return "Unnamed site";
  return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}
function km(v: number | null | undefined) {
  return v == null ? "—" : `${v.toFixed(1)} km`;
}
function mw(v: number | null | undefined) {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)} GW` : `${v.toFixed(0)} MW`;
}

export default async function VoltageSite() {
  const top = await topSites({ state: "VA" }, 1);
  const lead = top[0];
  let site: FullDcSite | null = null;
  if (lead) {
    site = await getSiteByShortId("VA", lead.fips_code ?? undefined, lead.id.slice(0, 8));
  }

  if (!site) {
    return (
      <Shell>
        <TopBar active="site" />
        <p style={{ padding: 48, color: V.muted }}>No site data available.</p>
      </Shell>
    );
  }

  const subScores: Array<[string, number | null]> = (
    [
      ["Power", site.score_power],
      ["Speed-to-power", site.score_speed_to_power],
      ["Fiber", site.score_fiber],
      ["Water", site.score_water],
      ["Hazard", site.score_hazard],
      ["Land", site.score_land],
      ["Buildability", site.score_buildability],
      ["Energy cost", site.score_energy_cost],
    ] as Array<[string, number | null]>
  ).filter(([, v]) => v != null);

  return (
    <Shell>
      <TopBar active="site" />

      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "26px 28px 56px" }}>
        {/* breadcrumb */}
        <nav
          style={{
            fontFamily: mono,
            fontSize: 11.5,
            color: V.muted,
            marginBottom: 26,
            display: "flex",
            gap: 8,
          }}
        >
          <Link href="/preview/brand-voltage" style={{ color: V.accent, textDecoration: "none" }}>
            National
          </Link>
          <span>/</span>
          <span>{stateName(site.state || "VA")}</span>
          <span>/</span>
          <span>{site.county}</span>
          <span>/</span>
          <span style={{ color: V.text }}>{titleCase(site.name)}</span>
        </nav>

        {/* ── HERO ──────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 300px",
            gap: 36,
            paddingBottom: 30,
            borderBottom: `1px solid ${V.border}`,
            alignItems: "center",
          }}
          className="vlt-hero"
        >
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
              <Chip accent>{site.iso_region || "ISO"}</Chip>
              {site.site_type ? <Chip>{titleCase(site.site_type)}</Chip> : null}
              {site.substation_voltage_kv ? (
                <Chip>{site.substation_voltage_kv} kV</Chip>
              ) : null}
            </div>
            <h1
              style={{
                fontWeight: 600,
                fontSize: "clamp(2rem, 4.2vw, 3.1rem)",
                lineHeight: 1.02,
                letterSpacing: "-0.03em",
                margin: "0 0 12px",
              }}
            >
              {titleCase(site.name)}
            </h1>
            <p style={{ color: V.muted, fontSize: 15, margin: 0 }}>
              {site.county}, {stateName(site.state || "VA")}
              {site.latitude && site.longitude ? (
                <span style={{ fontFamily: mono, marginLeft: 12, fontSize: 12.5 }}>
                  {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
                </span>
              ) : null}
            </p>
            <div style={{ display: "flex", gap: 32, marginTop: 26, flexWrap: "wrap" }}>
              <HeroMetric label="Capacity headroom" value={mw(site.available_capacity_mw)} />
              <HeroMetric
                label="Queue wait"
                value={
                  site.avg_queue_wait_years != null
                    ? `${site.avg_queue_wait_years.toFixed(1)} yr`
                    : "—"
                }
              />
              <HeroMetric
                label="Fiber providers"
                value={site.fcc_fiber_providers != null ? String(site.fcc_fiber_providers) : "—"}
              />
            </div>
          </div>

          {/* signature score lockup (NOT a ring) */}
          <Card style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <Label style={{ marginBottom: 18 }}>Composite readiness</Label>
            <ScoreLockup score={site.dc_score} size="lg" />
          </Card>
        </div>

        {/* ── SUB-SCORES ────────────────────────────────────── */}
        <div style={{ marginTop: 30 }}>
          <Label style={{ marginBottom: 16 }}>Sub-score breakdown</Label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "20px 28px",
            }}
            className="vlt-sub-grid"
          >
            {subScores.map(([l, v]) => (
              <SubScore key={l} label={l} value={v} />
            ))}
          </div>
        </div>

        {/* ── DETAIL CARDS ──────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0,1fr))",
            gap: 20,
            marginTop: 34,
          }}
          className="vlt-2col"
        >
          <Card>
            <Label style={{ color: V.accent }}>Power &amp; interconnection</Label>
            <div style={{ marginTop: 10 }}>
              <Stat label="Substation kV" value={site.substation_voltage_kv ? `${site.substation_voltage_kv} kV` : "—"} accent />
              <Stat label="Nearest substation" value={titleCase(site.nearest_substation_name)} />
              <Stat label="Distance" value={km(site.nearest_substation_distance_km)} />
              <Stat label="Available capacity" value={mw(site.available_capacity_mw)} />
              <Stat label="Utility" value={site.utility_name || "—"} />
              <Stat label="Wholesale LMP" value={site.lmp_wholesale_mwh != null ? `$${site.lmp_wholesale_mwh.toFixed(0)}/MWh` : "—"} />
            </div>
          </Card>

          <Card>
            <Label style={{ color: V.accent }}>Speed-to-power</Label>
            <div style={{ marginTop: 10 }}>
              <Stat label="ISO region" value={site.iso_region || "—"} accent />
              <Stat label="Queue depth" value={site.queue_depth != null ? site.queue_depth.toLocaleString() : "—"} />
              <Stat label="Avg queue wait" value={site.avg_queue_wait_years != null ? `${site.avg_queue_wait_years.toFixed(1)} yr` : "—"} />
              <Stat label="Recent wait" value={site.recent_queue_wait_years != null ? `${site.recent_queue_wait_years.toFixed(1)} yr` : "—"} />
              <Stat label="Completion rate" value={site.queue_completion_rate != null ? `${(site.queue_completion_rate * 100).toFixed(0)}%` : "—"} />
            </div>
          </Card>

          <Card>
            <Label style={{ color: V.accent }}>Connectivity</Label>
            <div style={{ marginTop: 10 }}>
              <Stat label="Nearest IXP" value={site.nearest_ixp_name || "—"} accent />
              <Stat label="IXP distance" value={km(site.nearest_ixp_distance_km)} />
              <Stat label="Fiber providers" value={site.fcc_fiber_providers != null ? String(site.fcc_fiber_providers) : "—"} />
              <Stat label="Fiber coverage" value={site.fcc_fiber_pct != null ? `${site.fcc_fiber_pct.toFixed(0)}%` : "—"} />
              <Stat label="Nearest cloud" value={site.nearest_cloud_provider || "—"} />
            </div>
          </Card>

          <Card>
            <Label style={{ color: V.accent }}>Risk &amp; environment</Label>
            <div style={{ marginTop: 10 }}>
              <Stat label="Flood zone" value={site.flood_zone || "—"} accent />
              <Stat label="In SFHA" value={site.flood_zone_sfha == null ? "—" : site.flood_zone_sfha ? "Yes" : "No"} />
              <Stat label="Water stress (WRI)" value={site.wri_water_stress != null ? site.wri_water_stress.toFixed(2) : "—"} />
              <Stat label="Basin" value={site.wri_basin_name || "—"} />
              <Stat label="Superfund nearby" value={site.superfund_nearby == null ? "—" : site.superfund_nearby ? "Yes" : "No"} />
            </div>
          </Card>
        </div>

        <p
          style={{
            color: V.muted,
            fontSize: 12,
            lineHeight: 1.6,
            marginTop: 30,
            paddingTop: 20,
            borderTop: `1px solid ${V.border}`,
          }}
        >
          Screening estimate. Capacity headroom is indicative of nearby
          substation capacity, not a confirmed interconnection. Validate with
          the serving utility and ISO queue before committing.
        </p>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .vlt-hero { grid-template-columns: 1fr !important; }
          .vlt-2col { grid-template-columns: 1fr !important; }
          .vlt-sub-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </Shell>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: mono,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontSize: 10,
          color: V.muted,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 21,
          fontWeight: 600,
          color: V.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}
