/**
 * Dunham GBP office audit
 * GET /api/dunham/gbp-audit            — return stored audit (fast, from Supabase)
 * GET /api/dunham/gbp-audit?refresh=1  — live-pull all Dunham locations from the
 *                                        Business Information API, compute audit
 *                                        flags, store, and return (guarded)
 *
 * Kenny's GBP account manages the 16 Dunham & Jones office profiles, so this
 * works today. Review counts require the legacy "Google My Business API"
 * (mybusiness.googleapis.com) enabled in Cloud project 132234777258 — until
 * then reviews come back null and the audit notes it.
 *
 * Stored in gbp_locations with client_key 'dunham-gbp-audit'.
 */

import { supabase, getGoogleAccessToken } from './_google.js';

const CLIENT_KEY = 'dunham-gbp-audit';
const READ_MASK = 'name,title,storefrontAddress,categories,regularHours,phoneNumbers,websiteUri,openInfo,metadata,profile,serviceItems';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const sb = supabase();

    if (req.query.refresh === '1') {
        // Write path — same-origin dashboard or cron secret only
        const auth = req.headers['authorization'] || '';
        const referer = req.headers['referer'] || '';
        const isCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
        const isSameOrigin = /^https:\/\/(www\.)?hyder\.me\//.test(referer);
        if (!isCron && !isSameOrigin) return res.status(403).json({ error: 'Forbidden' });

        try {
            const result = await refreshAudit(sb);
            return res.status(200).json(result);
        } catch (err) {
            return res.status(500).json({ status: 'error', error: err.message });
        }
    }

    // Read path
    const { data, error } = await sb
        .from('gbp_locations').select('*')
        .eq('client_key', CLIENT_KEY)
        .order('location_name', { ascending: true });
    if (error) return res.status(500).json({ status: 'error', error: error.message });
    return res.status(200).json({
        status: 'success',
        count: data.length,
        refreshedAt: data[0]?.updated_at || null,
        offices: data.map(r => r.data),
    });
}

async function refreshAudit(sb) {
    const token = await getGoogleAccessToken(sb);
    const headers = { 'Authorization': `Bearer ${token}` };

    // Accounts → all locations titled Dunham
    const acctData = await (await fetch(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers }
    )).json();
    if (acctData.error) throw new Error(`accounts: ${acctData.error.message}`);

    const offices = [];
    let reviewsApiAvailable = true;

    for (const acct of (acctData.accounts || [])) {
        let pageToken = '';
        do {
            const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations`
                + `?readMask=${encodeURIComponent(READ_MASK)}&pageSize=100`
                + (pageToken ? `&pageToken=${pageToken}` : '');
            const locData = await (await fetch(url, { headers })).json();
            if (locData.error) throw new Error(`locations: ${locData.error.message}`);

            for (const loc of (locData.locations || [])) {
                if (!/dunham/i.test(loc.title || '')) continue;

                // Reviews via legacy v4 (may be SERVICE_DISABLED)
                let reviews = null;
                if (reviewsApiAvailable) {
                    const locId = loc.name.split('/')[1];
                    const rev = await (await fetch(
                        `https://mybusiness.googleapis.com/v4/${acct.name}/locations/${locId}/reviews?pageSize=1`,
                        { headers }
                    )).json();
                    if (rev.error) {
                        if (rev.error.status === 'PERMISSION_DENIED') reviewsApiAvailable = false;
                    } else {
                        reviews = {
                            total: rev.totalReviewCount || 0,
                            averageRating: rev.averageRating || null,
                        };
                    }
                }

                offices.push(auditOffice(loc, acct.accountName, reviews));
            }
            pageToken = locData.nextPageToken || '';
        } while (pageToken);
    }

    // Upsert one row per location
    for (const office of offices) {
        const { data: existing } = await sb
            .from('gbp_locations').select('id')
            .eq('client_key', CLIENT_KEY)
            .eq('location_name', office.locationId)
            .maybeSingle();
        const row = {
            client_key: CLIENT_KEY,
            location_name: office.locationId,
            data: office,
            updated_at: new Date().toISOString(),
        };
        if (existing) await sb.from('gbp_locations').update(row).eq('id', existing.id);
        else await sb.from('gbp_locations').insert(row);
    }

    return {
        status: 'success',
        refreshed: offices.length,
        reviewsApiAvailable,
        reviewsNote: reviewsApiAvailable ? null
            : 'Enable "Google My Business API" in Cloud project 132234777258 for review counts.',
        offices,
    };
}

function auditOffice(loc, accountName, reviews) {
    const cats = loc.categories || {};
    const primary = cats.primaryCategory?.displayName || null;
    const additional = (cats.additionalCategories || []).map(c => c.displayName);
    const allCats = [primary, ...additional].filter(Boolean);

    // 24/7 = every weekday has a period spanning midnight-to-midnight
    const periods = loc.regularHours?.periods || [];
    const fullDays = new Set(
        periods
            .filter(p =>
                (p.openTime?.hours ?? 0) === 0 && !p.openTime?.minutes
                && ((p.closeTime?.hours ?? 0) === 24 || (p.closeTime?.hours ?? 0) === 0)
                && p.openDay === p.closeDay)
            .map(p => p.openDay)
    );
    const is24x7 = fullDays.size === 7;

    const city = loc.storefrontAddress?.locality || null;
    const website = loc.websiteUri || null;

    return {
        locationId: loc.name.split('/')[1],
        account: accountName,
        title: loc.title,
        city,
        state: loc.storefrontAddress?.administrativeArea || null,
        address: (loc.storefrontAddress?.addressLines || []).join(', '),
        phone: loc.phoneNumbers?.primaryPhone || null,
        website,
        placeId: loc.metadata?.placeId || null,
        mapsUri: loc.metadata?.mapsUri || null,
        openStatus: loc.openInfo?.status || null,
        primaryCategory: primary,
        additionalCategories: additional,
        description: loc.profile?.description || null,
        serviceItemCount: (loc.serviceItems || []).length,
        hoursPeriodCount: periods.length,
        reviews,
        audit: {
            hasBailCategory: allCats.some(c => /bail/i.test(c)),
            is24x7,
            hasHours: periods.length > 0,
            websiteIsCountyPage: !!website && /\/tx\/(bail-bonds|[a-z-]+-criminal-attorneys)\//.test(website),
            hasDescription: !!loc.profile?.description,
            hasServiceItems: (loc.serviceItems || []).length > 0,
            isOpen: loc.openInfo?.status === 'OPEN',
        },
        auditedAt: new Date().toISOString(),
    };
}
