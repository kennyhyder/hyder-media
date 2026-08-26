import { NextResponse } from "next/server";
import { CORS_HEADERS, handleError } from "@/lib/grid-api/utils";
import { nearbySitesByLatLng, nearbyDatacentersByLatLng, getCountyByFips, type DcSite, type Datacenter } from "@/lib/db";
import { siteProfilePath } from "@/lib/entity-slug";
import { regulatoryClimate } from "@/lib/dc-policy";
import { hyperscalerOf, coloOf } from "@/lib/hyperscalers";
import frontier from "@/data/frontier-dc.json";

function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Vet-a-site (Phase 1) — Jon De Pena's second workflow: bring a location
// (address / town / lat,lng) + a target build size, and get a first-pass read:
// jurisdiction, regulatory climate (MW-gated), county power/water/hazard context,
// nearby scored candidate sites, and latest local news. All external calls
// (Census geocoder, FCC jurisdiction, GDELT news) run server-side, so the browser
// only hits same-origin — no CSP additions needed. Satellite imagery is an <img>
// on the client (Esri World Imagery, allowed by the existing img-src https:).

export const dynamic = "force-dynamic";

const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

async function geocode(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const m = q.match(COORD_RE);
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    }
  }
  try {
    const url =
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}` +
      `&benchmark=Public_AR_Current&format=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    const match = j?.result?.addressMatches?.[0];
    if (match?.coordinates && Number.isFinite(match.coordinates.y) && Number.isFinite(match.coordinates.x)) {
      return { lat: match.coordinates.y, lng: match.coordinates.x, label: match.matchedAddress || q };
    }
  } catch {
    /* Census failed — fall through to the place fallback */
  }
  // Fallback for town / place names (Census is address-only). Low-volume,
  // server-side, US-only, with a contact User-Agent per OSM policy.
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "GridCensus/1.0 (+https://gridcensus.com; kenny@hyder.me)" },
    });
    if (r.ok) {
      const j = await r.json();
      const hit = Array.isArray(j) ? j[0] : null;
      if (hit) {
        const lat = parseFloat(hit.lat);
        const lng = parseFloat(hit.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng, label: (hit.display_name as string) || q };
        }
      }
    }
  } catch {
    /* place fallback failed — return null below */
  }
  return null;
}

async function jurisdiction(lat: number, lng: number) {
  try {
    const r = await fetch(`https://geo.fcc.gov/api/census/area?lat=${lat}&lon=${lng}&format=json`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const a = j?.results?.[0];
    if (a?.state_code) {
      return {
        state: a.state_code as string,
        stateName: (a.state_name as string) ?? null,
        county: (a.county_name as string) ?? null,
        fips: (a.county_fips as string) ?? null,
      };
    }
  } catch {
    /* reverse-geocode failed */
  }
  return null;
}

interface Article { title: string; url: string; domain: string; date: string }

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return (m?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

async function news(place: string): Promise<Article[]> {
  // Google News RSS — keyless, robust, actually returns results from server IPs
  // (GDELT returns empty from cloud IPs). Query scoped to DC-siting topics.
  try {
    const query = `"${place}" (data center OR datacenter OR substation OR "large load")`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GridCensus/1.0)" },
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.split("<item>").slice(1, 9);
    const out: Article[] = [];
    for (const it of items) {
      let title = tag(it, "title");
      const link = tag(it, "link");
      const source = tag(it, "source");
      const pub = tag(it, "pubDate");
      if (!title || !link) continue;
      // Google News appends " - Source" to titles; trim it when we have the source.
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      let date = pub;
      const t = Date.parse(pub);
      if (!isNaN(t)) date = new Date(t).toISOString().slice(0, 10);
      out.push({ title, url: link, domain: source, date });
    }
    return out.slice(0, 6);
  } catch {
    return [];
  }
}

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

  const juris = await jurisdiction(geo.lat, geo.lng);
  const [nearby, county, dcs] = await Promise.all([
    nearbySitesByLatLng(geo.lat, geo.lng, 8),
    juris?.fips ? getCountyByFips(juris.fips) : Promise.resolve(null),
    nearbyDatacentersByLatLng(geo.lat, geo.lng, null, 10, 0.7),
  ]);

  // Existing-datacenter footprint near the location, with hyperscaler/colo tags.
  const datacenters = (dcs || [])
    .map((dc: Datacenter) => ({
      id: dc.id,
      name: dc.name,
      operator: dc.operator,
      city: dc.city,
      state: dc.state,
      capacity_mw: dc.capacity_mw,
      hyperscaler: hyperscalerOf(dc.operator) ?? hyperscalerOf(dc.name),
      colo: coloOf(dc.operator) ?? coloOf(dc.name),
      distance_mi:
        dc.latitude != null && dc.longitude != null
          ? Math.round(milesBetween(geo.lat, geo.lng, dc.latitude, dc.longitude) * 10) / 10
          : null,
    }))
    .sort((a, b) => (a.distance_mi ?? 1e9) - (b.distance_mi ?? 1e9));
  const hyperscalerFootprint = [...new Set(datacenters.map((d) => d.hyperscaler).filter(Boolean))];

  // Nearby frontier AI datacenter projects (Epoch AI) — pipeline + off-taker context.
  const pipeline = frontier.projects
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({
      name: p.name,
      owner: p.owner,
      off_takers: p.off_takers,
      power_mw: p.power_mw,
      distance_mi: Math.round(milesBetween(geo.lat, geo.lng, p.lat as number, p.lng as number) * 10) / 10,
    }))
    .filter((p) => p.distance_mi <= 75)
    .sort((a, b) => a.distance_mi - b.distance_mi)
    .slice(0, 5);

  const state = juris?.state ?? null;
  const reg = regulatoryClimate(state, mw);
  const placeLabel = juris?.county && juris?.state ? `${juris.county}, ${juris.state}` : geo.label;
  const articles = await news(placeLabel);

  const nearbyOut = (nearby || []).map((s: DcSite) => ({ ...s, path: siteProfilePath(s) }));

  return NextResponse.json(
    {
      location: {
        lat: geo.lat,
        lng: geo.lng,
        label: geo.label,
        state,
        stateName: juris?.stateName ?? null,
        county: juris?.county ?? null,
        fips: juris?.fips ?? null,
      },
      targetMw: mw,
      regulatory: reg,
      county,
      nearby: nearbyOut,
      datacenters,
      hyperscalerFootprint,
      pipeline,
      news: articles,
    },
    { headers: CORS_HEADERS }
  );
}
