"use client";

// Productionized, theme-aware readiness map. The Leaflet engine is loaded via
// dynamic(ssr:false) so it is a pure CLIENT ISLAND — it never renders on the
// server and never blocks/replaces SSR content. Drop it anywhere as an
// enhancement on top of fully server-rendered pages.
//
//   <ReadinessMap height="70vh" showChoropleth showPoints />
//
// Full-bleed capable. Renders theme-aware glass overlays (legend + live stat
// readout + intelligence SitePanel) that adapt to light & dark via CSS vars.

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { MapSite } from "./types";
import { RAMP, glass, labelStyle, mono, scoreColor } from "./theme";
import SitePanel from "./SitePanel";
import type { EngineHandle } from "./MapEngine";

const MapEngine = dynamic(() => import("./MapEngine"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-2)",
        color: "var(--muted)",
        fontSize: 13,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        fontFamily: "var(--font-geist-mono), monospace",
      }}
    >
      <span className="gcm-boot">◆ Loading atlas…</span>
    </div>
  ),
});

export interface ReadinessMapProps {
  height?: string | number;
  center?: [number, number];
  zoom?: number;
  maxBounds?: [[number, number], [number, number]];
  showChoropleth?: boolean;
  showPoints?: boolean;
  /** Render the floating legend (default true). */
  showLegend?: boolean;
  /** Render the live "sites in view" readout (default true). */
  showReadout?: boolean;
  /** Optional overlaid hero content (headline + CTA) — top-left. */
  overlay?: React.ReactNode;
  /** Rounded corners (default true). Set false for true full-bleed. */
  rounded?: boolean;
}

export default function ReadinessMap({
  height = "70vh",
  center = [38.5, -97],
  zoom = 4,
  maxBounds,
  showChoropleth = true,
  showPoints = true,
  showLegend = true,
  showReadout = true,
  overlay,
  rounded = true,
}: ReadinessMapProps) {
  const [selected, setSelected] = useState<MapSite | null>(null);
  const [viewport, setViewport] = useState<{
    count: number;
    avgScore: number | null;
  }>({ count: 0, avgScore: null });
  const [loading, setLoading] = useState(true);
  const handleRef = useRef<EngineHandle | null>(null);

  const handleSelect = useCallback((site: MapSite) => {
    setSelected(site);
    if (site.latitude != null && site.longitude != null) {
      handleRef.current?.flyTo(site.latitude, site.longitude, 11);
    }
  }, []);

  const avg = viewport.avgScore == null ? null : Math.round(viewport.avgScore * 10) / 10;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        overflow: "hidden",
        borderRadius: rounded ? 16 : 0,
        border: rounded ? "1px solid var(--border)" : "none",
        background: "var(--surface-2)",
        isolation: "isolate",
      }}
    >
      {/* Leaflet base CSS is npm-bundled (see MapEngine import); the .leaflet-*
          / .gcm-* overrides + keyframes live in globals.css. */}
      <MapEngine
        center={center}
        zoom={zoom}
        maxBounds={maxBounds}
        showChoropleth={showChoropleth}
        showPoints={showPoints}
        onSelect={handleSelect}
        onViewport={setViewport}
        onLoading={setLoading}
        registerHandle={(h) => (handleRef.current = h)}
      />

      {overlay && (
        <div
          style={{
            position: "absolute",
            left: 16,
            top: 16,
            zIndex: 900,
            maxWidth: "min(560px, calc(100% - 32px))",
            pointerEvents: "none",
          }}
        >
          {overlay}
        </div>
      )}

      {showReadout && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 1100,
            padding: "11px 14px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            ...glass,
          }}
        >
          <div>
            <div style={{ ...labelStyle, marginBottom: 3 }}>Sites in view</div>
            <div
              style={{
                fontFamily: mono,
                fontVariantNumeric: "tabular-nums",
                fontSize: 20,
                fontWeight: 700,
                color: "var(--text)",
                lineHeight: 1,
              }}
            >
              {viewport.count.toLocaleString("en-US")}
            </div>
          </div>
          <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />
          <div>
            <div style={{ ...labelStyle, marginBottom: 3 }}>Avg readiness</div>
            <div
              style={{
                fontFamily: mono,
                fontVariantNumeric: "tabular-nums",
                fontSize: 20,
                fontWeight: 700,
                color: avg == null ? "var(--muted)" : scoreColor(avg),
                lineHeight: 1,
              }}
            >
              {avg == null ? "—" : avg.toFixed(1)}
            </div>
          </div>
          <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              className="gcm-live-dot"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: loading ? "var(--accent)" : "#a3e635",
                boxShadow: `0 0 8px ${loading ? "var(--accent)" : "#a3e635"}`,
              }}
            />
            <span style={{ ...labelStyle, fontSize: 10 }}>
              {loading ? "Syncing" : "Live"}
            </span>
          </div>
        </div>
      )}

      {showLegend && (
        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 16,
            zIndex: 1150,
            padding: "12px 14px",
            minWidth: 188,
            ...glass,
          }}
        >
          <div style={{ ...labelStyle, marginBottom: 9 }}>DC Readiness</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {RAMP.map((r) => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    background: r.color,
                    boxShadow: `0 0 7px ${r.color}`,
                    flex: "0 0 auto",
                  }}
                />
                <span style={{ fontSize: 12.5, color: "var(--text)", flex: 1 }}>
                  {r.label}
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: mono }}>
                  {r.range}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <SitePanel site={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
