/**
 * AG2020 Lead-Attribution — shared helpers.
 *
 * Underscore-prefixed so Vercel does NOT treat this as a routable function.
 * Imported by `journey-ingest.js` and (Phase 1.3+) the per-source adapters
 * in `_adapters/`.
 *
 * Phase 1 of the Lead-Attribution Platform plan. See
 * docs/lead-attribution-platform-plan.md for the full design rationale.
 *
 * Multi-tenant rules apply (see root CLAUDE.md "Reusable Patterns Library →
 * Speed-to-lead autodialer"): every function takes a `tenantId`, every query
 * filters on `tenant_id`, no vertical-specific names in this engine.
 */

// ---------------------------------------------------------------------------
// Identity normalization — phone is the universal join key across systems.
// ---------------------------------------------------------------------------

/** Normalize a phone to E.164 (+1NNNXXXXXXX). Returns null on garbage. */
export function normalizePhone(raw) {
    if (raw == null) return null;
    let s = String(raw).replace(/[^\d+]/g, '');
    if (!s) return null;
    if (/^\d{10}$/.test(s)) s = '+1' + s;
    else if (/^1\d{10}$/.test(s)) s = '+' + s;
    else if (!s.startsWith('+')) s = '+' + s;
    return s.slice(0, 20);
}

/** Lowercase + trim an email for case-insensitive matching. Null on garbage. */
export function normalizeEmail(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().toLowerCase();
    if (!s || !s.includes('@')) return null;
    return s.slice(0, 320);
}

// ---------------------------------------------------------------------------
// Per-tenant source map. Phase 1 is hardcoded for AG2020; Phase 3 lifts this
// into a `tenant_config` row in Supabase keyed by tenant. NO tenant-name
// strings anywhere else in this file — they live only in this map.
// ---------------------------------------------------------------------------

const DEFAULT_TENANT = 'ag2020';

/**
 * AG2020 source map — derived from `docs/ag2020-ac-tag-inventory.md`
 * (manual addendum, 2026-05-27). Keys are stringified AC tag ids AND
 * lowercase tag names (AC webhooks send names; backfill scripts may use ids).
 * Lookups are case-insensitive on lowercase keys.
 */
const TENANT_SOURCE_MAPS = {
    ag2020: {
        tag_to_source: {
            // Google-paid — by id
            '2449': { source: 'google_paid', channel: 'general' },
            '2467': { source: 'google_paid', channel: 'lead_form' },
            '2471': { source: 'google_paid', channel: 'contact_page' },
            '2472': { source: 'google_paid', channel: 'landing_page' },
            '2473': { source: 'google_paid', channel: 'homepage_form' },
            '2474': { source: 'google_paid', channel: 'service_page' },
            // Google-paid — by lowercase name (AC webhooks send `tag` as name)
            'new google ad':           { source: 'google_paid', channel: 'general' },
            'new lead form (g.ads)':   { source: 'google_paid', channel: 'lead_form' },
            'newgoogle-cntct':         { source: 'google_paid', channel: 'contact_page' },
            'newgoogle-lp':            { source: 'google_paid', channel: 'landing_page' },
            'newgoogle-hp':            { source: 'google_paid', channel: 'homepage_form' },
            'newgoogle-srv':           { source: 'google_paid', channel: 'service_page' },
            // Organic / referral — id + name
            '2450': { source: 'organic',  channel: 'landing_page' },
            'organic landing page':       { source: 'organic',  channel: 'landing_page' },
            '2484': { source: 'referral', channel: 'referral_program' },
            'referral program introduced':{ source: 'referral', channel: 'referral_program' },
        },
        // AC native contact.source / contact.referrer value → classification
        native_source_map: {
            'Facebook Business': { source: 'meta_paid', channel: 'lead_form' },
            'facebook business': { source: 'meta_paid', channel: 'lead_form' },
        },
        // Tags that trigger the autodialer (NOT source classifiers).
        trigger_tags: ['NEW LEAD ALERT', '2487'],
        // Tags that indicate a missed-call origin.
        missed_call_tags: ['Missed Call - Vonage', '2488'],
    },
};

export function sourceMap(tenantId = DEFAULT_TENANT) {
    const m = TENANT_SOURCE_MAPS[tenantId];
    if (!m) throw new Error(`No source map for tenant: ${tenantId}`);
    return m;
}

/**
 * Classify a trigger into a (source, channel) using the per-tenant source map.
 *   classifier = {
 *     tag_ids?: string[],            // AC tag ids on the contact
 *     tag_names?: string[],          // AC tag names on the contact
 *     ac_native_source?: string,     // AC contact.source / referrer
 *   }
 * Returns { source, channel } — source defaults to 'unknown' if nothing matched.
 */
export function classifySource(tenantId, classifier = {}) {
    const map = sourceMap(tenantId);
    const tagIds = (classifier.tag_ids || []).map(String);
    const tagNames = classifier.tag_names || [];

    // Lookup either by id or by lowercase name — the source map holds both.
    for (const v of [...tagIds, ...tagNames]) {
        const key = String(v).trim().toLowerCase();
        if (map.tag_to_source[key]) return map.tag_to_source[key];
        // Also try uncased (ids are numeric strings, unaffected by lowercasing)
        const rawKey = String(v).trim();
        if (map.tag_to_source[rawKey]) return map.tag_to_source[rawKey];
    }
    // Native AC source field (e.g. "Facebook Business" from the FB integration)
    const nat = classifier.ac_native_source;
    if (nat) {
        if (map.native_source_map[nat]) return map.native_source_map[nat];
        const nkey = String(nat).trim().toLowerCase();
        if (map.native_source_map[nkey]) return map.native_source_map[nkey];
    }

    return { source: 'unknown', channel: null };
}

