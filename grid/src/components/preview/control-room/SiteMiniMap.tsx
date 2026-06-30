"use client";

import { useEffect, useRef } from "react";
import { CR } from "./theme";

export interface MapPoint {
  name: string;
  lat: number;
  lng: number;
  score: number | null;
  primary?: boolean;
}

function ramp(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 75) return "#A3E635";
  if (s >= 60) return "#FBBF24";
  if (s >= 40) return "#FB923C";
  return "#F43F5E";
}

/**
 * Site profile mini-map: dark tiles, the focal site as a glowing pulsing cyan
 * ring + ramp-coloured nearby comparable markers. Client island, no SSR.
 */
export default function SiteMiniMap({
  points,
  height = "340px",
}: {
  points: MapPoint[];
  height?: string;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMap = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!mapRef.current || leafletMap.current) return;
      const L = (await import("leaflet")).default;

      const valid = points.filter((p) => p.lat && p.lng);
      const primary = valid.find((p) => p.primary) || valid[0];

      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
      }).setView(primary ? [primary.lat, primary.lng] : [38.5, -96], 9);
      leafletMap.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { maxZoom: 19 }
      ).addTo(map);
      L.control.zoom({ position: "topright" }).addTo(map);

      if (cancelled) return;

      for (const p of valid) {
        const color = ramp(p.score);
        if (p.primary) {
          // outer glow ring
          L.circleMarker([p.lat, p.lng], {
            radius: 16,
            fillColor: CR.cyan,
            fillOpacity: 0.12,
            color: CR.cyan,
            weight: 1,
          }).addTo(map);
          L.circleMarker([p.lat, p.lng], {
            radius: 8,
            fillColor: CR.cyan,
            fillOpacity: 1,
            color: "#ffffff",
            weight: 2,
          })
            .addTo(map)
            .bindTooltip(
              `<b style="color:${CR.text}">${p.name}</b><br><span style="font-family:var(--font-geist-mono),monospace;color:${CR.cyan}">${
                p.score != null ? p.score.toFixed(1) : "—"
              }</span>`,
              { className: "cr-tooltip", direction: "top" }
            );
        } else {
          L.circleMarker([p.lat, p.lng], {
            radius: 6,
            fillColor: color,
            fillOpacity: 0.85,
            color: CR.canvas,
            weight: 1.5,
          })
            .addTo(map)
            .bindTooltip(
              `<b style="color:${CR.text}">${p.name}</b><br><span style="font-family:var(--font-geist-mono),monospace;color:${color}">${
                p.score != null ? p.score.toFixed(1) : "—"
              }</span>`,
              { className: "cr-tooltip", direction: "top" }
            );
        }
      }

      if (valid.length > 1) {
        const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
      }
    }
    init();
    return () => {
      cancelled = true;
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${CR.border}`,
      }}
    >
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <style>{`
        .cr-tooltip {
          background: ${CR.surface} !important;
          border: 1px solid ${CR.border} !important;
          border-radius: 8px !important;
          padding: 8px 10px !important;
          font-size: 12px;
        }
        .cr-tooltip::before { border-top-color: ${CR.border} !important; }
        .leaflet-container { background: ${CR.canvas} !important; }
        .leaflet-bar a {
          background: ${CR.surface} !important;
          color: ${CR.text} !important;
          border-color: ${CR.border} !important;
        }
        .leaflet-bar a:hover { background: ${CR.surface2} !important; }
      `}</style>
      <div ref={mapRef} style={{ height, width: "100%" }} />
    </div>
  );
}
