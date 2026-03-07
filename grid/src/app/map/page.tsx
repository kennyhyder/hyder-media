"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

interface MapSite {
  id: string;
  name: string;
  site_type: string;
  state: string;
  county: string | null;
  latitude: number;
  longitude: number;
  dc_score: number | null;
  available_capacity_mw: number | null;
  former_use: string | null;
  substation_voltage_kv: number | null;
  nearest_ixp_distance_km: number | null;
  nearest_dc_distance_km: number | null;
  acreage: number | null;
  // Sub-scores for custom weighting
  score_power: number | null;
  score_speed_to_power: number | null;
  score_fiber: number | null;
  score_water: number | null;
  score_hazard: number | null;
  score_labor: number | null;
  score_existing_dc: number | null;
  score_land: number | null;
  score_tax: number | null;
  score_climate: number | null;
  // Computed client-side
  custom_score?: number;
}

interface ExistingDC {
  id: string;
  name: string;
  operator: string | null;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  capacity_mw: number | null;
  sqft: number | null;
  dc_type: string | null;
  year_built: number | null;
}

interface IXP {
  id: string;
  name: string;
  org_name: string | null;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  ix_count: number | null;
  network_count: number | null;
}

interface MapData {
  sites: MapSite[];
  total: number;
  datacenters?: ExistingDC[];
  ixps?: IXP[];
}

// Default weights matching server-side score-dc-sites.py
const DEFAULT_WEIGHTS: Record<string, number> = {
  power: 30,
  speed_to_power: 20,
  fiber: 18,
  water: 3,
  hazard: 7,
  labor: 5,
  existing_dc: 7,
  land: 5,
  tax: 3,
  climate: 2,
};

const WEIGHT_LABELS: Record<string, string> = {
  power: "Power Availability",
  speed_to_power: "Speed to Power",
  fiber: "Fiber Connectivity",
  water: "Water Access",
  hazard: "Low Hazard Risk",
  labor: "Labor Pool",
  existing_dc: "DC Ecosystem",
  land: "Land Suitability",
  tax: "Tax Incentives",
  climate: "Climate/Cooling",
};

