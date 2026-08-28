// Shared siting-signal assembly — used by /api/grid/vet (interactive) and the
// Watchtower scan cron (scheduled). Extracted from the vet route so both read
// the exact same signals; /vet response shape is unchanged.
//
// Snapshot model (Watchtower): { [signal_key]: { value, hash } } — hashes are
// stable digests of the signal's meaningful content, so the scan cron can diff
// cheaply and adding new signals later is purely additive.

import crypto from "crypto";
import {
  nearbySitesByLatLng,
  nearbyDatacentersByLatLng,
  getCountyByFips,
  type DcSite,
  type Datacenter,
  type CountyDetail,
} from "@/lib/db";
import { regulatoryClimate, DC_POLICY_AS_OF, type RegulatoryClimate } from "@/lib/dc-policy";
import { hyperscalerOf, coloOf } from "@/lib/hyperscalers";
import { fetchNews, type Article } from "@/lib/grid-api/news";
import frontier from "@/data/frontier-dc.json";
import congestion from "@/data/ercot-congestion.json";

export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export interface GeoPoint {
  lat: number;
  lng: number;
  label: string;
}

/** Address / town / "lat,lng" → point. Census first (addresses), Nominatim
 *  fallback (towns — Census is address-only). Server-side only. */
export async function geocode(q: string): Promise<GeoPoint | null> {
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
    if (r.ok) {
      const j = await r.json();
      const match = j?.result?.addressMatches?.[0];
      if (match?.coordinates && Number.isFinite(match.coordinates.y) && Number.isFinite(match.coordinates.x)) {
        return { lat: match.coordinates.y, lng: match.coordinates.x, label: match.matchedAddress || q };
      }
    }
  } catch {
    /* fall through to place fallback */
  }
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
    /* place fallback failed */
  }
  return null;
}

export interface Jurisdiction {
  state: string;
  stateName: string | null;
  county: string | null;
  fips: string | null;
}

export async function jurisdiction(lat: number, lng: number): Promise<Jurisdiction | null> {
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

export interface DatacenterNear {
  id: number | string;
  name: string | null;
  operator: string | null;
  city: string | null;
  state: string | null;
  capacity_mw: number | null;
  hyperscaler: string | null;
  colo: string | null;
  distance_mi: number | null;
}

export interface PipelineNear {
  name: string;
  owner: string | null;
  off_takers: string[] | null;
  power_mw: number | null;
  distance_mi: number;
}

export interface VetData {
  geo: GeoPoint;
  juris: Jurisdiction | null;
  state: string | null;
  regulatory: RegulatoryClimate;
  county: CountyDetail | null;
  nearby: DcSite[];
  datacenters: DatacenterNear[];
  hyperscalerFootprint: string[];
  pipeline: PipelineNear[];
  news: Article[];
}

/** Assemble every siting signal for a point + target MW. `newsPlace` lets the
 *  caller prefer the user's typed place over the resolved county. */
export async function assembleVetData(
  geo: GeoPoint,
  mw: number | null,
  newsPlace?: string,
): Promise<VetData> {
  const juris = await jurisdiction(geo.lat, geo.lng);
  const [nearby, county, dcs] = await Promise.all([
    nearbySitesByLatLng(geo.lat, geo.lng, 8),
    juris?.fips ? getCountyByFips(juris.fips) : Promise.resolve(null),
    nearbyDatacentersByLatLng(geo.lat, geo.lng, null, 10, 0.7),
  ]);

  const datacenters: DatacenterNear[] = (dcs || [])
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
  const hyperscalerFootprint = [...new Set(datacenters.map((d) => d.hyperscaler).filter(Boolean))] as string[];

  const pipeline: PipelineNear[] = frontier.projects
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({
      name: p.name,
      owner: p.owner ?? null,
      off_takers: (p.off_takers as string[] | null) ?? null,
      power_mw: (p.power_mw as number | null) ?? null,
      distance_mi: Math.round(milesBetween(geo.lat, geo.lng, p.lat as number, p.lng as number) * 10) / 10,
    }))
    .filter((p) => p.distance_mi <= 75)
    .sort((a, b) => a.distance_mi - b.distance_mi)
    .slice(0, 5);

  const state = juris?.state ?? null;
  const regulatory = regulatoryClimate(state, mw);
  const placeLabel = juris?.county && juris?.state ? `${juris.county}, ${juris.state}` : geo.label;
  const news = await fetchNews(newsPlace || placeLabel);

  return { geo, juris, state, regulatory, county, nearby, datacenters, hyperscalerFootprint, pipeline, news };
}

// ── Watchtower snapshots ─────────────────────────────────────────────────────

export interface SignalEntry {
  value: unknown;
  hash: string;
}
export type Snapshot = Record<string, SignalEntry>;

function digest(v: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 16);
}

interface CongestionConstraint {
  constraint: string;
  severity: number;
  kv?: number;
  max_shadow_price?: number;
}

/** Statewide ERCOT congestion context (per-site geolocation is blocked on the
 *  ERCOT bus→coord crosswalk — honest scope, same as /grid-congestion). */
function congestionSignal(state: string | null): { top: Array<{ name: string; severity: number; rank: number }> } | null {
  if (state !== "TX") return null;
  const list = ((congestion as { constraints?: CongestionConstraint[] }).constraints ?? [])
    .slice(0, 10)
    .map((b, i) => ({ name: b.constraint, severity: b.severity, rank: i + 1 }));
  return list.length ? { top: list } : null;
}

export interface SiteScoreRow {
  dc_score: number | null;
  score_power?: number | null;
  score_speed_to_power?: number | null;
  score_fiber?: number | null;
}

/** Build a Watchtower snapshot from assembled vet data (+ site score row for
 *  site-kind watches). Every signal is { value, hash }; adding signals later is
 *  additive and old snapshots simply won't have the new keys. */
export function buildSnapshot(data: VetData, site?: SiteScoreRow | null): Snapshot {
  const snap: Snapshot = {};

  if (site && site.dc_score != null) {
    const v = {
      dc_score: site.dc_score,
      power: site.score_power ?? null,
      speed: site.score_speed_to_power ?? null,
      fiber: site.score_fiber ?? null,
    };
    snap.score = { value: v, hash: digest(v) };
  }

  const reg = { label: data.regulatory.label, gated: data.regulatory.gated ?? null, v: DC_POLICY_AS_OF };
  snap.regulatory = { value: reg, hash: digest(reg) };

  const cong = congestionSignal(data.state);
  if (cong) snap.congestion = { value: cong, hash: digest(cong) };

  const pipe = data.pipeline.map((p) => ({ n: p.name, mw: p.power_mw, d: p.distance_mi }));
  snap.pipeline = { value: pipe, hash: digest(pipe.map((p) => p.n)) };

  const dcNames = data.datacenters.slice(0, 10).map((d) => d.name ?? d.operator ?? String(d.id));
  snap.datacenters = { value: { names: dcNames, hyperscalers: data.hyperscalerFootprint }, hash: digest(dcNames) };

  const urls = data.news.map((a) => a.url);
  snap.news = { value: data.news.map((a) => ({ t: a.title, u: a.url, d: a.date })), hash: digest(urls) };

  return snap;
}

export function snapshotHash(snap: Snapshot): string {
  const keys = Object.keys(snap).sort();
  return digest(keys.map((k) => `${k}:${snap[k].hash}`).join("|"));
}
