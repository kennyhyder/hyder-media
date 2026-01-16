/**
 * Google Ads Data Sync
 * POST /api/google-ads/sync
 *
 * Syncs campaign, ad group, keyword, and search term data from Google Ads to Supabase
 */

import { createClient } from '@supabase/supabase-js';

export const config = {
    maxDuration: 60, // Allow up to 60 seconds for sync operations
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { accountId, dateRange, syncType = 'FULL' } = req.body;

    if (!accountId) {
        return res.status(400).json({ error: 'accountId is required' });
    }

    // Initialize Supabase
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    try {
        // Get account and connection details
        const { data: account, error: accountError } = await supabase
            .from('google_ads_accounts')
            .select(`
                *,
                connection:google_ads_connections(*)
            `)
            .eq('id', accountId)
            .single();

        if (accountError || !account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        // Check if token needs refresh
        let accessToken = account.connection.access_token;
        if (new Date(account.connection.token_expires_at) <= new Date()) {
            accessToken = await refreshToken(supabase, account.connection);
        }

        // Create sync log entry
        const { data: syncLog } = await supabase
            .from('google_ads_sync_log')
            .insert({
                account_id: accountId,
                sync_type: syncType,
                status: 'STARTED',
                date_range_start: dateRange?.start || getDefaultStartDate(),
                date_range_end: dateRange?.end || getDefaultEndDate(),
            })
            .select()
            .single();

        // Mark account as syncing
        await supabase
            .from('google_ads_accounts')
            .update({ is_syncing: true })
            .eq('id', accountId);

        const startTime = Date.now();
        let totalRecords = 0;

        try {
            // Sync campaigns
            const campaignCount = await syncCampaigns(
                supabase,
                account,
                accessToken,
                dateRange
            );
            totalRecords += campaignCount;

            // Sync ad groups
            const adGroupCount = await syncAdGroups(
                supabase,
                account,
                accessToken,
                dateRange
            );
            totalRecords += adGroupCount;

            // Sync keywords (optional based on syncType)
            if (syncType === 'FULL' || syncType === 'KEYWORDS') {
                const keywordCount = await syncKeywords(
                    supabase,
                    account,
                    accessToken,
                    dateRange
                );
                totalRecords += keywordCount;
            }

            // Sync search terms (optional based on syncType)
            if (syncType === 'FULL' || syncType === 'SEARCH_TERMS') {
                const searchTermCount = await syncSearchTerms(
                    supabase,
                    account,
                    accessToken,
                    dateRange
                );
                totalRecords += searchTermCount;
            }

            // Update sync log - success
            await supabase
                .from('google_ads_sync_log')
                .update({
                    status: 'COMPLETED',
                    records_synced: totalRecords,
                    duration_ms: Date.now() - startTime,
                    completed_at: new Date().toISOString(),
                })
                .eq('id', syncLog.id);

            // Update account last sync
            await supabase
                .from('google_ads_accounts')
                .update({
                    is_syncing: false,
                    last_sync_at: new Date().toISOString(),
                })
                .eq('id', accountId);

            res.status(200).json({
                success: true,
                recordsSynced: totalRecords,
                durationMs: Date.now() - startTime,
            });

        } catch (syncError) {
            // Update sync log - failed
            await supabase
                .from('google_ads_sync_log')
                .update({
                    status: 'FAILED',
                    error_message: syncError.message,
                    duration_ms: Date.now() - startTime,
                    completed_at: new Date().toISOString(),
                })
                .eq('id', syncLog.id);

            // Update account
            await supabase
                .from('google_ads_accounts')
                .update({
                    is_syncing: false,
                    sync_error: syncError.message,
                })
                .eq('id', accountId);

            throw syncError;
        }

    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * Refresh OAuth token
 */
async function refreshToken(supabase, connection) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            refresh_token: connection.refresh_token,
            client_id: process.env.GOOGLE_ADS_CLIENT_ID,
            client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
            grant_type: 'refresh_token',
        }),
    });

    const tokens = await response.json();

    if (tokens.error) {
        throw new Error(`Token refresh failed: ${tokens.error}`);
    }

    // Update stored token
    await supabase
        .from('google_ads_connections')
        .update({
            access_token: tokens.access_token,
            token_expires_at: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
        })
        .eq('id', connection.id);

    return tokens.access_token;
}

/**
 * Execute Google Ads API query
 */
async function executeQuery(customerId, query, accessToken, loginCustomerId) {
    const response = await fetch(
        `https://googleads.googleapis.com/v15/customers/${customerId}/googleAds:search`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
                'login-customer-id': loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        }
    );

    const data = await response.json();

    if (data.error) {
        throw new Error(data.error.message || 'Google Ads API error');
    }

    return data.results || [];
}

