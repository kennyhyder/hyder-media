"use client";

import { useEffect, useRef } from "react";
import { CR } from "./theme";

export interface StateDatum {
  code: string;
  name: string;
  avgScore: number | null;
  count: number;
}

interface Props {
  /** keyed by full state NAME (matches the GeoJSON properties.name) */
  states: Record<string, StateDatum>;
  height?: string;
}

const GEOJSON_URL =
  "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";

function ramp(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 75) return "#A3E635";
  if (s >= 60) return "#FBBF24";
  if (s >= 40) return "#FB923C";
  return "#F43F5E";
}

/**
 * Dark-tile state choropleth coloured by each state's avg readiness score.
 * Client island — Leaflet loaded dynamically (no SSR). CartoDB Dark Matter
 * basemap to match the Control Room canvas. Hover tooltip shows score + count.
 */
export default function ChoroplethMap({ states, height = "560px" }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMap = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!mapRef.current || leafletMap.current) return;
      const L = (await import("leaflet")).default;

      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        preferCanvas: false,
      }).setView([38.5, -96], 4);
      leafletMap.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { maxZoom: 19 }
      ).addTo(map);
      L.control.zoom({ position: "topright" }).addTo(map);

      let geo: GeoJSON.FeatureCollection | null = null;
      try {
        const res = await fetch(GEOJSON_URL);
        geo = await res.json();
      } catch {
        return;
      }
      if (cancelled || !geo) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function style(feature: any) {
        const name = feature?.properties?.name as string;
        const d = states[name];
        const color = ramp(d?.avgScore);
        return {
          fillColor: color,
          weight: 1,
          opacity: 1,
          color: CR.border,
          fillOpacity: d ? 0.62 : 0.12,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layer = L.geoJSON(geo as any, {
        style,
        onEachFeature: (feature, lyr) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const name = (feature as any)?.properties?.name as string;
          const d = states[name];
          const score = d?.avgScore;
          const html = `
            <div style="font-family:var(--font-geist-sans),system-ui;min-width:170px;color:${CR.text}">
              <div style="font-weight:700;font-size:14px;margin-bottom:6px">${name}</div>
              <div style="display:flex;justify-content:space-between;font-size:12px;color:${CR.muted};margin-bottom:3px">
                <span style="text-transform:uppercase;letter-spacing:.06em">Readiness</span>
                <span style="font-family:var(--font-geist-mono),monospace;font-variant-numeric:tabular-nums;color:${ramp(score)};font-weight:700">${
                  score != null ? score.toFixed(1) : "—"
                }</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:12px;color:${CR.muted}">
                <span style="text-transform:uppercase;letter-spacing:.06em">Sites</span>
                <span style="font-family:var(--font-geist-mono),monospace;font-variant-numeric:tabular-nums;color:${CR.text}">${
                  d ? d.count.toLocaleString() : "—"
                }</span>
              </div>
            </div>`;
          lyr.bindTooltip(html, {
            sticky: true,
            direction: "top",
            opacity: 1,
            className: "cr-tooltip",
          });
          lyr.on({
            mouseover: (e) => {
              const t = e.target;
              t.setStyle({ weight: 2, color: CR.cyan, fillOpacity: 0.82 });
              t.bringToFront();
            },
            mouseout: (e) => layer.resetStyle(e.target),
          });
        },
      }).addTo(map);

      map.fitBounds(layer.getBounds(), { padding: [12, 12] });
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
        boxShadow: "0 0 0 1px rgba(31,42,64,.6), 0 12px 40px -16px rgba(34,211,238,.18)",
      }}
    >
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <style>{`
        .cr-tooltip {
          background: ${CR.surface} !important;
          border: 1px solid ${CR.border} !important;
          border-radius: 8px !important;
          box-shadow: 0 8px 30px -10px rgba(0,0,0,.7) !important;
          padding: 10px 12px !important;
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
