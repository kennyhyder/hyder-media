/**
 * Shared utility functions for GridScout API endpoints.
 *
 * Usage:
 *   import { sanitizeSearch, validatePagination, setCacheHeaders, handleError } from "./_utils.js";
 */

/**
 * Escape special PostgREST characters for use in .or() / .ilike() filters.
 * Prevents injection of wildcards and grouping operators.
 */
export function sanitizeSearch(str) {
  if (!str) return "";
  return str.replace(/[%_.*()]/g, (ch) => "\\" + ch);
}

/**
 * Extract and validate pagination parameters from query string.
 * Returns { limit, offset } with sane defaults and bounds.
 *
 * @param {object} query - req.query object
 * @param {object} [opts] - options
 * @param {number} [opts.maxLimit=200] - maximum allowed limit
 * @param {number} [opts.defaultLimit=50] - default limit when not specified
 * @returns {{ limit: number, offset: number }}
 */
export function validatePagination(query, opts = {}) {
  const { maxLimit = 200, defaultLimit = 50 } = opts;
  const limit = Math.min(Math.max(parseInt(query.limit) || defaultLimit, 1), maxLimit);
  const offset = Math.max(parseInt(query.offset) || 0, 0);
  return { limit, offset };
}

/**
 * Set standard Cache-Control headers for public API responses.
 * 5 min s-maxage with 10 min stale-while-revalidate.
 */
export function setCacheHeaders(res) {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
}

/**
 * Send a standardized error response.
 * Logs the error server-side and returns a JSON error to the client.
 *
 * @param {object} res - Vercel response object
 * @param {Error|string} error - Error object or message string
 * @param {number} [statusCode=500] - HTTP status code
 */
export function handleError(res, error, statusCode = 500) {
  const message = typeof error === "string" ? error : error.message || "Internal server error";
  console.error(`[GridScout API Error] ${message}`);
  return res.status(statusCode).json({ error: message });
}
