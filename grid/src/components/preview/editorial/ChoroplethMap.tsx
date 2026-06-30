"use client";

import { useEffect, useRef } from "react";
import statesGeo from "./us-states.geo.json";
import { RAMP, FIPS_TO_USPS } from "./theme";

interface StateDatum {
  code: string; // USPS
  avgScore: number;
  count: number;
}

interface Props {
  states: StateDatum[]; // one per state, postal-keyed
  domain?: [number, number];
  height?: string;
}

// Local ramp resolver (mirrors theme.rampColor but inlined so the client island
// has no server-only import surface).
function color(score: number, lo: number, hi: number): string {
  const t = Math.max(0, Math.min(1, (score - lo) / (hi - lo)));
  return RAMP[Math.round(t * (RAMP.length - 1))];
}

/**
 * US state choropleth on CartoDB Positron (light) tiles, colored by each
 * state's average screening score on a deep-teal sequential ramp. Hover lifts
 * the polygon and shows a tooltip (state · score · site count). Leaflet is
 * dynamically imported (no SSR).
 */
export default function ChoroplethMap({
  states,
  domain = [42, 60],
  height = "520px",
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    const byCode = new Map(states.map((s) => [s.code, s]));

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !elRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(elRef.current, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
        preferCanvas: false,
      }).setView([38.5, -96.5], 4);
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://carto.com/">CARTO</a> · &copy; OpenStreetMap',
          subdomains: "abcd",
          maxZoom: 19,
        }
      ).addTo(map);

      // Floating tooltip element.
      const tip = L.DomUtil.create("div");
      Object.assign(tip.style, {
        position: "absolute",
        zIndex: "1000",
        pointerEvents: "none",
        background: "#FFFFFF",
        border: "1px solid #E7E2D9",
        borderRadius: "2px",
        padding: "0.45rem 0.6rem",
        font: '500 12px/1.4 ui-sans-serif, system-ui, sans-serif',
        color: "#1A1A17",
        boxShadow: "0 1px 4px rgba(0,0,0,.12)",
        display: "none",
        whiteSpace: "nowrap",
      });
      elRef.current.appendChild(tip);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function styleFor(feature: any) {
        const code = FIPS_TO_USPS[feature.id];
        const d = code ? byCode.get(code) : undefined;
        return {
          fillColor: d ? color(d.avgScore, domain[0], domain[1]) : "#F2EFE8",
          weight: 0.75,
          color: "#FBFAF7",
          fillOpacity: d ? 0.92 : 0.5,
        };
      }

      const layer = L.geoJSON(statesGeo as never, {
        style: styleFor,
        onEachFeature: (feature, lyr) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const f = feature as any;
          const code = FIPS_TO_USPS[f.id];
          const d = code ? byCode.get(code) : undefined;
          lyr.on({
            mouseover: (e) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const t = e.target as any;
              t.setStyle({ weight: 1.5, color: "#0F766E", fillOpacity: 1 });
              t.bringToFront();
              const name = f.properties?.name ?? "—";
              tip.innerHTML = d
                ? `<div style="font-weight:600;margin-bottom:2px">${name}</div>
                   <div style="color:#6B6B63">Avg score <b style="color:#0F766E;font-variant-numeric:tabular-nums">${d.avgScore.toFixed(
                     1
                   )}</b> · <span style="font-variant-numeric:tabular-nums">${d.count.toLocaleString()}</span> sites</div>`
                : `<div style="font-weight:600">${name}</div><div style="color:#6B6B63">No screened sites</div>`;
              tip.style.display = "block";
            },
            mousemove: (e) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const oe = (e as any).originalEvent;
              const rect = elRef.current!.getBoundingClientRect();
              let x = oe.clientX - rect.left + 14;
              let y = oe.clientY - rect.top + 14;
              x = Math.min(x, rect.width - tip.offsetWidth - 8);
              y = Math.min(y, rect.height - tip.offsetHeight - 8);
              tip.style.left = `${x}px`;
              tip.style.top = `${y}px`;
            },
            mouseout: (e) => {
              layer.resetStyle(e.target);
              tip.style.display = "none";
            },
          });
        },
      }).addTo(map);

      map.fitBounds(layer.getBounds(), { padding: [12, 12] });
      // Keep CONUS framed; don't let Alaska/Hawaii/PR pull the view out.
      map.setView([38.2, -95.5], 4);
      setTimeout(() => map.invalidateSize(), 80);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [states, domain]);

  return (
    <div style={{ position: "relative" }}>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div
        ref={elRef}
        style={{
          height,
          width: "100%",
          background: "#FBFAF7",
        }}
      />
    </div>
  );
}
