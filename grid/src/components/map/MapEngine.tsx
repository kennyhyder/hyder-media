"use client";

// The Leaflet engine. Pure client island — always loaded via dynamic(ssr:false)
// so it NEVER runs on the server and NEVER blocks SSR content. Renders:
//   • theme-aware CartoDB tiles (Positron / Dark Matter), re-tiled on theme flip
//   • a US-state choropleth at low zoom (avgScore per state from rollups.json)
//   • zoom-scaled, score-coloured, clustered site point markers
// and reports viewport stats + marker selection up to the React wrapper.

import { useCallback, useEffect, useRef } from "react";
import { scoreColor, scoreGlow, TILES, readTheme } from "./theme";
import { MapSite, MapDataResponse } from "./types";
import { rollups } from "@/lib/rollups";
import { stateName } from "@/lib/geo";
import statesGeo from "./us-states.geo.json";
import { FIPS_TO_USPS } from "./fips";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface EngineHandle {
  flyTo: (lat: number, lng: number, zoom: number) => void;
}

interface Props {
  /** Initial view. */
  center: [number, number];
  zoom: number;
  /** Optional viewport clamp (regional maps). [[swLat,swLng],[neLat,neLng]] */
  maxBounds?: [[number, number], [number, number]];
  showChoropleth: boolean;
  showPoints: boolean;
  /** Static, pre-supplied sites (mini-map mode). When set, NO bbox fetch runs. */
  staticSites?: MapSite[];
  /** Fit the initial view to the static sites' bounds (regional mode). */
  fitSites?: boolean;
  /** Highlight one site (mini-map "this site"). */
  focusSiteId?: string | null;
  onSelect: (site: MapSite) => void;
  onViewport: (info: { count: number; avgScore: number | null }) => void;
  onLoading: (loading: boolean) => void;
  registerHandle: (h: EngineHandle) => void;
}

// avgScore per USPS state code, from the precomputed rollups.
const STATE_AVG: Record<string, { avg: number; count: number }> = (() => {
  const out: Record<string, { avg: number; count: number }> = {};
  for (const [code, agg] of Object.entries(rollups.states)) {
    out[code] = { avg: agg.avgScore, count: agg.count };
  }
  return out;
})();

