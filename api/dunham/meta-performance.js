/**
 * Dunham Meta Ads performance metrics
 * GET /api/dunham/meta-performance?days=28  (or startDate+endDate YYYY-MM-DD)
 *
 * Campaign-level insights + daily series for act_104149513126190.
 * Same token source as api/meta-ads/dunham-ads.js (meta_ads_connections).
 */

import { createClient } from '@supabase/supabase-js';

const AD_ACCOUNT_ID = 'act_104149513126190';
const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    let since, until;
    if (req.query.startDate && req.query.endDate) {
        since = req.query.startDate;
        until = req.query.endDate;
    } else {
        const days = [7, 28, 90].includes(parseInt(req.query.days)) ? parseInt(req.query.days) : 28;
        const end = new Date(); end.setDate(end.getDate() - 1);
        const start = new Date(end); start.setDate(start.getDate() - (days - 1));
        since = start.toISOString().split('T')[0];
        until = end.toISOString().split('T')[0];
    }

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { data: connection, error: connError } = await supabase
            .from('meta_ads_connections').select('*')
            .order('updated_at', { ascending: false }).limit(1).single();

        if (connError || !connection) {
            return res.status(200).json({ status: 'needs_auth', error: 'No Meta connection — authorize via the Ad Report first.' });
        }
        if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
            return res.status(200).json({ status: 'needs_auth', error: 'Meta token expired — re-authorize via the Ad Report.' });
        }
        const accessToken = connection.access_token;
        const timeRange = JSON.stringify({ since, until });

        const [campaignData, dailyData] = await Promise.all([
            graphGet(`${AD_ACCOUNT_ID}/insights`, {
                level: 'campaign',
                fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions',
                time_range: timeRange,
                limit: '200',
            }, accessToken),
            graphGet(`${AD_ACCOUNT_ID}/insights`, {
                level: 'account',
                fields: 'spend,impressions,clicks,actions',
                time_range: timeRange,
                time_increment: '1',
                limit: '200',
            }, accessToken),
        ]);

        const leadCount = (actions) => (actions || [])
            .filter(a => /lead|contact|find_location|click_to_call|phone/i.test(a.action_type))
            .reduce((s, a) => s + Number(a.value || 0), 0);

        const campaigns = (campaignData || []).map(r => ({
            id: r.campaign_id,
            name: r.campaign_name,
            spend: Number(r.spend || 0),
            impressions: Number(r.impressions || 0),
            clicks: Number(r.clicks || 0),
            ctr: Number(r.ctr || 0),
            cpc: Number(r.cpc || 0),
            leadActions: leadCount(r.actions),
        })).sort((a, b) => b.spend - a.spend);

        const daily = (dailyData || []).map(r => ({
            date: r.date_start,
            spend: Number(r.spend || 0),
            impressions: Number(r.impressions || 0),
            clicks: Number(r.clicks || 0),
            leadActions: leadCount(r.actions),
        })).sort((a, b) => a.date.localeCompare(b.date));

        const totals = campaigns.reduce((t, c) => ({
            spend: t.spend + c.spend,
            impressions: t.impressions + c.impressions,
            clicks: t.clicks + c.clicks,
            leadActions: t.leadActions + c.leadActions,
        }), { spend: 0, impressions: 0, clicks: 0, leadActions: 0 });

        return res.status(200).json({
            status: 'success',
            account: AD_ACCOUNT_ID,
            dateRange: { start: since, end: until },
            totals, campaigns, daily,
        });
    } catch (err) {
        return res.status(200).json({ status: 'error', error: err.message });
    }
}

async function graphGet(path, params, accessToken) {
    const url = new URL(`${GRAPH_BASE}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', accessToken);

    const results = [];
    let next = url.toString();
    while (next) {
        const data = await (await fetch(next)).json();
        if (data.error) throw new Error(`Meta: ${data.error.message}`);
        results.push(...(data.data || []));
        next = data.paging?.next || null;
    }
    return results;
}
