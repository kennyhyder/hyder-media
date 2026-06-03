// Cross-pipeline constants. Sports + golf both need the same staleness
// threshold; previously each comparison endpoint defined its own and they
// could silently drift.
//
// Add new constants here only if they're shared across pipelines. Pipeline-
// specific tuning (e.g., Kalshi cron cadence) stays in its own file.

/**
 * How old (wall-clock) a quote can be before we treat it as stale and
 * drop it from comparison responses. Calibrated to 1 missed cron cycle
 * of grace at the slowest ingest cadence (sports books = 30 min).
 *
 * Used in:
 *   /api/sports/event.js
 *   /api/golfodds/comparison.js
 */
export const STALE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Helper: true if `fetchedAt` (ISO string or null) is older than the
 * shared staleness threshold from `now`. Defaults to Date.now() so callers
 * don't have to pass it every loop iteration.
 */
export const isStaleQuote = (fetchedAt, now = Date.now()) => {
  if (!fetchedAt) return false;
  return now - new Date(fetchedAt).getTime() > STALE_THRESHOLD_MS;
};
