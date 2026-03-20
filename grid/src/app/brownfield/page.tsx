"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { withDemoToken } from "@/lib/demoAccess";

const TransmissionMap = dynamic(() => import("../../components/TransmissionMap"), { ssr: false });

interface NearbyFacility {
  id: string;
  name: string;
  facility_type: "ixp" | "datacenter";
  org_name?: string;
  operator?: string;
  city?: string;
  state?: string;
  latitude: number;
  longitude: number;
  website?: string;
  sales_email?: string;
  sales_phone?: string;
  tech_email?: string;
  tech_phone?: string;
  ix_count?: number;
  network_count?: number;
  capacity_mw?: number;
  sqft?: number;
  dc_type?: string;
}

interface BrownfieldDetail {
  brownfield: Record<string, unknown>;
  dcSite: Record<string, unknown> | null;
  county: Record<string, unknown> | null;
  nearbyLines: Record<string, unknown>[];
  nearbyFacilities?: NearbyFacility[];
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreBar(label: string, value: number, weight: string) {
  const color =
    value >= 70 ? "bg-green-500" :
    value >= 50 ? "bg-yellow-500" :
    value >= 30 ? "bg-orange-500" : "bg-red-500";

  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs text-gray-600 w-32 truncate" title={label}>{label}</span>
      <span className="text-xs text-gray-400 w-8">{weight}</span>
      <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-8 text-right">{value}</span>
    </div>
  );
}

function infoRow(label: string, value: unknown) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{String(value)}</span>
    </div>
  );
}

export default function BrownfieldDetailPage() {
  return (
    <Suspense fallback={<div className="animate-pulse"><div className="h-8 bg-gray-200 rounded w-64 mb-4" /><div className="h-48 bg-gray-200 rounded" /></div>}>
      <BrownfieldDetailContent />
    </Suspense>
  );
}

function BrownfieldDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [data, setData] = useState<BrownfieldDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const baseUrl = window.location.origin;
    fetch(withDemoToken(`${baseUrl}/api/grid/brownfield?id=${id}`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  if (!id) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Brownfield Detail</h1>
        <p className="text-gray-600">No brownfield ID provided. <a href="/grid/brownfields/" className="text-purple-600 hover:underline">Browse brownfields</a></p>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Loading brownfield...</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Brownfield Not Found</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error || "Brownfield not found"}
        </div>
      </div>
    );
  }

  const bf = data.brownfield as Record<string, string | number | null>;
  const dc = data.dcSite as Record<string, string | number | null> | null;
  const county = data.county as Record<string, string | number | boolean | null> | null;

  const dcScore = dc ? Number(dc.dc_score) || 0 : null;
  const scoreColorClass = dcScore !== null
    ? dcScore >= 70 ? "text-green-600" :
      dcScore >= 50 ? "text-yellow-600" :
      dcScore >= 30 ? "text-orange-600" : "text-red-600"
    : "";

  const cleanupLabel: Record<string, string> = {
    cleanup_complete: "Cleanup Complete",
    in_progress: "In Progress",
    not_started: "Not Started",
  };

  const cleanupColor: Record<string, string> = {
    cleanup_complete: "bg-green-100 text-green-700",
    in_progress: "bg-yellow-100 text-yellow-700",
    not_started: "bg-red-100 text-red-700",
  };

  const typeLabel: Record<string, string> = {
    retired_plant: "Retired Power Plant",
    epa_brownfield: "EPA Brownfield",
  };

  // Build Edge Compute Thesis bullets
  const thesisBullets: string[] = [];
  if (bf.existing_capacity_mw && Number(bf.existing_capacity_mw) > 0) {
    thesisBullets.push(`Existing ${bf.existing_capacity_mw} MW grid connection — may retain transmission rights and substation infrastructure, dramatically reducing time-to-energization.`);
  }
  if (bf.grid_connection_voltage_kv && Number(bf.grid_connection_voltage_kv) >= 69) {
    thesisBullets.push(`${bf.grid_connection_voltage_kv} kV grid connection voltage is sufficient for hyperscale datacenter loads.`);
  }
  if (bf.acreage && Number(bf.acreage) >= 50) {
    thesisBullets.push(`${bf.acreage} acres is sufficient for a campus-scale datacenter deployment (typical DC requires 20-50 acres).`);
  } else if (bf.acreage && Number(bf.acreage) >= 10) {
    thesisBullets.push(`${bf.acreage} acres is suitable for a single-building edge or colocation facility.`);
  }
  if (bf.cleanup_status === "cleanup_complete") {
    thesisBullets.push("Environmental cleanup is complete — no remediation delays or regulatory risk.");
  } else if (bf.cleanup_status === "in_progress") {
    thesisBullets.push("Environmental remediation is in progress — monitor for completion timeline before site acquisition.");
  }
  if (bf.former_use) {
    const use = String(bf.former_use).toLowerCase();
    if (use.includes("coal") || use.includes("gas") || use.includes("nuclear")) {
      thesisBullets.push(`Former ${bf.former_use} plant likely has heavy-duty infrastructure: roads, water systems, and cleared/graded land already in place.`);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{String(bf.name)}</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
              {typeLabel[String(bf.site_type)] || String(bf.site_type)}
            </span>
            {bf.cleanup_status && (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${
                cleanupColor[String(bf.cleanup_status)] || "bg-gray-100 text-gray-700"
              }`}>
                {cleanupLabel[String(bf.cleanup_status)] || String(bf.cleanup_status)}
              </span>
            )}
          </div>
          <p className="text-gray-600">
            {bf.city && `${bf.city}, `}{bf.county && `${bf.county}, `}{bf.state}
          </p>
        </div>
        {dcScore !== null && (
          <div className="text-right">
            <div className="text-xs text-gray-500 uppercase tracking-wide">DC Score</div>
            <div className={`text-4xl font-bold ${scoreColorClass}`}>{dcScore}</div>
          </div>
        )}
      </div>

      {/* Map */}
      {bf.latitude && bf.longitude && (
        <div className="mb-6 rounded-lg overflow-hidden border border-gray-200">
          <TransmissionMap
            lines={data.nearbyLines.filter((l) => l.geometry_wkt) as Array<{ id: string; hifld_id: number; geometry_wkt: string | null; voltage_kv: number | null; capacity_mw: number | null; upgrade_candidate: boolean; owner: string | null; state: string | null; sub_1: string | null; sub_2: string | null; naession: string | null }>}
            center={[Number(bf.latitude), Number(bf.longitude)]}
            zoom={11}
            height="350px"
            siteMarker={{
              lat: Number(bf.latitude),
              lng: Number(bf.longitude),
              label: String(bf.name),
              type: "brownfield",
            }}
            onLineClick={(id) => { window.location.href = `/grid/line/?id=${id}`; }}
          />
        </div>
      )}

      {/* Key metrics cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Former Capacity</div>
          <div className="text-2xl font-bold text-gray-900">
            {bf.existing_capacity_mw ? `${bf.existing_capacity_mw} MW` : "—"}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Acreage</div>
          <div className="text-2xl font-bold text-gray-900">
            {bf.acreage ? Number(bf.acreage).toLocaleString() : "—"}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Grid Voltage</div>
          <div className="text-2xl font-bold text-gray-900">
            {bf.grid_connection_voltage_kv ? `${bf.grid_connection_voltage_kv} kV` : dc?.substation_voltage_kv ? `${dc.substation_voltage_kv} kV` : "—"}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Substation</div>
          <div className="text-2xl font-bold text-gray-900">
            {bf.nearest_substation_distance_km != null ? `${(Number(bf.nearest_substation_distance_km) * 0.621371).toFixed(1)} mi` : "—"}
          </div>
        </div>
      </div>

      {/* Edge Compute Thesis */}
      {thesisBullets.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-amber-800 mb-3">Edge Compute Thesis</h2>
          <ul className="space-y-2">
            {thesisBullets.map((bullet, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                <span className="text-amber-500 mt-0.5">&#9656;</span>
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* DC Readiness Score breakdown */}
        {dc && dcScore !== null && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              DC Readiness Score
              <a href={`/grid/site/?id=${dc.id}`} className="text-sm font-normal text-purple-600 hover:underline ml-2">
                View full site detail
              </a>
            </h2>
            <div className="space-y-1">
              {scoreBar("Power Availability", Number(dc.score_power) || 0, "25%")}
              {scoreBar("Speed to Power", Number(dc.score_speed_to_power) || 0, "20%")}
              {scoreBar("Fiber Connectivity", Number(dc.score_fiber) || 0, "15%")}
              {scoreBar("Water Risk", Number(dc.score_water) || 0, "10%")}
              {scoreBar("Natural Hazard", Number(dc.score_hazard) || 0, "10%")}
              {scoreBar("Labor Market", Number(dc.score_labor) || 0, "5%")}
              {scoreBar("Existing DC Cluster", Number(dc.score_existing_dc) || 0, "5%")}
              {scoreBar("Land / Acreage", Number(dc.score_land) || 0, "5%")}
              {scoreBar("Tax Incentive", Number(dc.score_tax) || 0, "3%")}
              {scoreBar("Climate / Cooling", Number(dc.score_climate) || 0, "2%")}
            </div>
          </div>
        )}

        {/* Power section */}
        {dc && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Power</h2>
            {dc.nearest_substation_name && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Nearest Substation</span>
                <a href={`/grid/search/?q=${encodeURIComponent(String(dc.nearest_substation_name))}`}
                  className="text-sm font-medium text-purple-600 hover:underline">
                  {String(dc.nearest_substation_name)}
                </a>
              </div>
            )}
            {infoRow("Distance", dc.nearest_substation_distance_km != null ? `${(Number(dc.nearest_substation_distance_km) * 0.621371).toFixed(1)} mi` : null)}
            {infoRow("Voltage", dc.substation_voltage_kv ? `${dc.substation_voltage_kv} kV` : bf.grid_connection_voltage_kv ? `${bf.grid_connection_voltage_kv} kV` : null)}
            {infoRow("Former Capacity", bf.existing_capacity_mw ? `${bf.existing_capacity_mw} MW` : null)}
            {infoRow("Available Capacity", dc.available_capacity_mw ? `${dc.available_capacity_mw} MW` : null)}
            {infoRow("Queue Depth", dc.queue_depth)}
            {infoRow("Avg Queue Wait", dc.avg_queue_wait_years ? `${dc.avg_queue_wait_years} years` : null)}
          </div>
        )}

        {/* Connectivity section */}
        {dc && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Connectivity</h2>
            {dc.nearest_ixp_name && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Nearest IXP</span>
                <a href={`https://www.peeringdb.com/search?q=${encodeURIComponent(String(dc.nearest_ixp_name))}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium text-purple-600 hover:underline">
                  {String(dc.nearest_ixp_name)} &#8599;
                </a>
              </div>
            )}
            {infoRow("IXP Distance", dc.nearest_ixp_distance_km != null ? `${(Number(dc.nearest_ixp_distance_km) * 0.621371).toFixed(1)} mi` : null)}
            {dc.nearest_dc_name && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Nearest Datacenter</span>
                <a href={`https://www.google.com/maps/search/${encodeURIComponent(String(dc.nearest_dc_name) + ' datacenter')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium text-purple-600 hover:underline">
                  {String(dc.nearest_dc_name)} &#8599;
                </a>
              </div>
            )}
            {infoRow("DC Distance", dc.nearest_dc_distance_km != null ? `${(Number(dc.nearest_dc_distance_km) * 0.621371).toFixed(1)} mi` : null)}
            {dc.fcc_fiber_pct != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Fiber Coverage</span>
                <span className="text-sm font-medium text-gray-900">
                  {Number(dc.fcc_fiber_pct).toFixed(1)}%
                  {bf.latitude && bf.longitude && (
                    <a href={`https://broadbandmap.fcc.gov/location-summary/fixed?speed=1000&latlon=${bf.latitude},${bf.longitude}&zoom=14`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-purple-600 hover:underline ml-1 text-xs">(FCC BDC &#8599;)</a>
                  )}
                </span>
              </div>
            )}
            {dc.nearest_fiber_km != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
                <span className="text-xs text-gray-500">Nearest Fiber Route</span>
                <span className="text-sm font-medium text-gray-900">{(Number(dc.nearest_fiber_km) * 0.621371).toFixed(1)} mi</span>
              </div>
            )}
          </div>
        )}

        {/* Site Characteristics section */}
        {dc && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Site Characteristics</h2>
            {dc.energy_price_mwh != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Energy Price</span>
                <span className="text-sm font-medium text-gray-900">
                  ${Number(dc.energy_price_mwh).toFixed(2)}/MWh
                  {dc.energy_price_source && (
                    <a href={`https://www.eia.gov/electricity/state/${String(bf.state || "").toLowerCase()}/`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-purple-600 hover:underline ml-1 text-xs">({String(dc.energy_price_source)} &#8599;)</a>
                  )}
                </span>
              </div>
            )}
            {dc.construction_cost_index != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Construction Cost Index</span>
                <span className="text-sm font-medium text-gray-900">
                  {Number(dc.construction_cost_index).toFixed(1)} <span className="text-xs text-gray-400">(avg = 100, RSMeans)</span>
                </span>
              </div>
            )}
            {infoRow("Gas Pipeline Distance", dc.nearest_gas_pipeline_km != null ? `${(Number(dc.nearest_gas_pipeline_km) * 0.621371).toFixed(1)} mi` : null)}
            {infoRow("Land Cover", dc.nlcd_class)}
            {dc.nlcd_code && infoRow("NLCD Code", dc.nlcd_code)}
            {infoRow("Buildability Score", dc.buildability_score != null ? `${Number(dc.buildability_score).toFixed(1)} / 100` : null)}
          </div>
        )}

        {/* County Risk Profile */}
        {county && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">County Risk Profile</h2>
            {infoRow("County", county.county_name)}
            {county.nri_score != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">NRI Score / Rating</span>
                <span className="text-sm font-medium text-gray-900">
                  {String(county.nri_score)}{county.nri_rating ? ` (${county.nri_rating})` : ""}
                  <a href={`https://hazards.fema.gov/nri/map#checks=true&layers=false&stateZoom=${String(bf.state || "").toLowerCase()}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-purple-600 hover:underline ml-1 text-xs">(FEMA NRI &#8599;)</a>
                </span>
              </div>
            )}
            {county.water_stress_label && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Water Stress</span>
                <span className="text-sm font-medium text-gray-900">
                  {String(county.water_stress_label)}
                  {bf.latitude && bf.longitude && (
                    <a href={`https://www.wri.org/applications/aqueduct/water-risk-atlas/#/?basemap=hydro&indicator=w_awr_def_tot_cat&lat=${bf.latitude}&lng=${bf.longitude}&zoom=10`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-purple-600 hover:underline ml-1 text-xs">(WRI Aqueduct &#8599;)</a>
                  )}
                </span>
              </div>
            )}
            {county.cooling_degree_days != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Cooling Degree Days</span>
                <span className="text-sm font-medium text-gray-900">
                  {String(county.cooling_degree_days)}
                  <span className="text-xs text-gray-400 ml-1">(NOAA)</span>
                </span>
              </div>
            )}
            <div className="flex justify-between py-1.5 border-b border-gray-100">
              <span className="text-xs text-gray-500">Fiber Infrastructure</span>
              <span className="text-sm font-medium text-gray-900">
                {county.has_fiber ? (
                  <span className="text-green-600">
                    {county.fiber_provider_count ? `${county.fiber_provider_count} providers` : "Available"}
                  </span>
                ) : (
                  <span className="text-red-500">No fiber</span>
                )}
              </span>
            </div>
            {county.avg_land_value_per_acre_usd && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Land Value</span>
                <span className="text-sm font-medium text-gray-900">
                  ${Number(county.avg_land_value_per_acre_usd).toLocaleString()}/acre
                  <span className="text-xs text-gray-400 ml-1">(USDA)</span>
                </span>
              </div>
            )}
            <div className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
              <span className="text-xs text-gray-500">DC Tax Incentive</span>
              <span className="text-sm font-medium text-gray-900">
                {county.has_dc_tax_incentive ? (
                  <>
                    <span className="text-green-600">Yes</span>
                    {county.dc_incentive_type && <span className="text-gray-500 text-xs ml-1">({String(county.dc_incentive_type)})</span>}
                  </>
                ) : "No"}
              </span>
            </div>
          </div>
        )}

        {/* Brownfield Details */}
        <div className="bg-white rounded-lg border border-amber-200 bg-amber-50/30 p-6">
          <h2 className="text-lg font-semibold text-amber-800 mb-3">Brownfield Details</h2>
          {infoRow("Site Type", typeLabel[String(bf.site_type)] || bf.site_type)}
          {infoRow("Former Use", bf.former_use)}
          {infoRow("Existing Capacity", bf.existing_capacity_mw ? `${bf.existing_capacity_mw} MW` : null)}
          {infoRow("Retirement Date", bf.retirement_date)}
          {infoRow("Cleanup Status", cleanupLabel[String(bf.cleanup_status)] || bf.cleanup_status)}
          {infoRow("Contaminant Type", bf.contaminant_type)}
          {infoRow("Acreage", bf.acreage)}
          {infoRow("Grid Voltage", bf.grid_connection_voltage_kv ? `${bf.grid_connection_voltage_kv} kV` : null)}
          {infoRow("EIA Plant ID", bf.eia_plant_id)}
          {infoRow("EPA ID", bf.epa_id)}
          {String(bf.operator_name || "") && (
            <div className="mt-3 pt-3 border-t border-amber-200">
              <h3 className="text-sm font-medium text-amber-700 mb-2">Operator Contact</h3>
              {infoRow("Operator", bf.operator_name)}
              {infoRow("Address", bf.operator_address)}
            </div>
          )}
        </div>

        {/* External Resources */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">External Resources</h2>
          <div className="space-y-4">
            {/* Location & Imagery */}
            {bf.latitude && bf.longitude && (
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Location &amp; Imagery</div>
                <div className="space-y-1.5">
                  <a href={`https://www.google.com/maps/@${bf.latitude},${bf.longitude},500m/data=!3m1!1e3`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> Google Maps Satellite View
                  </a>
                  <a href={`https://earth.google.com/web/@${bf.latitude},${bf.longitude},0a,1000d,35y,0h,0t,0r`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> Google Earth 3D View
                  </a>
                  {bf.county && bf.state && (
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(`${bf.county} County ${bf.state} GIS parcel map`)}`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> {String(bf.county)} County GIS / Parcel Map
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Grid & Power */}
            <div>
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Grid &amp; Power</div>
              <div className="space-y-1.5">
                {bf.eia_plant_id && (
                  <a href={`https://www.eia.gov/electricity/data/browser/#/plant/${bf.eia_plant_id}`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> EIA Plant Profile
                  </a>
                )}
                {dc && dc.iso_region && (
                  <a href={
                    dc.iso_region === "ERCOT" ? "https://www.ercot.com/gridinfo/resource" :
                    dc.iso_region === "CAISO" ? "https://www.caiso.com/planning/Pages/GeneratorInterconnection/Default.aspx" :
                    dc.iso_region === "PJM" ? "https://www.pjm.com/planning/services-requests/interconnection-queues" :
                    dc.iso_region === "MISO" ? "https://www.misoenergy.org/planning/generator-interconnection/GI_Queue/" :
                    dc.iso_region === "SPP" ? "https://opsportal.spp.org/Studies/GIActive" :
                    dc.iso_region === "NYISO" ? "https://www.nyiso.com/interconnections" :
                    dc.iso_region === "ISO-NE" ? "https://www.iso-ne.com/system-planning/interconnection-service/interconnection-request-queue/" :
                    "#"
                  } target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> {String(dc.iso_region)} Interconnection Queue
                  </a>
                )}
                {bf.state && (
                  <a href={`/grid/lines/?state=${bf.state}`}
                    className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> All Transmission Lines in {String(bf.state)}
                  </a>
                )}
                {bf.state && (
                  <a href={`https://www.eia.gov/electricity/state/${String(bf.state).toLowerCase()}/`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> EIA State Electricity Profile — {String(bf.state)}
                  </a>
                )}
                <a href="https://hifld-geoplatform.opendata.arcgis.com/datasets/electric-substations"
                  target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                  <span>&#8599;</span> HIFLD Substation Database
                </a>
              </div>
            </div>

            {/* Risk & Environment */}
            {bf.latitude && bf.longitude && (
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Risk &amp; Environment</div>
                <div className="space-y-1.5">
                  <a href={`https://msc.fema.gov/portal/search?AddressQuery=${bf.latitude}%2C${bf.longitude}#searchresultsanchor`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> FEMA Flood Map{dc && dc.flood_zone ? ` (Zone ${dc.flood_zone})` : ""}
                  </a>
                  {bf.epa_id && (
                    <a href={`https://enviro.epa.gov/enviro/fii_query_dtl.disp_program_facility?p_registry_id=${bf.epa_id}`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> EPA Facility Report
                    </a>
                  )}
                  <a href={`https://ejscreen.epa.gov/mapper/mobile/?latitude=${bf.latitude}&longitude=${bf.longitude}&zoomLevel=14`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> EPA EJScreen Environmental Justice
                  </a>
                  <a href={`https://hazards.fema.gov/nri/map#checks=true&layers=false&stateZoom=${String(bf.state || "").toLowerCase()}`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> FEMA National Risk Index — {String(bf.state)}
                  </a>
                </div>
              </div>
            )}

            {/* Connectivity */}
            {dc && (dc.nearest_ixp_name || dc.fcc_fiber_providers) && (
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Connectivity</div>
                <div className="space-y-1.5">
                  {dc.nearest_ixp_name && (
                    <a href={`https://www.peeringdb.com/search?q=${encodeURIComponent(String(dc.nearest_ixp_name))}`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> PeeringDB: {String(dc.nearest_ixp_name)}
                    </a>
                  )}
                  {bf.latitude && bf.longitude && (
                    <a href={`https://broadbandmap.fcc.gov/location-summary/fixed?speed=1000&latlon=${bf.latitude},${bf.longitude}&zoom=14`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> FCC Broadband Map{dc.fcc_fiber_providers ? ` (${dc.fcc_fiber_providers} fiber providers)` : ""}
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Incentives & Policy */}
            {bf.state && (
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Incentives &amp; Policy</div>
                <div className="space-y-1.5">
                  <a href={`https://programs.dsireusa.org/system/program?state=${String(bf.state)}&technology=105&sector=3`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> DSIRE Incentives — {String(bf.state)}
                  </a>
                  <a href={`https://www.google.com/search?q=${encodeURIComponent(`${bf.state} datacenter tax incentive abatement`)}`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> {String(bf.state)} DC Tax Incentive Programs
                  </a>
                  {bf.county && (
                    <a href={`https://selectusa.gov/programs-incentives?state=${encodeURIComponent(String(bf.state))}`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> SelectUSA — {String(bf.state)} Programs &amp; Incentives
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Land Acquisition */}
      <div className="bg-white rounded-lg border border-purple-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Land Acquisition</h2>
        <p className="text-xs text-gray-500 mb-4">Property ownership and land availability information for this brownfield site.</p>
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Brownfield Redevelopment</span>
          </div>
          <p className="text-sm text-gray-700 mb-3">
            This is a retired power plant site with existing grid infrastructure. Brownfield redevelopment typically involves
            working with the property owner (often the former utility) and the state environmental agency for any required cleanup.
          </p>
          {bf.operator_name ? (
            <div className="mb-3">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Property Owner / Former Operator</div>
              <div className="text-sm font-medium text-gray-900">{String(bf.operator_name)}</div>
              {bf.operator_address ? (
                <div className="text-xs text-gray-600">{String(bf.operator_address)}</div>
              ) : null}
            </div>
          ) : null}
          {dc && dc.parcel_owner && (
            <div className="mb-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Tax Parcel Owner (County Records)</div>
              <div className="text-sm font-semibold text-gray-900">{String(dc.parcel_owner)}</div>
              {dc.parcel_apn && <div className="text-xs text-gray-500 mt-0.5">Parcel #: {String(dc.parcel_apn)}</div>}
              {dc.parcel_address && <div className="text-xs text-gray-600 mt-0.5">{String(dc.parcel_address)}</div>}
            </div>
          )}
          <div className="space-y-2">
            <a href="https://www.epa.gov/brownfields/state-brownfields-and-voluntary-response-programs" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
              <span>&#8599;</span> EPA State Brownfield Programs Directory
            </a>
            {bf.state && (
              <a href={`https://www.google.com/search?q=${encodeURIComponent(`${bf.state} brownfield voluntary cleanup program`)}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                <span>&#8599;</span> {String(bf.state)} Brownfield Program
              </a>
            )}
            {bf.county && bf.state && (
              <a href={`https://www.loopnet.com/search/land/${encodeURIComponent(String(bf.county).toLowerCase().replace(/\s+/g, '-'))}-county-${encodeURIComponent(String(bf.state).toLowerCase().replace(/\s+/g, '-'))}/for-sale/`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                <span>&#8599;</span> LoopNet — {String(bf.county)} County Land for Sale
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Nearby Facilities */}
      {data.nearbyFacilities && data.nearbyFacilities.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Nearby Facilities</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Facility</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Distance</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Contact</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Website</th>
                </tr>
              </thead>
              <tbody>
                {(data.nearbyFacilities as NearbyFacility[])
                  .map((f) => ({ ...f, _dist: haversine(Number(bf.latitude), Number(bf.longitude), f.latitude, f.longitude) }))
                  .sort((a, b) => a._dist - b._dist)
                  .map((f) => (
                  <tr key={f.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3">
                      <div className="font-medium text-gray-900 text-xs">
                        {f.facility_type === "ixp" ? (
                          <a href={`https://www.peeringdb.com/search?q=${encodeURIComponent(f.name)}`}
                            target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">
                            {f.name} &#8599;
                          </a>
                        ) : f.website ? (
                          <a href={f.website} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">
                            {f.name} &#8599;
                          </a>
                        ) : (
                          f.name
                        )}
                      </div>
                      {f.operator && f.operator !== f.name && (
                        <div className="text-xs text-gray-500">{f.operator}</div>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        f.facility_type === "ixp" ? "bg-cyan-100 text-cyan-700" : "bg-blue-100 text-blue-700"
                      }`}>
                        {f.facility_type === "ixp" ? "IXP" : "DC"}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-right text-gray-600 font-medium">
                      {f._dist.toFixed(0)} mi
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-600">
                      {f.city && `${f.city}, `}{f.state}
                    </td>
                    <td className="py-2 px-3 text-xs">
                      {f.sales_email ? (
                        <a href={`mailto:${f.sales_email}`} className="text-purple-600 hover:underline block">{f.sales_email}</a>
                      ) : f.sales_phone ? (
                        <a href={`tel:${f.sales_phone}`} className="text-gray-600 block">{f.sales_phone}</a>
                      ) : f.tech_email ? (
                        <a href={`mailto:${f.tech_email}`} className="text-purple-600 hover:underline block">{f.tech_email}</a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-xs">
                      {f.website ? (
                        <a href={f.website} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Visit</a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nearby transmission lines */}
      {data.nearbyLines.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Nearby Transmission Lines</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Line</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Owner</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Voltage</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Capacity</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">From</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">To</th>
                </tr>
              </thead>
              <tbody>
                {data.nearbyLines.map((line) => (
                  <tr key={String(line.id)} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3">
                      <a href={`/grid/line/?id=${line.id}`} className="text-purple-600 hover:underline text-xs">
                        {String(line.naession || line.hifld_id || line.id)}
                      </a>
                    </td>
                    <td className="py-2 px-3 text-gray-600 text-xs">{String(line.owner || "—")}</td>
                    <td className="py-2 px-3 text-right text-gray-600">
                      {line.voltage_kv ? `${line.voltage_kv} kV` : "—"}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600">
                      {line.capacity_mw ? `${line.capacity_mw} MW` : "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600 text-xs">{String(line.sub_1 || "—")}</td>
                    <td className="py-2 px-3 text-gray-600 text-xs">{String(line.sub_2 || "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
