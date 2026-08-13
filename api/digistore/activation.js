/**
 * Digistore24 — activation cohorts + gclid capture health (dashboard read)
 * GET /api/digistore/activation
 *
 * Serves the PostHog-derived tables synced daily by cron-posthog-activation:
 *   cohorts — signup-month × geo funnel (real-gclid cohort)
 *   capture — last 14 days signups vs gclid capture by geo
 */

import { guard } from './_guard.js';

async function sbGet(path) {
  const r = await fetch(`${(process.env.SUPABASE_URL || '').trim()}/rest/v1/${path}`, {
    headers: {
      apikey: (process.env.SUPABASE_SERVICE_KEY || '').trim(),
      Authorization: `Bearer ${(process.env.SUPABASE_SERVICE_KEY || '').trim()}`,
    },
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const [cohorts, capture] = await Promise.all([
      sbGet('ds24_activation_cohorts?select=*&order=cohort_month.asc,geo.asc'),
      sbGet('ds24_gclid_capture_daily?select=*&order=day.asc,geo.asc'),
    ]);
    const fetchedAt = cohorts.length ? cohorts[cohorts.length - 1].fetched_at : null;
    return res.status(200).json({ status: 'success', fetchedAt, cohorts, capture });
  } catch (e) {
    return res.status(200).json({ status: 'error', error: String((e && e.message) || e), cohorts: [], capture: [] });
  }
}
