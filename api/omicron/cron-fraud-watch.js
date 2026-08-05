/**
 * Omicron Click-Fraud Watch — monthly canary for ClickCease-off monitoring
 * GET /api/omicron/cron-fraud-watch   (cron: 3rd of month, 18:00 UTC / 8am HST)
 *
 * Context: ClickCease was disabled on all accounts in Feb 2026. Analysis
 * (2026-08-05) found no fraud signal, so it stays off — this cron is the
 * ongoing tripwire. For each account it compares the last full month against
 * the trailing 6-month baseline on the two signals that would show fraud
 * Google isn't already filtering:
 *   1. invalid click rate (Google-filtered junk; rises if fraud attempts ramp)
 *   2. SEARCH-network conversion rate (paid junk clicks that never convert;
 *      search-only so YouTube/Demand Gen mix shifts can't fake a decay)
 * Always emails the digest to kenny@ (silence never means "unknown");
 * subject carries 🚨 + flag count when a threshold trips.
 *
 * ?dry=1 returns the JSON payload without emailing (still needs CRON_SECRET).
 */

import { createClient } from '@supabase/supabase-js';

const ACCOUNTS = [
    { id: '7079118680', name: 'Eweka', mcc: '8086957043' },
    { id: '5380661321', name: 'Easynews', mcc: '8086957043' },
    { id: '7566341629', name: 'Newshosting', mcc: '8086957043' },
    { id: '3972303325', name: 'UsenetServer', mcc: '8086957043' },
    { id: '1146581474', name: 'Tweak', mcc: '8086957043' },
    { id: '1721346287', name: 'Pure', mcc: '8086957043' },
    { id: '8908689985', name: 'Sunny', mcc: '8086957043' },
    { id: '4413390727', name: 'BUR', mcc: '6736988718' },
    { id: '1478467425', name: 'Top10usenet', mcc: '1478467425' },
    { id: '6759792960', name: 'Privado', mcc: '2031897556' },
];

// Flag thresholds — tuned against Feb25–Jul26 history where normal month-to-month
// swing was well inside these bounds (e.g. Top10 invalid rate ranged 3.3–11.2%
// with ClickCease ON). Volume floors keep low-spend accounts (Sunny/Pure) from
// generating small-number noise.
const INV_RATIO = 1.5;        // invalid rate > 1.5x baseline...
const INV_ABS_PTS = 2;        // ...AND more than 2 points above it
const INV_MIN_CLICKS = 500;   // total (valid+invalid) clicks in target month
const CONV_RATIO = 0.65;      // search conv rate < 65% of baseline
const CONV_MIN_CLICKS = 300;  // search clicks in target month

const ALERT_TO = 'kenny@hyder.me';

function monthKey(d) { return d.toISOString().slice(0, 7); }

// Last full month + the 6 months before it, as YYYY-MM keys and a date range.
function windows(now) {
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const baseline = [];
    for (let i = 7; i >= 2; i--) {
        baseline.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
    }
    const start = `${baseline[0]}-01`;
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { targetKey: monthKey(target), baseline, start, end: endDate.toISOString().slice(0, 10) };
}

