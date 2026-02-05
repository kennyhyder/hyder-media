/**
 * AG2020 Cash Infusions API
 * GET /api/ag2020/cash-infusions - Fetch saved cash infusion selections
 * POST /api/ag2020/cash-infusions - Save cash infusion selections
 *
 * Stores a simple JSON object in Supabase with transaction IDs marked as cash infusions.
 * This allows all users to see the same selections.
 */

import { createClient } from '@supabase/supabase-js';

const TABLE_NAME = 'ag2020_settings';
const SETTING_KEY = 'cash_infusions';

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Initialize Supabase
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    if (req.method === 'GET') {
        try {
            // Fetch the cash infusion selections
            const { data, error } = await supabase
                .from(TABLE_NAME)
                .select('value, updated_at')
                .eq('key', SETTING_KEY)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
                console.error('Supabase error:', error);
                return res.status(500).json({ error: 'Database error', details: error.message });
            }

            // Return the selections (or empty object if none saved)
            return res.status(200).json({
                success: true,
                selections: data?.value || {},
                updatedAt: data?.updated_at || null
            });

        } catch (err) {
            console.error('GET error:', err);
            return res.status(500).json({ error: 'Server error', details: err.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { selections } = req.body;

            if (typeof selections !== 'object') {
                return res.status(400).json({ error: 'Invalid selections format' });
            }

            // Count how many transactions are selected
            const selectedCount = Object.values(selections).filter(Boolean).length;

            // Calculate total amount (passed from client)
            const totalAmount = req.body.totalAmount || 0;

            // Upsert the selections
            const { data, error } = await supabase
                .from(TABLE_NAME)
                .upsert({
                    key: SETTING_KEY,
                    value: selections,
                    metadata: {
                        selectedCount,
                        totalAmount,
                        lastUpdatedBy: req.headers['x-forwarded-for'] || 'unknown'
                    },
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'key'
                })
                .select()
                .single();

            if (error) {
                console.error('Supabase upsert error:', error);
                return res.status(500).json({ error: 'Failed to save selections', details: error.message });
            }

            return res.status(200).json({
                success: true,
                message: `Saved ${selectedCount} cash infusion selections`,
                updatedAt: data.updated_at
            });

        } catch (err) {
            console.error('POST error:', err);
            return res.status(500).json({ error: 'Server error', details: err.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
