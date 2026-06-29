// Google Search Console API client for the GridCensus autonomous SEO loop.
//
// Auth: a long-lived OAuth refresh token (GSC_REFRESH_TOKEN) is exchanged for a
// short-lived access token on demand. Creds live in grid/.env.local:
//   GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REFRESH_TOKEN, GSC_SITE_URL.
//
// Everything fails soft: if creds are missing or Google errors, callers get a
// thrown Error they can catch (the cron logs it to gc_gsc_sync_log) — no crash.

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function gscConfigured(): boolean {
  return Boolean(
    process.env.GSC_CLIENT_ID &&
      process.env.GSC_CLIENT_SECRET &&
      process.env.GSC_REFRESH_TOKEN &&
      process.env.GSC_SITE_URL,
  );
}

export function gscSiteUrl(): string {
  return process.env.GSC_SITE_URL || "";
}

let _cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Exchange the refresh token for an access token. Cached in-process until ~60s
 * before expiry so a single cron run doesn't hammer the token endpoint.
 */
export async function gscAccessToken(): Promise<string> {
  if (!gscConfigured()) {
    throw new Error("GSC is not configured (missing GSC_* env vars)");
  }
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
    return _cachedToken.token;
  }

  const body = new URLSearchParams({
    client_id: process.env.GSC_CLIENT_ID!,
    client_secret: process.env.GSC_CLIENT_SECRET!,
    refresh_token: process.env.GSC_REFRESH_TOKEN!,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GSC token refresh failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("GSC token refresh returned no access_token");
  }
  _cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

export interface GscQueryOptions {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dimensions: string[]; // e.g. ['date','page','query']
  rowLimit?: number; // max 25000 per page
  startRow?: number;
  searchType?: string; // default 'web'
}

export interface GscRow {
  keys: string[]; // ordered to match `dimensions`
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscApiResponse {
  rows?: GscRow[];
}

/**
 * One page of the searchAnalytics/query call. For full pulls, use gscQueryAll()
 * which paginates 25k rows at a time.
 */
export async function gscQuery(opts: GscQueryOptions): Promise<GscRow[]> {
  const token = await gscAccessToken();
  const site = gscSiteUrl();
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    site,
  )}/searchAnalytics/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: opts.dimensions,
      rowLimit: Math.min(opts.rowLimit ?? 25000, 25000),
      startRow: opts.startRow ?? 0,
      searchType: opts.searchType ?? "web",
      dataState: "all",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GSC query failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as GscApiResponse;
  return json.rows ?? [];
}

/**
 * Paginated pull — fetches every page (25k rows each) until a short page is
 * returned. Bounded by `maxRows` to keep a cron run inside its time budget.
 */
export async function gscQueryAll(
  opts: Omit<GscQueryOptions, "startRow" | "rowLimit">,
  maxRows = 100_000,
): Promise<GscRow[]> {
  const PAGE = 25_000;
  const all: GscRow[] = [];
  let startRow = 0;
  while (all.length < maxRows) {
    const page = await gscQuery({ ...opts, rowLimit: PAGE, startRow });
    all.push(...page);
    if (page.length < PAGE) break;
    startRow += PAGE;
  }
  return all;
}
