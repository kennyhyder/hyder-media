"use client";

import { useEffect, useRef, useState } from "react";
import { withDemoToken } from "@/lib/demoAccess";

interface HeatMapLayerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any; // Leaflet map instance
  visible: boolean;
  zoomLevel: number;
}

/**
 * Renders a continuous infrastructure suitability heat map across ALL US land
 * using county-level DC readiness scores (3,222 counties).
 *
 * This layer shows WHERE development could happen based on infrastructure
 * (power, fiber, water, labor, climate, energy cost, tax incentives) —
 * independent of where existing prospect sites are. Sites render as markers
 * on top of this surface.
 *
 * County data is fetched once from /api/grid/county-heat and cached.
 */
export default function HeatMapLayer({ map, visible, zoomLevel }: HeatMapLayerProps) {
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

      // Pure county infrastructure data — no site overlay
      if (countyHeat.length === 0) return;

      // Larger radius for smooth continuous coverage from county centroids
      const radius = zoomLevel < 6 ? 55 : zoomLevel < 8 ? 45 : zoomLevel < 10 ? 35 : 25;
      const blur = zoomLevel < 6 ? 40 : zoomLevel < 8 ? 30 : zoomLevel < 10 ? 20 : 15;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const globalL = (window as any).L;
      const heatLayer = globalL.heatLayer(countyHeat, {
        radius,
        blur,
        maxZoom: 12,
        max: 1.0,
        minOpacity: 0.15,
        gradient: {
          0.0: "#1e3a5f",   // dark blue (poor infrastructure)
          0.3: "#3b82f6",   // blue
          0.45: "#06b6d4",  // cyan
          0.55: "#22c55e",  // green (moderate)
          0.7: "#eab308",   // yellow (good)
          0.85: "#f97316",  // orange (very good)
          1.0: "#ef4444",   // red (excellent infrastructure)
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
  }, [map, visible, zoomLevel, countyHeat]);

  return null;
}
