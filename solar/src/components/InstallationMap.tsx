"use client";

import { useEffect, useRef, useState } from "react";
import type { Installation } from "@/types/solar";

interface MapProps {
  installations: Installation[];
  center?: [number, number];
  zoom?: number;
  height?: string;
  onMarkerClick?: (id: string) => void;
}

export default function InstallationMap({
  installations,
  center = [39.8, -98.5],
  zoom = 4,
  height = "400px",
  onMarkerClick,
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

      // Fix default marker icons for webpack
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (cleanup || !mapRef.current) return;

      // Clear any existing map
      if (leafletMap.current) {
        leafletMap.current.remove();
      }

      map = L.map(mapRef.current).setView(center, zoom);
      leafletMap.current = map;

      // Satellite imagery (ESRI World Imagery - free)
      const satellite = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          attribution: "Tiles &copy; Esri",
          maxZoom: 19,
        }
      );

      // Street map (OpenStreetMap)
      const streets = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }
      );

      // Default to satellite for solar installations - you can see the panels
      satellite.addTo(map);

      // Layer control to switch between satellite and street
      L.control.layers(
        { "Satellite": satellite, "Street": streets },
        {},
        { position: "topright" }
      ).addTo(map);

      // Color by site type
      const typeColors: Record<string, string> = {
        utility: "#2563eb",
        commercial: "#16a34a",
        community: "#9333ea",
      };

      // Add markers (limit to 1000 for performance)
      const sitesWithCoords = installations
        .filter((i) => i.latitude && i.longitude)
        .slice(0, 1000);

      for (const site of sitesWithCoords) {
        const color = typeColors[site.site_type] || "#6b7280";
        const capacityLabel = site.capacity_mw
          ? `${Number(site.capacity_mw).toFixed(1)} MW`
          : site.capacity_dc_kw
          ? `${Number(site.capacity_dc_kw).toLocaleString()} kW`
          : "Unknown";

        const marker = L.circleMarker(
          [Number(site.latitude), Number(site.longitude)],
          {
            radius: Math.min(12, Math.max(4, Math.log2((Number(site.capacity_mw) || 0.1) + 1) * 3)),
            fillColor: color,
            color: "#fff",
            weight: 1,
            fillOpacity: 0.7,
          }
        ).addTo(map);

        marker.bindPopup(
          `<div style="min-width:180px">
            <strong>${site.site_name || site.county || "Unknown"}</strong><br/>
            <span style="color:${color};font-weight:600;text-transform:capitalize">${site.site_type}</span><br/>
            ${capacityLabel}<br/>
            ${[site.city, site.county, site.state].filter(Boolean).join(", ")}<br/>
            ${site.install_date ? `Installed: ${site.install_date.substring(0, 4)}` : ""}
            ${onMarkerClick ? `<br/><a href="/solar/site/?id=${site.id}" style="color:#2563eb">View Details &rarr;</a>` : ""}
          </div>`
        );

        if (onMarkerClick) {
          marker.on("click", () => onMarkerClick(site.id));
        }
      }

      // Fit bounds if we have markers
      if (sitesWithCoords.length > 0) {
        const bounds = L.latLngBounds(
          sitesWithCoords.map((s) => [Number(s.latitude), Number(s.longitude)] as [number, number])
        );
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 12 });
      }
    })();

    return () => {
      cleanup = true;
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, [mounted, installations, center, zoom, onMarkerClick]);

  if (!mounted) {
    return (
      <div
        style={{ height }}
        className="bg-gray-100 rounded-lg flex items-center justify-center text-gray-400"
      >
        Loading map...
      </div>
    );
  }

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      />
      <div ref={mapRef} style={{ height }} className="rounded-lg z-0" />
    </>
  );
}
