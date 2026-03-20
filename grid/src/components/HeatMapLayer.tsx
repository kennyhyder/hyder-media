"use client";

import { useEffect, useRef } from "react";

interface HeatMapLayerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any; // Leaflet map instance
  sites: { latitude: number; longitude: number; dc_score: number | null }[];
  visible: boolean;
  zoomLevel: number;
}

/**
 * Renders a heat map layer on a Leaflet map using leaflet.heat.
 * Intensity is dc_score / 100 (normalized 0-1).
 * At low zoom (< 8), aggregates by county centroid to avoid density issues.
 */
export default function HeatMapLayer({ map, sites, visible, zoomLevel }: HeatMapLayerProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heatLayerRef = useRef<any>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!map || !visible) {
      // Remove layer if hidden
      if (heatLayerRef.current && map) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      return;
    }

    const initHeat = async () => {
      // Dynamically import leaflet and leaflet.heat
      const L = await import("leaflet");
      await import("leaflet.heat");

      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }

      // Build heat data points
      let heatData: [number, number, number][];

      if (zoomLevel < 8) {
        // County-level aggregation: group by rounded lat/lng (~0.5 degree grid)
        const grid = new Map<string, { lat: number; lng: number; totalScore: number; count: number }>();
        for (const site of sites) {
          if (!site.latitude || !site.longitude) continue;
          const score = site.dc_score ?? 0;
          // Round to 0.5 degree grid for county-level aggregation
          const gridLat = Math.round(site.latitude * 2) / 2;
          const gridLng = Math.round(site.longitude * 2) / 2;
          const key = `${gridLat},${gridLng}`;
          const existing = grid.get(key);
          if (existing) {
            existing.totalScore += score;
            existing.count += 1;
            existing.lat += site.latitude;
            existing.lng += site.longitude;
          } else {
            grid.set(key, { lat: site.latitude, lng: site.longitude, totalScore: score, count: 1 });
          }
        }
        heatData = Array.from(grid.values()).map(g => [
          g.lat / g.count,
          g.lng / g.count,
          (g.totalScore / g.count) / 100,
        ]);
      } else {
        // Full resolution
        heatData = sites
          .filter(s => s.latitude && s.longitude)
          .map(s => [s.latitude, s.longitude, (s.dc_score ?? 0) / 100]);
      }

      // Create heat layer — L.heatLayer is added by leaflet.heat plugin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const heatLayer = (L as any).heatLayer(heatData, {
        radius: 25,
        blur: 15,
        maxZoom: 12,
        max: 1.0,
        minOpacity: 0.3,
        gradient: {
          0.0: "#3b82f6",   // blue (low score)
          0.25: "#06b6d4",  // cyan
          0.5: "#eab308",   // yellow (mid score)
          0.75: "#f97316",  // orange
          1.0: "#ef4444",   // red (high score)
        },
      });

      heatLayer.addTo(map);
      heatLayerRef.current = heatLayer;
      initializedRef.current = true;
    };

    initHeat();

    return () => {
      if (heatLayerRef.current && map) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [map, sites, visible, zoomLevel]);

  return null;
}
