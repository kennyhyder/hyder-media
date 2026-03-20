"use client";

import { useEffect, useRef, useCallback } from "react";

interface MapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  label?: string;
  score?: number;
  href?: string;
}

interface ResultsMapProps {
  points: MapPoint[];
  height?: string;
  geoCenter?: { lat: number; lng: number; radius: number } | null;
}

function scoreColor(score: number): string {
  if (score >= 70) return "#16a34a";
  if (score >= 50) return "#ca8a04";
  if (score >= 30) return "#ea580c";
  return "#dc2626";
}

/**
 * Lightweight Leaflet map for displaying filtered results from list pages.
 * Dynamically imports Leaflet (no SSR). Shows markers with popups + optional geo radius circle.
 */
export default function ResultsMap({ points, height = "400px", geoCenter }: ResultsMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMap = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const circleRef = useRef<any>(null);

  const initMap = useCallback(async () => {
    if (!mapRef.current) return;
    const L = await import("leaflet");

    if (leafletMap.current) {
      leafletMap.current.remove();
    }

    const map = L.map(mapRef.current, { preferCanvas: true }).setView([39.0, -98.0], 5);
    leafletMap.current = map;

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { attribution: '&copy; <a href="https://carto.com/">CARTO</a>', maxZoom: 19 }
    ).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);
  }, []);

  // Initialize map once
  useEffect(() => {
    initMap();
    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers when points change
  useEffect(() => {
    if (!leafletMap.current || !markersRef.current) return;

    const updateMarkers = async () => {
      const L = await import("leaflet");
      markersRef.current.clearLayers();

      // Remove old circle
      if (circleRef.current) {
        leafletMap.current.removeLayer(circleRef.current);
        circleRef.current = null;
      }

      const validPoints = points.filter(p => p.latitude && p.longitude);
      if (validPoints.length === 0) {
        leafletMap.current.setView([39.0, -98.0], 5);
        return;
      }

      for (const p of validPoints) {
        const color = p.score != null ? scoreColor(p.score) : "#7c3aed";
        const marker = L.circleMarker([p.latitude, p.longitude], {
          radius: 6,
          fillColor: color,
          fillOpacity: 0.8,
          color: "#fff",
          weight: 1,
        });
        const popup = `<div style="font-size:12px;min-width:150px">
          <b>${p.name}</b>
          ${p.label ? `<br><span style="color:#666">${p.label}</span>` : ""}
          ${p.score != null ? `<br>Score: <b>${p.score.toFixed(1)}</b>` : ""}
          ${p.href ? `<br><a href="${p.href}" style="color:#7c3aed">View details</a>` : ""}
        </div>`;
        marker.bindPopup(popup);
        markersRef.current.addLayer(marker);
      }

      // Draw geo radius circle if active
      if (geoCenter && geoCenter.lat && geoCenter.lng) {
        circleRef.current = L.circle([geoCenter.lat, geoCenter.lng], {
          radius: geoCenter.radius * 1609.34,
          color: "#7c3aed",
          fillColor: "#7c3aed",
          fillOpacity: 0.06,
          weight: 2,
          dashArray: "6 4",
        }).addTo(leafletMap.current);
      }

      // Fit bounds
      const bounds = L.latLngBounds(validPoints.map(p => [p.latitude, p.longitude]));
      if (geoCenter && geoCenter.lat && geoCenter.lng) {
        bounds.extend([geoCenter.lat, geoCenter.lng]);
      }
      leafletMap.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    };

    updateMarkers();
  }, [points, geoCenter]);

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={mapRef} style={{ height, width: "100%" }} />
    </div>
  );
}
