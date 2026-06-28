import type { Metadata } from "next";
import Link from "next/link";
import { topSites, getSiteByShortId, nearbySites } from "@/lib/db";
import type { FullDcSite } from "@/lib/db";
import { stateName } from "@/lib/geo";
import { CR, mono, sans, scoreColor } from "@/components/preview/control-room/theme";
import TopBar from "@/components/preview/control-room/TopBar";
import ScoreGauge from "@/components/preview/control-room/ScoreGauge";
import SubScoreBar from "@/components/preview/control-room/SubScoreBar";
import { Card, Label, Stat, Tag } from "@/components/preview/control-room/ui";
import { MiniMapClient } from "@/components/preview/control-room/MapClient";
import type { MapPoint } from "@/components/preview/control-room/SiteMiniMap";

export const metadata: Metadata = {
  title: "Control Room — Site Profile Preview",
  robots: { index: false, follow: false },
};

export const revalidate = 86400;

function titleCase(s: string | null): string {
  if (!s) return "Unnamed site";
  return s
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
function km(v: number | null | undefined): string {
  return v == null ? "—" : `${v.toFixed(1)} km`;
}
function mw(v: number | null | undefined): string {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)} GW` : `${v.toFixed(0)} MW`;
}

export default async function ControlRoomSite() {
  // Resolve a real high-score VA site as a full row.
  const top = await topSites({ state: "VA" }, 1);
  const lead = top[0];
  let site: FullDcSite | null = null;
  if (lead) {
    site = await getSiteByShortId("VA", lead.fips_code ?? undefined, lead.id.slice(0, 8));
  }

  if (!site) {
    return (
      <div style={{ background: CR.canvas, color: CR.text, padding: 48, borderRadius: 16 }}>
        <TopBar />
        <p style={{ padding: 40 }}>No site data available.</p>
      </div>
    );
  }

  const nearby = await nearbySites(site, 8);

  const mapPoints: MapPoint[] = [
    {
      name: titleCase(site.name),
      lat: site.latitude ?? 0,
      lng: site.longitude ?? 0,
      score: site.dc_score,
      primary: true,
    },
    ...nearby
      .filter((n) => n.latitude && n.longitude)
      .map((n) => ({
        name: titleCase(n.name),
        lat: n.latitude as number,
        lng: n.longitude as number,
        score: n.dc_score,
      })),
  ];

  const subScores: Array<[string, number | null]> = [
    ["Power", site.score_power],
    ["Speed-to-power", site.score_speed_to_power],
    ["Fiber", site.score_fiber],
    ["Water", site.score_water],
    ["Hazard", site.score_hazard],
    ["Land", site.score_land ?? null],
    ["Buildability", site.score_buildability ?? null],
    ["Energy cost", site.score_energy_cost ?? null],
  ].filter(([, v]) => v != null) as Array<[string, number | null]>;

  return (
    <div
      style={{
        background: CR.canvas,
        color: CR.text,
        fontFamily: sans,
        margin: "-24px -16px",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 0 0 1px #1F2A40",
      }}
    >
      <TopBar />

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 32px 56px" }}>
        {/* breadcrumb */}
        <nav
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontFamily: mono,
            fontSize: 12,
            color: CR.muted,
            marginBottom: 26,
          }}
        >
          <Link href="/preview/control-room" style={{ color: CR.cyan, textDecoration: "none" }}>
            Map
          </Link>
          <span>/</span>
          <span>{stateName(site.state || "VA")}</span>
          <span>/</span>
          <span>{site.county}</span>
          <span>/</span>
          <span style={{ color: CR.text }}>{titleCase(site.name)}</span>
        </nav>

        {/* ── HERO ─────────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) auto",
            gap: 28,
            alignItems: "center",
            paddingBottom: 28,
            borderBottom: `1px solid ${CR.border}`,
          }}
          className="cr-hero"
        >
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <Tag>{site.iso_region || "ISO"}</Tag>
              {site.site_type ? <Tag>{titleCase(site.site_type)}</Tag> : null}
              {site.substation_voltage_kv ? (
                <Tag>{site.substation_voltage_kv} kV</Tag>
              ) : null}
            </div>
            <h1
              style={{
                fontFamily: sans,
                fontWeight: 800,
                fontSize: "clamp(2rem, 4vw, 3rem)",
                lineHeight: 1.04,
                letterSpacing: "-0.02em",
                margin: "0 0 12px",
              }}
            >
              {titleCase(site.name)}
            </h1>
            <p style={{ color: CR.muted, fontSize: 16, margin: 0 }}>
              {site.county}, {stateName(site.state || "VA")}
              {site.latitude && site.longitude ? (
                <span style={{ fontFamily: mono, marginLeft: 12, fontSize: 13 }}>
                  {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
                </span>
              ) : null}
            </p>
            <div style={{ display: "flex", gap: 28, marginTop: 24, flexWrap: "wrap" }}>
              <HeroMetric label="Capacity headroom" value={mw(site.available_capacity_mw)} />
              <HeroMetric
                label="Queue wait"
                value={
                  site.avg_queue_wait_years != null
                    ? `${site.avg_queue_wait_years.toFixed(1)} yrs`
                    : "—"
                }
              />
              <HeroMetric
                label="Fiber providers"
                value={site.fcc_fiber_providers != null ? String(site.fcc_fiber_providers) : "—"}
              />
            </div>
          </div>
          <div style={{ justifySelf: "center" }}>
            <ScoreGauge score={site.dc_score} size={200} label="READINESS" />
          </div>
        </div>

        {/* ── SUB-SCORES + MAP ─────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
            gap: 20,
            marginTop: 28,
          }}
          className="cr-2col"
        >
          <Card>
            <Label>Sub-score breakdown</Label>
            <div style={{ display: "grid", gap: 15, marginTop: 16 }}>
              {subScores.map(([l, v]) => (
                <SubScoreBar key={l} label={l} value={v} />
              ))}
            </div>
          </Card>

          <Card pad={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "16px 20px 0" }}>
              <Label>Location · {nearby.length} comparable sites nearby</Label>
            </div>
            <div style={{ padding: 14 }}>
              <MiniMapClient points={mapPoints} height="300px" />
            </div>
          </Card>
        </div>

        {/* ── DETAIL CARDS ─────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0,1fr))",
            gap: 20,
            marginTop: 20,
          }}
          className="cr-2col"
        >
          <Card>
            <Label style={{ color: CR.cyan }}>Power &amp; interconnection</Label>
            <div style={{ marginTop: 12 }}>
              <Stat label="Substation kV" value={site.substation_voltage_kv ? `${site.substation_voltage_kv} kV` : "—"} accent />
              <Stat label="Nearest substation" value={titleCase(site.nearest_substation_name) || "—"} />
              <Stat label="Distance" value={km(site.nearest_substation_distance_km)} />
              <Stat label="Available capacity" value={mw(site.available_capacity_mw)} />
              <Stat label="Utility" value={site.utility_name || "—"} />
              <Stat label="Wholesale LMP" value={site.lmp_wholesale_mwh != null ? `$${site.lmp_wholesale_mwh.toFixed(0)}/MWh` : "—"} />
            </div>
          </Card>

          <Card>
            <Label style={{ color: CR.cyan }}>Speed-to-power</Label>
            <div style={{ marginTop: 12 }}>
              <Stat label="ISO region" value={site.iso_region || "—"} accent />
              <Stat label="Queue depth" value={site.queue_depth != null ? site.queue_depth.toLocaleString() : "—"} />
              <Stat label="Avg queue wait" value={site.avg_queue_wait_years != null ? `${site.avg_queue_wait_years.toFixed(1)} yrs` : "—"} />
              <Stat label="Recent wait" value={site.recent_queue_wait_years != null ? `${site.recent_queue_wait_years.toFixed(1)} yrs` : "—"} />
              <Stat label="Completion rate" value={site.queue_completion_rate != null ? `${(site.queue_completion_rate * 100).toFixed(0)}%` : "—"} />
              <Stat label="Withdrawal rate" value={site.queue_withdrawal_rate != null ? `${(site.queue_withdrawal_rate * 100).toFixed(0)}%` : "—"} />
            </div>
          </Card>

          <Card>
            <Label style={{ color: CR.cyan }}>Connectivity</Label>
            <div style={{ marginTop: 12 }}>
              <Stat label="Nearest IXP" value={site.nearest_ixp_name || "—"} accent />
              <Stat label="IXP distance" value={km(site.nearest_ixp_distance_km)} />
              <Stat label="Fiber providers" value={site.fcc_fiber_providers != null ? String(site.fcc_fiber_providers) : "—"} />
              <Stat label="Fiber coverage" value={site.fcc_fiber_pct != null ? `${site.fcc_fiber_pct.toFixed(0)}%` : "—"} />
              <Stat label="Nearest cloud" value={site.nearest_cloud_provider || "—"} />
              <Stat label="Cloud distance" value={km(site.nearest_cloud_distance_km ?? site.nearest_cloud_region_km)} />
            </div>
          </Card>

          <Card>
            <Label style={{ color: CR.cyan }}>Risk &amp; environment</Label>
            <div style={{ marginTop: 12 }}>
              <Stat label="Flood zone" value={site.flood_zone || "—"} accent />
              <Stat label="In SFHA" value={site.flood_zone_sfha == null ? "—" : site.flood_zone_sfha ? "Yes" : "No"} />
              <Stat label="Water stress (WRI)" value={site.wri_water_stress != null ? site.wri_water_stress.toFixed(2) : "—"} />
              <Stat label="Basin" value={site.wri_basin_name || "—"} />
              <Stat label="Wetland present" value={site.wetland_present == null ? "—" : site.wetland_present ? "Yes" : "No"} />
              <Stat label="Superfund nearby" value={site.superfund_nearby == null ? "—" : site.superfund_nearby ? "Yes" : "No"} />
            </div>
          </Card>

          <Card style={{ gridColumn: "1 / -1" }}>
            <Label style={{ color: CR.cyan }}>Location context</Label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                gap: "0 32px",
                marginTop: 12,
              }}
              className="cr-2col"
            >
              <div>
                <Stat label="Parcel owner" value={titleCase(site.parcel_owner) || "—"} />
                <Stat label="Acreage" value={site.acreage != null ? `${site.acreage.toFixed(0)} ac` : "—"} />
                <Stat label="In industrial zone" value={site.in_industrial_zone == null ? "—" : site.in_industrial_zone ? "Yes" : "No"} />
                <Stat label="Nearest datacenter" value={titleCase(site.nearest_dc_name) || "—"} />
              </div>
              <div>
                <Stat label="DC distance" value={km(site.nearest_dc_distance_km)} />
                <Stat label="Nearest rail" value={km(site.nearest_rail_km)} />
                <Stat label="Gas pipeline" value={km(site.nearest_gas_pipeline_km)} />
                <Stat label="Nearest fiber" value={km(site.nearest_fiber_km)} />
              </div>
            </div>
          </Card>
        </div>

        {/* footer note */}
        <p
          style={{
            color: CR.muted,
            fontSize: 12.5,
            lineHeight: 1.6,
            marginTop: 32,
            paddingTop: 20,
            borderTop: `1px solid ${CR.border}`,
          }}
        >
          Screening estimate. Capacity headroom is indicative of nearby substation
          capacity, not a confirmed interconnection. Validate with the serving
          utility and ISO queue before committing.
        </p>
      </div>

      <style>{`
        @media (max-width: 820px) {
          .cr-2col { grid-template-columns: 1fr !important; }
          .cr-hero { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: 10.5,
          color: CR.muted,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 22,
          fontWeight: 700,
          color: CR.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}
