// Sitemap INDEX at /sitemap-index.xml.
//
// Next's `generateSitemaps()` serves sharded sitemaps at /sitemap/<id>.xml but
// does NOT emit an index, and the /sitemap.xml path is reserved by Next's
// metadata convention (can't be overridden). So we expose the <sitemapindex>
// here and point robots.txt at it.

import { SITE_URL } from "@/lib/site";
import { STATES } from "@/lib/geo";
import { freshnessDate } from "@/lib/rollups";
import { orgSitemapShardCount } from "@/lib/organizations";

export const revalidate = 86400;

export async function GET() {
  // Shard 0 = core hubs; shards 1..N = per-state county pages; shards N+1..2N =
  // per-state site-profile URLs; shards 2N+1..3N = per-state substation-profile
  // URLs; then 3 single shards for brownfields, internet-exchanges and
  // datacenters, then ORG_SHARD_COUNT shards for organization URLs.
  // Must stay in sync with generateSitemaps() in src/app/sitemap.ts.
  const shardCount = 1 + STATES.length * 3 + 3 + orgSitemapShardCount(50000);
  const lastmod = freshnessDate().toISOString();

  const entries = Array.from({ length: shardCount }, (_, i) =>
    [
      "  <sitemap>",
      `    <loc>${SITE_URL}/sitemap/${i}.xml</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      "  </sitemap>",
    ].join("\n")
  ).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
