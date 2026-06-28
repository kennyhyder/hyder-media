"use client";

// Lightweight per-profile map. Pure client island (Leaflet engine via
// dynamic ssr:false) — the site profile page stays fully server-rendered; this
// is layered on top as an enhancement. Seeded with the focused site + its
// nearby comparables (static — NO bbox fetch). Theme-aware tiles + panel.

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { MapSite } from "./types";
import { glass, labelStyle, mono, scoreColor, RAMP } from "./theme";
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

export interface SiteMiniMapProps {
  site: MapSite;
  nearby?: MapSite[];
  height?: string | number;
}

export default function SiteMiniMap({ site, nearby = [], height = 360 }: SiteMiniMapProps) {
  const [selected, setSelected] = useState<MapSite | null>(null);
  const handleRef = useRef<EngineHandle | null>(null);

  const all = [site, ...nearby].filter(
    (s) => s.latitude != null && s.longitude != null
  );

  const handleSelect = useCallback((s: MapSite) => {
    setSelected(s);
  }, []);

  // Nothing to plot → render nothing (page text already covers it).
  if (site.latitude == null || site.longitude == null) return null;

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
      <style>{MINI_CSS}</style>

      <MapEngine
        center={[site.latitude, site.longitude]}
        zoom={10}
        showChoropleth={false}
        showPoints
        staticSites={all}
        focusSiteId={site.id}
        onSelect={handleSelect}
        onViewport={() => {}}
        onLoading={() => {}}
        registerHandle={(h) => (handleRef.current = h)}
      />

      {/* compact legend */}
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
        <span style={{ ...labelStyle, fontSize: 10 }}>
          {nearby.length > 0
            ? `This site + ${nearby.length} nearby`
            : "Site location"}
        </span>
      </div>

      <SitePanel site={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

const MINI_CSS = `
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
