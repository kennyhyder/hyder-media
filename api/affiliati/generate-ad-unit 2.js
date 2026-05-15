/**
 * Affiliati - Generate Ad Unit Breakdown
 * POST /api/affiliati/generate-ad-unit
 *
 * Uses Claude to generate a comprehensive Meta ad unit breakdown
 * based on offer data, trial matches, and locations.
 * Body: { offer_id: number, regenerate?: boolean }
 */

import { createClient } from '@supabase/supabase-js';
import { GenerateAdUnitSchema, validate } from './_validate.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { data: params, error: validationError } = validate(GenerateAdUnitSchema, req.body);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    try {
        // Check for existing ad unit
        if (!params.regenerate) {
            const { data: existing } = await supabase
                .from('affiliati_ad_units')
                .select('id, version')
                .eq('offer_id', params.offer_id)
                .order('version', { ascending: false })
                .limit(1)
                .single();

            if (existing) {
                return res.status(200).json({
                    success: true,
                    message: 'Ad unit already exists. Set regenerate=true to create a new version.',
                    ad_unit_id: existing.id,
                    version: existing.version,
                });
            }
        }

        // Load offer with full details
        const { data: offer, error: offerError } = await supabase
            .from('affiliati_offers')
            .select('*')
            .eq('offer_id', params.offer_id)
            .single();

        if (offerError || !offer) {
            return res.status(404).json({ error: 'Offer not found' });
        }

        // Load matches
        const { data: matches } = await supabase
            .from('affiliati_trial_matches')
            .select('*')
            .eq('offer_id', params.offer_id)
            .eq('is_dismissed', false)
            .order('match_score', { ascending: false });

        // Load locations
        let locations = [];
        if (matches && matches.length > 0) {
            const matchIds = matches.map(m => m.id);
            const { data: locs } = await supabase
                .from('affiliati_trial_locations')
                .select('*')
                .in('match_id', matchIds);
            locations = locs || [];
        }

        // Get current version number
        const { data: latestUnit } = await supabase
            .from('affiliati_ad_units')
            .select('version')
            .eq('offer_id', params.offer_id)
            .order('version', { ascending: false })
            .limit(1)
            .single();

        const newVersion = (latestUnit?.version || 0) + 1;

        // Build context for Claude
        const stateSet = new Set(locations.filter(l => l.state).map(l => l.state));
        const cityCounts = {};
        for (const loc of locations) {
            if (loc.city && loc.state) {
                const key = `${loc.city}, ${loc.state}`;
                cityCounts[key] = (cityCounts[key] || 0) + 1;
            }
        }
        const topCities = Object.entries(cityCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([city, count]) => `${city} (${count} sites)`);

        const matchSummary = (matches || []).slice(0, 10).map(m =>
            `- ${m.nct_id}: ${m.study_title} (Score: ${m.match_score}, Phase: ${m.phase || 'N/A'}, ${m.location_count} US sites)`
        ).join('\n');

        const prompt = `You are a clinical trial patient recruitment media buyer creating a comprehensive Meta (Facebook/Instagram) ad unit breakdown.

## OFFER DETAILS
- Offer Name: ${offer.offer_name}
- Condition: ${offer.condition_name || 'Unknown'}
- Payout: $${offer.payout || 0} per ${offer.price_format || 'conversion'}
- Description: ${offer.description || 'N/A'}
- Restrictions: ${offer.restrictions || 'None specified'}
- Allowed Media: ${(offer.allowed_media_types || []).join(', ') || 'Not specified'}
- Eligibility: Age ${offer.min_age || '18'}–${offer.max_age || '99'}, Gender: ${offer.gender || 'All'}
- Qualifications: ${(offer.qualifications || []).join('; ') || 'None specified'}
- Exclusions: ${(offer.exclusions || []).join('; ') || 'None specified'}

## MATCHED TRIALS (${(matches || []).length} total)
${matchSummary || 'No trial matches yet'}

## GEOGRAPHIC COVERAGE
- States: ${Array.from(stateSet).join(', ') || 'Nationwide'}
- Top Cities: ${topCities.join(', ') || 'N/A'}
- Total Trial Sites: ${locations.length}

Generate a complete Meta ad unit breakdown as JSON with this exact structure:

{
  "persona": {
    "name": "Primary patient persona name",
    "age_range": "e.g. 45-75",
    "demographics": "Key demographic traits",
    "pain_points": ["3-5 emotional/practical pain points"],
    "motivations": ["3-5 motivations for trial participation"],
    "objections": ["2-4 common objections to address"]
  },
  "geo_targeting": {
    "strategy": "Geographic targeting approach",
    "priority_states": ["Top 5-8 states by trial site density"],
    "priority_metros": ["Top 5-10 metro areas"],
    "radius_recommendation": "Recommended radius targeting",
    "exclusions": ["Geographic exclusions if any"]
  },
  "screening_flow": [
    {
      "step": 1,
      "question": "Screening question text",
      "purpose": "Why this question matters",
      "pass": "What qualifies",
      "fail": "What disqualifies"
    }
  ],
  "ad_copy": {
    "headlines": ["5 headline options (40 char max each)"],
    "primary_text": ["3 primary text options (125 char recommended)"],
    "descriptions": ["3 link description options"],
    "ctas": ["2-3 call-to-action button text options"]
  },
  "video_scripts": [
    {
      "title": "Script concept name",
      "duration": "15s/30s/60s",
      "hook": "Opening hook (first 3 seconds)",
      "body": "Main message",
      "cta": "Closing call-to-action",
      "visual_notes": "Visual direction notes"
    }
  ],
  "compliance_notes": {
    "allowed_claims": ["What you CAN say in ads"],
    "prohibited_claims": ["What you CANNOT say"],
    "required_disclaimers": ["Disclaimers to include"],
    "platform_policies": ["Relevant Meta/Facebook ad policies"]
  }
}

Return ONLY valid JSON, no markdown formatting. Be specific to the condition and trial data provided.`;

        // Call Claude
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4096,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!claudeResponse.ok) {
            const errText = await claudeResponse.text();
            throw new Error(`Claude API error ${claudeResponse.status}: ${errText}`);
        }

        const claudeData = await claudeResponse.json();
        const responseText = claudeData.content?.[0]?.text || '';

        // Parse JSON response
        let adUnit;
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            adUnit = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
        } catch (parseError) {
            throw new Error(`Failed to parse Claude response: ${responseText.slice(0, 300)}`);
        }

        // Store ad unit
        const adUnitRecord = {
            offer_id: params.offer_id,
            version: newVersion,
            generation_model: 'claude-sonnet-4-20250514',
            persona: adUnit.persona || null,
            geo_targeting: adUnit.geo_targeting || null,
            screening_flow: adUnit.screening_flow || null,
            ad_copy: adUnit.ad_copy || null,
            video_scripts: adUnit.video_scripts || null,
            compliance_notes: adUnit.compliance_notes || null,
            status: 'draft',
        };

        const { data: inserted, error: insertError } = await supabase
            .from('affiliati_ad_units')
            .insert(adUnitRecord)
            .select('id')
            .single();

        if (insertError) throw insertError;

        // Log
        await supabase.from('affiliati_sync_log').insert({
            sync_type: 'ad_unit',
            status: 'completed',
            records_processed: 1,
            records_created: 1,
            completed_at: new Date().toISOString(),
        });

        return res.status(200).json({
            success: true,
            ad_unit_id: inserted?.id,
            version: newVersion,
            ad_unit: adUnitRecord,
        });

    } catch (error) {
        await supabase.from('affiliati_sync_log').insert({
            sync_type: 'ad_unit',
            status: 'failed',
            error_message: error.message,
            completed_at: new Date().toISOString(),
        });

        return res.status(500).json({ error: error.message });
    }
}
