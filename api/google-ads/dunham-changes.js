/**
 * Google Ads - Dunham & Jones Change History
 *
 * Modes:
 *   GET /api/google-ads/dunham-changes          → Read all stored changes from Supabase
 *   GET /api/google-ads/dunham-changes?year=2026 → Read changes for a specific year
 *   GET /api/google-ads/dunham-changes?sync=true  → Fetch last 30 days from API, store, return sync result
 *
 * The change_event resource has a hard 30-day lookback limit.
 * Syncing regularly accumulates a full audit trail over time.
 */

import { createClient } from '@supabase/supabase-js';

const CUSTOMER_ID = '8408385870';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

        if (req.query.sync === 'true') {
            return await syncChanges(supabase, res);
        }
        return await readChanges(supabase, req, res);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// ─── Read from Supabase ──────────────────────────────────────────────
async function readChanges(supabase, req, res) {
    const year = parseInt(req.query.year);

    // Get date range of stored data
    const [oldest, newest, countResult] = await Promise.all([
        supabase.from('dunham_change_history').select('change_date_time').order('change_date_time', { ascending: true }).limit(1),
        supabase.from('dunham_change_history').select('change_date_time').order('change_date_time', { ascending: false }).limit(1),
        supabase.from('dunham_change_history').select('*', { count: 'exact', head: true }),
    ]);

    const totalStored = countResult.count || 0;
    const availableYears = [];
    const startYear = oldest.data?.[0] ? new Date(oldest.data[0].change_date_time).getFullYear() : null;
    const endYear = newest.data?.[0] ? new Date(newest.data[0].change_date_time).getFullYear() : null;
    if (startYear && endYear) {
        for (let y = endYear; y >= startYear; y--) availableYears.push(y);
    }

    // Fetch changes
    let query = supabase
        .from('dunham_change_history')
        .select('*')
        .order('change_date_time', { ascending: false });

    if (year) {
        query = query
            .gte('change_date_time', `${year}-01-01T00:00:00Z`)
            .lt('change_date_time', `${year + 1}-01-01T00:00:00Z`);
    }

    const { data: rows, error } = await query.limit(10000);

    if (error) {
        return res.status(500).json({ error: 'Failed to read change history', details: error.message });
    }

    const changes = (rows || []).map(row => ({
        dateTime: row.change_date_time,
        resourceType: row.resource_type,
        operation: row.operation,
        userEmail: row.user_email,
        clientType: row.client_type,
        campaignName: row.campaign_name,
        adGroupName: row.ad_group_name,
        changedFields: row.changed_fields || [],
        details: row.details,
    }));

    const typeCounts = {};
    for (const c of changes) {
        typeCounts[c.resourceType] = (typeCounts[c.resourceType] || 0) + 1;
    }

    return res.status(200).json({
        account: { id: '840-838-5870', name: 'Dunham & Jones' },
        changes,
        typeCounts,
        availableYears,
        totalStored,
        year: year || null,
        fetchedAt: new Date().toISOString(),
    });
}

