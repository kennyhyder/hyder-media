/**
 * AG2020 — Journey ingest endpoint
 *
 * POST /api/ag2020/journey-ingest
 *
 *   Generic touchpoint logger. Adapters POST here to record a lead
 *   touchpoint and (find-or-)create the underlying journey row. The actual
 *   work lives in `_attribution-lib.js`; this endpoint is the auth wrapper
 *   + classifier shim for sources that don't already have a source/channel
 *   resolved.
 *
 *   Auth: header `X-Webhook-Secret` or `?secret=` must match
 *         AG2020_AUTODIAL_SECRET (the funnel-wide webhook secret —
 *         shared with the autodialer).
 *
 *   Body: {
 *     // identity (at least phone or email required)
 *     phone, email, name,
 *
 *     // touchpoint
 *     touchpoint_type,       // 'form_submit' | 'call_inbound' | etc.
 *     touchpoint_at,         // ISO; defaults to now
 *     direction,             // 'inbound' | 'outbound' | null
 *     payload,               // arbitrary JSON to log on the touchpoint
 *
 *     // attribution — either resolved fields or a classifier to resolve
 *     source, channel, campaign, ad_group, keyword, url, utm, gclid, fbclid,
 *     source_classifier: { tag_ids?, tag_names?, ac_native_source? },
 *
 *     // optional links
 *     ac_contact_id,
 *
 *     // monetary / call-leg
 *     revenue_cents, duration_seconds,
 *   }
 *
 *   Response: { status, journey_id, source, channel }
 */

import { createClient } from '@supabase/supabase-js';
import {
    attributionSecret, classifySource, upsertJourney, insertTouchpoint,
} from './_attribution-lib.js';

const TENANT = 'ag2020';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const expected = attributionSecret();
    const provided = req.headers['x-webhook-secret'] || req.query.secret;
    if (!expected) return res.status(503).json({ error: 'Attribution secret not configured on server' });
    if (provided !== expected) return res.status(401).json({ error: 'Invalid secret' });

    const body = req.body || {};
    if (!body.phone && !body.email) {
        return res.status(400).json({ error: 'phone or email is required' });
    }
    if (!body.touchpoint_type) {
        return res.status(400).json({ error: 'touchpoint_type is required' });
    }

    // Resolve attribution: explicit fields win; otherwise run the classifier.
    let { source, channel } = body;
    if (!source && body.source_classifier) {
        const c = classifySource(TENANT, body.source_classifier);
        source = c.source;
        channel = channel || c.channel;
    }
    source = source || 'unknown';

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    try {
        const journeyId = await upsertJourney(supabase, TENANT, {
            phone: body.phone,
            email: body.email,
            name: body.name,
            firstTouchAt: body.touchpoint_at,
            firstTouchSource: source,
            firstTouchChannel: channel,
            firstTouchCampaign: body.campaign,
            firstTouchAdGroup: body.ad_group,
            firstTouchKeyword: body.keyword,
            firstTouchUrl: body.url,
            firstTouchUtm: body.utm,
            firstTouchGclid: body.gclid,
            firstTouchFbclid: body.fbclid,
            acContactId: body.ac_contact_id,
            rawFirstTouch: body,
        });

        await insertTouchpoint(supabase, TENANT, journeyId, {
            touchpointAt: body.touchpoint_at,
            touchpointType: body.touchpoint_type,
            source,
            channel,
            direction: body.direction,
            payload: body.payload || body,
            revenueCents: body.revenue_cents,
            durationSeconds: body.duration_seconds,
        });

        return res.status(200).json({
            status: 'success',
            journey_id: journeyId,
            source,
            channel: channel || null,
        });
    } catch (err) {
        return res.status(500).json({ status: 'error', error: err.message });
    }
}
