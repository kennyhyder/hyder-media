import { NextResponse } from "next/server";
import { CORS_HEADERS, handleError } from "@/lib/grid-api/utils";
import { siteProfilePath } from "@/lib/entity-slug";
import type { DcSite } from "@/lib/db";
import { geocode, COORD_RE, assembleVetData } from "@/lib/vet-signals";

// Vet-a-site (Phase 1) — Jon De Pena's second workflow: bring a location
// (address / town / lat,lng) + a target build size, and get a first-pass read:
// jurisdiction, regulatory climate (MW-gated), county power/water/hazard context,
// nearby scored candidate sites, and latest local news. All external calls
// (Census geocoder, FCC jurisdiction, news) run server-side, so the browser
// only hits same-origin — no CSP additions needed. Satellite imagery is an <img>
// on the client (Esri World Imagery, allowed by the existing img-src https:).
//
// Signal assembly lives in src/lib/vet-signals.ts, shared with the Watchtower
// scan cron — keep this route a thin shell over it.

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const mwRaw = searchParams.get("mw");
  const mw = mwRaw && !isNaN(parseFloat(mwRaw)) ? parseFloat(mwRaw) : null;

  if (!q) return handleError("q (address, town, or lat,lng) is required", 400);
  if (q.length > 200) return handleError("q is too long", 400);

  const geo = await geocode(q);
  if (!geo) {
    return NextResponse.json(
      { error: "Could not locate that address or place. Try a full street address, a town + state, or lat,lng." },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  // For news, prefer the user's specific place (e.g. "Abilene, TX") over the
  // county — it's more locally relevant. Fall back to county for coord queries.
  const newsPlace = COORD_RE.test(q) ? undefined : q;
  const data = await assembleVetData(geo, mw, newsPlace);

  const nearbyOut = (data.nearby || []).map((s: DcSite) => ({ ...s, path: siteProfilePath(s) }));

  return NextResponse.json(
    {
      location: {
        lat: geo.lat,
        lng: geo.lng,
        label: geo.label,
        state: data.state,
        stateName: data.juris?.stateName ?? null,
        county: data.juris?.county ?? null,
        fips: data.juris?.fips ?? null,
      },
      targetMw: mw,
      regulatory: data.regulatory,
      county: data.county,
      nearby: nearbyOut,
      datacenters: data.datacenters,
      hyperscalerFootprint: data.hyperscalerFootprint,
      pipeline: data.pipeline,
      news: data.news,
    },
    { headers: CORS_HEADERS }
  );
}
