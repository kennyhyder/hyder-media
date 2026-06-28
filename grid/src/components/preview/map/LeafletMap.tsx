"use client";

import { useCallback, useEffect, useRef } from "react";
import { scoreColor, scoreGlow } from "./theme";
import {
  MapSite,
  MapDataResponse,
  MapSubstation,
  MapLine,
  MapBrownfield,
} from "./types";
import type { LayerState } from "./ControlPanel";

// Imperative handle the shell uses to drive flyTo from the search box.
export interface MapHandle {
  flyTo: (lat: number, lng: number, zoom: number) => void;
}

interface Props {
  layers: LayerState;
  onSelect: (site: MapSite) => void;
  onViewport: (info: { count: number; avgScore: number | null }) => void;
  onLoading: (loading: boolean) => void;
  registerHandle: (h: MapHandle) => void;
}

// Parse WKT LINESTRING / MULTILINESTRING → arrays of [lat,lng].
function parseWKT(wkt: string): [number, number][][] {
  if (!wkt) return [];
  const out: [number, number][][] = [];
  const parse = (s: string): [number, number][] =>
    s
      .split(",")
      .map((pair) => pair.trim().split(/\s+/))
      .filter((p) => p.length >= 2)
      .map((p) => [parseFloat(p[1]), parseFloat(p[0])] as [number, number])
      .filter(([la, ln]) => !isNaN(la) && !isNaN(ln));
  if (wkt.startsWith("MULTILINESTRING")) {
    const inner = wkt.replace(/^MULTILINESTRING\s*\(\(/, "").replace(/\)\)\s*$/, "");
    for (const part of inner.split("),(")) {
      const c = parse(part);
      if (c.length) out.push(c);
    }
  } else if (wkt.startsWith("LINESTRING")) {
    const inner = wkt.replace(/^LINESTRING\s*\(/, "").replace(/\)\s*$/, "");
    const c = parse(inner);
    if (c.length) out.push(c);
  }
  return out;
}

function lineColor(kv: number | null): string {
  if (kv == null) return "#6366F1";
  if (kv >= 500) return "#C4B5FD";
  if (kv >= 230) return "#A78BFA";
  if (kv >= 115) return "#8B5CF6";
  return "#6D5BD0";
}