// ---------------------------------------------------------------------------
// Journey upsert: by phone first, by email fallback. Returns journey id.
// ---------------------------------------------------------------------------

/**
 * Find-or-create a lead_journey row. Existing rows get their `last_touch_*`
 * fields refreshed and any null external IDs filled in; first_touch fields
 * are immutable once set.
 *
 * Throws if neither phone nor email is supplied.
 */
export async function upsertJourney(supabase, tenantId, {
    phone, email, name,
    firstTouchAt = new Date().toISOString(),
    firstTouchSource = 'unknown',
    firstTouchChannel = null,
    firstTouchCampaign = null,
    firstTouchAdGroup = null,
    firstTouchKeyword = null,
    firstTouchUrl = null,
    firstTouchUtm = null,
    firstTouchGclid = null,
    firstTouchFbclid = null,
    acContactId = null,
    rawFirstTouch = null,
}) {
    const phoneN = normalizePhone(phone);
    const emailN = normalizeEmail(email);
    if (!phoneN && !emailN) {
        throw new Error('upsertJourney: phone or email is required');
    }

    // Try phone match first (the universal key); fall back to email.
    const findBy = async (col, val) => {
        const r = await supabase
            .from('ag2020_lead_journey')
            .select('id, ac_contact_id')
            .eq('tenant_id', tenantId)
            .eq(col, val)
            .limit(1)
            .maybeSingle();
        return r.data || null;
    };
    let existing = null;
    if (phoneN) existing = await findBy('phone_normalized', phoneN);
    if (!existing && emailN) existing = await findBy('email_normalized', emailN);

    if (existing) {
        const patch = {
            last_touch_at: firstTouchAt,
            last_touch_source: firstTouchSource,
            updated_at: new Date().toISOString(),
        };
        // Fill in fields that were previously null
        if (acContactId && !existing.ac_contact_id) patch.ac_contact_id = acContactId;
        if (emailN) patch.email_normalized = emailN;
        await supabase.from('ag2020_lead_journey').update(patch).eq('id', existing.id);
        return existing.id;
    }

    const { data, error } = await supabase
        .from('ag2020_lead_journey')
        .insert({
            tenant_id: tenantId,
            phone: phone ?? null,
            phone_normalized: phoneN,
            email: email ?? null,
            email_normalized: emailN,
            first_touch_at: firstTouchAt,
            first_touch_source: firstTouchSource,
            first_touch_channel: firstTouchChannel,
            first_touch_campaign: firstTouchCampaign,
            first_touch_ad_group: firstTouchAdGroup,
            first_touch_keyword: firstTouchKeyword,
            first_touch_url: firstTouchUrl,
            first_touch_utm: firstTouchUtm,
            first_touch_gclid: firstTouchGclid,
            first_touch_fbclid: firstTouchFbclid,
            last_touch_at: firstTouchAt,
            last_touch_source: firstTouchSource,
            ac_contact_id: acContactId,
            journey_state: 'new',
            raw_first_touch: rawFirstTouch,
        })
        .select('id')
        .single();
    if (error) throw new Error('upsertJourney insert failed: ' + error.message);
    return data.id;
}

// ---------------------------------------------------------------------------
// Touchpoint insert
// ---------------------------------------------------------------------------

export async function insertTouchpoint(supabase, tenantId, journeyId, {
    touchpointAt = new Date().toISOString(),
    touchpointType,
    source = null,
    channel = null,
    direction = null,
    payload = null,
    revenueCents = null,
    durationSeconds = null,
}) {
    if (!journeyId) throw new Error('insertTouchpoint: journeyId required');
    if (!touchpointType) throw new Error('insertTouchpoint: touchpointType required');
    const { error } = await supabase.from('ag2020_lead_touchpoints').insert({
        tenant_id: tenantId,
        journey_id: journeyId,
        touchpoint_at: touchpointAt,
        touchpoint_type: touchpointType,
        source,
        channel,
        direction,
        payload,
        revenue_cents: revenueCents,
        duration_seconds: durationSeconds,
    });
    if (error) throw new Error('insertTouchpoint failed: ' + error.message);
}

// ---------------------------------------------------------------------------
// Journey state transitions (forward-only state machine)
// ---------------------------------------------------------------------------

const STATE_ORDER = [
    'new', 'contacted', 'spoke', 'quoted', 'won', 'completed', 'lost', 'dormant',
];

/**
 * Advance a journey's state if `newState` is forward of the current state.
 * Idempotent — backwards/equal transitions are no-ops.
 */
export async function advanceJourneyState(supabase, journeyId, newState) {
    const newIdx = STATE_ORDER.indexOf(newState);
    if (newIdx < 0) throw new Error('Unknown journey state: ' + newState);
    const cur = await supabase
        .from('ag2020_lead_journey')
        .select('journey_state')
        .eq('id', journeyId)
        .maybeSingle();
    if (!cur.data) return;
    const curIdx = STATE_ORDER.indexOf(cur.data.journey_state);
    if (newIdx > curIdx) {
        await supabase
            .from('ag2020_lead_journey')
            .update({ journey_state: newState, updated_at: new Date().toISOString() })
            .eq('id', journeyId);
    }
}

// ---------------------------------------------------------------------------
// Auth — shares the autodial webhook secret (one secret for the funnel surface)
// ---------------------------------------------------------------------------

export function attributionSecret() {
    return (
        process.env.AG2020_AUTODIAL_SECRET ||
        process.env.AG2020_MISSED_CALL_WEBHOOK_SECRET ||
        ''
    );
}
