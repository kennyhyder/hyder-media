"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

interface MapSite {
  id: string;
  name: string;
  site_type: string;
  state: string;
  latitude: number;
  longitude: number;
  dc_score: number | null;
}

interface ExistingDC {
  id: string;
  name: string;
  operator?: string;
  city?: string;
  state: string | null;
  latitude: number;
  longitude: number;
  capacity_mw?: number;
  sqft?: number;
  dc_type?: string;
  year_built?: number;
}

interface IXP {
  id: string;
  name: string;
  org_name?: string;
  city?: string;
  state: string | null;
  latitude: number;
  longitude: number;
  ix_count?: number;
  network_count?: number;
}

interface TransmissionLine {
  id: string;
  voltage_kv: number | null;
  owner?: string;
  sub_1?: string;
  sub_2?: string;
  geometry_wkt?: string;
}

interface Substation {
  id: string;
  name: string;
  state: string | null;
  latitude: number;
  longitude: number;
  max_voltage_kv: number | null;
}

interface MapData {
  sites: MapSite[];
  total: number;
  returned: number;
  datacenters?: ExistingDC[];
  ixps?: IXP[];
  lines?: TransmissionLine[];
  substations?: Substation[];
}

function scoreColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#eab308";
  if (score >= 30) return "#f97316";
  return "#ef4444";
}

function siteTypeColor(type: string): string {
  switch (type) {
    case "substation": return "#7c3aed";
    case "brownfield": return "#d97706";
    case "greenfield": return "#059669";
    default: return "#6b7280";
  }
}

function siteTypeLabel(type: string): string {
  switch (type) {
    case "substation": return "Substation Site";
    case "brownfield": return "Retired Power Plant";
    case "greenfield": return "Greenfield Corridor";
    default: return type;
  }
}

