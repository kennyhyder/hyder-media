import { NextResponse } from "next/server";
import { CORS_HEADERS, handleError } from "@/lib/grid-api/utils";
import { nearbySitesByLatLng, getCountyByFips, type DcSite } from "@/lib/db";
import { siteProfilePath } from "@/lib/entity-slug";
import { regulatoryClimate } from "@/lib/dc-policy";

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
    /* geocode failed — return null below */
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

async function news(place: string): Promise<Article[]> {
  try {
    const query = `"${place}" (data center OR datacenter OR substation OR "large load")`;
    const url =
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}` +
      `&mode=artlist&maxrecords=6&format=json&sort=datedesc&timespan=6m`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "GridCensus/1.0 (+https://gridcensus.com)" },
    });
    if (!r.ok) return [];
    const j = await r.json();
    const arts = Array.isArray(j?.articles) ? j.articles : [];
    return arts.slice(0, 6).map((a: Record<string, string>) => ({
      title: a.title,
      url: a.url,
      domain: a.domain,
      date: a.seendate,
    }));
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
  const [nearby, county] = await Promise.all([
    nearbySitesByLatLng(geo.lat, geo.lng, 8),
    juris?.fips ? getCountyByFips(juris.fips) : Promise.resolve(null),
  ]);

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
      news: articles,
    },
    { headers: CORS_HEADERS }
  );
}
