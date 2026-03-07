"use client";

import { useEffect, useRef, useState } from "react";

interface LineGeometry {
  id: string;
  hifld_id: number;
  geometry_wkt: string | null;
  voltage_kv: number | null;
  capacity_mw: number | null;
  upgrade_candidate: boolean;
  owner: string | null;
  state: string | null;
  sub_1: string | null;
  sub_2: string | null;
  naession: string | null;
}

interface SiteMarker {
  lat: number;
  lng: number;
  label: string;
  type?: "site" | "brownfield";
}

interface MapProps {
  lines: LineGeometry[];
  center?: [number, number];
  zoom?: number;
  height?: string;
  onLineClick?: (id: string) => void;
  showSubstations?: boolean;
  singleLine?: boolean;
  siteMarker?: SiteMarker;
}

function parseWKT(wkt: string): [number, number][][] {
  if (!wkt) return [];

  const polylines: [number, number][][] = [];

  // Handle MULTILINESTRING
  if (wkt.startsWith("MULTILINESTRING")) {
    const inner = wkt.replace(/^MULTILINESTRING\s*\(\(/, "").replace(/\)\)\s*$/, "");
    const parts = inner.split("),(");
    for (const part of parts) {
      const coords = parseCoordString(part);
      if (coords.length > 0) polylines.push(coords);
    }
  }
  // Handle LINESTRING
  else if (wkt.startsWith("LINESTRING")) {
    const inner = wkt.replace(/^LINESTRING\s*\(/, "").replace(/\)\s*$/, "");
    const coords = parseCoordString(inner);
    if (coords.length > 0) polylines.push(coords);
  }

  return polylines;
}

function parseCoordString(str: string): [number, number][] {
  const coords: [number, number][] = [];
  const pairs = str.split(",");
  for (const pair of pairs) {
    const parts = pair.trim().split(/\s+/);
    if (parts.length >= 2) {
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        coords.push([lat, lng]);
      }
    }
  }
  return coords;
}

export default function TransmissionMap({
  lines,
  center = [34.0, -108.0],
  zoom = 5,
  height = "500px",
  onLineClick,
  singleLine = false,
  siteMarker,
}: MapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMap = useRef<any>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !mapRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any;
    let cleanup = false;

    (async () => {
      const L = await import("leaflet");

      if (cleanup || !mapRef.current) return;

      if (leafletMap.current) {
        leafletMap.current.remove();
      }

      map = L.map(mapRef.current).setView(center, zoom);
      leafletMap.current = map;

      // Satellite imagery (ESRI)
      const satellite = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles &copy; Esri", maxZoom: 19 }
      );

      // Street map (OpenStreetMap)
      const streets = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }
      );

      // Dark map (better for seeing colored lines)
      const dark = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>', maxZoom: 19 }
      );

      // Default to satellite for site detail views, dark for line-heavy views
      const defaultLayer = singleLine ? dark : satellite;
      defaultLayer.addTo(map);

      L.control.layers(
        { "Satellite": satellite, "Dark": dark, "Street": streets },
        {},
        { position: "topright" }
      ).addTo(map);

      // All bounds for fitting
      const allCoords: [number, number][] = [];

      // Draw lines
      for (const line of lines) {
        if (!line.geometry_wkt) continue;

        const polylines = parseWKT(line.geometry_wkt);
        if (polylines.length === 0) continue;

        const color = line.upgrade_candidate ? "#a855f7" : "#6b7280";
        const weight = line.upgrade_candidate ? 3 : 1.5;
        const opacity = line.upgrade_candidate ? 0.9 : 0.5;

        for (const coords of polylines) {
          allCoords.push(...coords);

          const polyline = L.polyline(coords, {
            color,
            weight: singleLine ? 4 : weight,
            opacity: singleLine ? 1.0 : opacity,
          });

          const capacityLabel = line.capacity_mw != null ? `${Number(line.capacity_mw).toFixed(1)} MW` : "Unknown";
          const voltageLabel = line.voltage_kv != null ? `${Number(line.voltage_kv).toFixed(0)} kV` : "?";

          polyline.bindPopup(
            `<div style="min-width:200px;font-family:system-ui">
              <strong style="font-size:13px">${line.naession || `${line.sub_1 || "?"} → ${line.sub_2 || "?"}`}</strong><br/>
              <span style="color:${line.upgrade_candidate ? '#a855f7' : '#6b7280'};font-weight:600">
                ${capacityLabel} · ${voltageLabel}
              </span><br/>
              ${line.owner ? `Owner: ${line.owner}<br/>` : ""}
              ${line.state || ""}
              ${line.upgrade_candidate ? '<br/><span style="color:#a855f7;font-weight:600">⚡ Upgrade Candidate</span>' : ""}
              ${onLineClick ? `<br/><a href="/grid/line/?id=${line.id}" style="color:#7c3aed;text-decoration:underline">View Details →</a>` : ""}
            </div>`
          );

          polyline.addTo(map);

          if (onLineClick) {
            polyline.on("click", () => onLineClick(line.id));
          }
        }
      }

      // Add site marker if provided
      if (siteMarker) {
        const markerColor = siteMarker.type === "brownfield" ? "#d97706" : "#7c3aed";
        const markerIcon = L.divIcon({
          html: `<div style="
            width:16px;height:16px;border-radius:50%;
            background:${markerColor};border:3px solid white;
            box-shadow:0 2px 6px rgba(0,0,0,0.4);
          "></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
          className: "",
        });

        const marker = L.marker([siteMarker.lat, siteMarker.lng], { icon: markerIcon });
        marker.bindPopup(`<strong>${siteMarker.label}</strong>`);
        marker.addTo(map);
        allCoords.push([siteMarker.lat, siteMarker.lng]);
      }

      // Fit bounds — for site detail (non-singleLine), stay zoomed in on the site
      if (allCoords.length > 0) {
        if (singleLine) {
          const bounds = L.latLngBounds(allCoords);
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        } else if (siteMarker && lines.length <= 5) {
          // Site detail: keep tight zoom on site marker
          map.setView([siteMarker.lat, siteMarker.lng], zoom);
        } else {
          const bounds = L.latLngBounds(allCoords);
          map.fitBounds(bounds, { padding: [20, 20], maxZoom: 10 });
        }
      }

      // Add legend
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legend = new (L.Control as any)({ position: "bottomright" });
      legend.onAdd = () => {
        const div = L.DomUtil.create("div", "");
        div.style.cssText = "background:rgba(0,0,0,0.8);padding:8px 12px;border-radius:6px;font-size:11px;color:#fff;font-family:system-ui";
        div.innerHTML = `
          <div style="margin-bottom:4px;font-weight:600">Line Capacity</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <div style="width:20px;height:3px;background:#a855f7;border-radius:2px"></div>
            <span>Upgrade (50-100 MW)</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:20px;height:2px;background:#6b7280;border-radius:2px"></div>
            <span>Other</span>
          </div>
        `;
        return div;
      };
      legend.addTo(map);
    })();

    return () => {
      cleanup = true;
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, [mounted, lines, center, zoom, onLineClick, singleLine, siteMarker]);

  if (!mounted) {
    return (
      <div
        style={{ height }}
        className="bg-gray-800 rounded-lg flex items-center justify-center text-gray-400"
      >
        Loading map...
      </div>
    );
  }

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={mapRef} style={{ height }} className="rounded-lg z-0" />
    </>
  );
}