function parseWKTLineString(wkt: string): [number, number][] | null {
  // Handle LINESTRING and MULTILINESTRING WKT
  const match = wkt.match(/LINESTRING\s*\(([^)]+)\)/i) || wkt.match(/MULTILINESTRING\s*\(\(([^)]+)\)/i);
  if (!match) return null;
  try {
    return match[1].split(",").map(pair => {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);
      return [lat, lng] as [number, number];
    });
  } catch {
    return null;
  }
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR"
];

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMap = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const siteLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dcLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ixpLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LRef = useRef<any>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const moveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mounted, setMounted] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [totalSites, setTotalSites] = useState(0);
  const [returnedSites, setReturnedSites] = useState(0);
  const [totalDCs, setTotalDCs] = useState(0);
  const [totalIXPs, setTotalIXPs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterState, setFilterState] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterMinScore, setFilterMinScore] = useState<string>("");
  const [filterMaxScore, setFilterMaxScore] = useState<string>("");
  const [showDCs, setShowDCs] = useState(true);
  const [showIXPs, setShowIXPs] = useState(true);
  const [showSites, setShowSites] = useState(true);
  const [showLines, setShowLines] = useState(false);
  const [showSubstations, setShowSubstations] = useState(false);
  const [totalLines, setTotalLines] = useState(0);
  const [totalSubstations, setTotalSubstations] = useState(0);
  const [colorBy, setColorBy] = useState<"score" | "type">("score");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Score distribution
  const [scoreDistribution, setScoreDistribution] = useState({ excellent: 0, good: 0, fair: 0, poor: 0 });
  const [typeBreakdown, setTypeBreakdown] = useState({ substation: 0, brownfield: 0, greenfield: 0 });

  useEffect(() => { setMounted(true); }, []);

  // Initialize map once
  useEffect(() => {
    if (!mounted || !mapRef.current || mapReady) return;

    let cleanup = false;

    (async () => {
      const L = await import("leaflet");
      await import("leaflet.markercluster");

      if (cleanup || !mapRef.current) return;
      LRef.current = L;

      if (leafletMap.current) {
        leafletMap.current.remove();
      }

      const map = L.map(mapRef.current, {
        preferCanvas: true,
        zoomControl: false,
      }).setView([39.0, -98.0], 5);
      leafletMap.current = map;

      L.control.zoom({ position: "topright" }).addTo(map);

      const dark = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: '&copy; <a href="https://carto.com/">CARTO</a>', maxZoom: 19 }
      );
      const satellite = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles &copy; Esri", maxZoom: 19 }
      );
      const streets = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>', maxZoom: 19 }
      );
      dark.addTo(map);

      L.control.layers(
        { "Dark": dark, "Satellite": satellite, "Street": streets },
        {},
        { position: "topright" }
      ).addTo(map);

      // Create persistent layer groups
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createCluster = () => (window as any).L.markerClusterGroup({
        chunkedLoading: true,
        chunkInterval: 100,
        chunkDelay: 10,
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 14,
        iconCreateFunction: function(cluster: { getChildCount: () => number }) {
          const count = cluster.getChildCount();
          let dim = 30;
          let fontSize = "11";
          if (count > 100) { dim = 50; fontSize = "14"; }
          else if (count > 10) { dim = 40; fontSize = "12"; }

          return L.divIcon({
            html: `<div style="
              width:${dim}px;height:${dim}px;border-radius:50%;
              background:rgba(124,58,237,0.8);border:2px solid rgba(255,255,255,0.6);
              display:flex;align-items:center;justify-content:center;
              color:white;font-weight:700;font-size:${fontSize}px;
              font-family:system-ui;
            ">${count >= 1000 ? Math.round(count/1000) + 'K' : count}</div>`,
            className: "",
            iconSize: [dim, dim],
          });
        },
      });

      siteLayerRef.current = createCluster();
      dcLayerRef.current = L.layerGroup();
      ixpLayerRef.current = L.layerGroup();
      lineLayerRef.current = L.layerGroup();
      subLayerRef.current = L.layerGroup();

      map.addLayer(siteLayerRef.current);
      map.addLayer(dcLayerRef.current);
      map.addLayer(ixpLayerRef.current);
      // Lines and substations not added by default (toggled on by user)

      // Add legend
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legend = new (L.Control as any)({ position: "bottomright" });
      legend.onAdd = () => {
        const div = L.DomUtil.create("div", "");
        div.style.cssText = "background:rgba(0,0,0,0.85);padding:10px 14px;border-radius:8px;font-size:11px;color:#fff;font-family:system-ui;line-height:1.6";
        div.innerHTML = `
          <div style="font-weight:700;margin-bottom:4px">DC Readiness Score</div>
          <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#22c55e"></div> 70-100 Excellent</div>
          <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#eab308"></div> 50-70 Good</div>
          <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#f97316"></div> 30-50 Fair</div>
          <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#ef4444"></div> 0-30 Poor</div>
          <div style="border-top:1px solid #444;margin:6px 0;padding-top:6px">
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #1d4ed8"></div> Existing DC</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#06b6d4;border:2px solid #0891b2"></div> IXP / Interconnect</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:3px;background:#f59e0b"></div> Transmission Line</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;background:#f59e0b;border:2px solid #d97706;transform:rotate(45deg)"></div> Substation</div>
          </div>
        `;
        return div;
      };
      legend.addTo(map);

      setMapReady(true);
    })();

    return () => {
      cleanup = true;
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Fetch data and render markers
  const fetchAndRender = useCallback(async (useBounds = false) => {
    if (!mapReady || !LRef.current) return;

    // Cancel any in-flight request
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
    }
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const baseUrl = window.location.origin;
      const params = new URLSearchParams();
      if (filterState) params.set("state", filterState);
      if (filterType) params.set("site_type", filterType);
      if (filterMinScore) params.set("min_score", filterMinScore);
      if (filterMaxScore) params.set("max_score", filterMaxScore);
      params.set("include_dcs", "1");
      params.set("include_ixps", "1");
      if (showLines) params.set("include_lines", "1");
      if (showSubstations) params.set("include_substations", "1");
      params.set("lite", "1");

      // Use viewport bounds for re-fetches (not initial load)
      if (useBounds && leafletMap.current) {
        const b = leafletMap.current.getBounds();
        const sw = b.getSouthWest();
        const ne = b.getNorthEast();
        params.set("bounds", `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`);
        params.set("limit", "8000");
      } else {
        params.set("limit", "5000");
      }

      const res = await fetch(`${baseUrl}/api/grid/map-data?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MapData = await res.json();

      if (controller.signal.aborted) return;

      const L = LRef.current;

      // Update site markers
      siteLayerRef.current.clearLayers();
      let excellent = 0, good = 0, fair = 0, poor = 0;
      let sub = 0, bf = 0, gf = 0;

      for (const site of json.sites) {
        if (!site.latitude || !site.longitude) continue;

        const score = site.dc_score ?? 0;
        if (score >= 70) excellent++;
        else if (score >= 50) good++;
        else if (score >= 30) fair++;
        else poor++;

        if (site.site_type === "substation") sub++;
        else if (site.site_type === "brownfield") bf++;
        else if (site.site_type === "greenfield") gf++;

        const color = colorBy === "score"
          ? scoreColor(score)
          : siteTypeColor(site.site_type);

        const marker = L.circleMarker([site.latitude, site.longitude], {
          radius: 5,
          fillColor: color,
          color: "rgba(255,255,255,0.5)",
          weight: 1,
          fillOpacity: 0.8,
        });

        const typeDesc = siteTypeLabel(site.site_type);
        marker.bindPopup(`
          <div style="min-width:220px;font-family:system-ui;font-size:13px">
            <strong style="font-size:14px">${site.name || "Unnamed Site"}</strong><br/>
            <span style="color:${siteTypeColor(site.site_type)};font-weight:600">${typeDesc}</span>
            · ${site.state}<br/>
            <div style="margin:6px 0;padding:6px 0;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb">
              <span style="font-size:20px;font-weight:700;color:${scoreColor(score)}">${score.toFixed(1)}</span>
              <span style="color:#666;font-size:11px">/100 DC Score</span>
            </div>
            <a href="/grid/site/?id=${site.id}" style="color:#7c3aed;text-decoration:underline;font-weight:600">View Details →</a>
          </div>
        `);

        siteLayerRef.current.addLayer(marker);
      }

      setScoreDistribution({ excellent, good, fair, poor });
      setTypeBreakdown({ substation: sub, brownfield: bf, greenfield: gf });

      // Update DC markers
      dcLayerRef.current.clearLayers();
      if (json.datacenters) {
        for (const dc of json.datacenters) {
          if (!dc.latitude || !dc.longitude) continue;
          const marker = L.circleMarker([dc.latitude, dc.longitude], {
            radius: 8,
            fillColor: "#3b82f6",
            color: "#1d4ed8",
            weight: 2,
            fillOpacity: 0.9,
          });
          const capacityStr = dc.capacity_mw ? `${Number(dc.capacity_mw).toFixed(0)} MW` : "";
          marker.bindPopup(`
            <div style="min-width:200px;font-family:system-ui;font-size:13px">
              <strong style="font-size:14px">${dc.name || "Datacenter"}</strong><br/>
              <span style="color:#3b82f6;font-weight:600">Existing Datacenter</span><br/>
              ${dc.operator ? `<b>Operator:</b> ${dc.operator}<br/>` : ""}
              ${dc.city ? `${dc.city}, ` : ""}${dc.state || ""}<br/>
              ${capacityStr ? `<b>Capacity:</b> ${capacityStr}<br/>` : ""}
              ${dc.dc_type ? `<b>Type:</b> ${dc.dc_type}<br/>` : ""}
            </div>
          `);
          dcLayerRef.current.addLayer(marker);
        }
        setTotalDCs(json.datacenters.length);
      }

      // Update IXP markers
      ixpLayerRef.current.clearLayers();
      if (json.ixps) {
        for (const ixp of json.ixps) {
          if (!ixp.latitude || !ixp.longitude) continue;
          const marker = L.circleMarker([ixp.latitude, ixp.longitude], {
            radius: 7,
            fillColor: "#06b6d4",
            color: "#0891b2",
            weight: 2,
            fillOpacity: 0.9,
          });
          marker.bindPopup(`
            <div style="min-width:200px;font-family:system-ui;font-size:13px">
              <strong style="font-size:14px">${ixp.name}</strong><br/>
              <span style="color:#06b6d4;font-weight:600">Interconnection Facility (IXP)</span><br/>
              ${ixp.org_name ? `<b>Operator:</b> ${ixp.org_name}<br/>` : ""}
              ${ixp.city ? `${ixp.city}, ` : ""}${ixp.state || ""}<br/>
              ${ixp.ix_count ? `<b>Exchanges:</b> ${ixp.ix_count}<br/>` : ""}
              ${ixp.network_count ? `<b>Networks:</b> ${ixp.network_count}<br/>` : ""}
            </div>
          `);
          ixpLayerRef.current.addLayer(marker);
        }
        setTotalIXPs(json.ixps.length);
      }

      // Update transmission line polylines
      lineLayerRef.current.clearLayers();
      if (json.lines) {
        for (const line of json.lines) {
          if (!line.geometry_wkt) continue;
          const coords = parseWKTLineString(line.geometry_wkt);
          if (!coords || coords.length < 2) continue;

          const voltage = line.voltage_kv ?? 0;
          const weight = voltage >= 345 ? 3 : voltage >= 230 ? 2 : 1;
          const opacity = voltage >= 345 ? 0.8 : voltage >= 230 ? 0.6 : 0.4;

          const polyline = L.polyline(coords, {
            color: "#f59e0b",
            weight,
            opacity,
          });
          polyline.bindPopup(`
            <div style="min-width:180px;font-family:system-ui;font-size:13px">
              <strong style="font-size:14px">${voltage ? voltage + ' kV Line' : 'Transmission Line'}</strong><br/>
              ${line.owner ? `<b>Owner:</b> ${line.owner}<br/>` : ""}
              ${line.sub_1 ? `<b>From:</b> ${line.sub_1}<br/>` : ""}
              ${line.sub_2 ? `<b>To:</b> ${line.sub_2}<br/>` : ""}
            </div>
          `);
          lineLayerRef.current.addLayer(polyline);
        }
        setTotalLines(json.lines.length);
      }

      // Update substation markers
      subLayerRef.current.clearLayers();
      if (json.substations) {
        for (const sub of json.substations) {
          if (!sub.latitude || !sub.longitude) continue;
          const marker = L.marker([sub.latitude, sub.longitude], {
            icon: L.divIcon({
              html: `<div style="width:10px;height:10px;background:#f59e0b;border:2px solid #d97706;transform:rotate(45deg)"></div>`,
              className: "",
              iconSize: [10, 10],
              iconAnchor: [5, 5],
            }),
          });
          const voltageStr = sub.max_voltage_kv ? `${Number(sub.max_voltage_kv).toFixed(0)} kV` : "";
          marker.bindPopup(`
            <div style="min-width:180px;font-family:system-ui;font-size:13px">
              <strong style="font-size:14px">${sub.name || "Substation"}</strong><br/>
              <span style="color:#f59e0b;font-weight:600">Substation</span> · ${sub.state || ""}<br/>
              ${voltageStr ? `<b>Max Voltage:</b> ${voltageStr}<br/>` : ""}
            </div>
          `);
          subLayerRef.current.addLayer(marker);
        }
        setTotalSubstations(json.substations.length);
      }

      setTotalSites(json.total);
      setReturnedSites(json.returned);
      setInitialLoad(false);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mapReady, filterState, filterType, filterMinScore, filterMaxScore, colorBy, showLines, showSubstations]);

  // Initial data load
  useEffect(() => {
    if (mapReady) fetchAndRender(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, filterState, filterType, filterMinScore, filterMaxScore, showLines, showSubstations]);

  // Re-fetch on viewport change (debounced)
  useEffect(() => {
    if (!mapReady || !leafletMap.current || initialLoad) return;

    const onMoveEnd = () => {
      if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
      moveTimeoutRef.current = setTimeout(() => {
        fetchAndRender(true);
      }, 400);
    };

    leafletMap.current.on("moveend", onMoveEnd);
    return () => {
      leafletMap.current?.off("moveend", onMoveEnd);
      if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
    };
  }, [mapReady, initialLoad, fetchAndRender]);

  // Toggle layer visibility without re-fetching
  useEffect(() => {
    if (!leafletMap.current || !siteLayerRef.current) return;
    if (showSites) {
      if (!leafletMap.current.hasLayer(siteLayerRef.current)) leafletMap.current.addLayer(siteLayerRef.current);
    } else {
      leafletMap.current.removeLayer(siteLayerRef.current);
    }
  }, [showSites]);

  useEffect(() => {
    if (!leafletMap.current || !dcLayerRef.current) return;
    if (showDCs) {
      if (!leafletMap.current.hasLayer(dcLayerRef.current)) leafletMap.current.addLayer(dcLayerRef.current);
    } else {
      leafletMap.current.removeLayer(dcLayerRef.current);
    }
  }, [showDCs]);

  useEffect(() => {
    if (!leafletMap.current || !ixpLayerRef.current) return;
    if (showIXPs) {
      if (!leafletMap.current.hasLayer(ixpLayerRef.current)) leafletMap.current.addLayer(ixpLayerRef.current);
    } else {
      leafletMap.current.removeLayer(ixpLayerRef.current);
    }
  }, [showIXPs]);

  useEffect(() => {
    if (!leafletMap.current || !lineLayerRef.current) return;
    if (showLines) {
      if (!leafletMap.current.hasLayer(lineLayerRef.current)) leafletMap.current.addLayer(lineLayerRef.current);
    } else {
      leafletMap.current.removeLayer(lineLayerRef.current);
    }
  }, [showLines]);

  useEffect(() => {
    if (!leafletMap.current || !subLayerRef.current) return;
    if (showSubstations) {
      if (!leafletMap.current.hasLayer(subLayerRef.current)) leafletMap.current.addLayer(subLayerRef.current);
    } else {
      leafletMap.current.removeLayer(subLayerRef.current);
    }
  }, [showSubstations]);

  // Re-render markers when colorBy changes (no re-fetch needed, but need to recreate markers)
  useEffect(() => {
    if (mapReady && !initialLoad) {
      fetchAndRender(leafletMap.current?.getZoom() > 5);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorBy]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />

      <div className="-mx-4 -mt-6" style={{ height: "calc(100vh - 57px)" }}>
        <div className="flex h-full">
          {/* Sidebar */}
          <div className={`bg-white border-r border-gray-200 transition-all duration-300 flex flex-col ${sidebarOpen ? 'w-80' : 'w-0'} overflow-hidden`}>
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Site Explorer</h2>
              <p className="text-xs text-gray-500 mt-1">
                {loading && initialLoad ? "Loading..." : (
                  <>
                    {returnedSites.toLocaleString()}{returnedSites < totalSites ? ` of ${totalSites.toLocaleString()}` : ""} sites
                    {" · "}{totalDCs} DCs · {totalIXPs} IXPs
                    {totalLines > 0 && ` · ${totalLines.toLocaleString()} lines`}
                    {totalSubstations > 0 && ` · ${totalSubstations.toLocaleString()} subs`}
                    {returnedSites < totalSites && <span className="text-purple-600"> · zoom in for more</span>}
                  </>
                )}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Layers */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Layers</label>
                <div className="mt-2 space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={showSites} onChange={e => setShowSites(e.target.checked)} className="accent-purple-600" />
                    <span className="w-3 h-3 rounded-full bg-purple-600 inline-block"></span>
                    Prospect Sites ({returnedSites.toLocaleString()})
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={showDCs} onChange={e => setShowDCs(e.target.checked)} className="accent-blue-600" />
                    <span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span>
                    Existing Datacenters ({totalDCs})
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={showIXPs} onChange={e => setShowIXPs(e.target.checked)} className="accent-cyan-600" />
                    <span className="w-3 h-3 rounded-full bg-cyan-500 inline-block"></span>
                    Interconnection Facilities ({totalIXPs})
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={showLines} onChange={e => setShowLines(e.target.checked)} className="accent-amber-600" />
                    <span className="w-3 h-0.5 bg-amber-500 inline-block"></span>
                    Transmission Lines {totalLines > 0 && `(${totalLines.toLocaleString()})`}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={showSubstations} onChange={e => setShowSubstations(e.target.checked)} className="accent-amber-600" />
                    <span className="w-3 h-3 bg-amber-500 inline-block rotate-45"></span>
                    Substations {totalSubstations > 0 && `(${totalSubstations.toLocaleString()})`}
                  </label>
                </div>
              </div>

              {/* Color By */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Color By</label>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setColorBy("score")}
                    className={`px-3 py-1.5 text-xs rounded-lg font-medium ${colorBy === "score" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  >
                    Score
                  </button>
                  <button
                    onClick={() => setColorBy("type")}
                    className={`px-3 py-1.5 text-xs rounded-lg font-medium ${colorBy === "type" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  >
                    Site Type
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filters</label>
                <div className="mt-2 space-y-3">
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">State</label>
                    <select
                      value={filterState}
                      onChange={e => setFilterState(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                    >
                      <option value="">All States</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-600 block mb-1">Site Type</label>
                    <select
                      value={filterType}
                      onChange={e => setFilterType(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                    >
                      <option value="">All Types</option>
                      <option value="substation">Substation Sites</option>
                      <option value="brownfield">Retired Power Plants</option>
                      <option value="greenfield">Greenfield Corridors</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-600 block mb-1">Min Score</label>
                      <input
                        type="number"
                        value={filterMinScore}
                        onChange={e => setFilterMinScore(e.target.value)}
                        placeholder="0"
                        min={0} max={100}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 block mb-1">Max Score</label>
                      <input
                        type="number"
                        value={filterMaxScore}
                        onChange={e => setFilterMaxScore(e.target.value)}
                        placeholder="100"
                        min={0} max={100}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Score Distribution */}
              {!initialLoad && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Score Distribution</label>
                  <div className="mt-2 space-y-1">
                    {[
                      { label: "70-100", color: "#22c55e", count: scoreDistribution.excellent },
                      { label: "50-70", color: "#eab308", count: scoreDistribution.good },
                      { label: "30-50", color: "#f97316", count: scoreDistribution.fair },
                      { label: "0-30", color: "#ef4444", count: scoreDistribution.poor },
                    ].map(band => (
                      <div key={band.label} className="flex items-center gap-2 text-xs">
                        <div className="w-3 h-3 rounded" style={{ background: band.color }}></div>
                        <span className="w-12 text-gray-600">{band.label}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className="h-2 rounded-full" style={{
                            background: band.color,
                            width: `${Math.max(1, (band.count / Math.max(returnedSites, 1)) * 100)}%`,
                          }}></div>
                        </div>
                        <span className="text-gray-500 w-12 text-right">{band.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Site Type Breakdown */}
              {!initialLoad && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">By Type</label>
                  <div className="mt-2 space-y-1">
                    {[
                      { type: "substation", label: "Substation Sites", color: "#7c3aed", count: typeBreakdown.substation },
                      { type: "greenfield", label: "Greenfield Corridors", color: "#059669", count: typeBreakdown.greenfield },
                      { type: "brownfield", label: "Retired Power Plants", color: "#d97706", count: typeBreakdown.brownfield },
                    ].map(t => (
                      <div key={t.type} className="flex items-center gap-2 text-xs">
                        <div className="w-3 h-3 rounded-full" style={{ background: t.color }}></div>
                        <span className="flex-1 text-gray-700">{t.label}</span>
                        <span className="text-gray-500">{t.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Map Area */}
          <div className="flex-1 relative">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="absolute top-3 left-3 z-[1000] bg-white border border-gray-300 rounded-lg px-2 py-1.5 shadow-md hover:bg-gray-50"
              title={sidebarOpen ? "Hide filters" : "Show filters"}
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {sidebarOpen
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
              </svg>
            </button>

            {loading && initialLoad && (
              <div className="absolute inset-0 bg-gray-900/50 z-[1000] flex items-center justify-center">
                <div className="bg-white rounded-xl px-6 py-4 shadow-xl">
                  <div className="text-gray-700 font-medium">Loading top-scored sites...</div>
                  <div className="text-gray-500 text-sm mt-1">Zoom in to explore more</div>
                </div>
              </div>
            )}

            {loading && !initialLoad && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 border border-gray-200 rounded-full px-4 py-1.5 shadow text-xs text-gray-600">
                Updating...
              </div>
            )}

            {error && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">
                Error: {error}
              </div>
            )}

            <div ref={mapRef} className="h-full w-full" />
          </div>
        </div>
      </div>
    </>
  );
}