// ─── Sync: fetch from Google Ads API, store in Supabase ──────────────
async function syncChanges(supabase, res) {
    // Auth
    const { data: connection, error: connError } = await supabase
        .from('google_ads_connections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (connError || !connection) {
        return res.status(500).json({ error: 'No Google Ads connection found.' });
    }

    let accessToken = connection.access_token;

    if (new Date(connection.token_expires_at) < new Date() && connection.refresh_token) {
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                refresh_token: connection.refresh_token,
                grant_type: 'refresh_token',
            }),
        });

        const refreshData = await refreshResponse.json();
        if (refreshData.access_token) {
            accessToken = refreshData.access_token;
            await supabase
                .from('google_ads_connections')
                .update({
                    access_token: accessToken,
                    token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
                })
                .eq('id', connection.id);
        } else {
            return res.status(500).json({ error: 'Token refresh failed', details: refreshData });
        }
    }

    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': CUSTOMER_ID,
        'Content-Type': 'application/json',
    };

    // Fetch last 30 days (hard API limit)
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 29);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = now.toISOString().split('T')[0];

    const changesData = await fetchQuery(CUSTOMER_ID, headers, `
        SELECT
            change_event.resource_name,
            change_event.change_date_time,
            change_event.change_resource_type,
            change_event.resource_change_operation,
            change_event.user_email,
            change_event.client_type,
            change_event.changed_fields,
            change_event.old_resource,
            change_event.new_resource,
            campaign.name,
            ad_group.name
        FROM change_event
        WHERE change_event.change_date_time >= '${startStr}' AND change_event.change_date_time <= '${endStr}'
        ORDER BY change_event.change_date_time DESC
        LIMIT 10000
    `);

    if (changesData.error) {
        return res.status(500).json({ error: 'API query failed', details: changesData.error });
    }

    const rows = changesData.results || [];
    const records = rows.map(row => {
        const evt = row.changeEvent || {};
        const campaign = row.campaign || {};
        const adGroup = row.adGroup || {};

        return {
            id: evt.resourceName,
            change_date_time: normalizeDateTime(evt.changeDateTime),
            resource_type: evt.changeResourceType || 'UNKNOWN',
            operation: evt.resourceChangeOperation || 'UNKNOWN',
            user_email: evt.userEmail || null,
            client_type: evt.clientType || null,
            campaign_name: campaign.name || null,
            ad_group_name: adGroup.name || null,
            changed_fields: parseChangedFields(evt.changedFields),
            details: extractDetails(evt),
        };
    }).filter(r => r.id);

    // Batch upsert to Supabase
    let stored = 0;
    const BATCH_SIZE = 500;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const { error: upsertError } = await supabase
            .from('dunham_change_history')
            .upsert(batch, { onConflict: 'id' });

        if (upsertError) {
            return res.status(500).json({
                error: 'Failed to store changes',
                details: upsertError.message,
                storedSoFar: stored,
            });
        }
        stored += batch.length;
    }

    return res.status(200).json({
        success: true,
        synced: stored,
        dateRange: { start: startStr, end: endStr },
        message: `Synced ${stored} changes from ${startStr} to ${endStr}`,
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function fetchQuery(customerId, headers, query) {
    try {
        const response = await fetch(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ query }),
            }
        );

        const data = await response.json();
        if (data.error) {
            const details = data.error.details
                ? data.error.details.map(d => JSON.stringify(d)).join('; ')
                : '';
            const msg = `${data.error.message || 'Unknown error'}${details ? ' | ' + details : ''} [status: ${data.error.status || data.error.code}]`;
            return { error: msg, query: query.trim() };
        }
        return { results: data.results || [] };
    } catch (e) {
        return { error: e.message, query: query.trim() };
    }
}

function normalizeDateTime(dt) {
    if (!dt) return null;
    // Google Ads returns "2026-03-27 14:30:00.000000" — normalize to ISO
    let iso = dt.replace(' ', 'T');
    // Trim microseconds beyond ms precision
    iso = iso.replace(/(\.\d{3})\d*/, '$1');
    // Add Z if no timezone
    if (!iso.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(iso)) {
        iso += 'Z';
    }
    return iso;
}

function parseChangedFields(fieldMask) {
    if (!fieldMask) return [];
    if (typeof fieldMask === 'string') {
        return fieldMask.split(',').map(f => f.trim()).filter(Boolean);
    }
    if (fieldMask.paths) return fieldMask.paths;
    return [];
}

