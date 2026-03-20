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
  address?: string;
  zipcode?: string;
  ix_count?: number;
  network_count?: number;
  capacity_mw?: number;
  sqft?: number;
  dc_type?: string;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface FiberRoute {
  id: string;
  geometry_json: unknown;
  name?: string;
  operator?: string;
  fiber_type?: string;
}

interface SiteDetail {
  site: Record<string, unknown>;
  county: Record<string, unknown> | null;
  nearbyLines: Record<string, unknown>[];
  nearbyFiber?: FiberRoute[];
  brownfield: Record<string, unknown> | null;
  nearbyFacilities?: NearbyFacility[];
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

export default function SiteDetailPage() {
  return (
    <Suspense fallback={<div className="animate-pulse"><div className="h-8 bg-gray-200 rounded w-64 mb-4" /><div className="h-48 bg-gray-200 rounded" /></div>}>
      <SiteDetailContent />
    </Suspense>
  );
}

function SiteDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [data, setData] = useState<SiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const baseUrl = window.location.origin;
    fetch(withDemoToken(`${baseUrl}/api/grid/dc-site?id=${id}`))
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
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Site Detail</h1>
        <p className="text-gray-600">No site ID provided. <a href="/grid/sites/" className="text-purple-600 hover:underline">Browse sites</a></p>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Loading site...</h1>
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
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Site Not Found</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error || "Site not found"}
        </div>
      </div>
    );
  }

  const s = data.site as Record<string, number | string | null>;
  const county = data.county as Record<string, number | string | null> | null;

  const dcScore = Number(s.dc_score) || 0;
  const scoreColorClass =
    dcScore >= 70 ? "text-green-600" :
    dcScore >= 50 ? "text-yellow-600" :
    dcScore >= 30 ? "text-orange-600" : "text-red-600";

  // Sub-scores for investment thesis
  const speedScore = Number(s.score_speed_to_power) || 0;
  const powerScore = Number(s.score_power) || 0;
  const fiberScore = Number(s.score_fiber) || 0;
  const waterScore = Number(s.score_water) || 0;
  const hazardScore = Number(s.score_hazard) || 0;
  const taxScore = Number(s.score_tax) || 0;
  const dcClusterScore = Number(s.score_existing_dc) || 0;
  const landScore = Number(s.score_land) || 0;
  const energyCostScore = Number(s.score_energy_cost) || 0;
  const gasPipelineScore = Number(s.score_gas_pipeline) || 0;
  const buildabilityScoreVal = Number(s.score_buildability) || 0;
  const constructionCostScore = Number(s.score_construction_cost) || 0;

  // Speed to energization callout
  const speedLabel = speedScore >= 70 ? "Fast" : speedScore >= 40 ? "Moderate" : "Slow";
  const speedColor = speedScore >= 70
    ? "bg-green-50 border-green-200 text-green-800"
    : speedScore >= 40
    ? "bg-yellow-50 border-yellow-200 text-yellow-800"
    : "bg-orange-50 border-orange-200 text-orange-800";
  const speedBadgeColor = speedScore >= 70
    ? "bg-green-100 text-green-700"
    : speedScore >= 40
    ? "bg-yellow-100 text-yellow-700"
    : "bg-orange-100 text-orange-700";

  // Build investment thesis bullets
  const strengths: string[] = [];
  const risks: string[] = [];

  if (powerScore >= 70) strengths.push("Strong power availability — high-voltage substation within close proximity.");
  else if (powerScore < 30) risks.push("Limited power infrastructure nearby — may require significant grid investment.");

  if (speedScore >= 70) strengths.push("Fast path to energization — low queue congestion in this ISO region.");
  else if (speedScore < 30) risks.push("Slow interconnection timeline — high queue congestion will delay energization.");

  if (fiberScore >= 70) strengths.push("Excellent fiber connectivity — IXP access and multiple fiber providers.");
  else if (fiberScore < 30) risks.push("Poor fiber connectivity — distant from IXPs, limited fiber infrastructure.");

  if (waterScore >= 70) strengths.push("Low water stress — sustainable cooling water supply.");
  else if (waterScore < 30) risks.push("High water stress — cooling water availability may be constrained.");

  if (hazardScore >= 70) strengths.push("Low natural hazard risk — minimal exposure to extreme weather events.");
  else if (hazardScore < 30) risks.push("Elevated hazard risk — consider redundant infrastructure and insurance costs.");

  if (taxScore >= 70) strengths.push("DC tax incentive available — state offers datacenter-specific tax benefits.");

  if (dcClusterScore >= 70) strengths.push("Existing datacenter cluster nearby — benefits from shared ecosystem and workforce.");

  if (landScore >= 70) strengths.push("Ample land available for campus-scale development.");

  if (energyCostScore >= 70) strengths.push("Low energy costs — competitive electricity pricing for the region.");
  else if (energyCostScore < 30) risks.push("High energy costs — above-average electricity pricing may impact operating margins.");

  if (gasPipelineScore >= 70) strengths.push("Gas pipeline access — nearby pipeline supports on-site backup generation.");

  if (buildabilityScoreVal >= 70) strengths.push("Highly buildable land — favorable terrain and land cover for development.");
  else if (buildabilityScoreVal < 30) risks.push("Challenging buildability — terrain or land cover may increase construction costs.");

  if (constructionCostScore >= 70) strengths.push("Below-average construction costs for this region.");
  else if (constructionCostScore < 30) risks.push("Above-average construction costs — labor and materials premium in this market.");

  if (s.site_type === "brownfield") {
    strengths.push("Brownfield advantage — existing grid connection, cleared land, and road access may reduce time-to-power by 2-4 years.");
  }

  // ISO queue tracker URLs
  const isoQueueUrls: Record<string, string> = {
    ERCOT: "https://www.ercot.com/gridinfo/resource",
    CAISO: "https://www.caiso.com/planning/Pages/GeneratorInterconnection/Default.aspx",
    PJM: "https://www.pjm.com/planning/services-requests/interconnection-queues",
    MISO: "https://www.misoenergy.org/planning/generator-interconnection/GI_Queue/",
    SPP: "https://opsportal.spp.org/Studies/GIActive",
    NYISO: "https://www.nyiso.com/interconnections",
    "ISO-NE": "https://www.iso-ne.com/system-planning/interconnection-service/interconnection-request-queue/",
  };

  // State DC tax incentive direct URLs
  const stateTaxIncentiveUrls: Record<string, string> = {
    VA: "https://www.vedp.org/incentive/data-center-sales-and-use-tax-exemption",
    TX: "https://gov.texas.gov/business/page/tax-exemptions-and-tax-incentives",
    GA: "https://www.georgia.org/competitive-advantages/incentives",
    NC: "https://edpnc.com/incentives/",
    OH: "https://development.ohio.gov/business/state-incentives",
    IN: "https://www.iedc.in.gov/incentives",
    NV: "https://goed.nv.gov/key-industries/information-technology/",
    IA: "https://www.iowaeda.com/tax-credits-exemptions/",
    TN: "https://www.tnecd.com/advantages/incentives/",
    SC: "https://www.sccommerce.com/incentives",
    MS: "https://mississippi.org/incentives/",
    NE: "https://opportunity.nebraska.gov/incentives-financing/",
    ND: "https://www.commerce.nd.gov/economic-development-finance/incentives-programs",
    SD: "https://sdgoed.com/investors/tax-incentives/",
    WY: "https://wyomingbusiness.org/industries/data-centers/",
    OR: "https://www.oregon4biz.com/Oregon-Business/Tax-Incentives/",
    WA: "https://choosewashingtonstate.com/why-washington-state/tax-incentives/",
    IL: "https://dceo.illinois.gov/business-incentives.html",
    NY: "https://esd.ny.gov/doing-business-ny/business-incentives",
    NJ: "https://www.njeda.gov/economicrecoveryact/",
    PA: "https://dced.pa.gov/programs-funding/",
    MD: "https://commerce.maryland.gov/fund/programs-for-businesses",
    CT: "https://portal.ct.gov/decd/services/business-incentives",
  };

  // Cloud provider region direct URLs
  const cloudRegionUrls: Record<string, Record<string, string>> = {
    AWS: {
      "us-east-1": "https://aws.amazon.com/about-aws/global-infrastructure/regions_az/?p=ngi&loc=2#Northern%20Virginia",
      "us-east-2": "https://aws.amazon.com/about-aws/global-infrastructure/regions_az/?p=ngi&loc=2#Ohio",
      "us-west-1": "https://aws.amazon.com/about-aws/global-infrastructure/regions_az/?p=ngi&loc=2#Northern%20California",
      "us-west-2": "https://aws.amazon.com/about-aws/global-infrastructure/regions_az/?p=ngi&loc=2#Oregon",
    },
    GCP: {
      "us-east1": "https://cloud.google.com/about/locations#south-carolina",
      "us-east4": "https://cloud.google.com/about/locations#northern-virginia",
      "us-east5": "https://cloud.google.com/about/locations#columbus",
      "us-central1": "https://cloud.google.com/about/locations#iowa",
      "us-south1": "https://cloud.google.com/about/locations#dallas",
      "us-west1": "https://cloud.google.com/about/locations#oregon",
      "us-west2": "https://cloud.google.com/about/locations#los-angeles",
      "us-west3": "https://cloud.google.com/about/locations#salt-lake-city",
      "us-west4": "https://cloud.google.com/about/locations#las-vegas",
    },
    Azure: {
      "eastus": "https://azure.microsoft.com/en-us/explore/global-infrastructure/geographies/#geographies",
      "eastus2": "https://azure.microsoft.com/en-us/explore/global-infrastructure/geographies/#geographies",
      "centralus": "https://azure.microsoft.com/en-us/explore/global-infrastructure/geographies/#geographies",
      "westus": "https://azure.microsoft.com/en-us/explore/global-infrastructure/geographies/#geographies",
      "westus2": "https://azure.microsoft.com/en-us/explore/global-infrastructure/geographies/#geographies",
      "westus3": "https://azure.microsoft.com/en-us/explore/global-infrastructure/geographies/#geographies",
      "southcentralus": "https://azure.microsoft.com/en-us/explore/global-infrastructure/geographies/#geographies",
      "northcentralus": "https://azure.microsoft.com/en-us/explore/global-infrastructure/geographies/#geographies",
    },
  };

  // Get cloud region URL
  const getCloudRegionUrl = (provider: string, region: string): string | null => {
    const providerKey = Object.keys(cloudRegionUrls).find(k => provider?.toLowerCase().includes(k.toLowerCase()));
    if (!providerKey) return null;
    const regionMap = cloudRegionUrls[providerKey];
    return regionMap[region] || Object.values(regionMap)[0] || null;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{String(s.name)}</h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${
              s.site_type === "brownfield"
                ? "bg-amber-100 text-amber-700"
                : s.site_type === "greenfield"
                ? "bg-green-100 text-green-700"
                : "bg-blue-100 text-blue-700"
            }`}>
              {String(s.site_type)}
            </span>
          </div>
          <p className="text-gray-600">
            {s.county && `${s.county}, `}{s.state}
            {s.iso_region && ` (${s.iso_region})`}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500 uppercase tracking-wide">DC Score</div>
          <div className={`text-4xl font-bold ${scoreColorClass}`}>{dcScore.toFixed(1)}</div>
          <div className={`text-xs font-medium ${scoreColorClass}`}>
            {dcScore >= 70 ? "Excellent" : dcScore >= 50 ? "Good" : dcScore >= 30 ? "Fair" : "Poor"}
          </div>
          <button
            onClick={() => window.print()}
            className="mt-2 px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 print:hidden"
          >
            Print / PDF
          </button>
        </div>
      </div>

      {/* Map */}
      {s.latitude && s.longitude && (
        <div className="mb-6">
          <div className="rounded-lg overflow-hidden border border-gray-200">
          <TransmissionMap
            lines={data.nearbyLines.filter((l) => l.geometry_wkt) as Array<{ id: string; hifld_id: number; geometry_wkt: string | null; voltage_kv: number | null; capacity_mw: number | null; upgrade_candidate: boolean; owner: string | null; state: string | null; sub_1: string | null; sub_2: string | null; naession: string | null }>}
            center={[Number(s.latitude), Number(s.longitude)]}
            zoom={15}
            height="350px"
            siteMarker={{
              lat: Number(s.latitude),
              lng: Number(s.longitude),
              label: String(s.name),
              type: s.site_type === "brownfield" ? "brownfield" : "site",
            }}
            onLineClick={(id) => { window.location.href = `/grid/line/?id=${id}`; }}
            fiberRoutes={data.nearbyFiber?.map(f => ({ geometry_json: f.geometry_json, name: f.name, operator: f.operator, fiber_type: f.fiber_type }))}
          />
          </div>
          <p className="text-xs text-gray-400 mt-1">Map pin shows approximate site location. Nearby transmission lines shown in context.</p>
        </div>
      )}

      {/* Speed to Energization callout */}
      <div className={`rounded-lg border p-5 mb-6 ${speedColor}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold">Speed to Energization</h2>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold ${speedBadgeColor}`}>
                {speedLabel}
              </span>
            </div>
            <p className="text-sm opacity-80">
              {s.queue_depth != null
                ? `${s.queue_depth} projects in the ${s.iso_region || "regional"} interconnection queue`
                : `${s.iso_region || "Regional"} interconnection queue data`}
              {s.avg_queue_wait_years != null && ` with an average ${s.avg_queue_wait_years}-year wait`}.
              {s.site_type === "brownfield" && " Brownfield sites with existing grid connections can bypass much of the queue."}
            </p>
          </div>
          <div className="text-3xl font-bold ml-4">{speedScore}</div>
        </div>
      </div>

      {/* Investment Thesis */}
      {(strengths.length > 0 || risks.length > 0) && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Investment Thesis</h2>
          {strengths.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-green-700 uppercase tracking-wide mb-2">Strengths</h3>
              <ul className="space-y-1.5">
                {strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-green-500 mt-0.5">&#9650;</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {risks.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-red-700 uppercase tracking-wide mb-2">Risks</h3>
              <ul className="space-y-1.5">
                {risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-red-500 mt-0.5">&#9660;</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Score breakdown */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Score Breakdown</h2>
        <div className="space-y-1">
          {scoreBar("Power Availability", powerScore, "30%")}
          {scoreBar("Speed to Power", speedScore, "20%")}
          {scoreBar("Fiber Connectivity", fiberScore, "18%")}
          {scoreBar("Natural Hazard", hazardScore, "7%")}
          {scoreBar("Existing DC Cluster", dcClusterScore, "7%")}
          {scoreBar("Land / Acreage", landScore, "5%")}
          {scoreBar("Labor Market", Number(s.score_labor) || 0, "5%")}
          {scoreBar("Water Risk", waterScore, "3%")}
          {scoreBar("Tax Incentive", taxScore, "3%")}
          {scoreBar("Climate / Cooling", Number(s.score_climate) || 0, "2%")}
          {scoreBar("Energy Cost", energyCostScore, "—")}
          {scoreBar("Gas Pipeline", gasPipelineScore, "—")}
          {scoreBar("Buildability", buildabilityScoreVal, "—")}
          {scoreBar("Construction Cost", constructionCostScore, "—")}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Power section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Power</h2>
          {s.nearest_substation_name && (
            <div className="flex justify-between py-1.5 border-b border-gray-100">
              <span className="text-xs text-gray-500">Nearest Substation</span>
              <a href={`/grid/search/?q=${encodeURIComponent(String(s.nearest_substation_name))}`}
                className="text-sm font-medium text-purple-600 hover:underline">
                {String(s.nearest_substation_name)}
              </a>
            </div>
          )}
          {infoRow("Distance", s.nearest_substation_distance_km != null ? `${(Number(s.nearest_substation_distance_km) * 0.621371).toFixed(1)} mi` : null)}
          {infoRow("Voltage", s.substation_voltage_kv ? `${s.substation_voltage_kv} kV` : null)}
          {infoRow("Available Capacity", s.available_capacity_mw ? `${s.available_capacity_mw} MW` : null)}
          {infoRow("Queue Depth", s.queue_depth)}
          {infoRow("Avg Queue Wait", s.avg_queue_wait_years ? `${s.avg_queue_wait_years} years` : null)}
          {s.iso_region && isoQueueUrls[String(s.iso_region)] && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <a href={isoQueueUrls[String(s.iso_region)]} target="_blank" rel="noopener noreferrer"
                className="text-xs text-purple-600 hover:underline">
                {String(s.iso_region)} Queue Tracker &#8599;
              </a>
            </div>
          )}
        </div>

        {/* Connectivity section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Connectivity</h2>
          {s.nearest_ixp_name && (
            <div className="flex justify-between py-1.5 border-b border-gray-100">
              <span className="text-xs text-gray-500">Nearest IXP</span>
              <a href={`https://www.peeringdb.com/search?q=${encodeURIComponent(String(s.nearest_ixp_name))}`}
                target="_blank" rel="noopener noreferrer"
                className="text-sm font-medium text-purple-600 hover:underline">
                {String(s.nearest_ixp_name)} &#8599;
              </a>
            </div>
          )}
          {infoRow("IXP Distance", s.nearest_ixp_distance_km != null ? `${(Number(s.nearest_ixp_distance_km) * 0.621371).toFixed(1)} mi` : null)}
          {s.nearest_dc_name && (
            <div className="flex justify-between py-1.5 border-b border-gray-100">
              <span className="text-xs text-gray-500">Nearest Datacenter</span>
              <a href={`https://www.google.com/maps/search/${encodeURIComponent(String(s.nearest_dc_name) + ' datacenter')}`}
                target="_blank" rel="noopener noreferrer"
                className="text-sm font-medium text-purple-600 hover:underline">
                {String(s.nearest_dc_name)} &#8599;
              </a>
            </div>
          )}
          {infoRow("DC Distance", s.nearest_dc_distance_km != null ? `${(Number(s.nearest_dc_distance_km) * 0.621371).toFixed(1)} mi` : null)}
          {s.fcc_fiber_pct != null && (
            <div className="flex justify-between py-1.5 border-b border-gray-100">
              <span className="text-xs text-gray-500">Fiber Coverage</span>
              <span className="text-sm font-medium text-gray-900">
                {Number(s.fcc_fiber_pct).toFixed(1)}%
                <a href={`https://broadbandmap.fcc.gov/location-summary/fixed?speed=1000&latlon=${s.latitude},${s.longitude}&zoom=14`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-purple-600 hover:underline ml-1 text-xs">(FCC BDC &#8599;)</a>
              </span>
            </div>
          )}
          {s.nearest_fiber_km != null && (
            <div className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
              <span className="text-xs text-gray-500">Nearest Fiber Route</span>
              <span className="text-sm font-medium text-gray-900">{(Number(s.nearest_fiber_km) * 0.621371).toFixed(1)} mi</span>
            </div>
          )}
        </div>

        {/* Site Characteristics section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Site Characteristics</h2>
          {s.energy_price_mwh != null && (
            <div className="flex justify-between py-1.5 border-b border-gray-100">
              <span className="text-xs text-gray-500">Energy Price</span>
              <span className="text-sm font-medium text-gray-900">
                ${Number(s.energy_price_mwh).toFixed(2)}/MWh
                {s.energy_price_source && (
                  <a href={`https://www.eia.gov/electricity/state/${String(s.state || "").toLowerCase()}/`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-purple-600 hover:underline ml-1 text-xs">({String(s.energy_price_source)} &#8599;)</a>
                )}
              </span>
            </div>
          )}
          {s.construction_cost_index != null && (
            <div className="flex justify-between py-1.5 border-b border-gray-100">
              <span className="text-xs text-gray-500">Construction Cost Index</span>
              <span className="text-sm font-medium text-gray-900">
                {Number(s.construction_cost_index).toFixed(1)} <span className="text-xs text-gray-400">(avg = 100, RSMeans)</span>
              </span>
            </div>
          )}
          {infoRow("Gas Pipeline Distance", s.nearest_gas_pipeline_km != null ? `${(Number(s.nearest_gas_pipeline_km) * 0.621371).toFixed(1)} mi` : null)}
          {infoRow("Land Cover", s.nlcd_class)}
          {s.nlcd_code && infoRow("NLCD Code", s.nlcd_code)}
          {infoRow("Buildability Score", s.buildability_score != null ? `${Number(s.buildability_score).toFixed(1)} / 100` : null)}
        </div>

        {/* County risk section */}
        {county && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">County Risk Profile</h2>
            {infoRow("County", county.county_name)}

            {/* NRI with source */}
            {county.nri_score != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">NRI Score / Rating</span>
                <span className="text-sm font-medium text-gray-900">
                  {String(county.nri_score)}{county.nri_rating ? ` (${county.nri_rating})` : ""}
                  <a href={`https://hazards.fema.gov/nri/map#checks=true&layers=false&stateZoom=${String(s.state || "").toLowerCase()}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-purple-600 hover:underline ml-1 text-xs">(FEMA NRI &#8599;)</a>
                </span>
              </div>
            )}

            {/* Water stress with source */}
            {county.water_stress_label && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Water Stress</span>
                <span className="text-sm font-medium text-gray-900">
                  {String(county.water_stress_label)}
                  {s.latitude && s.longitude && (
                    <a href={`https://www.wri.org/applications/aqueduct/water-risk-atlas/#/?basemap=hydro&indicator=w_awr_def_tot_cat&lat=${s.latitude}&lng=${s.longitude}&zoom=10`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-purple-600 hover:underline ml-1 text-xs">(WRI Aqueduct &#8599;)</a>
                  )}
                </span>
              </div>
            )}

            {/* CDD with source */}
            {county.cooling_degree_days != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Cooling Degree Days</span>
                <span className="text-sm font-medium text-gray-900">
                  {String(county.cooling_degree_days)}
                  <span className="text-xs text-gray-400 ml-1">(NOAA)</span>
                </span>
              </div>
            )}

            {/* Fiber with provider details */}
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
                {s.latitude && s.longitude && (
                  <a href={`https://broadbandmap.fcc.gov/location-summary/fixed?speed=1000&latlon=${s.latitude},${s.longitude}&zoom=14`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-purple-600 hover:underline ml-1 text-xs">(FCC BDC &#8599;)</a>
                )}
              </span>
            </div>

            {/* Land value with source */}
            {county.avg_land_value_per_acre_usd && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Land Value</span>
                <span className="text-sm font-medium text-gray-900">
                  ${Number(county.avg_land_value_per_acre_usd).toLocaleString()}/acre
                  <span className="text-xs text-gray-400 ml-1">(USDA)</span>
                </span>
              </div>
            )}

            {/* Tax incentive */}
            <div className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
              <span className="text-xs text-gray-500">DC Tax Incentive</span>
              <span className="text-sm font-medium text-gray-900">
                {county.has_dc_tax_incentive ? (
                  <>
                    <span className="text-green-600">Yes</span>
                    {county.dc_incentive_type && <span className="text-gray-500 text-xs ml-1">({String(county.dc_incentive_type)})</span>}
                    {s.state && stateTaxIncentiveUrls[String(s.state)] && (
                      <a href={stateTaxIncentiveUrls[String(s.state)]}
                        target="_blank" rel="noopener noreferrer"
                        className="text-purple-600 hover:underline ml-1 text-xs">(Details &#8599;)</a>
                    )}
                  </>
                ) : "No"}
              </span>
            </div>

            {/* USGS Water Availability */}
            {county.total_water_mgd != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Water Withdrawal</span>
                <span className="text-sm font-medium text-gray-900">
                  {Number(county.total_water_mgd).toLocaleString(undefined, {maximumFractionDigits: 0})} Mgal/day
                  <span className="text-xs text-gray-400 ml-1">(USGS 2015)</span>
                </span>
              </div>
            )}

            {/* Rail proximity */}
            {s.nearest_rail_km != null && (
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500">Nearest Rail</span>
                <span className="text-sm font-medium text-gray-900">
                  {(Number(s.nearest_rail_km) * 0.621371).toFixed(1)} mi
                  <span className="text-xs text-gray-400 ml-1">(FRA)</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Environmental Constraints */}
        {(s.critical_habitat != null || s.wetland_present != null || s.superfund_nearby != null) && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Environmental Constraints</h2>
            <div className="divide-y divide-gray-100">
              {s.critical_habitat != null && (
                <div className="flex justify-between py-2">
                  <span className="text-sm text-gray-600">Critical Habitat (USFWS)</span>
                  <span className={`text-sm font-medium ${s.critical_habitat ? 'text-red-600' : 'text-green-600'}`}>
                    {s.critical_habitat ? (
                      <>
                        Present
                        {s.critical_habitat_species && (
                          <span className="text-xs text-red-400 ml-1">({String(s.critical_habitat_species)})</span>
                        )}
                      </>
                    ) : 'Clear'}
                  </span>
                </div>
              )}
              {s.wetland_present != null && (
                <div className="flex justify-between py-2">
                  <span className="text-sm text-gray-600">Wetlands (NWI)</span>
                  <span className={`text-sm font-medium ${s.wetland_present ? 'text-amber-600' : 'text-green-600'}`}>
                    {s.wetland_present ? (
                      <>
                        Present
                        {s.wetland_type && <span className="text-xs text-amber-400 ml-1">({String(s.wetland_type)})</span>}
                      </>
                    ) : 'Clear'}
                  </span>
                </div>
              )}
              {s.superfund_nearby != null && (
                <div className="flex justify-between py-2">
                  <span className="text-sm text-gray-600">Superfund Site (EPA)</span>
                  <span className={`text-sm font-medium ${s.superfund_nearby ? 'text-red-600' : 'text-green-600'}`}>
                    {s.superfund_nearby ? (
                      <>
                        Nearby
                        {s.superfund_site_name && <span className="text-xs text-red-400 ml-1">({String(s.superfund_site_name)})</span>}
                      </>
                    ) : 'Clear'}
                  </span>
                </div>
              )}
              {s.flood_zone && (
                <div className="flex justify-between py-2">
                  <span className="text-sm text-gray-600">FEMA Flood Zone</span>
                  <span className={`text-sm font-medium ${
                    ['A', 'AE', 'AH', 'AO', 'V', 'VE'].includes(String(s.flood_zone)) ? 'text-red-600' : 'text-green-600'
                  }`}>
                    Zone {String(s.flood_zone)}
                    {s.flood_zone_sfha && <span className="text-xs text-red-400 ml-1">(SFHA)</span>}
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Environmental flags may require additional permitting: Section 7 (ESA) for critical habitat, Section 404 (CWA) for wetlands, CERCLA for superfund sites.
            </p>
          </div>
        )}

        {/* Brownfield section */}
        {data.brownfield && (
          <div className="bg-white rounded-lg border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-lg font-semibold text-amber-800 mb-3">
              Brownfield Details
              <a href={`/grid/brownfield/?id=${(data.brownfield as Record<string, unknown>).id}`}
                className="text-sm font-normal text-purple-600 hover:underline ml-2">
                View full detail
              </a>
            </h2>
            {infoRow("Former Use", (data.brownfield as Record<string, unknown>).former_use)}
            {infoRow("Existing Capacity", (data.brownfield as Record<string, unknown>).existing_capacity_mw
              ? `${(data.brownfield as Record<string, unknown>).existing_capacity_mw} MW` : null)}
            {infoRow("Retirement Date", (data.brownfield as Record<string, unknown>).retirement_date)}
            {infoRow("Cleanup Status", (data.brownfield as Record<string, unknown>).cleanup_status)}
            {infoRow("EIA Plant ID", (data.brownfield as Record<string, unknown>).eia_plant_id)}
            {infoRow("Acreage", (data.brownfield as Record<string, unknown>).acreage)}
            {String((data.brownfield as Record<string, unknown>).operator_name || "") && (
              <div className="mt-3 pt-3 border-t border-amber-200">
                <h3 className="text-sm font-medium text-amber-700 mb-2">Operator Contact</h3>
                {infoRow("Operator", (data.brownfield as Record<string, unknown>).operator_name)}
                {infoRow("Address", (data.brownfield as Record<string, unknown>).operator_address)}
              </div>
            )}
          </div>
        )}

        {/* External Resources */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">External Resources</h2>
          <div className="space-y-4">
            {/* Location & Imagery */}
            {s.latitude && s.longitude && (
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Location &amp; Imagery</div>
                <div className="space-y-1.5">
                  <a href={`https://www.google.com/maps/@${s.latitude},${s.longitude},500m/data=!3m1!1e3`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> Google Maps Satellite View
                  </a>
                  <a href={`https://earth.google.com/web/@${s.latitude},${s.longitude},0a,1000d,35y,0h,0t,0r`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> Google Earth 3D View
                  </a>
                  {s.county && s.state && (
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(`${s.county} County ${s.state} GIS parcel map`)}`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> {String(s.county)} County GIS / Parcel Map
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Grid & Power */}
            {(s.iso_region || s.state) && (
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Grid &amp; Power</div>
                <div className="space-y-1.5">
                  {s.iso_region && isoQueueUrls[String(s.iso_region)] && (
                    <a href={isoQueueUrls[String(s.iso_region)]}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> {String(s.iso_region)} Interconnection Queue
                    </a>
                  )}
                  {s.state && (
                    <a href={`/grid/lines/?state=${s.state}`}
                      className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> All Transmission Lines in {String(s.state)}
                    </a>
                  )}
                  {s.state && (
                    <a href={`https://www.eia.gov/electricity/state/${String(s.state).toLowerCase()}/`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> EIA State Electricity Profile — {String(s.state)}
                    </a>
                  )}
                  {s.nearest_substation_name && (
                    <a href={`/grid/search/?q=${encodeURIComponent(String(s.nearest_substation_name))}`}
                      className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> GridScout: {String(s.nearest_substation_name)} Substation
                    </a>
                  )}
                  <a href="https://hifld-geoplatform.opendata.arcgis.com/datasets/electric-substations"
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> HIFLD Substation Database
                  </a>
                </div>
              </div>
            )}

            {/* Risk & Environment */}
            {s.latitude && s.longitude && (
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Risk &amp; Environment</div>
                <div className="space-y-1.5">
                  <a href={`https://msc.fema.gov/portal/search?AddressQuery=${s.latitude}%2C${s.longitude}#searchresultsanchor`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> FEMA Flood Map{s.flood_zone ? ` (Zone ${s.flood_zone})` : ""}
                  </a>
                  <a href={`https://ejscreen.epa.gov/mapper/mobile/?latitude=${s.latitude}&longitude=${s.longitude}&zoomLevel=14`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> EPA EJScreen Environmental Justice
                  </a>
                  <a href={`https://hazards.fema.gov/nri/map#checks=true&layers=false&stateZoom=${String(s.state || "").toLowerCase()}`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> FEMA National Risk Index — {String(s.state)}
                  </a>
                  {s.wri_basin_name && (
                    <a href={`https://www.wri.org/applications/aqueduct/water-risk-atlas/#/?basemap=hydro&indicator=w_awr_def_tot_cat&lat=${s.latitude}&lng=${s.longitude}&zoom=10`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> WRI Aqueduct Water Risk — {String(s.wri_basin_name)}
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Connectivity */}
            {(s.nearest_ixp_name || s.fcc_fiber_providers) && (
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Connectivity</div>
                <div className="space-y-1.5">
                  {s.nearest_ixp_name && (
                    <a href={`https://www.peeringdb.com/search?q=${encodeURIComponent(String(s.nearest_ixp_name))}`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> PeeringDB: {String(s.nearest_ixp_name)}
                    </a>
                  )}
                  {s.latitude && s.longitude && (
                    <a href={`https://broadbandmap.fcc.gov/location-summary/fixed?speed=1000&latlon=${s.latitude},${s.longitude}&zoom=14`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> FCC Broadband Map{s.fcc_fiber_providers ? ` (${s.fcc_fiber_providers} fiber providers)` : ""}
                    </a>
                  )}
                  {s.nearest_cloud_provider && (() => {
                    const directUrl = getCloudRegionUrl(String(s.nearest_cloud_provider), String(s.nearest_cloud_region || ""));
                    return (
                      <a href={directUrl || `https://www.google.com/search?q=${encodeURIComponent(`${s.nearest_cloud_provider} ${s.nearest_cloud_region || ""} cloud region`)}`}
                        target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                        <span>&#8599;</span> Nearest Cloud: {String(s.nearest_cloud_provider)}{s.nearest_cloud_region ? ` (${s.nearest_cloud_region})` : ""}
                      </a>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Incentives & Policy */}
            {s.state && (
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Incentives &amp; Policy</div>
                <div className="space-y-1.5">
                  <a href={`https://programs.dsireusa.org/system/program?state=${String(s.state)}&technology=105&sector=3`}
                    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                    <span>&#8599;</span> DSIRE Incentives — {String(s.state)}
                  </a>
                  {stateTaxIncentiveUrls[String(s.state)] ? (
                    <a href={stateTaxIncentiveUrls[String(s.state)]}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> {String(s.state)} Economic Development &amp; Incentives
                    </a>
                  ) : (
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(`${s.state} datacenter tax incentive abatement`)}`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> {String(s.state)} DC Tax Incentive Programs
                    </a>
                  )}
                  {s.county && (
                    <a href={`https://selectusa.gov/programs-incentives?state=${encodeURIComponent(String(s.state))}`}
                      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <span>&#8599;</span> SelectUSA — {String(s.state)} Programs &amp; Incentives
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
        <p className="text-xs text-gray-500 mb-4">Property ownership and land availability information for this site.</p>
        {s.site_type === "brownfield" ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Brownfield Redevelopment</span>
            </div>
            <p className="text-sm text-gray-700 mb-3">
              This is a retired power plant site with existing grid infrastructure. Brownfield redevelopment typically involves
              working with the property owner (often the former utility) and the state environmental agency for any required cleanup.
            </p>
            {data.brownfield && (data.brownfield as Record<string, unknown>).operator_name ? (
              <div className="mb-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Property Owner / Former Operator</div>
                <div className="text-sm font-medium text-gray-900">{String((data.brownfield as Record<string, unknown>).operator_name)}</div>
                {(data.brownfield as Record<string, unknown>).operator_address ? (
                  <div className="text-xs text-gray-600">{String((data.brownfield as Record<string, unknown>).operator_address)}</div>
                ) : null}
              </div>
            ) : null}
            {s.parcel_owner && (
              <div className="mb-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Tax Parcel Owner (County Records)</div>
                <div className="text-sm font-semibold text-gray-900">{String(s.parcel_owner)}</div>
                {s.parcel_apn && <div className="text-xs text-gray-500 mt-0.5">Parcel #: {String(s.parcel_apn)}</div>}
                {s.parcel_address && <div className="text-xs text-gray-600 mt-0.5">{String(s.parcel_address)}</div>}
              </div>
            )}
            <div className="space-y-2">
              <a href="https://www.epa.gov/brownfields/state-brownfields-and-voluntary-response-programs" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                <span>&#8599;</span> EPA State Brownfield Programs Directory
              </a>
              {s.state && (
                <a href={`https://www.epa.gov/brownfields/state-brownfields-and-voluntary-response-programs`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                  <span>&#8599;</span> {String(s.state)} Brownfield Program (EPA Directory)
                </a>
              )}
            </div>
          </div>
        ) : s.land_contact_type === "blm_office" ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Federal Land — BLM ROW Application</span>
            </div>
            <p className="text-sm text-gray-700 mb-3">
              This site is on federal land managed by the Bureau of Land Management. Development requires a Right-of-Way (ROW)
              grant application — land is leased, not purchased.
            </p>
            {s.land_contact_name && (
              <div className="mb-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">BLM Office</div>
                <div className="text-sm font-medium text-gray-900">{String(s.land_contact_name)}</div>
                {s.land_contact_phone && <div className="text-xs text-gray-600"><a href={`tel:${s.land_contact_phone}`} className="text-purple-600 hover:underline">{String(s.land_contact_phone)}</a></div>}
              </div>
            )}
            <div className="space-y-2">
              {s.land_contact_url && (
                <a href={String(s.land_contact_url)} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                  <span>&#8599;</span> BLM State Office Website
                </a>
              )}
              <a href="https://www.blm.gov/programs/lands-and-realty/right-of-way" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                <span>&#8599;</span> BLM Right-of-Way Application Process
              </a>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Private Land</span>
            </div>
            {s.parcel_owner ? (
              <>
                <div className="mb-4 p-4 bg-purple-50 rounded-lg border border-purple-100">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Property Owner (County Tax Records)</div>
                  <div className="text-base font-semibold text-gray-900">{String(s.parcel_owner)}</div>
                  {s.parcel_apn && <div className="text-xs text-gray-500 mt-1">Parcel #: {String(s.parcel_apn)}</div>}
                  {s.parcel_address && <div className="text-xs text-gray-600 mt-0.5">{String(s.parcel_address)}</div>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(`"${s.parcel_owner}" ${s.county ? s.county + ' County' : ''} ${s.state || ''} property`)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-purple-600 hover:underline bg-white px-2 py-1 rounded border border-purple-200">
                      <span>&#8599;</span> Search Owner
                    </a>
                    {s.county && s.state && (
                      <a href={`https://www.google.com/search?q=${encodeURIComponent(`${s.county} County ${s.state} assessor property records${s.parcel_apn ? ' ' + s.parcel_apn : ''}`)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-purple-600 hover:underline bg-white px-2 py-1 rounded border border-purple-200">
                        <span>&#8599;</span> County Records
                      </a>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  Owner information sourced from county tax assessor parcel records. Contact the property owner or their representative to discuss land lease or acquisition.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-700 mb-3">
                  This site is on or near private land. Property ownership records are maintained by the county assessor&apos;s office.
                </p>
                {s.county && s.state && (
                  <div className="mb-3">
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">County Assessor</div>
                    <div className="text-sm font-medium text-gray-900">{String(s.county)} County Assessor&apos;s Office</div>
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(`${s.county} County ${s.state} assessor property records`)}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-purple-600 hover:underline">
                      Search for county assessor website
                    </a>
                  </div>
                )}
              </>
            )}
            <div className="space-y-2">
              {s.county && s.state && (
                <a href={`https://www.loopnet.com/search/land/${encodeURIComponent(String(s.county).toLowerCase().replace(/\s+/g, '-'))}-county-${encodeURIComponent(String(s.state).toLowerCase().replace(/\s+/g, '-'))}/for-sale/`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                  <span>&#8599;</span> LoopNet — {String(s.county)} County Land for Sale
                </a>
              )}
              {s.state && (
                <a href={`https://www.landwatch.com/${encodeURIComponent(String(s.state).toLowerCase().replace(/\s+/g, '-'))}-land-for-sale`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                  <span>&#8599;</span> LandWatch — {String(s.state)} Land for Sale
                </a>
              )}
              {s.county && s.state && (
                <a href={`https://www.google.com/search?q=${encodeURIComponent(`land for sale ${s.county} County ${s.state} acreage commercial`)}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                  <span>&#8599;</span> Search Commercial Land Listings
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Nearby Facilities with Contacts */}
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
                  .map((f) => ({ ...f, _dist: haversine(Number(s.latitude), Number(s.longitude), f.latitude, f.longitude) }))
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
                      {f.org_name && f.org_name !== f.name && (
                        <div className="text-xs text-gray-500">{f.org_name}</div>
                      )}
                      {f.operator && f.operator !== f.name && (
                        <div className="text-xs text-gray-500">{f.operator}</div>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        f.facility_type === "ixp"
                          ? "bg-cyan-100 text-cyan-700"
                          : "bg-blue-100 text-blue-700"
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
                      {f.sales_email && (
                        <a href={`mailto:${f.sales_email}`} className="text-purple-600 hover:underline block">{f.sales_email}</a>
                      )}
                      {f.sales_phone && (
                        <a href={`tel:${f.sales_phone}`} className="text-gray-600 block">{f.sales_phone}</a>
                      )}
                      {!f.sales_email && !f.sales_phone && f.tech_email && (
                        <a href={`mailto:${f.tech_email}`} className="text-purple-600 hover:underline block">{f.tech_email}</a>
                      )}
                      {!f.sales_email && !f.sales_phone && !f.tech_email && (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-xs">
                      {f.website ? (
                        <a href={f.website} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">
                          Visit
                        </a>
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
                      <a
                        href={`/grid/line/?id=${line.id}`}
                        className="text-purple-600 hover:underline text-xs"
                      >
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
