/**
 * Affiliati - Alerts
 * GET  /api/affiliati/alerts — Returns unread alerts
 * POST /api/affiliati/alerts — Marks alerts as read
 */

import { createClient } from '@supabase/supabase-js';
import { AlertsPostSchema, validate } from './_validate.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    if (req.method === 'GET') {
        try {
            // Get unread alerts
            const { data: alerts, error } = await supabase
                .from('affiliati_alerts')
                .select('*')
                .eq('is_read', false)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;

            // Get total unread count
            const { count } = await supabase
                .from('affiliati_alerts')
                .select('id', { count: 'exact', head: true })
                .eq('is_read', false);

            return res.status(200).json({
                alerts: alerts || [],
                unread_count: count || 0,
            });

        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        const { data: params, error: validationError } = validate(AlertsPostSchema, req.body);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        try {
            const { error } = await supabase
                .from('affiliati_alerts')
                .update({ is_read: true })
                .in('id', params.alert_ids);

            if (error) throw error;

            return res.status(200).json({
                success: true,
                marked_read: params.alert_ids.length,
            });

        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
