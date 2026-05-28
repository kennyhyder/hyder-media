/**
 * AG2020 — Daily ad-spend rollup cron
 *
 * GET /api/ag2020/cron-ad-spend-daily
 *
 *   Pulls the last 7 days of campaign-level cost from Google Ads (both
 *   AG2020 accounts) + Meta Ads (AG2020 account), upserts into
 *   `ag2020_ad_spend_daily`. Idempotent — safe to re-run any time. Vercel
 *   cron runs it daily at 8am UTC (per `vercel.json`).
 *
 *   Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel cron pattern).
 *
 *   The data this populates is consumed by the daily attribution-rollup
 *   that allocates spend to journeys for CAC/ROAS calculations.
 */

import { createClient } from '@supabase/supabase-js';

const TENANT = 'ag2020';

const GOOGLE_ACCOUNTS = [
    { id: '5053365860', mcc: '6736988718', name: 'AG2020 Current' },
    { id: '4399614856', mcc: '4399614856', name: 'AG2020 Historical' },
];
const META_ACCOUNT_ID = 'act_1455451028117748';
const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

function todayISO(offsetDays = 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    const days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 7, 90));
    const startDate = todayISO(-days);
    const endDate = todayISO(0);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const stats = {
        date_range: { start: startDate, end: endDate },
        google_ads: { rows_fetched: 0, rows_upserted: 0, accounts: {}, errors: [] },
        meta_ads: { rows_fetched: 0, rows_upserted: 0, errors: [] },
    };

    // -------------------------------------------------------------------
    // Google Ads — pull daily per-campaign cost for each AG2020 account
    // -------------------------------------------------------------------
    try {
        const gAccessToken = await getGoogleAdsToken(supabase);
        for (const acct of GOOGLE_ACCOUNTS) {
            try {
                const rows = await fetchGoogleAdsSpend({
                    accessToken: gAccessToken,
                    customerId: acct.id,
                    loginCustomerId: acct.mcc,
                    startDate, endDate,
                });
                stats.google_ads.rows_fetched += rows.length;
                stats.google_ads.accounts[acct.id] = rows.length;
                if (rows.length) {
                    const bodies = rows.map(r => ({
                        tenant_id: TENANT,
                        platform: 'google_ads',
                        account_id: acct.id,
                        campaign_id: r.campaign_id,
                        campaign_name: r.campaign_name,
                        ad_group_id: null,
                        ad_group_name: null,
                        date: r.date,
                        spend: r.cost,
                        impressions: r.impressions,
                        clicks: r.clicks,
                        conversions: r.conversions,
                        raw: r,
                    }));
                    // upsert via the unique index on (tenant_id, platform, account_id, campaign_id, ad_group_id, date)
                    for (let i = 0; i < bodies.length; i += 100) {
                        const chunk = bodies.slice(i, i + 100);
                        const { error } = await supabase
                            .from('ag2020_ad_spend_daily')
                            .upsert(chunk, {
                                onConflict: 'tenant_id,platform,account_id,campaign_id,date',
                            });
                        if (error) stats.google_ads.errors.push(`acct ${acct.id} upsert: ${error.message}`);
                        else stats.google_ads.rows_upserted += chunk.length;
                    }
                }
            } catch (e) {
                stats.google_ads.errors.push(`acct ${acct.id}: ${e.message}`);
            }
        }
    } catch (e) {
        stats.google_ads.errors.push(`auth: ${e.message}`);
    }

    // -------------------------------------------------------------------
    // Meta Ads — pull daily per-campaign cost
    // -------------------------------------------------------------------
    try {
        const mAccessToken = await getMetaAdsToken(supabase);
        const rows = await fetchMetaAdsSpend({
            accessToken: mAccessToken, accountId: META_ACCOUNT_ID, startDate, endDate,
        });
        stats.meta_ads.rows_fetched = rows.length;
        if (rows.length) {
            const bodies = rows.map(r => ({
                tenant_id: TENANT,
                platform: 'meta_ads',
                account_id: META_ACCOUNT_ID,
                campaign_id: r.campaign_id,
                campaign_name: r.campaign_name,
                ad_group_id: null,
                ad_group_name: null,
                date: r.date,
                spend: r.spend,
                impressions: r.impressions,
                clicks: r.clicks,
                conversions: r.conversions,
                raw: r,
            }));
            for (let i = 0; i < bodies.length; i += 100) {
                const chunk = bodies.slice(i, i + 100);
                const { error } = await supabase
                    .from('ag2020_ad_spend_daily')
                    .upsert(chunk, {
                        onConflict: 'tenant_id,platform,account_id,campaign_id,date',
                    });
                if (error) stats.meta_ads.errors.push(`upsert: ${error.message}`);
                else stats.meta_ads.rows_upserted += chunk.length;
            }
        }
    } catch (e) {
        stats.meta_ads.errors.push(e.message);
    }

    return res.status(200).json({ status: 'success', ...stats });
}