function computeCustomScore(site: MapSite, weights: Record<string, number>): number {
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return 0;

  const subScores: Record<string, number | null> = {
    power: site.score_power,
    speed_to_power: site.score_speed_to_power,
    fiber: site.score_fiber,
    water: site.score_water,
    hazard: site.score_hazard,
    labor: site.score_labor,
    existing_dc: site.score_existing_dc,
    land: site.score_land,
    tax: site.score_tax,
    climate: site.score_climate,
  };

  let weighted = 0;
  for (const [key, w] of Object.entries(weights)) {
    const sub = subScores[key] ?? 50;
    weighted += (w / totalWeight) * sub;
  }
  return Math.round(weighted * 10) / 10;
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

function siteTypeLabel(type: string, formerUse?: string | null): string {
  switch (type) {
    case "substation": return "Substation Site";
    case "brownfield": {
      if (formerUse) {
        const use = formerUse.toLowerCase();
        if (use.includes("coal")) return "Retired Coal Plant";
        if (use.includes("gas") || use.includes("natural")) return "Retired Gas Plant";
        if (use.includes("nuclear")) return "Retired Nuclear Plant";
        if (use.includes("oil") || use.includes("petrol")) return "Retired Oil Plant";
        return `Retired ${formerUse.charAt(0).toUpperCase() + formerUse.slice(1)} Plant`;
      }
      return "Retired Power Plant";
    }
    case "greenfield": return "Greenfield Corridor";
    default: return type;
  }
}

function kmToMiles(km: number | null): string {
  if (km === null || km === undefined) return "N/A";
  return (km * 0.621371).toFixed(1) + " mi";
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
  const markersRef = useRef<any>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterState, setFilterState] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterMinScore, setFilterMinScore] = useState<string>("");
  const [filterMaxScore, setFilterMaxScore] = useState<string>("");
  const [showDCs, setShowDCs] = useState(true);
  const [showIXPs, setShowIXPs] = useState(true);
  const [showSites, setShowSites] = useState(true);
  const [colorBy, setColorBy] = useState<"score" | "type">("score");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [scoringOpen, setScoringOpen] = useState(false);

  // Custom scoring weights (0-100 each, normalized at compute time)
  const [weights, setWeights] = useState<Record<string, number>>({ ...DEFAULT_WEIGHTS });
  const [useCustomScoring, setUseCustomScoring] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchData = useCallback(async () => {
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
      params.set("lite", "1");

      const res = await fetch(`${baseUrl}/api/grid/map-data?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterState, filterType, filterMinScore, filterMaxScore]);

  useEffect(() => {
    if (mounted) fetchData();
  }, [mounted, fetchData]);

  // Compute custom scores when weights change
  const scoredSites = useMemo(() => {
    if (!data?.sites) return [];
    if (!useCustomScoring) return data.sites;
    return data.sites.map(s => ({
      ...s,
      custom_score: computeCustomScore(s, weights),
    }));
  }, [data, weights, useCustomScoring]);

  // Score distribution for sidebar
  const scoreDistribution = useMemo(() => {
    const sites = scoredSites;
    const getScore = (s: MapSite) => useCustomScoring ? (s.custom_score ?? 0) : (s.dc_score ?? 0);
    return {
      excellent: sites.filter(s => getScore(s) >= 70).length,
      good: sites.filter(s => getScore(s) >= 50 && getScore(s) < 70).length,
      fair: sites.filter(s => getScore(s) >= 30 && getScore(s) < 50).length,
      poor: sites.filter(s => getScore(s) < 30).length,
    };
  }, [scoredSites, useCustomScoring]);

  // Render map markers
  useEffect(() => {
    if (!mounted || !mapRef.current || !data) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any;
    let cleanup = false;

    (async () => {
      const L = await import("leaflet");
      // Ensure L is available globally for leaflet.markercluster plugin
      if (typeof window !== "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).L = L;
      }
      await import("leaflet.markercluster");

      if (cleanup || !mapRef.current) return;

      if (leafletMap.current) {
        leafletMap.current.remove();
      }

      map = L.map(mapRef.current, {
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clusterGroup = (L as any).markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: function(cluster: { getChildCount: () => number }) {
          const count = cluster.getChildCount();
          let size = "small";
          let dim = 30;
          if (count > 100) { size = "large"; dim = 50; }
          else if (count > 10) { size = "medium"; dim = 40; }

          return L.divIcon({
            html: `<div style="
              width:${dim}px;height:${dim}px;border-radius:50%;
              background:rgba(124,58,237,0.8);border:2px solid rgba(255,255,255,0.6);
              display:flex;align-items:center;justify-content:center;
              color:white;font-weight:700;font-size:${size === 'large' ? '14' : size === 'medium' ? '12' : '11'}px;
              font-family:system-ui;
            ">${count >= 1000 ? Math.round(count/1000) + 'K' : count}</div>`,
            className: "",
            iconSize: [dim, dim],
          });
        },
      });

      // DC site markers
      if (showSites) {
        for (const site of scoredSites) {
          if (!site.latitude || !site.longitude) continue;

          const score = useCustomScoring ? (site.custom_score ?? 0) : (site.dc_score ?? 0);
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

          const scoreLabel = score.toFixed(1);
          const typeDesc = siteTypeLabel(site.site_type, site.former_use);

          marker.bindPopup(`
            <div style="min-width:220px;font-family:system-ui;font-size:13px">
              <strong style="font-size:14px">${site.name || "Unnamed Site"}</strong><br/>
              <span style="color:${siteTypeColor(site.site_type)};font-weight:600">${typeDesc}</span>
              · ${site.state}<br/>
              <div style="margin:6px 0;padding:6px 0;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb">
                <span style="font-size:20px;font-weight:700;color:${scoreColor(score)}">${scoreLabel}</span>
                <span style="color:#666;font-size:11px">/100 DC Score</span>
              </div>
              <a href="/grid/site/?id=${site.id}" style="color:#7c3aed;text-decoration:underline;font-weight:600">View Details →</a>
            </div>
          `);

          clusterGroup.addLayer(marker);
        }
      }

      // Existing datacenter markers (blue, larger)
      if (showDCs && data.datacenters) {
        for (const dc of data.datacenters) {
          if (!dc.latitude || !dc.longitude) continue;

          const marker = L.circleMarker([dc.latitude, dc.longitude], {
            radius: 8,
            fillColor: "#3b82f6",
            color: "#1d4ed8",
            weight: 2,
            fillOpacity: 0.9,
          });

          const capacityStr = dc.capacity_mw ? `${Number(dc.capacity_mw).toFixed(0)} MW` : "";
          const sqftStr = dc.sqft ? `${Number(dc.sqft).toLocaleString()} sqft` : "";

          marker.bindPopup(`
            <div style="min-width:200px;font-family:system-ui;font-size:13px">
              <strong style="font-size:14px">${dc.name || "Datacenter"}</strong><br/>
              <span style="color:#3b82f6;font-weight:600">Existing Datacenter</span><br/>
              ${dc.operator ? `<b>Operator:</b> ${dc.operator}<br/>` : ""}
              ${dc.city ? `${dc.city}, ` : ""}${dc.state || ""}<br/>
              ${capacityStr ? `<b>Capacity:</b> ${capacityStr}<br/>` : ""}
              ${sqftStr ? `<b>Size:</b> ${sqftStr}<br/>` : ""}
              ${dc.dc_type ? `<b>Type:</b> ${dc.dc_type}<br/>` : ""}
              ${dc.year_built ? `<b>Built:</b> ${dc.year_built}<br/>` : ""}
            </div>
          `);

          clusterGroup.addLayer(marker);
        }
      }

      // IXP markers (cyan — labeled as DC interconnection facilities)
      if (showIXPs && data.ixps) {
        for (const ixp of data.ixps) {
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

          clusterGroup.addLayer(marker);
        }
      }

      markersRef.current = clusterGroup;
      map.addLayer(clusterGroup);

      // Legend
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legend = new (L.Control as any)({ position: "bottomright" });
      legend.onAdd = () => {
        const div = L.DomUtil.create("div", "");
        div.style.cssText = "background:rgba(0,0,0,0.85);padding:10px 14px;border-radius:8px;font-size:11px;color:#fff;font-family:system-ui;line-height:1.6";

        if (colorBy === "score") {
          div.innerHTML = `
            <div style="font-weight:700;margin-bottom:4px">${useCustomScoring ? 'Custom' : 'DC Readiness'} Score</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#22c55e"></div> 70-100 Excellent</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#eab308"></div> 50-70 Good</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#f97316"></div> 30-50 Fair</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#ef4444"></div> 0-30 Poor</div>
            <div style="border-top:1px solid #444;margin:6px 0;padding-top:6px">
              <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #1d4ed8"></div> Existing DC</div>
              <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#06b6d4;border:2px solid #0891b2"></div> IXP / Interconnect</div>
            </div>
          `;
        } else {
          div.innerHTML = `
            <div style="font-weight:700;margin-bottom:4px">Site Type</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#7c3aed"></div> Substation Site</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#d97706"></div> Retired Power Plant</div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#059669"></div> Greenfield Corridor</div>
            <div style="border-top:1px solid #444;margin:6px 0;padding-top:6px">
              <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #1d4ed8"></div> Existing DC</div>
              <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:#06b6d4;border:2px solid #0891b2"></div> IXP / Interconnect</div>
            </div>
          `;
        }
        return div;
      };
      legend.addTo(map);
    })();

    return () => {
      cleanup = true;
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, scoredSites, showSites, showDCs, showIXPs, colorBy, useCustomScoring]);

  const totalDCs = data?.datacenters?.length || 0;
  const totalIXPs = data?.ixps?.length || 0;
  const totalSites = scoredSites.length;

  const updateWeight = (key: string, val: number) => {
    setWeights(prev => ({ ...prev, [key]: val }));
  };

  const resetWeights = () => {
    setWeights({ ...DEFAULT_WEIGHTS });
  };

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
                {loading ? "Loading..." : `${totalSites.toLocaleString()} prospects · ${totalDCs} existing DCs · ${totalIXPs} IXPs`}
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
                    Prospect Sites ({totalSites.toLocaleString()})
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

              {/* Custom Scoring */}
              <div className="border-t border-gray-200 pt-4">
                <button
                  onClick={() => setScoringOpen(!scoringOpen)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer">
                    Custom Scoring
                  </label>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${scoringOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {scoringOpen && (
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={useCustomScoring}
                        onChange={e => setUseCustomScoring(e.target.checked)}
                        className="accent-purple-600"
                      />
                      <span className="font-medium">Enable custom weights</span>
                    </label>

                    {useCustomScoring && (
                      <>
                        <p className="text-xs text-gray-500">
                          Adjust weights to prioritize what matters most. Scores recompute instantly.
                        </p>

                        <div className="space-y-2">
                          {Object.entries(WEIGHT_LABELS).map(([key, label]) => (
                            <div key={key}>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs text-gray-700">{label}</span>
                                <span className="text-xs font-mono text-gray-500 w-8 text-right">{weights[key]}</span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={50}
                                value={weights[key]}
                                onChange={e => updateWeight(key, parseInt(e.target.value))}
                                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                              />
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={resetWeights}
                          className="text-xs text-purple-600 hover:text-purple-800 font-medium"
                        >
                          Reset to defaults
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Score Distribution */}
              {data && !loading && (
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
                            width: `${Math.max(1, (band.count / totalSites) * 100)}%`,
                          }}></div>
                        </div>
                        <span className="text-gray-500 w-12 text-right">{band.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Site Type Breakdown */}
              {data && !loading && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">By Type</label>
                  <div className="mt-2 space-y-1">
                    {[
                      { type: "substation", label: "Substation Sites", color: "#7c3aed" },
                      { type: "greenfield", label: "Greenfield Corridors", color: "#059669" },
                      { type: "brownfield", label: "Retired Power Plants", color: "#d97706" },
                    ].map(t => {
                      const count = scoredSites.filter(s => s.site_type === t.type).length;
                      return (
                        <div key={t.type} className="flex items-center gap-2 text-xs">
                          <div className="w-3 h-3 rounded-full" style={{ background: t.color }}></div>
                          <span className="flex-1 text-gray-700">{t.label}</span>
                          <span className="text-gray-500">{count.toLocaleString()}</span>
                        </div>
                      );
                    })}
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

            {loading && (
              <div className="absolute inset-0 bg-gray-900/50 z-[1000] flex items-center justify-center">
                <div className="bg-white rounded-xl px-6 py-4 shadow-xl">
                  <div className="text-gray-700 font-medium">Loading {filterState ? `${filterState} ` : ""}sites...</div>
                  <div className="text-gray-500 text-sm mt-1">~40K sites across all 50 states</div>
                </div>
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
