/**
 * Bail-bonds directory — daily Google Places enrichment drip (cron)
 * GET /api/bailbonds/cron-places-enrich
 *
 * Pulls the next counties from bb_places_queue (priority order: TX by
 * population, then FL/CA/GA/AZ/PA/TN, then remaining commercial-bail states)
 * and runs one Places API (New) Text Search per county page — full field mask,
 * so no separate Place Details calls are needed. Results upsert into bb_places.
 *
 * Budget discipline (the $50-cap verification run):
 *   - MAX_SEARCHES_PER_RUN = 140, under the 150/day hard quota cap.
 *   - Every response page = 1 billable Text Search request. The exact count
 *    is recorded in bb_places_queue.results/searched_at and returned in the
 *    response body, so actual spend = pages × rate card, no guesswork.
 *
 * Auth: Vercel cron Bearer CRON_SECRET (fail-closed); same-origin allowed for
 * manual runs from the dashboard.
 */

import { createClient } from '@supabase/supabase-js';

const MAX_SEARCHES_PER_RUN = 140;
const FIELD_MASK = [
    'places.id', 'places.displayName', 'places.formattedAddress',
    'places.nationalPhoneNumber', 'places.websiteUri', 'places.rating',
    'places.userRatingCount', 'places.regularOpeningHours.weekdayDescriptions',
    'places.location', 'places.businessStatus',
].join(',');

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
    const auth = req.headers['authorization'] || '';
    const referer = req.headers['referer'] || '';
    const isCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
    const isSameOrigin = /^https:\/\/(www\.)?hyder\.me\//.test(referer);
    if (!isCron && !isSameOrigin) return res.status(403).json({ error: 'Forbidden' });

    const apiKey = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
    if (!apiKey) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not set' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: queue, error: qErr } = await sb
        .from('bb_places_queue').select('*')
        .eq('done', false)
        .order('priority', { ascending: true })
        .limit(80);
    if (qErr) return res.status(500).json({ error: qErr.message });
    if (!queue?.length) {
        return res.status(200).json({ status: 'complete', message: 'Queue empty — national sweep finished.' });
    }

    let searchesUsed = 0;
    let placesFound = 0;
    const processed = [];

    for (const county of queue) {
        const pagesWanted = county.pages || 1;
        if (searchesUsed + pagesWanted > MAX_SEARCHES_PER_RUN) break;

        const countyResults = [];
        let pageToken = null;
        let pagesFetched = 0;
        let quotaExhausted = false;

        for (let p = 0; p < pagesWanted; p++) {
            const body = {
                textQuery: `bail bonds in ${county.county_name}, ${county.state}`,
                pageSize: 20,
                ...(pageToken ? { pageToken } : {}),
            };
            const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': FIELD_MASK + ',nextPageToken',
                },
                body: JSON.stringify(body),
            });
            const data = await resp.json();
            if (resp.status === 429 || data.error?.status === 'RESOURCE_EXHAUSTED') {
                quotaExhausted = true;
                break;
            }
            searchesUsed++;
            pagesFetched++;
            if (data.error) break;
            countyResults.push(...(data.places || []));
            pageToken = data.nextPageToken;
            if (!pageToken) break;
        }

        if (quotaExhausted) break;

        if (countyResults.length) {
            const rows = countyResults.map(p => ({
                place_id: p.id,
                state: county.state,
                county: county.county_name,
                name: p.displayName?.text || null,
                phone: p.nationalPhoneNumber || null,
                website: p.websiteUri || null,
                rating: p.rating ?? null,
                review_count: p.userRatingCount ?? null,
                hours: p.regularOpeningHours?.weekdayDescriptions || null,
                address: p.formattedAddress || null,
                lat: p.location?.latitude ?? null,
                lng: p.location?.longitude ?? null,
                business_status: p.businessStatus || null,
                fetched_at: new Date().toISOString(),
            }));
            const { error: upErr } = await sb.from('bb_places')
                .upsert(rows, { onConflict: 'place_id' });
            if (upErr) return res.status(500).json({ error: `upsert: ${upErr.message}`, searchesUsed });
            placesFound += rows.length;
        }

        await sb.from('bb_places_queue').update({
            done: true,
            searched_at: new Date().toISOString(),
            results: countyResults.length,
        }).eq('id', county.id);
        processed.push(`${county.county_name}, ${county.state}: ${countyResults.length} (${pagesFetched} req)`);
    }

    const { count: remaining } = await sb.from('bb_places_queue')
        .select('id', { count: 'exact', head: true }).eq('done', false);

    return res.status(200).json({
        status: 'success',
        countiesProcessed: processed.length,
        billableSearchRequests: searchesUsed,
        placesFound,
        queueRemaining: remaining,
        detail: processed,
    });
}