/**
 * Sync campaigns and their metrics
 */
async function syncCampaigns(supabase, account, accessToken, dateRange) {
    const startDate = dateRange?.start || getDefaultStartDate();
    const endDate = dateRange?.end || getDefaultEndDate();

    // Fetch campaign data with metrics
    const query = `
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.bidding_strategy_type,
            campaign_budget.amount_micros,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value,
            metrics.all_conversions,
            metrics.all_conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
        ORDER BY campaign.id, segments.date
    `;

    const results = await executeQuery(
        account.customer_id,
        query,
        accessToken,
        account.connection.login_customer_id
    );

    let recordCount = 0;

    // Process results - group by campaign
    const campaignMap = new Map();

    for (const row of results) {
        const campaignId = row.campaign.id;

        if (!campaignMap.has(campaignId)) {
            campaignMap.set(campaignId, {
                campaign: row.campaign,
                budget: row.campaignBudget,
                metrics: [],
            });
        }

        campaignMap.get(campaignId).metrics.push({
            date: row.segments.date,
            ...row.metrics,
        });
    }

    // Upsert campaigns and metrics
    for (const [campaignId, data] of campaignMap) {
        // Upsert campaign
        const { data: campaign } = await supabase
            .from('google_ads_campaigns')
            .upsert({
                account_id: account.id,
                campaign_id: campaignId,
                name: data.campaign.name,
                status: data.campaign.status,
                advertising_channel_type: data.campaign.advertisingChannelType,
                bidding_strategy_type: data.campaign.biddingStrategyType,
                budget_amount_micros: data.budget?.amountMicros,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'account_id,campaign_id',
            })
            .select()
            .single();

        // Upsert metrics
        for (const metric of data.metrics) {
            await supabase
                .from('google_ads_campaign_metrics')
                .upsert({
                    campaign_id: campaign.id,
                    date: metric.date,
                    impressions: metric.impressions || 0,
                    clicks: metric.clicks || 0,
                    cost_micros: metric.costMicros || 0,
                    conversions: metric.conversions || 0,
                    conversions_value: metric.conversionsValue || 0,
                    all_conversions: metric.allConversions || 0,
                    all_conversions_value: metric.allConversionsValue || 0,
                }, {
                    onConflict: 'campaign_id,date',
                });

            recordCount++;
        }
    }

    return recordCount;
}

/**
 * Sync ad groups and their metrics
 */
async function syncAdGroups(supabase, account, accessToken, dateRange) {
    const startDate = dateRange?.start || getDefaultStartDate();
    const endDate = dateRange?.end || getDefaultEndDate();

    const query = `
        SELECT
            ad_group.id,
            ad_group.name,
            ad_group.status,
            ad_group.type,
            ad_group.cpc_bid_micros,
            campaign.id,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
        FROM ad_group
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND ad_group.status != 'REMOVED'
        ORDER BY ad_group.id, segments.date
    `;

    const results = await executeQuery(
        account.customer_id,
        query,
        accessToken,
        account.connection.login_customer_id
    );

    let recordCount = 0;

    // Group by ad group
    const adGroupMap = new Map();

    for (const row of results) {
        const adGroupId = row.adGroup.id;

        if (!adGroupMap.has(adGroupId)) {
            adGroupMap.set(adGroupId, {
                adGroup: row.adGroup,
                campaignId: row.campaign.id,
                metrics: [],
            });
        }

        adGroupMap.get(adGroupId).metrics.push({
            date: row.segments.date,
            ...row.metrics,
        });
    }

    // Upsert ad groups and metrics
    for (const [adGroupId, data] of adGroupMap) {
        // Get campaign reference
        const { data: campaign } = await supabase
            .from('google_ads_campaigns')
            .select('id')
            .eq('account_id', account.id)
            .eq('campaign_id', data.campaignId)
            .single();

        if (!campaign) continue;

        // Upsert ad group
        const { data: adGroup } = await supabase
            .from('google_ads_ad_groups')
            .upsert({
                campaign_id: campaign.id,
                ad_group_id: adGroupId,
                name: data.adGroup.name,
                status: data.adGroup.status,
                type: data.adGroup.type,
                cpc_bid_micros: data.adGroup.cpcBidMicros,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'campaign_id,ad_group_id',
            })
            .select()
            .single();

        // Upsert metrics
        for (const metric of data.metrics) {
            await supabase
                .from('google_ads_ad_group_metrics')
                .upsert({
                    ad_group_id: adGroup.id,
                    date: metric.date,
                    impressions: metric.impressions || 0,
                    clicks: metric.clicks || 0,
                    cost_micros: metric.costMicros || 0,
                    conversions: metric.conversions || 0,
                    conversions_value: metric.conversionsValue || 0,
                }, {
                    onConflict: 'ad_group_id,date',
                });

            recordCount++;
        }
    }

    return recordCount;
}

