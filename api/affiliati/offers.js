/**
 * Affiliati - List Offers
 * GET /api/affiliati/offers
 *
 * Paginated offer list with filtering.
 * Query params: page, limit, status, condition, has_matches, has_ad_unit
 */

import { createClient } from '@supabase/supabase-js';
import { OffersQuerySchema, validate } from './_validate.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { data: params, error: validationError } = validate(OffersQuerySchema, req.query);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    try {
        let query = supabase
            .from('affiliati_offers')
            .select('*', { count: 'exact' });

        // Filter by status
        if (params.status === 'active') {
            query = query.eq('is_active', true);
        } else if (params.status === 'inactive') {
            query = query.eq('is_active', false);
        }

        // Filter by condition name search
        if (params.condition) {
            query = query.ilike('condition_name', `%${params.condition}%`);
        }

        // Order and paginate
        query = query
            .order('payout', { ascending: false })
            .range((params.page - 1) * params.limit, params.page * params.limit - 1);

        const { data: offers, count, error } = await query;

        if (error) throw error;

        // Get match counts and ad unit status for each offer
        const offerIds = offers.map(o => o.offer_id);

        let matchCounts = {};
        let adUnitStatuses = {};

        if (offerIds.length > 0) {
            // Get match counts
            const { data: matches } = await supabase
                .from('affiliati_trial_matches')
                .select('offer_id')
                .in('offer_id', offerIds)
                .eq('is_dismissed', false);

            if (matches) {
                for (const m of matches) {
                    matchCounts[m.offer_id] = (matchCounts[m.offer_id] || 0) + 1;
                }
            }

            // Get ad unit statuses
            const { data: adUnits } = await supabase
                .from('affiliati_ad_units')
                .select('offer_id, status')
                .in('offer_id', offerIds)
                .order('version', { ascending: false });

            if (adUnits) {
                for (const au of adUnits) {
                    if (!adUnitStatuses[au.offer_id]) {
                        adUnitStatuses[au.offer_id] = au.status;
                    }
                }
            }
        }

        // Apply post-query filters
        let enrichedOffers = offers.map(o => ({
            ...o,
            match_count: matchCounts[o.offer_id] || 0,
            ad_unit_status: adUnitStatuses[o.offer_id] || null,
            raw_data: undefined, // Don't send raw data in list view
        }));

        if (params.has_matches !== undefined) {
            enrichedOffers = enrichedOffers.filter(o =>
                params.has_matches ? o.match_count > 0 : o.match_count === 0
            );
        }

        if (params.has_ad_unit !== undefined) {
            enrichedOffers = enrichedOffers.filter(o =>
                params.has_ad_unit ? o.ad_unit_status !== null : o.ad_unit_status === null
            );
        }

        // Get last sync time
        const { data: lastSync } = await supabase
            .from('affiliati_sync_log')
            .select('completed_at, status')
            .eq('sync_type', 'offers')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        return res.status(200).json({
            offers: enrichedOffers,
            pagination: {
                page: params.page,
                limit: params.limit,
                total: count,
                pages: Math.ceil(count / params.limit),
            },
            last_sync: lastSync?.completed_at || null,
            last_sync_status: lastSync?.status || null,
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
