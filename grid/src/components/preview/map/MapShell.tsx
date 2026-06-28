"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { CR } from "./theme";
import { MapSite } from "./types";
import ControlPanel, { LayerKey, LayerState } from "./ControlPanel";
import SitePanel from "./SitePanel";
import Legend from "./Legend";
import StatReadout from "./StatReadout";
import type { MapHandle } from "./LeafletMap";

const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 50% 40%, #0F1422, #06080F)",
        color: CR.muted,
        fontSize: 13,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        fontFamily: "var(--font-geist-mono), monospace",
      }}
    >
      <span className="gc-boot">◆ Loading atlas…</span>
    </div>
  ),
});

export default function MapShell() {
  const [layers, setLayers] = useState<LayerState>({
    sites: true,
    substations: false,
    lines: false,
    brownfields: false,
  });
  const [selected, setSelected] = useState<MapSite | null>(null);
  const [viewport, setViewport] = useState<{
    count: number;
    avgScore: number | null;
  }>({ count: 0, avgScore: null });
  const [loading, setLoading] = useState(true);

  const handleRef = useRef<MapHandle | null>(null);

  const toggleLayer = useCallback((k: LayerKey) => {
    setLayers((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);

  const handleSelect = useCallback((site: MapSite) => {
    setSelected(site);
    if (site.latitude != null && site.longitude != null) {
      handleRef.current?.flyTo(site.latitude, site.longitude, 11);
    }
  }, []);

  const jump = useCallback((lat: number, lng: number, zoom: number) => {
    handleRef.current?.flyTo(lat, lng, zoom);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100dvh",
        zIndex: 50,
        background: "#06080F",
        overflow: "hidden",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      }}
    >
      {/* Leaflet + markercluster stylesheets (CDN, matches existing app pattern) */}
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"
      />

      <style>{CSS}</style>

      <LeafletMap
        layers={layers}
        onSelect={handleSelect}
        onViewport={setViewport}
        onLoading={setLoading}
        registerHandle={(h) => (handleRef.current = h)}
      />

      <ControlPanel layers={layers} onToggleLayer={toggleLayer} onJump={jump} />
      <StatReadout
        count={viewport.count}
        avgScore={viewport.avgScore}
        loading={loading}
      />
      <Legend />
      <SitePanel site={selected} onClose={() => setSelected(null)} />

      {/* Bottom-center hint */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 18,
          transform: "translateX(-50%)",
          zIndex: 1050,
          padding: "6px 13px",
          borderRadius: 999,
          background: "rgba(10,14,26,0.7)",
          backdropFilter: "blur(10px)",
          border: `1px solid ${CR.border}`,
          color: CR.muted,
          fontSize: 11,
          letterSpacing: "0.04em",
          pointerEvents: "none",
        }}
      >
        Pan &amp; zoom to explore · click any site for its readiness profile
      </div>
    </div>
  );
}

const CSS = `
.leaflet-container{background:#06080F;font-family:var(--font-geist-sans),system-ui,sans-serif;}
.leaflet-control-zoom a{
  background:rgba(10,14,26,0.82)!important;color:#8A97AD!important;
  border:1px solid #1F2A40!important;backdrop-filter:blur(8px);
}
.leaflet-control-zoom a:hover{color:#22D3EE!important;border-color:#22D3EE55!important;}
.leaflet-control-attribution{
  background:rgba(10,14,26,0.6)!important;color:#5A6678!important;font-size:10px!important;
  backdrop-filter:blur(6px);border-radius:6px 0 0 0;
}
.leaflet-control-attribution a{color:#22D3EE99!important;}
.leaflet-popup-content-wrapper{
  background:rgba(230,237,247,0.96);border-radius:10px;
  box-shadow:0 10px 30px -8px rgba(0,0,0,0.6);
}
.leaflet-popup-tip{background:rgba(230,237,247,0.96);}
.gc-site,.gc-prime{transition:transform 120ms ease,r 120ms ease;cursor:pointer;}
.gc-site:hover,.gc-prime:hover{transform:scale(1.45);}
@keyframes gc-pulse{
  0%{stroke-width:1;opacity:0.95;}
  50%{stroke-width:3.5;opacity:1;}
  100%{stroke-width:1;opacity:0.95;}
}
.gc-pulse{animation:gc-pulse 2.2s ease-in-out infinite;}
@keyframes gc-boot{0%,100%{opacity:0.5;}50%{opacity:1;}}
.gc-boot{animation:gc-boot 1.4s ease-in-out infinite;}
@keyframes gc-live{0%,100%{opacity:1;}50%{opacity:0.45;}}
.gc-live-dot{animation:gc-live 1.6s ease-in-out infinite;}
`;
