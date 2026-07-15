/**
 * Dunham Maps Initiative — connection status probe
 * GET /api/dunham/connections
 *
 * Reports whether the kenny@hyder.me Google identity currently has access to
 * each Dunham data source needed for the maps initiative:
 *   - gsc:  Search Console property for dunhamlaw.com
 *   - gbp:  a Business Profile account/location group containing Dunham offices
 *   - ga4:  a GA4 property for dunhamlaw.com
 *   - ads:  Google Ads (via MCC — expected always connected)
 *
 * Each block includes a `grant` hint describing what the client must do when
 * not yet connected. Safe to poll from the dashboard.
 */

import { supabase, getGoogleAccessToken, resolveDunhamGscProperty } from './_google.js';

const IDENTITY = 'kenny@hyder.me';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const sb = supabase();
    const out = {
        identity: IDENTITY,
        checkedAt: new Date().toISOString(),
        gsc: { connected: false },
        gbp: { connected: false },
        ga4: { connected: false },
        ads: { connected: true, note: 'Google Ads account 840-838-5870 via MCC (existing Ad Report integration)' },
    };

    // --- GSC + GBP share the google_ads_connections token ---
    let token = null;
    try {
        token = await getGoogleAccessToken(sb);
    } catch (err) {
        out.gsc = { connected: false, error: err.message };
        out.gbp = { connected: false, error: err.message };
    }

    if (token) {
        try {
            const prop = await resolveDunhamGscProperty(token);
            if (prop) {
                out.gsc = { connected: true, property: prop.siteUrl, permission: prop.permissionLevel };
            } else {
                out.gsc = {
                    connected: false,
                    grant: `In Search Console for dunhamlaw.com: Settings → Users and permissions → Add user → ${IDENTITY} (Full). Prefer the domain property (sc-domain:dunhamlaw.com).`,
                };
            }
        } catch (err) {
            out.gsc = { connected: false, error: err.message };
        }

        try {
            const headers = { 'Authorization': `Bearer ${token}` };
            const acctResp = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers });
            const acctData = await acctResp.json();
            if (acctData.error) throw new Error(acctData.error.message);
            const accounts = acctData.accounts || [];
            const dunhamAccounts = accounts.filter(a => /dunham/i.test(a.accountName || ''));
            // Look for Dunham locations in any accessible account (they may share
            // a location group whose name doesn't say "Dunham").
            let dunhamLocations = [];
            for (const acct of accounts.slice(0, 5)) {
                const locResp = await fetch(
                    `https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`,
                    { headers }
                );
                const locData = await locResp.json();
                const locs = (locData.locations || []).filter(l => /dunham/i.test(l.title || ''));
                dunhamLocations.push(...locs.map(l => ({
                    name: l.name,
                    title: l.title,
                    city: l.storefrontAddress?.locality || null,
                    account: acct.accountName,
                })));
            }
            if (dunhamAccounts.length > 0 || dunhamLocations.length > 0) {
                out.gbp = {
                    connected: true,
                    accounts: accounts.map(a => a.accountName),
                    dunhamLocationCount: dunhamLocations.length,
                    dunhamLocations,
                };
            } else {
                out.gbp = {
                    connected: false,
                    visibleAccounts: accounts.map(a => a.accountName),
                    grant: `In business.google.com (the account owning Dunham's office profiles): Businesses → select all locations (or the location group) → add ${IDENTITY} as Manager.`,
                };
            }
        } catch (err) {
            out.gbp = { connected: false, error: err.message };
        }
    }

    // --- GA4 uses its own connection table ---
    try {
        const ga4Token = await getGoogleAccessToken(sb, 'ga4_connections');
        const resp = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
            headers: { 'Authorization': `Bearer ${ga4Token}` },
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message);
        const props = (data.accountSummaries || []).flatMap(a =>
            (a.propertySummaries || []).map(p => ({
                account: a.displayName, property: p.property, displayName: p.displayName,
            }))
        );
        const dunhamProp = props.find(p => /dunham/i.test(p.displayName) || /dunham/i.test(p.account));
        if (dunhamProp) {
            out.ga4 = { connected: true, ...dunhamProp };
        } else {
            out.ga4 = {
                connected: false,
                grant: `In GA4 Admin for the dunhamlaw.com property: Property access management → Add user → ${IDENTITY} (Viewer). If no GA4 property exists, create one and install the tag.`,
            };
        }
    } catch (err) {
        out.ga4 = { connected: false, error: err.message };
    }

    return res.status(200).json(out);
}
