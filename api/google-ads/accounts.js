/**
 * Google Ads Accounts API
 * GET /api/google-ads/accounts
 *
 * Returns list of connected Google Ads accounts with summary metrics
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Initialize Supabase
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    try {
        // Get all accounts with their connection info
        const { data: accounts, error } = await supabase
            .from('google_ads_accounts')
            .select(`
                id,
                customer_id,
                descriptive_name,
                currency_code,
                time_zone,
                is_manager,
                status,
                last_sync_at,
                is_syncing,
                connection:google_ads_connections(
                    email,
                    is_active
                )
            `)
            .eq('connection.is_active', true)
            .order('descriptive_name');

        if (error) {
            throw error;
        }

        // Get summary metrics for each account (last 30 days)
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - 1);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);

        const accountsWithMetrics = await Promise.all(
            accounts.map(async (account) => {
                const { data: metrics } = await supabase
                    .rpc('get_conversion_summary', {
                        p_account_id: account.id,
                        p_start_date: startDate.toISOString().split('T')[0],
                        p_end_date: endDate.toISOString().split('T')[0],
                    });

                return {
                    ...account,
                    metrics: metrics?.[0] || {
                        total_conversions: 0,
                        total_value: 0,
                        total_cost: 0,
                        cpa: 0,
                        roas: 0,
                    },
                };
            })
        );

        res.status(200).json({
            success: true,
            accounts: accountsWithMetrics,
        });

    } catch (error) {
        console.error('Error fetching accounts:', error);
        res.status(500).json({ error: error.message });
    }
}
