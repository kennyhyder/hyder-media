/**
 * Google Ads Keyword Planner API
 * POST /api/google-ads/keywords
 *
 * Gets keyword ideas and metrics including:
 * - Search volume
 * - Competition level
 * - Top of page bid (low/high)
 * - CPC estimates
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    // Allow both GET (for testing) and POST
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get keywords from request body or query params
        let keywords = [];
        if (req.method === 'POST') {
            keywords = req.body.keywords || [];
        } else {
            // GET request - keywords as comma-separated query param
            const kwParam = req.query.keywords || req.query.kw || '';
            keywords = kwParam.split(',').map(k => k.trim()).filter(k => k);
        }

        if (keywords.length === 0) {
            return res.status(400).json({
                error: 'No keywords provided',
                usage: 'POST with { "keywords": ["keyword1", "keyword2"] } or GET with ?keywords=kw1,kw2'
            });
        }

        // Limit to 100 keywords per request
        if (keywords.length > 100) {
            keywords = keywords.slice(0, 100);
        }

        // Initialize Supabase
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Get the most recent connection
        const { data: connection, error: connError } = await supabase
            .from('google_ads_connections')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (connError || !connection) {
            return res.status(401).json({
                error: 'No Google Ads connection found',
                details: connError?.message
            });
        }

        let accessToken = connection.access_token;

        // Check if token is expired and refresh if needed
        if (new Date(connection.token_expires_at) < new Date()) {
            const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
                    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
                    refresh_token: connection.refresh_token,
                    grant_type: 'refresh_token',
                }),
            });

            const refreshData = await refreshResponse.json();

            if (refreshData.error) {
                return res.status(401).json({
                    error: 'Failed to refresh token',
                    details: refreshData
                });
            }

            accessToken = refreshData.access_token;

            // Update token in database
            await supabase
                .from('google_ads_connections')
                .update({
                    access_token: accessToken,
                    token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', connection.id);
        }

        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
        const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

        // Use the MCC account for keyword planning
        const customerId = loginCustomerId;

        // Generate keyword ideas using the Keyword Planner
        const keywordPlanResponse = await fetch(
            `https://googleads.googleapis.com/v23/customers/${customerId}:generateKeywordIdeas`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'developer-token': developerToken,
                    'login-customer-id': loginCustomerId,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    // Use keyword seed for exact keywords
                    keywordSeed: {
                        keywords: keywords
                    },
                    // Language: English
                    language: 'languageConstants/1000',
                    // Geographic targeting: United States
                    geoTargetConstants: ['geoTargetConstants/2840'],
                    // Include metrics
                    keywordPlanNetwork: 'GOOGLE_SEARCH',
                    // Historical metrics
                    historicalMetricsOptions: {
                        includeAverageCpc: true
                    }
                }),
            }
        );

        const keywordPlanText = await keywordPlanResponse.text();
        let keywordPlanData;

        try {
            keywordPlanData = JSON.parse(keywordPlanText);
        } catch (e) {
            return res.status(500).json({
                error: 'Invalid response from Google Ads API',
                status: keywordPlanResponse.status,
                preview: keywordPlanText.substring(0, 500)
            });
        }

        if (keywordPlanData.error) {
            return res.status(keywordPlanResponse.status).json({
                error: 'Google Ads API error',
                details: keywordPlanData.error
            });
        }

        // Parse and format the results
        const allResults = (keywordPlanData.results || []).map(result => {
            const metrics = result.keywordIdeaMetrics || {};

            return {
                keyword: result.text,
                avgMonthlySearches: parseInt(metrics.avgMonthlySearches) || 0,
                competition: metrics.competition || 'UNKNOWN',
                competitionIndex: parseInt(metrics.competitionIndex) || 0,
                lowTopOfPageBid: metrics.lowTopOfPageBidMicros
                    ? parseInt(metrics.lowTopOfPageBidMicros) / 1000000
                    : null,
                highTopOfPageBid: metrics.highTopOfPageBidMicros
                    ? parseInt(metrics.highTopOfPageBidMicros) / 1000000
                    : null,
                averageCpc: metrics.averageCpc?.micros
                    ? parseInt(metrics.averageCpc.micros) / 1000000
                    : null,
                // Monthly search volumes (last 12 months)
                monthlySearchVolumes: (metrics.monthlySearchVolumes || []).map(m => ({
                    month: m.month,
                    year: m.year,
                    searches: parseInt(m.monthlySearches) || 0
                }))
            };
        });

        // Check if user wants exact matches only
        const exactOnly = req.query.exact === 'true' || req.body?.exactOnly === true;
        const keywordsLower = keywords.map(k => k.toLowerCase());

        const results = exactOnly
            ? allResults.filter(r => keywordsLower.includes(r.keyword.toLowerCase()))
            : allResults;

        return res.status(200).json({
            success: true,
            requestedKeywords: keywords.length,
            totalResults: allResults.length,
            resultsCount: results.length,
            exactOnly: exactOnly,
            results: results
        });

    } catch (error) {
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
