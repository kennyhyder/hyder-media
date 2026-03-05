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
      await import("leaflet.markercluster");

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

      // Single-site view with polygon boundary
      const isSingleSite = installations.length === 1;
      const singleSite = isSingleSite ? installations[0] : null;
      const hasBoundary = singleSite?.site_boundary?.type && singleSite?.site_boundary?.coordinates;

      if (isSingleSite && hasBoundary && singleSite) {
        // Render polygon overlay
        const color = typeColors[singleSite.site_type] || "#2563eb";
        const polygonLayer = L.geoJSON(singleSite.site_boundary as GeoJSON.GeoJsonObject, {
          style: {
            color: color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.2,
          },
        }).addTo(map);

        // Also add a small circle marker at centroid for popup
        if (singleSite.latitude && singleSite.longitude) {
          const capacityLabel = singleSite.capacity_mw
            ? `${Number(singleSite.capacity_mw).toFixed(1)} MW`
            : singleSite.capacity_dc_kw
            ? `${Number(singleSite.capacity_dc_kw).toLocaleString()} kW`
            : "Unknown";

          L.circleMarker(
            [Number(singleSite.latitude), Number(singleSite.longitude)],
            {
              radius: 5,
              fillColor: color,
              color: "#fff",
              weight: 1,
              fillOpacity: 0.8,
            }
          ).bindPopup(
            `<div style="min-width:180px">
              <strong>${singleSite.site_name || singleSite.county || "Unknown"}</strong><br/>
              <span style="color:${color};font-weight:600;text-transform:capitalize">${singleSite.site_type}</span><br/>
              ${capacityLabel}<br/>
              ${[singleSite.city, singleSite.county, singleSite.state].filter(Boolean).join(", ")}<br/>
              ${singleSite.area_m2 ? `Area: ${(Number(singleSite.area_m2) / 4047).toFixed(1)} acres` : ""}
            </div>`
          ).addTo(map);
        }

        // Fit to polygon bounds with padding
        map.fitBounds(polygonLayer.getBounds(), { padding: [40, 40], maxZoom: 18 });
      } else {
        // Multi-site or no polygon: use marker clusters
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clusters = new (L as any).MarkerClusterGroup({
          chunkedLoading: true,
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          disableClusteringAtZoom: 14,
        });

        const sitesWithCoords = installations
          .filter((i) => i.latitude && i.longitude);

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
          );

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

          clusters.addLayer(marker);
        }

        map.addLayer(clusters);

        // Fit bounds if we have markers
        if (sitesWithCoords.length > 0) {
          if (isSingleSite) {
            // Single site without polygon: zoom in close
            map.setView(
              [Number(sitesWithCoords[0].latitude), Number(sitesWithCoords[0].longitude)],
              zoom
            );
          } else {
            const bounds = L.latLngBounds(
              sitesWithCoords.map((s) => [Number(s.latitude), Number(s.longitude)] as [number, number])
            );
            map.fitBounds(bounds, { padding: [20, 20], maxZoom: 12 });
          }
        }
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
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"
      />
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"
      />
      <div ref={mapRef} style={{ height }} className="rounded-lg z-0" />
    </>
  );
}
