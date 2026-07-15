/**
 * Shared Google auth + GSC helpers for the Dunham maps initiative.
 * Reuses the kenny@hyder.me OAuth connection stored in google_ads_connections
 * (scopes: adwords, webmasters.readonly, business.manage).
 *
 * Dunham must grant kenny@hyder.me access to their GSC property / GA4
 * property / GBP location group before these return data — every caller
 * handles the not-yet-granted case explicitly.
 */

import { createClient } from '@supabase/supabase-js';

export function supabase() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export async function getGoogleAccessToken(sb, table = 'google_ads_connections') {
    const { data: connection, error } = await sb
        .from(table).select('*')
        .order('created_at', { ascending: false }).limit(1).single();

    if (error || !connection) throw new Error(`No Google connection found in ${table}`);

    let accessToken = connection.access_token;
    if (new Date(connection.token_expires_at) < new Date() && connection.refresh_token) {
        const resp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                refresh_token: connection.refresh_token,
                grant_type: 'refresh_token',
            }),
        });
        const data = await resp.json();
        if (!data.access_token) throw new Error('Token refresh failed');
        accessToken = data.access_token;
        await sb.from(table).update({
            access_token: accessToken,
            token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        }).eq('id', connection.id);
    }
    return accessToken;
}

/**
 * Find the GSC property for dunhamlaw.com on the current token.
 * Accepts either the domain property (sc-domain:dunhamlaw.com) or a
 * URL-prefix property — whichever Dunham granted.
 * Returns { siteUrl, permissionLevel } or null if not granted yet.
 */
export async function resolveDunhamGscProperty(accessToken) {
    const resp = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const data = await resp.json();
    if (data.error) throw new Error(`GSC sites list: ${data.error.message}`);
    const sites = data.siteEntry || [];
    const match = sites.find(s => s.siteUrl === 'sc-domain:dunhamlaw.com')
        || sites.find(s => /dunhamlaw\.com/i.test(s.siteUrl));
    if (!match || match.permissionLevel === 'siteUnverifiedUser') return null;
    return { siteUrl: match.siteUrl, permissionLevel: match.permissionLevel };
}

export async function gscQuery(accessToken, siteUrl, body) {
    const resp = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }
    );
    const data = await resp.json();
    if (data.error) throw new Error(`GSC API: ${data.error.message || JSON.stringify(data.error)}`);
    return data.rows || [];
}

// GSC data lags ~2 days. Returns {startDate, endDate} for an N-day window
// ending 2 days ago.
export function gscWindow(days) {
    const end = new Date();
    end.setDate(end.getDate() - 2);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
    };
}

export const BAIL_REGEX = 'bail|bondsman|bonds|bonding|fianza|jail release|jail-release';
