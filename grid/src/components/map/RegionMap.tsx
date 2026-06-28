"use client";

// Regional map for state / county pages. Pure client island (Leaflet via
// dynamic ssr:false) seeded with a region's top sites as STATIC points, fit to
// their bounds. The page's SSR content (stats, tables, FAQ) is untouched — this
// is layered on top as an enhancement. Theme-aware tiles + panel.

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { MapSite } from "./types";
import { glass, labelStyle, mono, RAMP } from "./theme";
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
        fontSize: 12,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        fontFamily: "var(--font-geist-mono), monospace",
      }}
    >
      <span className="gcm-boot">◆ Loading map…</span>
    </div>
  ),
});

export interface RegionMapProps {
  sites: MapSite[];
  height?: string | number;
  label?: string;
}

export default function RegionMap({ sites, height = 420, label }: RegionMapProps) {
  const [selected, setSelected] = useState<MapSite | null>(null);
  const handleRef = useRef<EngineHandle | null>(null);

  const plottable = sites.filter(
    (s) => s.latitude != null && s.longitude != null
  );

  const handleSelect = useCallback((s: MapSite) => setSelected(s), []);

  if (plottable.length === 0) return null;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        overflow: "hidden",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
        isolation: "isolate",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"
      />
      <style>{REGION_CSS}</style>

      <MapEngine
        center={[plottable[0].latitude as number, plottable[0].longitude as number]}
        zoom={6}
        showChoropleth={false}
        showPoints
        staticSites={plottable}
        fitSites
        onSelect={handleSelect}
        onViewport={() => {}}
        onLoading={() => {}}
        registerHandle={(h) => (handleRef.current = h)}
      />

      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          zIndex: 1150,
          padding: "9px 11px",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          ...glass,
        }}
      >
        {RAMP.map((r) => (
          <span key={r.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: r.color,
                boxShadow: `0 0 6px ${r.color}`,
              }}
            />
            <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: mono }}>
              {r.range}
            </span>
          </span>
        ))}
      </div>

      {label && (
        <div
          style={{
            position: "absolute",
            right: 12,
            top: 12,
            zIndex: 1100,
            padding: "6px 11px",
            ...glass,
          }}
        >
          <span style={{ ...labelStyle, fontSize: 10 }}>{label}</span>
        </div>
      )}

      <SitePanel site={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

const REGION_CSS = `
.leaflet-container{background:var(--surface-2);font-family:var(--font-geist-sans),system-ui,sans-serif;}
.leaflet-control-zoom a{
  background:color-mix(in srgb, var(--surface) 85%, transparent)!important;color:var(--muted)!important;
  border:1px solid var(--border)!important;
}
.leaflet-control-zoom a:hover{color:var(--accent)!important;}
.leaflet-control-attribution{
  background:color-mix(in srgb, var(--surface) 65%, transparent)!important;color:var(--muted)!important;font-size:10px!important;
}
.leaflet-control-attribution a{color:var(--accent)!important;}
.gcm-site,.gcm-prime{transition:transform 120ms ease;cursor:pointer;}
.gcm-site:hover,.gcm-prime:hover{transform:scale(1.4);}
@keyframes gcm-pulse{0%{stroke-width:1;opacity:.95}50%{stroke-width:3.5;opacity:1}100%{stroke-width:1;opacity:.95}}
.gcm-pulse{animation:gcm-pulse 2.2s ease-in-out infinite;}
@keyframes gcm-boot{0%,100%{opacity:.5}50%{opacity:1}}
.gcm-boot{animation:gcm-boot 1.4s ease-in-out infinite;}
`;
