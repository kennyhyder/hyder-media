/**
 * Digistore24 Keywords API
 * GET /api/digistore/keywords
 *
 * Serves keyword data from Supabase database
 * Falls back to static JSON if database unavailable
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse query params
    const { brand, category, limit = 10000, offset = 0 } = req.query;

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Build query
        let query = supabase
            .from('digistore_keywords')
            .select('*')
            .order('total_clicks', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (category) {
            query = query.eq('category', category);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Supabase error:', error);
            // Return empty with error flag - client will use static file
            return res.status(200).json({
                source: 'error',
                error: error.message,
                keywords: []
            });
        }

        // Parse brands JSON if stored as string
        const keywords = data.map(kw => ({
            ...kw,
            brands: typeof kw.brands === 'string' ? JSON.parse(kw.brands) : kw.brands
        }));

        // Filter by brand if specified
        let filtered = keywords;
        if (brand) {
            const brandLower = brand.toLowerCase();
            filtered = keywords.filter(kw =>
                kw.brands && kw.brands.some(b => b.name.toLowerCase() === brandLower)
            );
        }

        return res.status(200).json({
            source: 'database',
            count: filtered.length,
            keywords: filtered
        });

    } catch (error) {
        console.error('API error:', error);
        return res.status(200).json({
            source: 'error',
            error: error.message,
            keywords: []
        });
    }
}

export const config = {
    api: {
        responseLimit: false, // Allow large responses
    },
};
