/**
 * Bron dashboard data feed — read the intake submissions + AI analysis.
 * GET /api/bron/data?k=<DASH_TOKEN>
 * Gated by a token baked into the (password-protected) dashboard so the feed
 * isn't casually scrapeable. Returns submissions newest-first.
 */
const DASH_TOKEN = 'bron-dash-7k2mq4';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if ((req.query.k || '') !== DASH_TOKEN) return res.status(403).json({ error: 'forbidden' });

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bron_intake?select=id,submitted_at,respondent,role,answers,analysis,analysis_status&order=submitted_at.desc`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    const rows = await r.json();
    return res.status(200).json({ ok: true, count: rows.length, submissions: rows });
  } catch (error) {
    console.error('bron data error:', error.message);
    return res.status(500).json({ error: 'data_failed' });
  }
}
