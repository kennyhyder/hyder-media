/**
 * Affiliati API - Zod Validation Helper
 */

import { z } from 'zod';

// ============================================
// Request Schemas
// ============================================

export const SyncOffersSchema = z.object({
    // No required params - syncs all active Clinical Research offers
});

export const EnrichOfferSchema = z.object({
    offer_id: z.number().int().positive(),
});

export const MatchTrialsSchema = z.object({
    offer_id: z.number().int().positive().optional(), // If omitted, matches all enriched offers
});

export const ManualMatchSchema = z.object({
    offer_id: z.number().int().positive(),
    nct_id: z.string().regex(/^NCT\d{8}$/, 'Must be a valid NCT ID (e.g., NCT12345678)'),
});

export const GenerateAdUnitSchema = z.object({
    offer_id: z.number().int().positive(),
    regenerate: z.boolean().optional().default(false),
});

export const OffersQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
    condition: z.string().optional(),
    has_matches: z.coerce.boolean().optional(),
    has_ad_unit: z.coerce.boolean().optional(),
});

export const OfferQuerySchema = z.object({
    offer_id: z.coerce.number().int().positive(),
});

export const AlertsPostSchema = z.object({
    alert_ids: z.array(z.string().uuid()).min(1),
});

// ============================================
// Validation Helper
// ============================================

/**
 * Validate request data against a Zod schema.
 * Returns { data, error } where error is a formatted API response string.
 */
export function validate(schema, data) {
    const result = schema.safeParse(data);
    if (result.success) {
        return { data: result.data, error: null };
    }
    const messages = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return { data: null, error: messages.join('; ') };
}
