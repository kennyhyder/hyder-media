/**
 * Google Business Profile - Export All Data
 * GET /api/gbp/export
 *
 * Fetches business info, reviews, media for all accessible GBP locations.
 * Uses same OAuth token as Google Ads (stored in Supabase).
 * Requires scope: https://www.googleapis.com/auth/business.manage
 */

import { createClient } from '@supabase/supabase-js';

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
            return res.status(500).json({
                error: 'No Google connection found.',
                hint: 'Authorize at /api/google-ads/auth?returnUrl=/clients/dunham/gbp'
            });
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

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        };

        // Step 1: List GBP accounts
        const accountsResp = await fetch(
            'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
            { headers }
        );
        const accountsData = await accountsResp.json();

        if (accountsData.error) {
            return res.status(500).json({
                error: 'Failed to list GBP accounts',
                details: accountsData.error.message || JSON.stringify(accountsData.error),
                hint: 'Enable "My Business Account Management API" and "My Business Business Information API" in Google Cloud Console, then re-authorize at /api/google-ads/auth?returnUrl=/clients/dunham/gbp'
            });
        }

        const accounts = accountsData.accounts || [];
        if (accounts.length === 0) {
            return res.status(200).json({
                accounts: [],
                locations: [],
                fetchedAt: new Date().toISOString(),
            });
        }

        // Step 2: For each account, list locations and fetch details
        const allLocations = [];
        const errors = [];

        for (const account of accounts) {
            const accountName = account.name; // e.g., "accounts/123456789"
            const accountId = accountName.replace('accounts/', '');

            // List locations
            const readMask = 'title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,profile,openInfo,metadata,serviceArea,labels,moreHours';
            let locData;

            try {
                const locResp = await fetch(
                    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${readMask}&pageSize=100`,
                    { headers }
                );
                locData = await locResp.json();

                // Fallback with fewer fields if some aren't supported
                if (locData.error) {
                    const fallbackMask = 'title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,profile,openInfo,metadata';
                    const locResp2 = await fetch(
                        `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${fallbackMask}&pageSize=100`,
                        { headers }
                    );
                    locData = await locResp2.json();
                }
            } catch (e) {
                errors.push({ account: account.accountName, error: e.message });
                continue;
            }

            if (locData.error) {
                errors.push({ account: account.accountName, error: locData.error.message || JSON.stringify(locData.error) });
                continue;
            }

            const locations = locData.locations || [];

            for (const loc of locations) {
                const locationEntry = {
                    account,
                    location: loc,
                    reviews: [],
                    media: [],
                    totalReviewCount: null,
                    averageRating: null,
                };

                const locationId = loc.name.replace('locations/', '');

                // Fetch reviews (v4 API)
                try {
                    const reviewsResp = await fetch(
                        `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews?pageSize=200`,
                        { headers }
                    );
                    const reviewsData = await reviewsResp.json();
                    if (!reviewsData.error && reviewsData.reviews) {
                        locationEntry.reviews = reviewsData.reviews;
                        locationEntry.totalReviewCount = reviewsData.totalReviewCount;
                        locationEntry.averageRating = reviewsData.averageRating;
                    }
                } catch (e) {
                    // Reviews fetch failed silently
                }

                // Fetch media (v4 API)
                try {
                    const mediaResp = await fetch(
                        `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/media?pageSize=200`,
                        { headers }
                    );
                    const mediaData = await mediaResp.json();
                    if (!mediaData.error && mediaData.mediaItems) {
                        locationEntry.media = mediaData.mediaItems;
                    }
                } catch (e) {
                    // Media fetch failed silently
                }

                allLocations.push(locationEntry);
            }
        }

        return res.status(200).json({
            accounts: accounts.map(a => ({
                name: a.name,
                accountName: a.accountName,
                type: a.type,
                role: a.role,
            })),
            locations: allLocations.map(formatLocation),
            errors: errors.length > 0 ? errors : undefined,
            fetchedAt: new Date().toISOString(),
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

function formatLocation(entry) {
    const loc = entry.location;
    const addr = loc.storefrontAddress || {};
    const profile = loc.profile || {};
    const hours = loc.regularHours || {};
    const categories = loc.categories || {};
    const openInfo = loc.openInfo || {};
    const metadata = loc.metadata || {};
    const phones = loc.phoneNumbers || {};

    return {
        name: loc.name,
        title: loc.title,
        phone: phones.primaryPhone || null,
        additionalPhones: phones.additionalPhones || [],
        website: loc.websiteUri || null,
        address: {
            lines: addr.addressLines || [],
            locality: addr.locality || '',
            state: addr.administrativeArea || '',
            postalCode: addr.postalCode || '',
            country: addr.regionCode || '',
        },
        description: profile.description || null,
        primaryCategory: categories.primaryCategory ? {
            name: categories.primaryCategory.displayName,
            id: categories.primaryCategory.name,
        } : null,
        additionalCategories: (categories.additionalCategories || []).map(c => ({
            name: c.displayName,
            id: c.name,
        })),
        regularHours: (hours.periods || []).map(p => ({
            day: p.openDay,
            open: p.openTime ? `${p.openTime.hours || 0}:${String(p.openTime.minutes || 0).padStart(2, '0')}` : null,
            close: p.closeTime ? `${p.closeTime.hours || 0}:${String(p.closeTime.minutes || 0).padStart(2, '0')}` : null,
        })),
        specialHours: (loc.specialHours || {}).specialHourPeriods || [],
        labels: loc.labels || [],
        openStatus: openInfo.status || null,
        openDate: openInfo.openingDate || null,
        mapsUri: metadata.mapsUri || null,
        newReviewUri: metadata.newReviewUri || null,
        reviews: (entry.reviews || []).map(r => ({
            reviewer: r.reviewer ? {
                displayName: r.reviewer.displayName,
                profilePhotoUrl: r.reviewer.profilePhotoUrl
            } : null,
            starRating: r.starRating,
            comment: r.comment || null,
            createTime: r.createTime,
            updateTime: r.updateTime,
            reply: r.reviewReply ? {
                comment: r.reviewReply.comment,
                updateTime: r.reviewReply.updateTime
            } : null,
        })),
        totalReviewCount: entry.totalReviewCount || null,
        averageRating: entry.averageRating || null,
        media: (entry.media || []).map(m => ({
            mediaFormat: m.mediaFormat,
            googleUrl: m.googleUrl,
            thumbnailUrl: m.thumbnailUrl,
            createTime: m.createTime,
            description: m.description,
            locationAssociation: m.locationAssociation,
            dimensions: m.dimensions,
        })),
        moreHours: loc.moreHours || [],
        serviceArea: loc.serviceArea || null,
        accountName: entry.account.accountName,
        accountRole: entry.account.role,
    };
}
