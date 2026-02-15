"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import type { Installation, Equipment, SiteEvent } from "@/types/solar";

const InstallationMap = dynamic(() => import("@/components/InstallationMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[300px] bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
      Loading map...
    </div>
  ),
});

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000/api/solar"
    : "/api/solar";

interface SiteDetail extends Installation {
  equipment: Equipment[];
  events: SiteEvent[];
}

function DetailRow({ label, value, link }: { label: string; value: string | number | null | undefined; link?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-right">
        {link ? (
          <a href={link} className="text-blue-600 hover:underline">{String(value)}</a>
        ) : (
          String(value)
        )}
      </dd>
    </div>
  );
}

function SiteContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE}/installation?id=${id}`)
      .then((res) => res.json())
      .then((data) => setSite(data.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (!id) return <div className="text-gray-500">No site ID provided</div>;
  if (loading) return <div className="text-gray-500 py-12 text-center">Loading site details...</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;
  if (!site) return <div className="text-gray-500">Site not found</div>;

  const ageYears = site.install_date
    ? Math.floor((Date.now() - new Date(site.install_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  return (
    <div className="space-y-6">
      <div>
        <a href="/solar/search/" className="text-blue-600 hover:underline text-sm">
          &larr; Back to search
        </a>
        <h1 className="text-2xl font-bold mt-2">
          {site.site_name || `${site.county || "Unknown"}, ${site.state}`}
        </h1>
        <div className="flex flex-wrap gap-2 mt-2">
          <span className="capitalize bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-sm">
            {site.site_type}
          </span>
          <span className="capitalize bg-green-100 text-green-800 px-2 py-0.5 rounded text-sm">
            {site.site_status}
          </span>
          {ageYears !== null && ageYears >= 10 && (
            <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-sm">
              {ageYears} years old
            </span>
          )}
          {site.has_battery_storage && (
            <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-sm">
              Battery Storage
            </span>
          )}
        </div>
      </div>

      {/* Map or address fallback */}
      {site.latitude && site.longitude ? (
        <InstallationMap
          installations={[site]}
          center={[Number(site.latitude), Number(site.longitude)]}
          zoom={14}
          height="300px"
        />
      ) : (
        <div className="h-[200px] bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400">
          <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm font-medium">No precise coordinates available</span>
          {(site.address || site.city) && (
            <span className="text-xs mt-1">
              {[site.address, site.city, site.state].filter(Boolean).join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Site details + Location */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Site Details</h2>
          <dl className="text-sm">
            <DetailRow label="Capacity (MW)" value={site.capacity_mw ? Number(site.capacity_mw).toFixed(1) : null} />
            <DetailRow label="DC Capacity (kW)" value={site.capacity_dc_kw ? Number(site.capacity_dc_kw).toLocaleString() : null} />
            <DetailRow label="AC Capacity (kW)" value={site.capacity_ac_kw ? Number(site.capacity_ac_kw).toLocaleString() : null} />
            <DetailRow label="Mount Type" value={site.mount_type} />
            <DetailRow label="Tracking" value={site.tracking_type} />
            <DetailRow label="Install Date" value={site.install_date} />
            <DetailRow label="Interconnection Date" value={site.interconnection_date} />
            {site.has_battery_storage && (
              <DetailRow
                label="Battery Storage"
                value={site.battery_capacity_kwh ? `${site.battery_capacity_kwh} kWh` : "Yes"}
              />
            )}
            <DetailRow label="Modules" value={site.num_modules ? Number(site.num_modules).toLocaleString() : null} />
            <DetailRow label="Inverters" value={site.num_inverters ? Number(site.num_inverters).toLocaleString() : null} />
            {site.total_cost && (
              <DetailRow label="Total Cost" value={`$${Number(site.total_cost).toLocaleString()}`} />
            )}
            {site.cost_per_watt && (
              <DetailRow label="Cost/Watt" value={`$${Number(site.cost_per_watt).toFixed(2)}`} />
            )}
          </dl>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Location</h2>
            <dl className="text-sm">
              <DetailRow label="Address" value={site.address} />
              <DetailRow label="City" value={site.city} />
              <DetailRow label="County" value={site.county} />
              <DetailRow label="State" value={site.state} />
              <DetailRow label="Zip Code" value={site.zip_code} />
              {site.latitude && site.longitude && (
                <DetailRow
                  label="Coordinates"
                  value={`${Number(site.latitude).toFixed(4)}, ${Number(site.longitude).toFixed(4)}`}
                />
              )}
            </dl>
            {site.latitude && site.longitude && (
              <a
                href={`https://www.google.com/maps?q=${site.latitude},${site.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-3 text-blue-600 hover:underline text-sm"
              >
                View on Google Maps &rarr;
              </a>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">People & Companies</h2>
            <dl className="text-sm">
              <DetailRow
                label="Owner"
                value={site.owner_name}
                link={site.owner_name ? `/solar/search/?owner=${encodeURIComponent(site.owner_name)}` : undefined}
              />
              <DetailRow
                label="Operator"
                value={site.operator_name}
                link={site.operator_name ? `/solar/search/?q=${encodeURIComponent(site.operator_name)}` : undefined}
              />
              <DetailRow
                label="Developer"
                value={site.developer_name}
                link={site.developer_name ? `/solar/search/?q=${encodeURIComponent(site.developer_name)}` : undefined}
              />
              <DetailRow
                label="Installer"
                value={site.installer_name}
                link={site.installer_name ? `/solar/search/?installer=${encodeURIComponent(site.installer_name)}` : undefined}
              />
            </dl>
          </div>
        </div>
      </div>

      {/* Equipment */}
      {site.equipment && site.equipment.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
            Equipment ({site.equipment.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Manufacturer</th>
                  <th className="pb-2 pr-4">Model</th>
                  <th className="pb-2 pr-4">Technology</th>
                  <th className="pb-2 pr-4 text-right">Qty</th>
                  <th className="pb-2 pr-4 text-right">Specs</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {site.equipment.map((eq) => (
                  <tr key={eq.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 capitalize">{eq.equipment_type}</td>
                    <td className="py-2 pr-4">
                      {eq.manufacturer ? (
                        <a
                          href={`/solar/equipment/?manufacturer=${encodeURIComponent(eq.manufacturer)}&equipment_type=${eq.equipment_type}`}
                          className="text-blue-600 hover:underline"
                        >
                          {eq.manufacturer}
                        </a>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{eq.model || "-"}</td>
                    <td className="py-2 pr-4 text-gray-500">{eq.module_technology || "-"}</td>
                    <td className="py-2 pr-4 text-right font-mono">{eq.quantity || "-"}</td>
                    <td className="py-2 pr-4 text-right text-gray-500">
                      {eq.module_wattage_w ? `${eq.module_wattage_w}W` : ""}
                      {eq.inverter_capacity_kw ? `${eq.inverter_capacity_kw} kW` : ""}
                      {eq.battery_capacity_kwh ? `${eq.battery_capacity_kwh} kWh` : ""}
                    </td>
                    <td className="py-2 capitalize text-gray-500">{eq.equipment_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Events */}
      {site.events && site.events.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
            Site Events ({site.events.length})
          </h2>
          <div className="space-y-3">
            {site.events.map((event) => (
              <div key={event.id} className="flex gap-4 border-b last:border-0 pb-3">
                <div className="text-sm text-gray-500 w-28 shrink-0">
                  {event.event_date || "Unknown date"}
                </div>
                <div>
                  <span className="capitalize font-medium">{event.event_type}</span>
                  {event.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{event.description}</p>
                  )}
                  {event.old_capacity_kw && event.new_capacity_kw && (
                    <p className="text-sm text-gray-400 mt-0.5">
                      Capacity: {Number(event.old_capacity_kw).toLocaleString()} kW &rarr;{" "}
                      {Number(event.new_capacity_kw).toLocaleString()} kW
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SitePage() {
  return (
    <Suspense fallback={<div className="text-gray-500 py-12 text-center">Loading...</div>}>
      <SiteContent />
    </Suspense>
  );
}
