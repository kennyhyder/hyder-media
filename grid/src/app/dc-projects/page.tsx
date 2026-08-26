import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { fmtInt } from "@/lib/format";
import JsonLd from "@/components/JsonLd";
import Freshness from "@/components/Freshness";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import frontier from "@/data/frontier-dc.json";

export const revalidate = 604800;

export const metadata: Metadata = {
  title: "AI Datacenter Pipeline — Owners, Off-Takers & Megawatts",
  description:
    "The frontier AI datacenter buildout across the US: the biggest campuses under construction and operating, with owner, off-taker (tenant), power capacity, and location. Who's building, where, and for whom.",
  alternates: { canonical: `${SITE_URL}/dc-projects` },
};

function shortAddr(addr: string | null): string {
  if (!addr) return "—";
  // keep the city, state tail
  const parts = addr.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts.slice(-2).join(", ") : addr;
}

export default function DcProjectsPage() {
  const projects = frontier.projects;

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "AI Datacenter Pipeline", url: "/dc-projects" },
          ]),
          datasetSchema({
            name: `${SITE_NAME} — AI datacenter pipeline`,
            description:
              "Frontier AI datacenter campuses in the US with owner, off-taker, power capacity, and location.",
            url: `${SITE_URL}/dc-projects`,
            spatialCoverage: "United States",
          }),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <span className="text-gray-500">AI datacenter pipeline</span>
      </nav>

      <header className="mt-3">
        <h1 className="text-3xl font-bold text-gray-900">AI datacenter pipeline</h1>
        <p className="mt-2 max-w-3xl text-gray-700">
          The frontier AI datacenter buildout — the biggest US campuses under construction and
          operating, with the <strong>owner</strong>, the <strong>off-taker</strong> (the tenant
          actually using the compute), power capacity, and location. The off-taker is the single
          hardest fact to source and is usually non-public — this surfaces it where it&apos;s known.
        </p>
      </header>

      <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50 p-4 text-sm text-gray-700">
        <strong>Why it matters for siting:</strong> knowing who&apos;s already building where (and for
        whom) tells you which markets the smart money is concentrating in, who has an off-take need,
        and where the grid/ecosystem is maturing fastest — context for both discovering and vetting a
        site.
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="w-8 py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Campus</th>
              <th className="py-2 pr-3 font-medium">Owner</th>
              <th className="py-2 pr-3 font-medium">Off-taker(s)</th>
              <th className="py-2 pr-3 font-medium">Location</th>
              <th className="py-2 font-medium text-right">Power</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p, i) => (
              <tr key={p.name + i} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-2 tabular-nums text-gray-400">{i + 1}</td>
                <td className="py-2 pr-3 font-medium text-gray-900">
                  {p.source ? (
                    <a href={p.source} target="_blank" rel="noopener noreferrer" className="text-purple-700 hover:underline">
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-700">{p.owner || "—"}</td>
                <td className="py-2 pr-3 text-gray-600">
                  {p.off_takers.length > 0 ? p.off_takers.join(", ") : <span className="text-gray-400">undisclosed</span>}
                </td>
                <td className="py-2 pr-3 text-gray-500">{shortAddr(p.address)}</td>
                <td className="py-2 text-right tabular-nums text-gray-800">
                  {p.power_mw != null ? `${fmtInt(p.power_mw)} MW` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <Freshness />
      </div>
      <p className="mt-2 max-w-3xl text-xs text-gray-400">
        Source: <a href={frontier.source_url} className="hover:text-purple-600">Epoch AI — Frontier
        Data Centers</a> (CC-BY 4.0), {frontier.count} US campuses. Off-takers reflect the best public
        reporting and may be partial or speculative. A screening reference, not a substitute for
        primary due diligence.
      </p>
    </div>
  );
}