function extractDetails(evt) {
    const details = {};
    const oldRes = evt.oldResource || {};
    const newRes = evt.newResource || {};
    const resourceType = evt.changeResourceType || '';

    if (resourceType === 'CAMPAIGN') {
        const oldCamp = oldRes.campaign || {};
        const newCamp = newRes.campaign || {};
        if (oldCamp.name !== newCamp.name && (oldCamp.name || newCamp.name)) {
            details.name = { old: oldCamp.name, new: newCamp.name };
        }
        if (oldCamp.status !== newCamp.status && (oldCamp.status || newCamp.status)) {
            details.status = { old: oldCamp.status, new: newCamp.status };
        }
        if (oldCamp.campaignBudget || newCamp.campaignBudget) {
            details.budget = { old: oldCamp.campaignBudget, new: newCamp.campaignBudget };
        }
    }

    if (resourceType === 'AD') {
        const oldAd = oldRes.ad || {};
        const newAd = newRes.ad || {};
        const oldRsa = oldAd.responsiveSearchAd || {};
        const newRsa = newAd.responsiveSearchAd || {};

        if (oldRsa.headlines || newRsa.headlines) {
            const oldH = (oldRsa.headlines || []).map(h => h.text);
            const newH = (newRsa.headlines || []).map(h => h.text);
            if (JSON.stringify(oldH) !== JSON.stringify(newH)) {
                details.headlines = { old: oldH, new: newH };
            }
        }
        if (oldRsa.descriptions || newRsa.descriptions) {
            const oldD = (oldRsa.descriptions || []).map(d => d.text);
            const newD = (newRsa.descriptions || []).map(d => d.text);
            if (JSON.stringify(oldD) !== JSON.stringify(newD)) {
                details.descriptions = { old: oldD, new: newD };
            }
        }
        if (oldAd.status !== newAd.status && (oldAd.status || newAd.status)) {
            details.status = { old: oldAd.status, new: newAd.status };
        }
    }

    if (resourceType === 'AD_GROUP') {
        const oldAg = oldRes.adGroup || {};
        const newAg = newRes.adGroup || {};
        if (oldAg.name !== newAg.name && (oldAg.name || newAg.name)) {
            details.name = { old: oldAg.name, new: newAg.name };
        }
        if (oldAg.status !== newAg.status && (oldAg.status || newAg.status)) {
            details.status = { old: oldAg.status, new: newAg.status };
        }
        if (oldAg.cpcBidMicros !== newAg.cpcBidMicros && (oldAg.cpcBidMicros || newAg.cpcBidMicros)) {
            details.cpcBid = {
                old: oldAg.cpcBidMicros ? (Number(oldAg.cpcBidMicros) / 1000000).toFixed(2) : null,
                new: newAg.cpcBidMicros ? (Number(newAg.cpcBidMicros) / 1000000).toFixed(2) : null,
            };
        }
    }

    if (resourceType === 'AD_GROUP_CRITERION') {
        const oldCrit = oldRes.adGroupCriterion || {};
        const newCrit = newRes.adGroupCriterion || {};
        const oldKw = oldCrit.keyword || {};
        const newKw = newCrit.keyword || {};
        if (oldKw.text || newKw.text) {
            details.keyword = { text: newKw.text || oldKw.text, matchType: newKw.matchType || oldKw.matchType };
        }
        if (oldCrit.negative !== undefined || newCrit.negative !== undefined) {
            details.negative = newCrit.negative || oldCrit.negative || false;
        }
        if (oldCrit.cpcBidMicros !== newCrit.cpcBidMicros && (oldCrit.cpcBidMicros || newCrit.cpcBidMicros)) {
            details.cpcBid = {
                old: oldCrit.cpcBidMicros ? (Number(oldCrit.cpcBidMicros) / 1000000).toFixed(2) : null,
                new: newCrit.cpcBidMicros ? (Number(newCrit.cpcBidMicros) / 1000000).toFixed(2) : null,
            };
        }
    }

    if (resourceType === 'CAMPAIGN_BUDGET') {
        const oldBudget = oldRes.campaignBudget || {};
        const newBudget = newRes.campaignBudget || {};
        if (oldBudget.amountMicros || newBudget.amountMicros) {
            details.dailyBudget = {
                old: oldBudget.amountMicros ? (Number(oldBudget.amountMicros) / 1000000).toFixed(2) : null,
                new: newBudget.amountMicros ? (Number(newBudget.amountMicros) / 1000000).toFixed(2) : null,
            };
        }
    }

    if (resourceType === 'CAMPAIGN_CRITERION') {
        const oldCrit = oldRes.campaignCriterion || {};
        const newCrit = newRes.campaignCriterion || {};
        const oldKw = oldCrit.keyword || {};
        const newKw = newCrit.keyword || {};
        if (oldKw.text || newKw.text) {
            details.keyword = { text: newKw.text || oldKw.text, matchType: newKw.matchType || oldKw.matchType };
        }
    }

    return Object.keys(details).length > 0 ? details : null;
}
