"use client";

import { useEffect, useRef, useState } from "react";
import { withDemoToken } from "@/lib/demoAccess";

interface HeatMapLayerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any; // Leaflet map instance
  sites: { latitude: number; longitude: number; dc_score: number | null }[];
  visible: boolean;
  zoomLevel: number;
}

/**
 * Renders a continuous heat map layer across ALL US land using county-level
 * DC readiness scores (3,222 counties). At higher zoom levels, blends in
 * individual site scores for finer granularity.
 *
 * County data is fetched once from /api/grid/county-heat and cached.
 * This ensures heat coverage everywhere — not just where sites exist —
 * so investors can evaluate ANY land parcel.
 */
export default function HeatMapLayer({ map, sites, visible, zoomLevel }: HeatMapLayerProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heatLayerRef = useRef<any>(null);
  const [countyHeat, setCountyHeat] = useState<[number, number, number][]>([]);
  const countyFetchedRef = useRef(false);

  // Fetch county heat data once
  useEffect(() => {
    if (countyFetchedRef.current) return;
    countyFetchedRef.current = true;

    const fetchCountyHeat = async () => {
      try {
        const res = await fetch(withDemoToken("/api/grid/county-heat"));
        if (!res.ok) return;
        const json = await res.json();
        if (json.counties) {
          // Convert [lat, lng, score] to normalized [lat, lng, intensity]
          const data: [number, number, number][] = json.counties.map(
            (c: [number, number, number]) => [c[0], c[1], c[2] / 100]
          );
          setCountyHeat(data);
        }
      } catch (err) {
        console.error("Failed to fetch county heat data:", err);
      }
    };
    fetchCountyHeat();
  }, []);

  useEffect(() => {
    if (!map || !visible) {
      if (heatLayerRef.current && map) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      return;
    }

    const initHeat = async () => {
      const L = await import("leaflet");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).L = L.default || L;
      await import("leaflet.heat");

      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }

      // Build heat data: county base layer + site detail overlay
      let heatData: [number, number, number][];

      if (zoomLevel < 8) {
        // Use county centroids as primary heat source for full US coverage
        // This covers ALL land, not just where sites exist
        heatData = [...countyHeat];

        // Also add site-level data aggregated to grid cells for areas with dense sites
        const grid = new Map<string, { lat: number; lng: number; totalScore: number; count: number }>();
        for (const site of sites) {
          if (!site.latitude || !site.longitude) continue;
          const score = site.dc_score ?? 0;
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
        // Add aggregated site data with slight boost (sites are more precise)
        for (const g of grid.values()) {
          const avgScore = (g.totalScore / g.count) / 100;
          heatData.push([g.lat / g.count, g.lng / g.count, Math.min(1, avgScore * 1.1)]);
        }
      } else {
        // At higher zoom: county base + individual sites for precision
        heatData = [...countyHeat];
        for (const s of sites) {
          if (s.latitude && s.longitude) {
            heatData.push([s.latitude, s.longitude, (s.dc_score ?? 0) / 100]);
          }
        }
      }

      if (heatData.length === 0) return;

      // Adjust radius based on zoom — larger at low zoom for continuous coverage
      const radius = zoomLevel < 6 ? 40 : zoomLevel < 8 ? 30 : 25;
      const blur = zoomLevel < 6 ? 30 : zoomLevel < 8 ? 20 : 15;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const globalL = (window as any).L;
      const heatLayer = globalL.heatLayer(heatData, {
        radius,
        blur,
        maxZoom: 12,
        max: 1.0,
        minOpacity: 0.2,
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
    };

    initHeat().catch(err => console.error("HeatMapLayer init error:", err));

    return () => {
      if (heatLayerRef.current && map) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [map, sites, visible, zoomLevel, countyHeat]);

  return null;
}
