/**
 * Affiliati - Get Single Offer
 * GET /api/affiliati/offer?offer_id=123
 *
 * Returns full offer details with matches, locations, and ad unit.
 */

import { createClient } from '@supabase/supabase-js';
import { OfferQuerySchema, validate } from './_validate.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { data: params, error: validationError } = validate(OfferQuerySchema, req.query);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    try {
        // Get offer
        const { data: offer, error: offerError } = await supabase
            .from('affiliati_offers')
            .select('*')
            .eq('offer_id', params.offer_id)
            .single();

        if (offerError || !offer) {
            return res.status(404).json({ error: 'Offer not found' });
        }

        // Get trial matches with locations
        const { data: matches } = await supabase
            .from('affiliati_trial_matches')
            .select('*')
            .eq('offer_id', params.offer_id)
            .eq('is_dismissed', false)
            .order('match_score', { ascending: false });

        // Get locations for all matches
        let locations = [];
        if (matches && matches.length > 0) {
            const matchIds = matches.map(m => m.id);
            const { data: locs } = await supabase
                .from('affiliati_trial_locations')
                .select('*')
                .in('match_id', matchIds);
            locations = locs || [];
        }

        // Get latest ad unit
        const { data: adUnit } = await supabase
            .from('affiliati_ad_units')
            .select('*')
            .eq('offer_id', params.offer_id)
            .order('version', { ascending: false })
            .limit(1)
            .single();

        // Compute state coverage from locations
        const stateSet = new Set(locations.filter(l => l.state).map(l => l.state));

        return res.status(200).json({
            offer,
            matches: matches || [],
            locations,
            ad_unit: adUnit || null,
            summary: {
                match_count: (matches || []).length,
                location_count: locations.length,
                states_covered: Array.from(stateSet).sort(),
                state_count: stateSet.size,
                has_ad_unit: !!adUnit,
                ad_unit_status: adUnit?.status || null,
            },
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
