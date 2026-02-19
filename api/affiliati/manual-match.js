/**
 * Affiliati - Manual Trial Match
 * POST /api/affiliati/manual-match
 *
 * Manually link an offer to a ClinicalTrials.gov study by NCT ID.
 * Body: { offer_id: number, nct_id: string }
 */

import { createClient } from '@supabase/supabase-js';
import { ManualMatchSchema, validate } from './_validate.js';

const CT_API = 'https://clinicaltrials.gov/api/v2/studies';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { data: params, error: validationError } = validate(ManualMatchSchema, req.body);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    try {
        // Verify offer exists
        const { data: offer } = await supabase
            .from('affiliati_offers')
            .select('offer_id, offer_name')
            .eq('offer_id', params.offer_id)
            .single();

        if (!offer) {
            return res.status(404).json({ error: 'Offer not found' });
        }

        // Check for existing match
        const { data: existing } = await supabase
            .from('affiliati_trial_matches')
            .select('id, match_type')
            .eq('offer_id', params.offer_id)
            .eq('nct_id', params.nct_id)
            .single();

        if (existing) {
            return res.status(409).json({
                error: 'Match already exists',
                match_id: existing.id,
                match_type: existing.match_type,
            });
        }

        // Fetch study from ClinicalTrials.gov
        const ctUrl = `${CT_API}/${params.nct_id}`;
        const ctRes = await fetch(ctUrl);

        if (!ctRes.ok) {
            return res.status(404).json({ error: `Study ${params.nct_id} not found on ClinicalTrials.gov` });
        }

        const study = await ctRes.json();
        const proto = study.protocolSection || {};
        const id = proto.identificationModule || {};
        const design = proto.designModule || {};
        const sponsor = proto.sponsorCollaboratorsModule || {};
        const contacts = proto.contactsLocationsModule || {};

        // Extract US locations
        const locations = (contacts.locations || [])
            .filter(l => (l.country || '').toLowerCase() === 'united states')
            .map(l => ({
                facility: l.facility || null,
                city: l.city || null,
                state: l.state || null,
                zip: l.zip || null,
                status: l.status || null,
            }));

        const stateSet = new Set(locations.filter(l => l.state).map(l => l.state));

        // Create match record
        const matchRecord = {
            offer_id: params.offer_id,
            nct_id: params.nct_id,
            study_title: id.briefTitle || id.officialTitle || 'Untitled',
            brief_summary: proto.descriptionModule?.briefSummary?.slice(0, 1000) || null,
            sponsor: sponsor.leadSponsor?.name || null,
            phase: design.phases?.join(', ') || null,
            enrollment_count: design.enrollmentInfo?.count || null,
            match_type: 'manual',
            match_score: 100,
            match_reason: 'Manually linked by user',
            location_count: locations.length,
            states: Array.from(stateSet),
            is_verified: true,
            raw_data: proto,
        };

        const { data: newMatch, error: insertError } = await supabase
            .from('affiliati_trial_matches')
            .insert(matchRecord)
            .select('id')
            .single();

        if (insertError) throw insertError;

        // Store locations
        if (newMatch?.id && locations.length > 0) {
            const locationRecords = locations.map(loc => ({
                match_id: newMatch.id,
                nct_id: params.nct_id,
                facility_name: loc.facility,
                city: loc.city,
                state: loc.state,
                zip: loc.zip,
                country: 'United States',
                recruitment_status: loc.status,
            }));

            await supabase
                .from('affiliati_trial_locations')
                .insert(locationRecords);
        }

        return res.status(200).json({
            success: true,
            match_id: newMatch?.id,
            match: matchRecord,
            locations_count: locations.length,
            states: Array.from(stateSet),
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
