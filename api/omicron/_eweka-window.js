/**
 * Shared logic for the one-time Eweka ad-pause window (2026-08-20, 9:30am–1:00pm ET).
 * Used by eweka-pause.js and eweka-resume.js — underscore prefix keeps this from
 * deploying as its own route (same convention as api/_platform/).
 *
 * Approach: pause = find ENABLED campaigns, tag them with LABEL, set PAUSED.
 * resume = find PAUSED campaigns carrying LABEL, set ENABLED, untag. The label is
 * the state store — resume touches only campaigns this window paused, never ones
 * that were already paused for other reasons. Both directions are idempotent, so
 * the double cron firings (retry 10 min later) are safe.
 */

import { createClient } from '@supabase/supabase-js';

export const EWEKA = { id: '7079118680', mcc: '8086957043' };
export const WINDOW_DATE = '2026-08-20'; // UTC date gate — crons repeat yearly, this doesn't
export const LABEL = 'TEMP-PAUSE-2026-08-20';
const ALERT_TO = 'kenny@hyder.me';

async function getAccessToken() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
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

function adsHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        'developer-token': (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim(),
        'login-customer-id': EWEKA.mcc,
        'Content-Type': 'application/json',
    };
}

async function gaql(token, query) {
    const r = await fetch(`https://googleads.googleapis.com/v23/customers/${EWEKA.id}/googleAds:search`, {
        method: 'POST', headers: adsHeaders(token), body: JSON.stringify({ query }),
    });
    const d = await r.json();
    if (d.error) throw new Error('gaql: ' + JSON.stringify(d.error).slice(0, 300));
    return d.results || [];
}

async function mutate(token, endpoint, body) {
    const r = await fetch(`https://googleads.googleapis.com/v23/customers/${EWEKA.id}/${endpoint}:mutate`, {
        method: 'POST', headers: adsHeaders(token), body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.error) throw new Error(`${endpoint}: ` + JSON.stringify(d.error).slice(0, 300));
    return d;
}

async function email(subject, text) {
    const apiKey = (process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) return;
    await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Omicron Ads Window <alerts@hyder.me>', to: [ALERT_TO], subject, text }),
    }).catch(() => {});
}

async function ensureLabel(token) {
    const rows = await gaql(token, `SELECT label.id, label.resource_name FROM label WHERE label.name = '${LABEL}'`);
    if (rows.length) return rows[0].label.resourceName;
    const d = await mutate(token, 'labels', { operations: [{ create: { name: LABEL } }] });
    return d.results[0].resourceName;
}

async function runPause(token, validateOnly) {
    // BASE only: experiment (trial) campaigns reject direct status mutations, and
    // Google stops serving an experiment automatically when its base is paused.
    const enabled = await gaql(token,
        `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.experiment_type = 'BASE'`);
    if (!enabled.length) return { action: 'pause', validateOnly, campaigns: [], note: 'no ENABLED campaigns (already paused?)' };

    const ops = enabled.map(r => ({
        updateMask: 'status',
        update: { resourceName: r.campaign.resourceName, status: 'PAUSED' },
    }));

    if (!validateOnly) {
        const labelRes = await ensureLabel(token);
        // Tag BEFORE pausing so a partial failure leaves labeled-but-enabled
        // campaigns that the retry firing picks up. partialFailure tolerates
        // already-tagged duplicates on retry.
        await mutate(token, 'campaignLabels', {
            operations: enabled.map(r => ({ create: { campaign: r.campaign.resourceName, label: labelRes } })),
            partialFailure: true,
        });
    }
    await mutate(token, 'campaigns', { operations: ops, ...(validateOnly ? { validateOnly: true } : {}) });
    return { action: 'pause', validateOnly, campaigns: enabled.map(r => r.campaign.name) };
}

async function runResume(token, validateOnly) {
    const tagged = await gaql(token, `
        SELECT campaign.id, campaign.name, label.id FROM campaign_label
        WHERE label.name = '${LABEL}' AND campaign.status = 'PAUSED'`);
    if (!tagged.length) return { action: 'resume', validateOnly, campaigns: [], note: 'no labeled paused campaigns (already resumed?)' };

    await mutate(token, 'campaigns', {
        operations: tagged.map(r => ({
            updateMask: 'status',
            update: { resourceName: `customers/${EWEKA.id}/campaigns/${r.campaign.id}`, status: 'ENABLED' },
        })),
        ...(validateOnly ? { validateOnly: true } : {}),
    });
    if (!validateOnly) {
        await mutate(token, 'campaignLabels', {
            operations: tagged.map(r => ({ remove: `customers/${EWEKA.id}/campaignLabels/${r.campaign.id}~${r.label.id}` })),
            partialFailure: true,
        });
    }
    return { action: 'resume', validateOnly, campaigns: tagged.map(r => r.campaign.name) };
}

export async function handleWindow(req, res, action) {
    const secret = (process.env.CRON_SECRET || '').trim();
    const auth = req.headers.authorization || '';
    // Fail closed: reject when CRON_SECRET is missing or the header doesn't match.
    if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });

    const validateOnly = req.query?.validate === '1';
    const force = req.query?.force === '1';
    const today = new Date().toISOString().slice(0, 10);
    if (today !== WINDOW_DATE && !validateOnly && !force) {
        return res.status(200).json({ ok: true, skipped: `date gate: today ${today} != ${WINDOW_DATE}` });
    }

    try {
        const token = await getAccessToken();
        const result = action === 'pause' ? await runPause(token, validateOnly) : await runResume(token, validateOnly);
        if (!validateOnly) {
            const n = result.campaigns.length;
            await email(
                n ? `✅ Eweka ads ${action}d: ${n} campaign${n === 1 ? '' : 's'}` : `ℹ️ Eweka ${action}: nothing to do`,
                `${result.note || `${action} executed at ${new Date().toISOString()} (window ${WINDOW_DATE} 9:30am–1pm ET).`}\n\n${result.campaigns.map(c => '  · ' + c).join('\n')}`
            );
        }
        return res.status(200).json({ ok: true, ...result });
    } catch (e) {
        if (!validateOnly) await email(`🚨 Eweka ${action} FAILED`, `${e.message}\n\nRetry firing runs 10 min after the first; if this is the second failure, intervene manually in Google Ads.`);
        return res.status(500).json({ error: e.message });
    }
}
