// Server component: renders a top-N sites table from live DcSite rows.

import type { DcSite } from "@/lib/db";
import { fmtScore, fmtKv, fmtMwExact, fmtYears, scoreColor } from "@/lib/format";
import { siteTypeLabel } from "@/lib/geo";

export default function SitesTable({
  sites,
  showState = false,
  showCounty = true,
  showFormerUse = false,
  caption,
  linkBuilder,
}: {
  sites: DcSite[];
  showState?: boolean;
  showCounty?: boolean;
  showFormerUse?: boolean;
  caption?: string;
  // When provided, the site-name cell links to the row's profile page.
  // Returning null leaves that row as plain text (e.g. noindex sites).
  linkBuilder?: (site: DcSite) => string | null;
}) {
  if (!sites.length) {
    return (
      <p className="surface-card rounded-lg p-4 text-sm text-gray-500">
        Live site list is temporarily unavailable. Aggregate figures on this
        page are unaffected.
      </p>
    );
  }
  return (
    <div className="surface-card overflow-x-auto rounded-lg">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Site</th>
            <th className="px-3 py-2">Type</th>
            {showState && <th className="px-3 py-2">State</th>}
            {showCounty && <th className="px-3 py-2">County</th>}
            {showFormerUse && <th className="px-3 py-2">Former use</th>}
            <th className="px-3 py-2">Voltage</th>
            <th className="px-3 py-2">Capacity</th>
            <th className="px-3 py-2">Queue wait</th>
            <th className="px-3 py-2">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sites.map((s) => {
            const href = linkBuilder ? linkBuilder(s) : null;
            return (
            <tr key={s.id} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-900">
                {href ? (
                  <a href={href} className="text-purple-700 hover:underline">
                    {s.name || "Unnamed site"}
                  </a>
                ) : (
                  s.name || "Unnamed site"
                )}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {siteTypeLabel(s.site_type || "")}
              </td>
              {showState && <td className="px-3 py-2 text-gray-600">{s.state}</td>}
              {showCounty && (
                <td className="px-3 py-2 text-gray-600">{s.county || "—"}</td>
              )}
              {showFormerUse && (
                <td className="px-3 py-2 text-gray-600">{s.former_use || "—"}</td>
              )}
              <td className="px-3 py-2 text-gray-600">{fmtKv(s.substation_voltage_kv)}</td>
              <td className="px-3 py-2 text-gray-600">{fmtMwExact(s.available_capacity_mw)}</td>
              <td className="px-3 py-2 text-gray-600">{fmtYears(s.avg_queue_wait_years)}</td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${scoreColor(
                    s.dc_score
                  )}`}
                >
                  {fmtScore(s.dc_score)}
                </span>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
