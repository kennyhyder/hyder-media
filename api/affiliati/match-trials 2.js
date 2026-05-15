/**
 * Affiliati - Match Offers to ClinicalTrials.gov
 * POST /api/affiliati/match-trials
 *
 * For each enriched offer, queries ClinicalTrials.gov API,
 * scores matches, and stores results.
 * Body: { offer_id?: number } — if omitted, matches all enriched offers
 */

import { createClient } from '@supabase/supabase-js';
import { MatchTrialsSchema, validate } from './_validate.js';

const CT_API = 'https://clinicaltrials.gov/api/v2/studies';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { data: params, error: validationError } = validate(MatchTrialsSchema, req.body || {});
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    const startTime = Date.now();

    // Log sync start
    const { data: syncLog } = await supabase
        .from('affiliati_sync_log')
        .insert({ sync_type: 'match', status: 'started' })
        .select('id')
        .single();

    try {
        // Get offers to match
        let query = supabase
            .from('affiliati_offers')
            .select('offer_id, offer_name, condition_name, condition_keywords, min_age, max_age, gender, qualifications, exclusions')
            .eq('is_active', true)
            .not('condition_keywords', 'is', null);

        if (params.offer_id) {
            query = query.eq('offer_id', params.offer_id);
        }

        const { data: offers, error: offersError } = await query;
        if (offersError) throw offersError;

        if (!offers || offers.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No enriched offers to match',
                offers_processed: 0,
            });
        }

        let totalMatches = 0;
        let totalLocations = 0;
        const results = [];

        for (const offer of offers) {
            if (!offer.condition_keywords || offer.condition_keywords.length === 0) continue;

            // Build search query from condition keywords
            const searchTerms = offer.condition_keywords.slice(0, 5).join(' OR ');

            // Query ClinicalTrials.gov
            const ctUrl = new URL(CT_API);
            ctUrl.searchParams.set('query.cond', searchTerms);
            ctUrl.searchParams.set('filter.overallStatus', 'RECRUITING');
            ctUrl.searchParams.set('pageSize', '20');
            ctUrl.searchParams.set('fields', [
                'NCTId', 'BriefTitle', 'OfficialTitle', 'BriefSummary',
                'Condition', 'Phase', 'EnrollmentCount', 'LeadSponsorName',
                'EligibilityCriteria', 'MinimumAge', 'MaximumAge', 'Gender',
                'HealthyVolunteers', 'LocationFacility', 'LocationCity',
                'LocationState', 'LocationZip', 'LocationCountry', 'LocationStatus',
                'OverallStatus'
            ].join(','));

            let studies = [];
            try {
                const ctRes = await fetch(ctUrl.toString());
                if (ctRes.ok) {
                    const ctData = await ctRes.json();
                    studies = ctData.studies || [];
                }
            } catch (e) {
                results.push({ offer_id: offer.offer_id, error: e.message, matches: 0 });
                continue;
            }

            let offerMatches = 0;

            for (const study of studies) {
                const proto = study.protocolSection || {};
                const id = proto.identificationModule || {};
                const status = proto.statusModule || {};
                const design = proto.designModule || {};
                const eligibility = proto.eligibilityModule || {};
                const sponsor = proto.sponsorCollaboratorsModule || {};
                const contacts = proto.contactsLocationsModule || {};

                const nctId = id.nctId;
                if (!nctId) continue;

                // Score the match
                const score = scoreMatch(offer, proto);
                if (score < 40) continue;

                // Extract US locations
                const usLocations = extractUSLocations(contacts);

                // Compute states covered
                const stateSet = new Set(usLocations.filter(l => l.state).map(l => l.state));

                // Upsert match
                const matchRecord = {
                    offer_id: offer.offer_id,
                    nct_id: nctId,
                    study_title: id.briefTitle || id.officialTitle || 'Untitled',
                    brief_summary: proto.descriptionModule?.briefSummary?.slice(0, 1000) || null,
                    sponsor: sponsor.leadSponsor?.name || null,
                    phase: design.phases?.join(', ') || null,
                    enrollment_count: design.enrollmentInfo?.count || null,
                    match_type: 'auto',
                    match_score: score,
                    match_reason: buildMatchReason(offer, proto, score),
                    location_count: usLocations.length,
                    states: Array.from(stateSet),
                    is_verified: false,
                    raw_data: proto,
                    updated_at: new Date().toISOString(),
                };

                const { data: existingMatch } = await supabase
                    .from('affiliati_trial_matches')
                    .select('id')
                    .eq('offer_id', offer.offer_id)
                    .eq('nct_id', nctId)
                    .single();

                let matchId;
                if (existingMatch) {
                    await supabase
                        .from('affiliati_trial_matches')
                        .update(matchRecord)
                        .eq('id', existingMatch.id);
                    matchId = existingMatch.id;
                } else {
                    const { data: newMatch } = await supabase
                        .from('affiliati_trial_matches')
                        .insert(matchRecord)
                        .select('id')
                        .single();
                    matchId = newMatch?.id;
                }

                // Store locations
                if (matchId && usLocations.length > 0) {
                    // Delete old locations for this match
                    await supabase
                        .from('affiliati_trial_locations')
                        .delete()
                        .eq('match_id', matchId);

                    // Insert new locations
                    const locationRecords = usLocations.map(loc => ({
                        match_id: matchId,
                        nct_id: nctId,
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

                    totalLocations += usLocations.length;
                }

                // Alert on high-score matches
                if (score >= 70 && !existingMatch) {
                    await supabase.from('affiliati_alerts').insert({
                        alert_type: 'high_score_match',
                        offer_id: offer.offer_id,
                        title: `High-Score Match: ${offer.offer_name}`,
                        message: `${nctId} scored ${score}/100 — ${id.briefTitle?.slice(0, 100)}`,
                    });
                }

                offerMatches++;
                totalMatches++;
            }

            results.push({ offer_id: offer.offer_id, matches: offerMatches });

            // Rate limit: 1.5s delay between ClinicalTrials.gov queries
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        const duration = Date.now() - startTime;

        if (syncLog?.id) {
            await supabase
                .from('affiliati_sync_log')
                .update({
                    status: 'completed',
                    records_processed: offers.length,
                    records_created: totalMatches,
                    duration_ms: duration,
                    completed_at: new Date().toISOString(),
                })
                .eq('id', syncLog.id);
        }

        return res.status(200).json({
            success: true,
            offers_processed: offers.length,
            total_matches: totalMatches,
            total_locations: totalLocations,
            duration_ms: duration,
            results,
        });

    } catch (error) {
        const duration = Date.now() - startTime;

        if (syncLog?.id) {
            await supabase
                .from('affiliati_sync_log')
                .update({
                    status: 'failed',
                    error_message: error.message,
                    duration_ms: duration,
                    completed_at: new Date().toISOString(),
                })
                .eq('id', syncLog.id);
        }

        return res.status(500).json({ error: error.message });
    }
}

/**
 * Score a trial match (0-100)
 */
function scoreMatch(offer, proto) {
    let score = 0;
    const id = proto.identificationModule || {};
    const eligibility = proto.eligibilityModule || {};
    const design = proto.designModule || {};
    const sponsor = proto.sponsorCollaboratorsModule || {};
    const contacts = proto.contactsLocationsModule || {};
    const conditions = proto.conditionsModule?.conditions || [];

    const conditionName = (offer.condition_name || '').toLowerCase();
    const keywords = (offer.condition_keywords || []).map(k => k.toLowerCase());

    // --- Condition match (0-40) ---
    const conditionsLower = conditions.map(c => c.toLowerCase());
    const titleLower = (id.briefTitle || '').toLowerCase();
    const eligText = (eligibility.eligibilityCriteria || '').toLowerCase();

    if (conditionsLower.some(c => c === conditionName)) {
        score += 40; // Exact match in conditions array
    } else if (keywords.some(k => conditionsLower.some(c => c.includes(k)))) {
        score += 25; // Partial keyword in conditions
    } else if (keywords.some(k => titleLower.includes(k))) {
        score += 15; // In title
    } else if (keywords.some(k => eligText.includes(k))) {
        score += 10; // In eligibility text
    }

    // --- Eligibility overlap (0-25) ---
    // Age range overlap
    const studyMinAge = parseAge(eligibility.minimumAge);
    const studyMaxAge = parseAge(eligibility.maximumAge);
    if (offer.min_age && offer.max_age && studyMinAge !== null && studyMaxAge !== null) {
        const overlapMin = Math.max(offer.min_age, studyMinAge);
        const overlapMax = Math.min(offer.max_age, studyMaxAge);
        if (overlapMin <= overlapMax) score += 10;
    } else if (studyMinAge !== null || studyMaxAge !== null) {
        score += 5; // Partial age info available
    }

    // Gender match
    const studyGender = (eligibility.sex || '').toUpperCase();
    if (studyGender === 'ALL' || !offer.gender || offer.gender === 'All') {
        score += 5;
    } else if (studyGender === offer.gender?.toUpperCase()) {
        score += 5;
    }

    // Healthy volunteers alignment
    const acceptsHealthy = eligibility.healthyVolunteers === 'Yes';
    if (!acceptsHealthy) score += 5; // Clinical trial for actual patients

    // No exclusion conflicts (simplified check)
    score += 5;

    // --- Geographic relevance (0-20) ---
    const locations = contacts.locations || [];
    const usLocations = locations.filter(l =>
        (l.country || '').toLowerCase() === 'united states'
    );

    if (usLocations.length >= 10) {
        score += 20;
    } else if (usLocations.length >= 5) {
        score += 15;
    } else if (usLocations.length > 0) {
        score += 10;
    }

    // --- Study quality (0-15) ---
    const phases = design.phases || [];
    if (phases.some(p => p.includes('PHASE2') || p.includes('PHASE3'))) {
        score += 10;
    } else if (phases.some(p => p.includes('PHASE1'))) {
        score += 5;
    }

    const sponsorClass = sponsor.leadSponsor?.class || '';
    if (sponsorClass === 'INDUSTRY') {
        score += 5;
    }

    return Math.min(score, 100);
}

/**
 * Build human-readable match reason
 */
function buildMatchReason(offer, proto, score) {
    const parts = [];
    const conditions = proto.conditionsModule?.conditions || [];
    const conditionName = (offer.condition_name || '').toLowerCase();

    if (conditions.some(c => c.toLowerCase() === conditionName)) {
        parts.push('Exact condition match');
    } else {
        parts.push('Keyword overlap in conditions/title');
    }

    const design = proto.designModule || {};
    const phases = design.phases || [];
    if (phases.length > 0) {
        parts.push(`Phase: ${phases.join(', ').replace(/PHASE/g, '')}`);
    }

    const contacts = proto.contactsLocationsModule || {};
    const usLocs = (contacts.locations || []).filter(l =>
        (l.country || '').toLowerCase() === 'united states'
    );
    if (usLocs.length > 0) {
        parts.push(`${usLocs.length} US sites`);
    }

    return parts.join(' | ');
}

/**
 * Extract US locations from study data
 */
function extractUSLocations(contacts) {
    const locations = contacts.locations || [];
    return locations
        .filter(l => (l.country || '').toLowerCase() === 'united states')
        .map(l => ({
            facility: l.facility || null,
            city: l.city || null,
            state: l.state || null,
            zip: l.zip || null,
            status: l.status || null,
        }));
}

/**
 * Parse age string like "18 Years" to integer
 */
function parseAge(ageStr) {
    if (!ageStr) return null;
    const match = ageStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}