export default function MapEngine({
  center,
  zoom,
  maxBounds,
  showChoropleth,
  showPoints,
  staticSites,
  fitSites,
  focusSiteId,
  onSelect,
  onViewport,
  onLoading,
  registerHandle,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<Any>(null);
  const mapRef = useRef<Any>(null);
  const tileRef = useRef<Any>(null);
  const choroRef = useRef<Any>(null);
  const clusterRef = useRef<Any>(null);
  const themeRef = useRef<"light" | "dark">("light");

  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const readyRef = useRef(false);

  // Keep latest layer flags without remounting.
  const flagsRef = useRef({ showChoropleth, showPoints });
  flagsRef.current = { showChoropleth, showPoints };

  // ── points: build markers from a site array ───────────────────────────────
  const renderSites = useCallback(
    (sites: MapSite[]) => {
      const L = LRef.current;
      const cluster = clusterRef.current;
      if (!L || !cluster) return;
      cluster.clearLayers();
      let sum = 0;
      let n = 0;
      const markers: unknown[] = [];
      for (const site of sites) {
        if (site.latitude == null || site.longitude == null) continue;
        const score = site.dc_score ?? 0;
        sum += score;
        n++;
        const color = scoreColor(score);
        const isFocus = focusSiteId != null && site.id === focusSiteId;
        const prime = score >= 80 || isFocus;
        const marker = L.circleMarker([site.latitude, site.longitude], {
          radius: isFocus ? 9 : prime ? 7 : 5.5,
          fillColor: color,
          color: isFocus ? "#ffffff" : "rgba(255,255,255,0.55)",
          weight: isFocus ? 2 : 1,
          fillOpacity: 0.9,
          className: prime ? "gcm-prime" : "gcm-site",
        });
        marker.on("add", () => {
          const path = marker._path as SVGElement | undefined;
          if (path) {
            path.style.filter = `drop-shadow(0 0 ${prime ? 6 : 4}px ${scoreGlow(
              score,
              prime ? 0.9 : 0.6
            )})`;
            if (prime && !isFocus) path.classList.add("gcm-pulse");
          }
        });
        marker.on("click", () => onSelect(site));
        markers.push(marker);
      }
      cluster.addLayers(markers);
      onViewport({ count: n, avgScore: n ? sum / n : null });
    },
    [focusSiteId, onSelect, onViewport]
  );

  // ── points: bbox fetch (live mode) ────────────────────────────────────────
  const fetchAndRender = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !flagsRef.current.showPoints) return;
    if (ctrlRef.current) ctrlRef.current.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    onLoading(true);

    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    const bounds = `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`;

    try {
      const params = new URLSearchParams();
      params.set("bounds", bounds);
      params.set("limit", "1000");
      // Zoom-scaled readiness floor — ESSENTIAL. A wide bbox with no score
      // filter makes the API sort 164k rows by dc_score and hit the statement
      // timeout (empty map). At low zoom request only top-readiness sites (small
      // → fast); reveal the long tail as the viewport shrinks.
      const z = map.getZoom();
      const minScore =
        z <= 4 ? 78 : z <= 5 ? 70 : z <= 6 ? 60 : z <= 7 ? 48 : z <= 8 ? 32 : 0;
      if (minScore > 0) params.set("min_score", String(minScore));

      const res = await fetch(`/api/grid/map-data?${params}`, {
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as MapDataResponse;
      if (ctrl.signal.aborted) return;
      renderSites(data.sites || []);
    } catch {
      /* aborted or error — silent */
    } finally {
      if (!ctrl.signal.aborted) onLoading(false);
    }
  }, [onLoading, renderSites]);

  // ── choropleth: build / restyle the state layer ──────────────────────────
  const buildChoropleth = useCallback(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (choroRef.current) {
      map.removeLayer(choroRef.current);
      choroRef.current = null;
    }
    const layer = L.geoJSON(statesGeo as Any, {
      style: (feature: Any) => {
        const usps = FIPS_TO_USPS[feature.id as string];
        const rec = usps ? STATE_AVG[usps] : undefined;
        const fill = rec ? scoreColor(rec.avg) : "var(--border)";
        return {
          fillColor: fill,
          fillOpacity: rec ? 0.5 : 0.12,
          color: "rgba(255,255,255,0.35)",
          weight: 0.8,
        };
      },
      onEachFeature: (feature: Any, lyr: Any) => {
        const usps = FIPS_TO_USPS[feature.id as string];
        const rec = usps ? STATE_AVG[usps] : undefined;
        const nm = usps ? stateName(usps) : feature.properties?.name || "—";
        lyr.bindTooltip(
          `<div style="font:12px var(--font-geist-sans),system-ui;line-height:1.4">
             <b>${escapeHtml(nm)}</b><br/>
             ${rec ? `Avg readiness <b>${rec.avg.toFixed(1)}</b> · ${rec.count.toLocaleString("en-US")} sites` : "No data"}
           </div>`,
          { sticky: true, opacity: 0.95 }
        );
        lyr.on({
          mouseover: () => lyr.setStyle({ weight: 1.8, fillOpacity: 0.68 }),
          mouseout: () => layer.resetStyle(lyr),
          click: () => {
            const bounds = lyr.getBounds();
            map.flyToBounds(bounds, { duration: 1.0, padding: [40, 40] });
          },
        });
      },
    });
    choroRef.current = layer;
    layer.addTo(map);
    layer.bringToBack();
  }, []);

  // Show/hide choropleth based on zoom (national view only) + flag.
  const syncChoroplethVisibility = useCallback(() => {
    const map = mapRef.current;
    const layer = choroRef.current;
    if (!map || !layer) return;
    const wantByZoom = map.getZoom() <= 6;
    const want = flagsRef.current.showChoropleth && wantByZoom;
    const has = map.hasLayer(layer);
    if (want && !has) {
      map.addLayer(layer);
      layer.bringToBack();
    } else if (!want && has) {
      map.removeLayer(layer);
    }
  }, []);

  // ── theme-aware tiles ─────────────────────────────────────────────────────
  const applyTiles = useCallback(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const theme = readTheme();
    themeRef.current = theme;
    const t = TILES[theme];
    if (tileRef.current) map.removeLayer(tileRef.current);
    tileRef.current = L.tileLayer(t.url, {
      attribution: t.attribution,
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);
    tileRef.current.bringToFront();
    // tiles must sit BELOW the choropleth + points
    if (choroRef.current && map.hasLayer(choroRef.current))
      choroRef.current.bringToBack();
  }, []);

  // ── init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet.markercluster");
      if (cancelled || !elRef.current || mapRef.current) return;
      LRef.current = L;

      const map = L.map(elRef.current, {
        preferCanvas: true,
        zoomControl: false,
        attributionControl: true,
        worldCopyJump: true,
        ...(maxBounds
          ? { maxBounds: L.latLngBounds(maxBounds), maxBoundsViscosity: 0.7 }
          : {}),
      }).setView(center, zoom);
      mapRef.current = map;
      map.attributionControl.setPrefix("");
      L.control.zoom({ position: "bottomright" }).addTo(map);

      // Regional mode: fit the view to the supplied static sites' bounds.
      if (fitSites && staticSites && staticSites.length) {
        const pts = staticSites
          .filter((s) => s.latitude != null && s.longitude != null)
          .map((s) => [s.latitude as number, s.longitude as number]) as [
          number,
          number
        ][];
        if (pts.length === 1) {
          map.setView(pts[0], 9);
        } else if (pts.length > 1) {
          map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 9 });
        }
      }

      applyTiles();

      // cluster group for points
      const cluster = (window as Any).L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 48,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 13,
        iconCreateFunction: (cl: Any) => {
          const count = cl.getChildCount();
          let dim = 32;
          if (count > 200) dim = 52;
          else if (count > 40) dim = 42;
          const label =
            count >= 1000 ? Math.round(count / 1000) + "K" : count;
          return L.divIcon({
            className: "",
            iconSize: [dim, dim],
            html: `<div style="width:${dim}px;height:${dim}px;border-radius:50%;
              background:color-mix(in srgb, var(--accent) 16%, transparent);
              border:1.5px solid color-mix(in srgb, var(--accent) 60%, transparent);
              backdrop-filter:blur(2px);
              display:flex;align-items:center;justify-content:center;
              color:var(--text);font-weight:700;font-size:${dim > 46 ? 14 : 12}px;
              font-family:var(--font-geist-mono),monospace;
              box-shadow:0 0 14px -2px color-mix(in srgb, var(--accent) 50%, transparent)">${label}</div>`,
          });
        },
      });
      clusterRef.current = cluster;
      if (showPoints) map.addLayer(cluster);

      if (showChoropleth) {
        buildChoropleth();
        syncChoroplethVisibility();
      }

      readyRef.current = true;

      // moveend → debounced bbox fetch (live mode only)
      const onMoveEnd = () => {
        syncChoroplethVisibility();
        if (staticSites) return;
        if (moveTimer.current) clearTimeout(moveTimer.current);
        moveTimer.current = setTimeout(() => fetchAndRender(), 300);
      };
      map.on("moveend", onMoveEnd);
      map.on("zoomend", syncChoroplethVisibility);

      registerHandle({
        flyTo: (lat, lng, z) =>
          map.flyTo([lat, lng], z, { duration: 1.1, easeLinearity: 0.22 }),
      });

      // theme re-tile on <html> class change
      observer = new MutationObserver(() => {
        if (readTheme() !== themeRef.current) applyTiles();
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      // initial points
      if (staticSites) {
        renderSites(staticSites);
        onLoading(false);
      } else if (showPoints) {
        fetchAndRender();
      } else {
        onLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      if (moveTimer.current) clearTimeout(moveTimer.current);
      if (ctrlRef.current) ctrlRef.current.abort();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to showPoints / showChoropleth flag changes without remount.
  useEffect(() => {
    if (!readyRef.current) return;
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;
    if (showPoints && !map.hasLayer(cluster)) {
      map.addLayer(cluster);
      if (staticSites) renderSites(staticSites);
      else fetchAndRender();
    } else if (!showPoints && map.hasLayer(cluster)) {
      map.removeLayer(cluster);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPoints]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (showChoropleth && !choroRef.current) buildChoropleth();
    syncChoroplethVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChoropleth]);

  return <div ref={elRef} style={{ position: "absolute", inset: 0 }} />;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
