/**
 * Shared utility functions for GridCensus API route handlers.
 *
 * Ported from api/grid/_utils.js — the (req,res) helpers are replaced with
 * request/Response equivalents (handleError returns a NextResponse;
 * setCacheHeaders returns a headers object instead of mutating res).
 */
import { NextResponse } from "next/server";

/**
 * Escape special PostgREST characters for use in .or() / .ilike() filters.
 * Prevents injection of wildcards and grouping operators.
 */
export function sanitizeSearch(str?: string | null): string {
  if (!str) return "";
  return str.replace(/[%_.*()]/g, (ch) => "\\" + ch);
}

/**
 * Extract and validate pagination parameters from query string.
 * Returns { limit, offset } with sane defaults and bounds.
 */
export function validatePagination(
  params: URLSearchParams,
  opts: { maxLimit?: number; defaultLimit?: number } = {}
): { limit: number; offset: number } {
  const { maxLimit = 200, defaultLimit = 50 } = opts;
  const limit = Math.min(
    Math.max(parseInt(params.get("limit") || "") || defaultLimit, 1),
    maxLimit
  );
  const offset = Math.max(parseInt(params.get("offset") || "") || 0, 0);
  return { limit, offset };
}

/**
 * Standard Cache-Control header value for public API responses.
 * 5 min s-maxage with 10 min stale-while-revalidate.
 */
export const CACHE_HEADER = "public, s-maxage=300, stale-while-revalidate=600";

/**
 * Standard headers for every GridCensus data API response (CORS + cache).
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/** Headers for a cached public JSON response. */
export function cacheHeaders(
  value: string = CACHE_HEADER
): Record<string, string> {
  return { ...CORS_HEADERS, "Cache-Control": value };
}

/**
 * Build a standardized error NextResponse.
 *
 * Always logs the real error server-side. For 5xx responses it returns a
 * GENERIC message ("Internal server error") so Postgres/internal details
 * (e.g. "canceling statement due to statement timeout") are never leaked to
 * the client. For 4xx responses it echoes the provided (safe, user-facing)
 * validation message.
 */
export function handleError(
  error: unknown,
  statusCode: number = 500
): NextResponse {
  const realMessage =
    typeof error === "string"
      ? error
      : (error as Error)?.message || String(error);
  console.error(`[GridCensus API Error ${statusCode}] ${realMessage}`);

  // 5xx: never leak internals. 4xx: validation messages are safe + user-facing.
  const clientMessage = statusCode >= 500 ? "Internal server error" : realMessage;
  return NextResponse.json(
    { error: clientMessage },
    { status: statusCode, headers: CORS_HEADERS }
  );
}

/** A plain 500 with the generic message + CORS headers (no specific error). */
export function internalError(): NextResponse {
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500, headers: CORS_HEADERS }
  );
}
