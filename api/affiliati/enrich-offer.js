/**
 * Affiliati - AI Enrichment
 * POST /api/affiliati/enrich-offer
 *
 * Uses Claude to extract structured clinical trial data from offer description.
 * Body: { offer_id: number }
 */

import { createClient } from '@supabase/supabase-js';
import { EnrichOfferSchema, validate } from './_validate.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { data: params, error: validationError } = validate(EnrichOfferSchema, req.body);
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
        // Load offer
        const { data: offer, error: offerError } = await supabase
            .from('affiliati_offers')
            .select('*')
            .eq('offer_id', params.offer_id)
            .single();

        if (offerError || !offer) {
            return res.status(404).json({ error: 'Offer not found' });
        }

        // Build context from offer data
        const offerContext = [
            `Offer Name: ${offer.offer_name}`,
            offer.description ? `Description: ${offer.description}` : '',
            offer.restrictions ? `Restrictions: ${offer.restrictions}` : '',
            offer.preview_link ? `Preview Link: ${offer.preview_link}` : '',
            offer.payout ? `Payout: $${offer.payout}` : '',
            offer.price_format ? `Price Format: ${offer.price_format}` : '',
            offer.allowed_media_types ? `Allowed Media: ${offer.allowed_media_types.join(', ')}` : '',
        ].filter(Boolean).join('\n');

        // Also include raw data if available for richer extraction
        const rawContext = offer.raw_data
            ? `\n\nRaw API Data:\n${JSON.stringify(offer.raw_data, null, 2).slice(0, 3000)}`
            : '';

        // Call Claude for extraction
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: `You are analyzing a clinical trial affiliate offer to extract structured data for ad targeting.

Offer Data:
${offerContext}${rawContext}

Extract the following fields as JSON. Use null for any field you cannot determine:

{
  "condition_name": "The primary medical condition (e.g., 'Type 2 Diabetes', 'COPD', 'Atopic Dermatitis')",
  "condition_keywords": ["array of search terms for ClinicalTrials.gov matching", "include the condition name", "include related medical terms", "include common patient language"],
  "min_age": null or integer (minimum age for eligibility),
  "max_age": null or integer (maximum age for eligibility),
  "gender": "All" or "Male" or "Female" or null,
  "qualifications": ["list of eligibility criteria patients must meet"],
  "exclusions": ["list of conditions/factors that would disqualify patients"],
  "compliance_notes": "Any compliance concerns, required disclaimers, or regulatory notes for ad copy"
}

Return ONLY valid JSON, no markdown formatting.`
                }],
            }),
        });

        if (!claudeResponse.ok) {
            const errText = await claudeResponse.text();
            throw new Error(`Claude API error ${claudeResponse.status}: ${errText}`);
        }

        const claudeData = await claudeResponse.json();
        const responseText = claudeData.content?.[0]?.text || '';

        // Parse the JSON response
        let extracted;
        try {
            // Try to extract JSON from the response (handle potential markdown wrapping)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            extracted = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
        } catch (parseError) {
            throw new Error(`Failed to parse Claude response: ${responseText.slice(0, 200)}`);
        }

        // Update offer with extracted data
        const updateData = {
            condition_name: extracted.condition_name || null,
            condition_keywords: extracted.condition_keywords || [],
            min_age: extracted.min_age || null,
            max_age: extracted.max_age || null,
            gender: extracted.gender || null,
            qualifications: extracted.qualifications || [],
            exclusions: extracted.exclusions || [],
            compliance_notes: extracted.compliance_notes || null,
            updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
            .from('affiliati_offers')
            .update(updateData)
            .eq('offer_id', params.offer_id);

        if (updateError) throw updateError;

        // Log enrichment
        await supabase.from('affiliati_sync_log').insert({
            sync_type: 'enrich',
            status: 'completed',
            records_processed: 1,
            records_updated: 1,
            completed_at: new Date().toISOString(),
        });

        return res.status(200).json({
            success: true,
            offer_id: params.offer_id,
            extracted: updateData,
        });

    } catch (error) {
        await supabase.from('affiliati_sync_log').insert({
            sync_type: 'enrich',
            status: 'failed',
            error_message: error.message,
            completed_at: new Date().toISOString(),
        });

        return res.status(500).json({ error: error.message });
    }
}
