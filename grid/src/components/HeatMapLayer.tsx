"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { withDemoToken } from "@/lib/demoAccess";

interface HeatMapLayerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any; // Leaflet map instance
  visible: boolean;
}

/**
 * Renders a continuous infrastructure suitability heat map across ALL US land
 * using county-level DC readiness scores (3,222 counties).
 *
 * leaflet.heat 0.2.0 has canvas positioning bugs on zoom with Leaflet 1.x,
 * so we recreate the layer after every zoom/move to guarantee rendering.
 */
export default function HeatMapLayer({ map, visible }: HeatMapLayerProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heatLayerRef = useRef<any>(null);
  const [countyHeat, setCountyHeat] = useState<[number, number, number][]>([]);
  const countyFetchedRef = useRef(false);
  const leafletReadyRef = useRef(false);

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

  // Ensure leaflet + leaflet.heat are loaded once
  useEffect(() => {
    if (leafletReadyRef.current) return;
    const load = async () => {
      const L = await import("leaflet");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).L = L.default || L;
      await import("leaflet.heat");
      leafletReadyRef.current = true;
    };
    load();
  }, []);

  // Create a fresh heat layer and add it to the map
  const addHeatLayer = useCallback(() => {
    if (!map || !leafletReadyRef.current || countyHeat.length === 0) return;

    // Remove existing
    if (heatLayerRef.current) {
      try { map.removeLayer(heatLayerRef.current); } catch { /* ignore */ }
      heatLayerRef.current = null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const globalL = (window as any).L;
    if (!globalL || !globalL.heatLayer) return;

    const zoom = map.getZoom();
    // Keep radius large enough that county centroids (~50-80km apart) always overlap.
    // At high zoom, increase radius so heat stays visible even when few centroids are in view.
    const radius = zoom < 6 ? 55 : zoom < 8 ? 45 : zoom < 10 ? 40 : zoom < 12 ? 35 : 30;
    const blur = zoom < 6 ? 40 : zoom < 8 ? 30 : zoom < 10 ? 25 : 20;

    const heatLayer = globalL.heatLayer(countyHeat, {
      radius,
      blur,
      maxZoom: 18,
      max: 1.0,
      minOpacity: 0.15,
      gradient: {
        0.0: "#1e3a5f",
        0.3: "#3b82f6",
        0.45: "#06b6d4",
        0.55: "#22c55e",
        0.7: "#eab308",
        0.85: "#f97316",
        1.0: "#ef4444",
      },
    });

    heatLayer.addTo(map);
    heatLayerRef.current = heatLayer;
  }, [map, countyHeat]);

  // Manage visibility + recreate on zoom/move to work around leaflet.heat canvas bugs
  useEffect(() => {
    if (!map) return;

    if (!visible) {
      if (heatLayerRef.current) {
        try { map.removeLayer(heatLayerRef.current); } catch { /* ignore */ }
        heatLayerRef.current = null;
      }
      return;
    }

    if (countyHeat.length === 0) return;

    // Wait for leaflet.heat to load, then create initial layer
    const waitAndCreate = () => {
      if (leafletReadyRef.current) {
        addHeatLayer();
      } else {
        setTimeout(waitAndCreate, 100);
      }
    };
    waitAndCreate();

    // Recreate heat layer after any zoom/move completes
    // This is the nuclear fix for leaflet.heat 0.2.0 canvas bugs
    let debounceTimer: ReturnType<typeof setTimeout>;
    const onMapChange = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (visible) addHeatLayer();
      }, 200);
    };

    map.on("moveend", onMapChange);
    map.on("zoomend", onMapChange);

    return () => {
      clearTimeout(debounceTimer);
      map.off("moveend", onMapChange);
      map.off("zoomend", onMapChange);
    };
  }, [map, visible, countyHeat, addHeatLayer]);

  return null;
}
