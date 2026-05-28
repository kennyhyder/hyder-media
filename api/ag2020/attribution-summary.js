/**
 * AG2020 — Attribution summary endpoint
 *
 * GET /api/ag2020/attribution-summary
 *   ?days=30                  (lookback window for ad spend + recent journeys)
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD   (explicit range override)
 *
 * Returns aggregated metrics for the Attribution dashboard tab:
 *   - totals: journeys, linked jobs, revenue, margin, ad spend
 *   - by_source: per first_touch_source counts + revenue + margin + spend + CAC + ROAS
 *   - recent_journeys: 25 most recent with revenue (drill-down)
 *
 * Public read endpoint (matches the existing AG2020 dashboard read pattern —
 * the dashboard is sessionStorage-gated, not API-gated).
 */

import { createClient } from '@supabase/supabase-js';

const TENANT = 'ag2020';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 365));
    const today = new Date();
    const startDate = req.query.start || (() => {
        const d = new Date(today); d.setUTCDate(d.getUTCDate() - days);
        return d.toISOString().slice(0, 10);
    })();
    const endDate = req.query.end || today.toISOString().slice(0, 10);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // --- Top-line totals -------------------------------------------------
    const [{ count: jTotal }, { count: jWithRev }, { count: jobsLinked }, { count: jobsUnlinked }] = await Promise.all([
        supabase.from('ag2020_lead_journey').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT),
        supabase.from('ag2020_lead_journey').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT).gt('revenue_total', 0),
        supabase.from('ag2020_crm_jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT).not('journey_id', 'is', null),
        supabase.from('ag2020_crm_jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT).is('journey_id', null),
    ]);

    // --- Revenue by source — WINDOWED (jobs INVOICED in the date window) -
    // This is what the user expects when they change the date dropdown:
    // numbers should move. Uses the ag2020_revenue_by_source_window RPC for
    // a single fast SQL aggregation joining crm_jobs ↔ lead_journey by date.
    const bySource = {};
    const wRes = await supabase.rpc('ag2020_revenue_by_source_window', {
        p_tenant_id: TENANT, p_start: startDate, p_end: endDate,
    });
    if (wRes.error) {
        // Surface the issue but don't 500 — return empty bySource so the UI
        // at least loads (likely cause: the SQL function isn't applied yet).
        console.error('ag2020_revenue_by_source_window failed:', wRes.error.message);
    } else {
        for (const r of wRes.data || []) {
            const s = r.first_touch_source || 'unknown';
            bySource[s] = bySource[s] || {
                source: s, journeys: 0, jobs: 0, revenue: 0, margin: 0,
                spend: 0, cac: null, roas: null,
            };
            bySource[s].journeys += Number(r.journeys) || 0;
            bySource[s].jobs += Number(r.jobs) || 0;
            bySource[s].revenue += Number(r.revenue) || 0;
            bySource[s].margin += Number(r.margin) || 0;
        }
    }

    // --- Ad spend by platform (sum over date range) ----------------------
    const { data: spendRows } = await supabase
        .from('ag2020_ad_spend_daily')
        .select('platform, spend')
        .eq('tenant_id', TENANT)
        .gte('date', startDate)
        .lte('date', endDate);
    let googleSpend = 0, metaSpend = 0;
    for (const r of spendRows || []) {
        if (r.platform === 'google_ads') googleSpend += Number(r.spend) || 0;
        if (r.platform === 'meta_ads') metaSpend += Number(r.spend) || 0;
    }
    // Allocate spend to source buckets (simple: google_ads → google_paid, meta_ads → meta_paid)
    if (bySource.google_paid) bySource.google_paid.spend = googleSpend;
    if (bySource.meta_paid) bySource.meta_paid.spend = metaSpend;
    // Compute CAC + ROAS where spend > 0
    for (const k of Object.keys(bySource)) {
        const b = bySource[k];
        if (b.spend > 0 && b.journeys > 0) b.cac = b.spend / b.journeys;
        if (b.spend > 0) b.roas = b.revenue / b.spend;
    }

    // --- Top 25 most recent linked journeys with revenue -----------------
    const { data: recent } = await supabase
        .from('ag2020_lead_journey')
        .select('id, phone, email, first_touch_source, first_touch_channel, first_touch_at, revenue_total, margin_total, crm_job_ids, journey_state')
        .eq('tenant_id', TENANT)
        .gt('revenue_total', 0)
        .order('updated_at', { ascending: false })
        .limit(25);

    // --- Touchpoint counts by type --------------------------------------
    const tpTypes = {};
    let tpOff = 0;
    for (;;) {
        const { data } = await supabase
            .from('ag2020_lead_touchpoints')
            .select('touchpoint_type')
            .eq('tenant_id', TENANT)
            .range(tpOff, tpOff + 999);
        if (!data || !data.length) break;
        for (const r of data) tpTypes[r.touchpoint_type] = (tpTypes[r.touchpoint_type] || 0) + 1;
        if (data.length < 1000) break;
        tpOff += 1000;
    }

    // Sort sources by revenue desc for stable UI
    const bySourceArr = Object.values(bySource).sort((a, b) => b.revenue - a.revenue);

    // All-time revenue (separate from windowed) — useful for the lifetime card
    const { data: allTimeRev } = await supabase
        .from('ag2020_lead_journey')
        .select('revenue_total, margin_total')
        .eq('tenant_id', TENANT)
        .gt('revenue_total', 0);
    const allTimeRevenue = (allTimeRev || []).reduce((a, b) => a + (Number(b.revenue_total) || 0), 0);
    const allTimeMargin = (allTimeRev || []).reduce((a, b) => a + (Number(b.margin_total) || 0), 0);

    const windowedRevenue = Object.values(bySource).reduce((a, b) => a + b.revenue, 0);
    const windowedMargin = Object.values(bySource).reduce((a, b) => a + b.margin, 0);
    const windowedJobs = Object.values(bySource).reduce((a, b) => a + (b.jobs || 0), 0);

    return res.status(200).json({
        status: 'success',
        date_range: { start: startDate, end: endDate, days },
        totals: {
            journeys: jTotal || 0,
            journeys_with_revenue: jWithRev || 0,
            jobs_linked: jobsLinked || 0,
            jobs_unlinked: jobsUnlinked || 0,
            link_pct: jobsLinked + jobsUnlinked > 0
                ? +(jobsLinked / (jobsLinked + jobsUnlinked) * 100).toFixed(1) : 0,
            // Windowed (move with the date dropdown)
            revenue_window: +windowedRevenue.toFixed(2),
            margin_window: +windowedMargin.toFixed(2),
            jobs_in_window: windowedJobs,
            // All-time (for the lifetime card)
            revenue_all_time: +allTimeRevenue.toFixed(2),
            margin_all_time: +allTimeMargin.toFixed(2),
            // Ad spend (windowed)
            ad_spend_total: +(googleSpend + metaSpend).toFixed(2),
            google_spend: +googleSpend.toFixed(2),
            meta_spend: +metaSpend.toFixed(2),
        },
        by_source: bySourceArr.map(b => ({
            source: b.source,
            journeys: b.journeys,
            jobs: b.jobs || 0,
            revenue: +b.revenue.toFixed(2),
            margin: +b.margin.toFixed(2),
            spend: +b.spend.toFixed(2),
            cac: b.cac != null ? +b.cac.toFixed(2) : null,
            roas: b.roas != null ? +b.roas.toFixed(2) : null,
        })),
        recent_journeys: (recent || []).map(r => ({
            id: r.id,
            phone: r.phone,
            email: r.email,
            source: r.first_touch_source,
            channel: r.first_touch_channel,
            first_touch_at: r.first_touch_at,
            revenue: +Number(r.revenue_total || 0).toFixed(2),
            margin: +Number(r.margin_total || 0).toFixed(2),
            job_count: (r.crm_job_ids || []).length,
            state: r.journey_state,
        })),
        touchpoints_by_type: tpTypes,
    });
}
