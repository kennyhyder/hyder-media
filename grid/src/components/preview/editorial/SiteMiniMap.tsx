"use client";

import { useEffect, useRef } from "react";

interface Marker {
  lat: number;
  lng: number;
  name: string;
  score?: number | null;
  primary?: boolean;
}

interface Props {
  markers: Marker[];
  height?: string;
}

/**
 * Light-tile mini-map for an entity profile. The primary site renders as a
 * teal ringed marker; nearby comparables as smaller hairline dots. CartoDB
 * Positron tiles keep it calm and print-like.
 */
export default function SiteMiniMap({ markers, height = "340px" }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !elRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const valid = markers.filter(
        (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)
      );
      const center = valid[0] ?? { lat: 38.5, lng: -96 };

      const map = L.map(elRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true,
      }).setView([center.lat, center.lng], 9);
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 19,
        }
      ).addTo(map);

      for (const m of valid) {
        if (m.primary) {
          // Outer teal halo
          L.circleMarker([m.lat, m.lng], {
            radius: 13,
            color: "#0F766E",
            weight: 1,
            opacity: 0.35,
            fillColor: "#0F766E",
            fillOpacity: 0.1,
          }).addTo(map);
          L.circleMarker([m.lat, m.lng], {
            radius: 7,
            color: "#FBFAF7",
            weight: 2,
            fillColor: "#0F766E",
            fillOpacity: 1,
          })
            .addTo(map)
            .bindPopup(
              `<div style="font:600 13px/1.4 ui-sans-serif,system-ui,sans-serif;color:#1A1A17">${m.name}${
                m.score != null
                  ? `<div style="font-weight:500;color:#6B6B63;margin-top:2px">Score <b style="color:#0F766E">${m.score.toFixed(
                      1
                    )}</b></div>`
                  : ""
              }</div>`
            );
        } else {
          L.circleMarker([m.lat, m.lng], {
            radius: 5,
            color: "#B45309",
            weight: 1.25,
            fillColor: "#FFFFFF",
            fillOpacity: 1,
          })
            .addTo(map)
            .bindPopup(
              `<div style="font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif;color:#1A1A17">${m.name}${
                m.score != null
                  ? `<span style="color:#6B6B63"> · ${m.score.toFixed(1)}</span>`
                  : ""
              }</div>`
            );
        }
      }

      if (valid.length > 1) {
        const bounds = L.latLngBounds(valid.map((m) => [m.lat, m.lng]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
      }
      setTimeout(() => map.invalidateSize(), 80);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [markers]);

  return (
    <div>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={elRef} style={{ height, width: "100%", background: "#FBFAF7" }} />
    </div>
  );
}
