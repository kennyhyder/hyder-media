/**
 * Google Ads - Dunham & Jones Change History
 * GET /api/google-ads/dunham-changes
 *
 * Fetches change_event data for account 840-838-5870
 * Note: Google Ads API limits change_event to last 30 days, max 10,000 rows
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
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Get most recent connection
        const { data: connection, error: connError } = await supabase
            .from('google_ads_connections')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (connError || !connection) {
            return res.status(500).json({ error: 'No Google Ads connection found. Please authorize first.' });
        }

        let accessToken = connection.access_token;

        // Refresh token if expired
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

        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'login-customer-id': CUSTOMER_ID,
            'Content-Type': 'application/json',
        };

        // Use explicit date range — LAST_30_DAYS can trigger START_DATE_TOO_OLD
        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 29);
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = now.toISOString().split('T')[0];

        const changesData = await fetchQuery(CUSTOMER_ID, headers, `
            SELECT
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
            return res.status(500).json({ error: 'Change history query failed', details: changesData.error, query: changesData.query });
        }

        const response = buildChangesResponse(changesData.results || []);
        return res.status(200).json(response);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

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

function buildChangesResponse(rows) {
    const changes = rows.map(row => {
        const evt = row.changeEvent || {};
        const campaign = row.campaign || {};
        const adGroup = row.adGroup || {};

        const change = {
            dateTime: evt.changeDateTime || null,
            resourceType: evt.changeResourceType || 'UNKNOWN',
            operation: evt.resourceChangeOperation || 'UNKNOWN',
            userEmail: evt.userEmail || null,
            clientType: evt.clientType || null,
            campaignName: campaign.name || null,
            adGroupName: adGroup.name || null,
            changedFields: parseChangedFields(evt.changedFields),
            details: extractDetails(evt),
        };

        return change;
    });

    // Count by resource type
    const typeCounts = {};
    for (const c of changes) {
        typeCounts[c.resourceType] = (typeCounts[c.resourceType] || 0) + 1;
    }

    return {
        account: { id: '840-838-5870', name: 'Dunham & Jones' },
        changes,
        typeCounts,
        fetchedAt: new Date().toISOString(),
        note: 'Change history limited to last 30 days by Google Ads API',
    };
}

function parseChangedFields(fieldMask) {
    if (!fieldMask) return [];
    // field mask comes as a comma-separated string of field paths
    if (typeof fieldMask === 'string') {
        return fieldMask.split(',').map(f => f.trim()).filter(Boolean);
    }
    // If it comes as an object with paths property
    if (fieldMask.paths) return fieldMask.paths;
    return [];
}

function extractDetails(evt) {
    const details = {};
    const oldRes = evt.oldResource || {};
    const newRes = evt.newResource || {};
    const resourceType = evt.changeResourceType || '';

    // Campaign changes
    if (resourceType === 'CAMPAIGN') {
        const oldCamp = oldRes.campaign || {};
        const newCamp = newRes.campaign || {};
        if (oldCamp.name || newCamp.name) {
            if (oldCamp.name !== newCamp.name) {
                details.name = { old: oldCamp.name, new: newCamp.name };
            }
        }
        if (oldCamp.status || newCamp.status) {
            if (oldCamp.status !== newCamp.status) {
                details.status = { old: oldCamp.status, new: newCamp.status };
            }
        }
        if (oldCamp.campaignBudget || newCamp.campaignBudget) {
            details.budget = { old: oldCamp.campaignBudget, new: newCamp.campaignBudget };
        }
    }

    // Ad changes
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
        if (oldAd.status || newAd.status) {
            if (oldAd.status !== newAd.status) {
                details.status = { old: oldAd.status, new: newAd.status };
            }
        }
    }

    // Ad Group changes
    if (resourceType === 'AD_GROUP') {
        const oldAg = oldRes.adGroup || {};
        const newAg = newRes.adGroup || {};
        if (oldAg.name || newAg.name) {
            if (oldAg.name !== newAg.name) {
                details.name = { old: oldAg.name, new: newAg.name };
            }
        }
        if (oldAg.status || newAg.status) {
            if (oldAg.status !== newAg.status) {
                details.status = { old: oldAg.status, new: newAg.status };
            }
        }
        if (oldAg.cpcBidMicros || newAg.cpcBidMicros) {
            if (oldAg.cpcBidMicros !== newAg.cpcBidMicros) {
                details.cpcBid = {
                    old: oldAg.cpcBidMicros ? (Number(oldAg.cpcBidMicros) / 1000000).toFixed(2) : null,
                    new: newAg.cpcBidMicros ? (Number(newAg.cpcBidMicros) / 1000000).toFixed(2) : null,
                };
            }
        }
    }

    // Keyword changes
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
        if (oldCrit.cpcBidMicros || newCrit.cpcBidMicros) {
            if (oldCrit.cpcBidMicros !== newCrit.cpcBidMicros) {
                details.cpcBid = {
                    old: oldCrit.cpcBidMicros ? (Number(oldCrit.cpcBidMicros) / 1000000).toFixed(2) : null,
                    new: newCrit.cpcBidMicros ? (Number(newCrit.cpcBidMicros) / 1000000).toFixed(2) : null,
                };
            }
        }
    }

    // Campaign Budget changes
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

    // Campaign Criterion (campaign-level targeting/negatives)
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