export default function LeafletMap({
  layers,
  onSelect,
  onViewport,
  onLoading,
  registerHandle,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const siteClusterRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bfLayerRef = useRef<any>(null);

  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const layersRef = useRef<LayerState>(layers);
  layersRef.current = layers;
  const readyRef = useRef(false);

  // ---- viewport fetch + render -------------------------------------------
  const fetchAndRender = useCallback(async () => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const lyr = layersRef.current;

    if (ctrlRef.current) ctrlRef.current.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    onLoading(true);

    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    const bounds = `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`;

    try {
      // Sites + (optionally) substations + lines come from one map-data call.
      const params = new URLSearchParams();
      params.set("bounds", bounds);
      params.set("limit", "1000"); // cap markers in view → smooth
      if (lyr.substations) params.set("include_substations", "1");
      if (lyr.lines) params.set("include_lines", "1");

      const reqs: Promise<unknown>[] = [
        fetch(`/api/grid/map-data?${params}`, { signal: ctrl.signal }).then((r) =>
          r.ok ? (r.json() as Promise<MapDataResponse>) : Promise.reject(r.status)
        ),
      ];

      // Brownfields are a separate endpoint (viewport via near_lat/near_lng).
      if (lyr.brownfields) {
        const c = map.getCenter();
        const radius = Math.max(
          25,
          Math.min(400, c.distanceTo(ne) / 1609.34) // meters → miles, capped
        );
        const bf = new URLSearchParams({
          near_lat: String(c.lat),
          near_lng: String(c.lng),
          radius_miles: String(Math.round(radius)),
          limit: "400",
        });
        reqs.push(
          fetch(`/api/grid/brownfields?${bf}`, { signal: ctrl.signal })
            .then((r) => (r.ok ? r.json() : { data: [] }))
            .catch(() => ({ data: [] }))
        );
      }

      const results = await Promise.all(reqs);
      if (ctrl.signal.aborted) return;

      const data = results[0] as MapDataResponse;
      const bfData = (results[1] as { data?: MapBrownfield[] }) || {};

      // --- sites ---
      const cluster = siteClusterRef.current;
      cluster.clearLayers();
      let sum = 0;
      let n = 0;
      const markers: unknown[] = [];

      for (const site of data.sites || []) {
        if (site.latitude == null || site.longitude == null) continue;
        const score = site.dc_score ?? 0;
        sum += score;
        n++;
        const color = scoreColor(score);
        const prime = score >= 80;
        const marker = L.circleMarker([site.latitude, site.longitude], {
          radius: prime ? 7 : 5.5,
          fillColor: color,
          color: "rgba(255,255,255,0.55)",
          weight: 1,
          fillOpacity: 0.9,
          className: prime ? "gc-prime" : "gc-site",
        });
        // glow halo via SVG drop-shadow applied per-render after add
        marker.on("add", () => {
          const path = marker._path as SVGElement | undefined;
          if (path) {
            path.style.filter = `drop-shadow(0 0 ${prime ? 6 : 4}px ${scoreGlow(
              score,
              prime ? 0.9 : 0.6
            )})`;
            if (prime) path.classList.add("gc-pulse");
          }
        });
        marker.on("click", () => onSelect(site));
        markers.push(marker);
      }
      cluster.addLayers(markers);
      onViewport({ count: n, avgScore: n ? sum / n : null });

      // --- substations ---
      const subL = subLayerRef.current;
      subL.clearLayers();
      if (lyr.substations && data.substations) {
        for (const s of data.substations as MapSubstation[]) {
          if (s.latitude == null || s.longitude == null) continue;
          const icon = L.divIcon({
            className: "",
            iconSize: [12, 12],
            iconAnchor: [6, 6],
            html: `<div style="width:9px;height:9px;background:#22D3EE;transform:rotate(45deg);border:1px solid rgba(255,255,255,.6);box-shadow:0 0 6px rgba(34,211,238,.8)"></div>`,
          });
          const m = L.marker([s.latitude, s.longitude], { icon });
          m.bindPopup(
            `<div style="font:13px system-ui;color:#0A0E1A"><b>${escapeHtml(
              s.name || "Substation"
            )}</b><br/>${s.max_voltage_kv != null ? s.max_voltage_kv + " kV · " : ""}${escapeHtml(
              s.state || ""
            )}</div>`
          );
          subL.addLayer(m);
        }
      }

      // --- lines ---
      const lineL = lineLayerRef.current;
      lineL.clearLayers();
      if (lyr.lines && data.lines) {
        for (const ln of data.lines as MapLine[]) {
          if (!ln.geometry_wkt) continue;
          for (const coords of parseWKT(ln.geometry_wkt)) {
            const pl = L.polyline(coords, {
              color: lineColor(ln.voltage_kv),
              weight: ln.voltage_kv && ln.voltage_kv >= 345 ? 2.4 : 1.6,
              opacity: 0.78,
            });
            pl.bindPopup(
              `<div style="font:13px system-ui;color:#0A0E1A"><b>${escapeHtml(
                ln.sub_1 || "?"
              )} → ${escapeHtml(ln.sub_2 || "?")}</b><br/>${
                ln.voltage_kv != null ? ln.voltage_kv + " kV" : ""
              }${ln.owner ? " · " + escapeHtml(ln.owner) : ""}</div>`
            );
            lineL.addLayer(pl);
          }
        }
      }

      // --- brownfields ---
      const bfL = bfLayerRef.current;
      bfL.clearLayers();
      if (lyr.brownfields && bfData.data) {
        for (const bf of bfData.data) {
          if (bf.latitude == null || bf.longitude == null) continue;
          const m = L.circleMarker([bf.latitude, bf.longitude], {
            radius: 5,
            fillColor: "transparent",
            color: "#FB923C",
            weight: 2,
            fillOpacity: 0,
          });
          m.bindPopup(
            `<div style="font:13px system-ui;color:#0A0E1A"><b>${escapeHtml(
              bf.name || "Brownfield"
            )}</b><br/>${escapeHtml(bf.former_use || bf.site_type || "")} · ${escapeHtml(
              bf.state || ""
            )}</div>`
          );
          bfL.addLayer(m);
        }
      }
    } catch {
      /* aborted or error — silent */
    } finally {
      if (!ctrl.signal.aborted) onLoading(false);
    }
  }, [onLoading, onSelect, onViewport]);

  // ---- init map -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
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
      }).setView([38.5, -97], 5);
      mapRef.current = map;
      map.attributionControl.setPrefix("");

      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          maxZoom: 19,
          subdomains: "abcd",
        }
      ).addTo(map);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cluster = (window as any).L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 48,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 13,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        iconCreateFunction: (cl: any) => {
          const count = cl.getChildCount();
          let dim = 32;
          if (count > 200) dim = 52;
          else if (count > 40) dim = 42;
          const label = count >= 1000 ? Math.round(count / 1000) + "K" : count;
          return L.divIcon({
            className: "",
            iconSize: [dim, dim],
            html: `<div style="width:${dim}px;height:${dim}px;border-radius:50%;
              background:rgba(34,211,238,0.16);border:1.5px solid rgba(34,211,238,0.6);
              backdrop-filter:blur(2px);
              display:flex;align-items:center;justify-content:center;
              color:#E6EDF7;font-weight:700;font-size:${dim > 46 ? 14 : 12}px;
              font-family:var(--font-geist-mono),monospace;
              box-shadow:0 0 14px -2px rgba(34,211,238,0.5)">${label}</div>`,
          });
        },
      });
      siteClusterRef.current = cluster;
      subLayerRef.current = L.layerGroup();
      lineLayerRef.current = L.layerGroup();
      bfLayerRef.current = L.layerGroup();

      map.addLayer(cluster);
      map.addLayer(subLayerRef.current);
      map.addLayer(lineLayerRef.current);
      map.addLayer(bfLayerRef.current);

      readyRef.current = true;

      const onMoveEnd = () => {
        if (moveTimer.current) clearTimeout(moveTimer.current);
        moveTimer.current = setTimeout(() => fetchAndRender(), 300);
      };
      map.on("moveend", onMoveEnd);

      registerHandle({
        flyTo: (lat, lng, zoom) =>
          map.flyTo([lat, lng], zoom, { duration: 1.1, easeLinearity: 0.22 }),
      });

      // initial load
      fetchAndRender();
    })();

    return () => {
      cancelled = true;
      if (moveTimer.current) clearTimeout(moveTimer.current);
      if (ctrlRef.current) ctrlRef.current.abort();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when layer toggles change (without remounting the map).
  useEffect(() => {
    if (readyRef.current) fetchAndRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.sites, layers.substations, layers.lines, layers.brownfields]);

  // Hide the site cluster when "Sites" toggled off.
  useEffect(() => {
    const map = mapRef.current;
    const cl = siteClusterRef.current;
    if (!map || !cl) return;
    if (layers.sites && !map.hasLayer(cl)) map.addLayer(cl);
    if (!layers.sites && map.hasLayer(cl)) map.removeLayer(cl);
  }, [layers.sites]);

  return <div ref={elRef} style={{ position: "absolute", inset: 0 }} />;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
