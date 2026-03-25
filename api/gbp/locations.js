/**
 * GBP Locations API
 * GET    /api/gbp/locations?client=dunham  - List all locations for client
 * POST   /api/gbp/locations               - Create or update a location
 * DELETE  /api/gbp/locations?id=xxx        - Delete a location
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    // GET — list all locations for a client
    if (req.method === 'GET') {
        try {
            const clientKey = req.query.client || 'dunham';

            const { data, error } = await supabase
                .from('gbp_locations')
                .select('*')
                .eq('client_key', clientKey)
                .order('created_at', { ascending: true });

            if (error) {
                console.error('Supabase GET error:', error);
                return res.status(500).json({ error: 'Database error', details: error.message });
            }

            return res.status(200).json({ success: true, locations: data || [] });
        } catch (err) {
            console.error('GET error:', err);
            return res.status(500).json({ error: 'Server error', details: err.message });
        }
    }

    // POST — create or update a location
    if (req.method === 'POST') {
        try {
            const { id, client_key, location_name, data } = req.body;

            if (!location_name) {
                return res.status(400).json({ error: 'location_name is required' });
            }

            const row = {
                client_key: client_key || 'dunham',
                location_name,
                data: data || {},
                updated_at: new Date().toISOString()
            };

            let result;

            if (id) {
                // Update existing
                const { data: updated, error } = await supabase
                    .from('gbp_locations')
                    .update(row)
                    .eq('id', id)
                    .select()
                    .single();

                if (error) {
                    console.error('Supabase UPDATE error:', error);
                    return res.status(500).json({ error: 'Failed to update', details: error.message });
                }
                result = updated;
            } else {
                // Create new
                const { data: created, error } = await supabase
                    .from('gbp_locations')
                    .insert(row)
                    .select()
                    .single();

                if (error) {
                    console.error('Supabase INSERT error:', error);
                    return res.status(500).json({ error: 'Failed to create', details: error.message });
                }
                result = created;
            }

            return res.status(200).json({ success: true, location: result });
        } catch (err) {
            console.error('POST error:', err);
            return res.status(500).json({ error: 'Server error', details: err.message });
        }
    }

    // DELETE — remove a location by id
    if (req.method === 'DELETE') {
        try {
            const id = req.query.id;
            if (!id) {
                return res.status(400).json({ error: 'id query parameter is required' });
            }

            const { error } = await supabase
                .from('gbp_locations')
                .delete()
                .eq('id', id);

            if (error) {
                console.error('Supabase DELETE error:', error);
                return res.status(500).json({ error: 'Failed to delete', details: error.message });
            }

            return res.status(200).json({ success: true, deleted: id });
        } catch (err) {
            console.error('DELETE error:', err);
            return res.status(500).json({ error: 'Server error', details: err.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
