"use client";

import ScoreGauge from "./ScoreGauge";
import { glass, monoFigure, labelStyle, scoreColor } from "./theme";
import { MapSite, siteProfileHref, siteTypeLabel } from "./types";
import { stateName } from "@/lib/geo";

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        padding: "9px 11px",
        borderRadius: 9,
        background: "color-mix(in srgb, var(--surface-2) 70%, transparent)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ ...labelStyle, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          ...monoFigure,
          fontSize: 15,
          fontWeight: 600,
          color: accent ? "var(--accent)" : "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function fmtMW(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(1)} GW`;
  return `${v.toFixed(0)} MW`;
}
function fmtKm(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)} km`;
}
function fmtAcre(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} ac`;
}

export default function SitePanel({
  site,
  onClose,
}: {
  site: MapSite | null;
  onClose: () => void;
}) {
  const open = !!site;
  const href = site ? siteProfileHref(site) : null;
  const score = site?.dc_score ?? 0;

  return (
    <div
      aria-hidden={!open}
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        bottom: 16,
        width: 340,
        maxWidth: "calc(100% - 32px)",
        zIndex: 1200,
        pointerEvents: open ? "auto" : "none",
        transform: open ? "translateX(0)" : "translateX(380px)",
        opacity: open ? 1 : 0,
        transition:
          "transform 360ms cubic-bezier(.22,.61,.36,1), opacity 260ms ease",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        ...glass,
      }}
    >
      {site && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 8,
              padding: "16px 16px 10px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "2px 9px",
                  borderRadius: 999,
                  background: scoreColor(score) + "22",
                  border: `1px solid ${scoreColor(score)}55`,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: scoreColor(score),
                    boxShadow: `0 0 8px ${scoreColor(score)}`,
                  }}
                />
                <span
                  style={{
                    ...labelStyle,
                    color: scoreColor(score),
                    fontSize: 10,
                  }}
                >
                  {siteTypeLabel(site.site_type)}
                </span>
              </div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 17,
                  lineHeight: 1.25,
                  fontWeight: 650,
                  color: "var(--text)",
                  wordBreak: "break-word",
                }}
              >
                {site.name || "Unnamed Site"}
              </h2>
              <div style={{ ...labelStyle, marginTop: 5 }}>
                {site.county ? `${site.county} · ` : ""}
                {site.state ? stateName(site.state) : ""}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close panel"
              style={{
                flex: "0 0 auto",
                width: 28,
                height: 28,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--surface-2) 70%, transparent)",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "center" }}>
              <ScoreGauge score={score} size={150} label="DC READINESS" />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <Stat
                label="Available Cap"
                value={fmtMW(site.available_capacity_mw)}
                accent
              />
              <Stat
                label="Sub Voltage"
                value={
                  site.substation_voltage_kv != null
                    ? `${site.substation_voltage_kv} kV`
                    : "—"
                }
              />
              <Stat label="Nearest IXP" value={fmtKm(site.nearest_ixp_distance_km)} />
              <Stat label="Nearest DC" value={fmtKm(site.nearest_dc_distance_km)} />
              <Stat label="Acreage" value={fmtAcre(site.acreage)} />
              <Stat label="Former Use" value={site.former_use || "—"} />
            </div>
          </div>

          {href ? (
            <a
              href={href}
              style={{
                margin: 16,
                marginTop: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "11px 14px",
                borderRadius: 10,
                background:
                  "color-mix(in srgb, var(--accent) 14%, transparent)",
                border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
                color: "var(--accent)",
                fontWeight: 650,
                fontSize: 13.5,
                textDecoration: "none",
                letterSpacing: "0.02em",
              }}
            >
              View full profile →
            </a>
          ) : (
            <div
              style={{
                margin: 16,
                marginTop: 0,
                padding: "11px 14px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                color: "var(--muted)",
                fontSize: 12.5,
                textAlign: "center",
              }}
            >
              Profile link unavailable for this row
            </div>
          )}
        </>
      )}
    </div>
  );
}