async function getAccessToken(supabase) {
    const { data: conn, error } = await supabase
        .from('google_ads_connections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    if (error || !conn) throw new Error('no google_ads_connections row');
    if (new Date(conn.token_expires_at) > new Date(Date.now() + 60000)) return conn.access_token;
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
    const d = await r.json();
    if (!d.access_token) throw new Error('token refresh failed');
    await supabase.from('google_ads_connections').update({
        access_token: d.access_token,
        token_expires_at: new Date(Date.now() + d.expires_in * 1000).toISOString(),
    }).eq('id', conn.id);
    return d.access_token;
}

async function gaql(customerId, mcc, token, query) {
    let results = [];
    let pageToken;
    do {
        let d;
        // Google Ads intermittently returns 500 INTERNAL on healthy queries —
        // one retry after a short pause clears virtually all of them.
        for (let attempt = 0; ; attempt++) {
            const r = await fetch(`https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'developer-token': (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim(),
                    'login-customer-id': mcc,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
            });
            d = await r.json();
            if (d.error && d.error.code === 500 && attempt === 0) {
                await new Promise(rr => setTimeout(rr, 2000));
                continue;
            }
            break;
        }
        if (d.error) throw new Error(JSON.stringify(d.error).slice(0, 200));
        results = results.concat(d.results || []);
        pageToken = d.nextPageToken;
    } while (pageToken);
    return results;
}

function aggInv(rows) {
    const t = rows.reduce((s, r) => {
        s.clicks += Number(r.metrics.clicks || 0);
        s.inv += Number(r.metrics.invalidClicks || 0);
        s.cost += Number(r.metrics.costMicros || 0) / 1e6;
        return s;
    }, { clicks: 0, inv: 0, cost: 0 });
    t.invRate = (t.clicks + t.inv) ? t.inv / (t.clicks + t.inv) : 0;
    return t;
}

function aggSearch(rows) {
    const t = rows.reduce((s, r) => {
        if (r.segments.adNetworkType !== 'SEARCH') return s;
        s.clicks += Number(r.metrics.clicks || 0);
        s.conv += Number(r.metrics.conversions || 0);
        return s;
    }, { clicks: 0, conv: 0 });
    t.convRate = t.clicks ? t.conv / t.clicks : 0;
    return t;
}

async function checkAccount(acc, token, win) {
    const monthly = await gaql(acc.id, acc.mcc, token, `
        SELECT segments.month, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros
        FROM customer
        WHERE segments.date BETWEEN '${win.start}' AND '${win.end}'`);
    const network = await gaql(acc.id, acc.mcc, token, `
        SELECT segments.month, segments.ad_network_type, metrics.clicks, metrics.conversions
        FROM customer
        WHERE segments.date BETWEEN '${win.start}' AND '${win.end}'`);

    const inMonths = (rows, keys) => rows.filter(r => keys.includes(r.segments.month.slice(0, 7)));
    const tgtInv = aggInv(inMonths(monthly, [win.targetKey]));
    const baseInv = aggInv(inMonths(monthly, win.baseline));
    const tgtSearch = aggSearch(inMonths(network, [win.targetKey]));
    const baseSearch = aggSearch(inMonths(network, win.baseline));

    const flags = [];
    if (tgtInv.clicks + tgtInv.inv >= INV_MIN_CLICKS &&
        tgtInv.invRate > baseInv.invRate * INV_RATIO &&
        (tgtInv.invRate - baseInv.invRate) * 100 > INV_ABS_PTS) {
        flags.push(`invalid click rate ${(tgtInv.invRate * 100).toFixed(1)}% vs ${(baseInv.invRate * 100).toFixed(1)}% baseline`);
    }
    if (tgtSearch.clicks >= CONV_MIN_CLICKS && baseSearch.convRate > 0 &&
        tgtSearch.convRate < baseSearch.convRate * CONV_RATIO) {
        flags.push(`search conv rate ${(tgtSearch.convRate * 100).toFixed(2)}% vs ${(baseSearch.convRate * 100).toFixed(2)}% baseline`);
    }

    return {
        name: acc.name,
        spend: Math.round(tgtInv.cost),
        clicks: tgtInv.clicks,
        invRate: +(tgtInv.invRate * 100).toFixed(2),
        invRateBaseline: +(baseInv.invRate * 100).toFixed(2),
        searchConvRate: +(tgtSearch.convRate * 100).toFixed(2),
        searchConvRateBaseline: +(baseSearch.convRate * 100).toFixed(2),
        flags,
    };
}

async function sendDigest(win, rows, errors) {
    const apiKey = (process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) return { ok: false, error: 'RESEND_API_KEY missing' };
    const flagged = rows.filter(r => r.flags.length);
    const subject = flagged.length
        ? `🚨 Omicron fraud watch ${win.targetKey}: ${flagged.length} account${flagged.length > 1 ? 's' : ''} flagged`
        : `✅ Omicron fraud watch ${win.targetKey}: all clear`;
    const lines = rows.map(r => {
        const flag = r.flags.length ? `  ⚠️ ${r.flags.join('; ')}` : '';
        return `${r.name.padEnd(13)} $${String(r.spend).padStart(6)}  inv ${r.invRate}% (base ${r.invRateBaseline}%)  search-conv ${r.searchConvRate}% (base ${r.searchConvRateBaseline}%)${flag}`;
    });
    const text = [
        `Click-fraud tripwire for ${win.targetKey} vs trailing 6-month baseline (${win.baseline[0]}..${win.baseline[5]}).`,
        `ClickCease has been OFF since Feb 2026 — this digest is the ongoing check that its absence isn't costing anything.`,
        '',
        ...lines,
        '',
        flagged.length
            ? 'Flag thresholds: invalid rate >1.5x baseline AND +2pts; search conv rate <65% of baseline. Investigate flagged accounts (geo/device/hour click reports) before considering re-enabling ClickCease.'
            : 'No fraud signal. Signals: Google invalid click rate (junk attempts) and SEARCH-only conversion rate (paid junk Google missed).',
        errors.length ? `\nPull errors: ${errors.map(e => `${e.name}: ${e.error}`).join(' | ')}` : '',
    ].join('\n');
    const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: 'Omicron Fraud Watch <alerts@hyder.me>',
            to: [ALERT_TO],
            subject,
            text,
        }),
    });
    return r.ok ? { ok: true } : { ok: false, error: `resend ${r.status}` };
}

export default async function handler(req, res) {
    const secret = (process.env.CRON_SECRET || '').trim();
    const auth = req.headers.authorization || '';
    // Fail closed: reject when CRON_SECRET is missing or the header doesn't match.
    if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });

    const win = windows(new Date());
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const rows = [];
    const errors = [];
    try {
        const token = await getAccessToken(supabase);
        for (const acc of ACCOUNTS) {
            try {
                rows.push(await checkAccount(acc, token, win));
            } catch (e) {
                errors.push({ name: acc.name, error: e.message });
            }
        }
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }

    const payload = { targetMonth: win.targetKey, baseline: win.baseline, accounts: rows, errors };
    if (req.query?.dry === '1') return res.status(200).json(payload);

    const sent = await sendDigest(win, rows, errors);
    return res.status(200).json({ ...payload, email: sent });
}