/**
 * Sync keywords and their metrics
 */
async function syncKeywords(supabase, account, accessToken, dateRange) {
    const startDate = dateRange?.start || getDefaultStartDate();
    const endDate = dateRange?.end || getDefaultEndDate();

    const query = `
        SELECT
            ad_group_criterion.criterion_id,
            ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type,
            ad_group_criterion.status,
            ad_group_criterion.quality_info.quality_score,
            ad_group.id,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value,
            metrics.top_impression_percentage,
            metrics.absolute_top_impression_percentage
        FROM keyword_view
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND ad_group_criterion.status != 'REMOVED'
        ORDER BY ad_group_criterion.criterion_id, segments.date
    `;

    const results = await executeQuery(
        account.customer_id,
        query,
        accessToken,
        account.connection.login_customer_id
    );

    let recordCount = 0;

    // Group by keyword
    const keywordMap = new Map();

    for (const row of results) {
        const criterionId = row.adGroupCriterion.criterionId;
        const key = `${row.adGroup.id}-${criterionId}`;

        if (!keywordMap.has(key)) {
            keywordMap.set(key, {
                criterion: row.adGroupCriterion,
                adGroupId: row.adGroup.id,
                metrics: [],
            });
        }

        keywordMap.get(key).metrics.push({
            date: row.segments.date,
            ...row.metrics,
        });
    }

    // Upsert keywords and metrics
    for (const [key, data] of keywordMap) {
        // Get ad group reference
        const { data: adGroup } = await supabase
            .from('google_ads_ad_groups')
            .select('id')
            .eq('ad_group_id', data.adGroupId)
            .single();

        if (!adGroup) continue;

        // Upsert keyword
        const { data: keyword } = await supabase
            .from('google_ads_keywords')
            .upsert({
                ad_group_id: adGroup.id,
                criterion_id: data.criterion.criterionId,
                keyword_text: data.criterion.keyword?.text,
                match_type: data.criterion.keyword?.matchType,
                status: data.criterion.status,
                quality_score: data.criterion.qualityInfo?.qualityScore,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'ad_group_id,criterion_id',
            })
            .select()
            .single();

        // Upsert metrics
        for (const metric of data.metrics) {
            await supabase
                .from('google_ads_keyword_metrics')
                .upsert({
                    keyword_id: keyword.id,
                    date: metric.date,
                    impressions: metric.impressions || 0,
                    clicks: metric.clicks || 0,
                    cost_micros: metric.costMicros || 0,
                    conversions: metric.conversions || 0,
                    conversions_value: metric.conversionsValue || 0,
                    top_impression_percentage: metric.topImpressionPercentage,
                    absolute_top_impression_percentage: metric.absoluteTopImpressionPercentage,
                }, {
                    onConflict: 'keyword_id,date',
                });

            recordCount++;
        }
    }

    return recordCount;
}

/**
 * Sync search terms
 */
async function syncSearchTerms(supabase, account, accessToken, dateRange) {
    const startDate = dateRange?.start || getDefaultStartDate();
    const endDate = dateRange?.end || getDefaultEndDate();

    const query = `
        SELECT
            search_term_view.search_term,
            campaign.id,
            ad_group.id,
            ad_group_criterion.keyword.text,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
        FROM search_term_view
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        ORDER BY metrics.impressions DESC
        LIMIT 10000
    `;

    const results = await executeQuery(
        account.customer_id,
        query,
        accessToken,
        account.connection.login_customer_id
    );

    let recordCount = 0;

    // Upsert search terms
    for (const row of results) {
        await supabase
            .from('google_ads_search_terms')
            .upsert({
                account_id: account.id,
                search_term: row.searchTermView.searchTerm,
                campaign_id: row.campaign?.id,
                ad_group_id: row.adGroup?.id,
                keyword_text: row.adGroupCriterion?.keyword?.text,
                date: row.segments.date,
                impressions: row.metrics.impressions || 0,
                clicks: row.metrics.clicks || 0,
                cost_micros: row.metrics.costMicros || 0,
                conversions: row.metrics.conversions || 0,
                conversions_value: row.metrics.conversionsValue || 0,
            }, {
                onConflict: 'account_id,search_term,date,campaign_id,ad_group_id',
            });

        recordCount++;
    }

    return recordCount;
}

/**
 * Get default start date (30 days ago)
 */
function getDefaultStartDate() {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
}

/**
 * Get default end date (yesterday)
 */
function getDefaultEndDate() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
}
