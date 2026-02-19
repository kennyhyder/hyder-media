/**
 * Affiliati - Sync Offers from CAKE API
 * POST /api/affiliati/sync-offers
 *
 * Fetches active Clinical Research offers from CAKE, upserts into Supabase,
 * then triggers AI enrichment for new/updated offers.
 */

import { createClient } from '@supabase/supabase-js';

const CAKE_BASE = 'https://login.affiliati.com/api/1';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const startTime = Date.now();
    const apiKey = process.env.AFFILIATI_API_KEY;
    const affiliateId = process.env.AFFILIATI_AFFILIATE_ID;

    if (!apiKey || !affiliateId) {
        return res.status(500).json({ error: 'AFFILIATI_API_KEY and AFFILIATI_AFFILIATE_ID must be configured' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    // Log sync start
    const { data: syncLog } = await supabase
        .from('affiliati_sync_log')
        .insert({ sync_type: 'offers', status: 'started' })
        .select('id')
        .single();

    try {
        // 1. Fetch offer feed from CAKE
        const feedUrl = `${CAKE_BASE}/Offers/Feed?affiliate_id=${affiliateId}&api_key=${apiKey}&offer_status_id=1&limit=0`;
        const feedRes = await fetch(feedUrl);
        if (!feedRes.ok) {
            throw new Error(`CAKE Feed API returned ${feedRes.status}: ${await feedRes.text()}`);
        }
        const feedData = await feedRes.json();

        const allOffers = feedData.offers || feedData.data || feedData || [];
        if (!Array.isArray(allOffers)) {
            throw new Error('Unexpected CAKE response format - offers not found');
        }

        // 2. Filter for Clinical Research vertical
        const clinicalOffers = allOffers.filter(o =>
            (o.vertical_name || o.vertical || '').toLowerCase().includes('clinical')
        );

        let created = 0;
        let updated = 0;
        const processedOfferIds = [];

        // 3. For each clinical offer, get full details and upsert
        for (const offer of clinicalOffers) {
            const offerId = offer.offer_id || offer.id;
            const campaignId = offer.campaign_id;
            processedOfferIds.push(offerId);

            // Try to get campaign details for richer data
            let campaignData = null;
            if (campaignId) {
                try {
                    const campUrl = `${CAKE_BASE}/Offers/Campaign?affiliate_id=${affiliateId}&api_key=${apiKey}&campaign_id=${campaignId}`;
                    const campRes = await fetch(campUrl);
                    if (campRes.ok) {
                        campaignData = await campRes.json();
                    }
                } catch (e) {
                    // Non-fatal - continue with basic offer data
                }
            }

            const offerRecord = {
                offer_id: offerId,
                campaign_id: campaignId || null,
                offer_name: offer.offer_name || offer.name || `Offer ${offerId}`,
                vertical_name: offer.vertical_name || offer.vertical || 'Clinical Research',
                status: offer.offer_status?.status_name || offer.status || 'Active',
                payout: parseFloat(offer.payout?.amount || offer.payout || 0),
                price_format: offer.price_format?.price_format_name || offer.price_format || null,
                description: offer.description || campaignData?.description || null,
                restrictions: offer.restrictions || campaignData?.restrictions || null,
                preview_link: offer.preview_link || offer.preview_url || campaignData?.preview_link || null,
                allowed_media_types: extractMediaTypes(offer, campaignData),
                raw_data: { offer, campaign: campaignData },
                is_active: true,
                last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            // Check if offer exists
            const { data: existing } = await supabase
                .from('affiliati_offers')
                .select('offer_id, offer_name')
                .eq('offer_id', offerId)
                .single();

            if (existing) {
                // Update existing
                await supabase
                    .from('affiliati_offers')
                    .update(offerRecord)
                    .eq('offer_id', offerId);
                updated++;
            } else {
                // Insert new
                offerRecord.created_at = new Date().toISOString();
                await supabase
                    .from('affiliati_offers')
                    .insert(offerRecord);
                created++;

                // Create alert for new offer
                await supabase.from('affiliati_alerts').insert({
                    alert_type: 'new_offer',
                    offer_id: offerId,
                    title: `New Clinical Offer: ${offerRecord.offer_name}`,
                    message: `Payout: $${offerRecord.payout} | ${offerRecord.vertical_name}`,
                });
            }
        }

        // 4. Mark offers not in API response as inactive
        if (processedOfferIds.length > 0) {
            await supabase
                .from('affiliati_offers')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('is_active', true)
                .not('offer_id', 'in', `(${processedOfferIds.join(',')})`);
        }

        const duration = Date.now() - startTime;

        // Update sync log
        if (syncLog?.id) {
            await supabase
                .from('affiliati_sync_log')
                .update({
                    status: 'completed',
                    records_processed: clinicalOffers.length,
                    records_created: created,
                    records_updated: updated,
                    duration_ms: duration,
                    completed_at: new Date().toISOString(),
                })
                .eq('id', syncLog.id);
        }

        return res.status(200).json({
            success: true,
            total_in_feed: allOffers.length,
            clinical_offers: clinicalOffers.length,
            created,
            updated,
            duration_ms: duration,
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
 * Extract allowed media types from offer/campaign data
 */
function extractMediaTypes(offer, campaign) {
    const types = [];
    const mediaData = offer.allowed_media_types || offer.media_types
        || campaign?.allowed_media_types || campaign?.media_types;

    if (Array.isArray(mediaData)) {
        for (const m of mediaData) {
            types.push(m.media_type_name || m.name || m);
        }
    }

    return types.length > 0 ? types : null;
}