// ---------------------------------------------------------------------------
// Google Ads helpers — OAuth via Supabase google_ads_connections
// ---------------------------------------------------------------------------

async function getGoogleAdsToken(supabase) {
    const { data: conn, error } = await supabase
        .from('google_ads_connections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    if (error || !conn) throw new Error('No google_ads_connections row');
    let token = conn.access_token;
    if (new Date(conn.token_expires_at) < new Date() && conn.refresh_token) {
        const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                refresh_token: conn.refresh_token,
                grant_type: 'refresh_token',
            }),
        });
        const j = await r.json();
        if (!j.access_token) throw new Error('refresh failed: ' + JSON.stringify(j));
        token = j.access_token;
        await supabase.from('google_ads_connections').update({
            access_token: token,
            token_expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(),
        }).eq('id', conn.id);
    }
    return token;
}

async function fetchGoogleAdsSpend({ accessToken, customerId, loginCustomerId, startDate, endDate }) {
    const query = `
        SELECT campaign.id, campaign.name, segments.date,
               metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.conversions
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `.replace(/\s+/g, ' ').trim();
    const r = await fetch(
        `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
                'login-customer-id': loginCustomerId,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        }
    );
    const text = await r.text();
    if (!r.ok) throw new Error(`GAQL ${r.status}: ${text.slice(0, 200)}`);
    const j = JSON.parse(text);
    return (j.results || []).map(row => ({
        campaign_id: String(row.campaign?.id || ''),
        campaign_name: row.campaign?.name || null,
        date: row.segments?.date,
        cost: Number(row.metrics?.costMicros || 0) / 1_000_000,
        impressions: Number(row.metrics?.impressions || 0),
        clicks: Number(row.metrics?.clicks || 0),
        conversions: Number(row.metrics?.conversions || 0),
    }));
}

// ---------------------------------------------------------------------------
// Meta Ads helpers — OAuth via Supabase meta_ads_connections
// ---------------------------------------------------------------------------

async function getMetaAdsToken(supabase) {
    const { data: conn, error } = await supabase
        .from('meta_ads_connections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    if (error || !conn) throw new Error('No meta_ads_connections row');
    return conn.access_token;
}

async function fetchMetaAdsSpend({ accessToken, accountId, startDate, endDate }) {
    const url = new URL(`${GRAPH_BASE}/${accountId}/insights`);
    url.searchParams.set('level', 'campaign');
    url.searchParams.set('time_increment', '1');
    url.searchParams.set('time_range', JSON.stringify({ since: startDate, until: endDate }));
    url.searchParams.set('fields', 'campaign_id,campaign_name,date_start,spend,impressions,clicks,actions');
    url.searchParams.set('limit', '500');
    url.searchParams.set('access_token', accessToken);

    const out = [];
    let next = url.toString();
    while (next) {
        const r = await fetch(next);
        const j = await r.json();
        if (j.error) throw new Error(`Meta ${r.status}: ${j.error.message}`);
        for (const row of j.data || []) {
            // Sum lead/purchase action_values as conversions
            let conversions = 0;
            for (const a of row.actions || []) {
                if (a.action_type === 'lead' || a.action_type === 'purchase' ||
                    a.action_type === 'lead_form_submission' ||
                    (a.action_type || '').includes('offsite_conversion.fb_pixel')) {
                    conversions += Number(a.value || 0);
                }
            }
            out.push({
                campaign_id: row.campaign_id,
                campaign_name: row.campaign_name,
                date: row.date_start,
                spend: Number(row.spend || 0),
                impressions: Number(row.impressions || 0),
                clicks: Number(row.clicks || 0),
                conversions,
            });
        }
        next = j.paging?.next || null;
    }
    return out;
}
