/**
 * Google Ads - Digistore24 GA4 Insights
 * GET /api/digistore/ga4-insights
 *
 * Pulls vendor vs affiliate signup breakdown from BigQuery (GA4 export).
 * Reads from:
 *   • signup_history_apr2026 — historical 28-day backfill from the GA4 CSV
 *   • analytics_<property_id>.events_*  — live GA4 export (when available)
 *
 * Returns aggregate by ad_group + account_type. Frontend joins this with the
 * Google Ads spend data already loaded (campaign breakdown) to compute
 * effective vendor CPA per ad group.
 */

import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GA4_BQ_PROJECT_ID || 'ds24-analytics-9338';
const HISTORY_TABLE = process.env.GA4_BQ_HISTORY_TABLE || 'ds24_views.signup_history_apr2026';
const PROPERTY_ID = process.env.GA4_BQ_PROPERTY_ID; // e.g. "314577708" — set once GA4 export lands

function getBigQueryClient() {
    const keyJson = process.env.GA4_BQ_SERVICE_ACCOUNT_KEY;
    if (!keyJson) throw new Error('GA4_BQ_SERVICE_ACCOUNT_KEY not set in env');
    const credentials = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
    return new BigQuery({ projectId: PROJECT_ID, credentials });
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const result = { source: null, rows: [], totals: {}, errors: [], dataAge: null };

    try {
        const bq = getBigQueryClient();

        // Try the live GA4 export first (most current)
        let liveRows = [];
        if (PROPERTY_ID) {
            try {
                const liveQuery = `
                    WITH events AS (
                        SELECT
                            event_date,
                            event_name,
                            user_pseudo_id,
                            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'campaign')   AS utm_campaign,
                            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'content')    AS utm_content,
                            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'account_type') AS account_type,
                            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'source')     AS utm_source,
                            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'medium')     AS utm_medium
                        FROM \`${PROJECT_ID}.analytics_${PROPERTY_ID}.events_*\`
                        WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY))
                                                AND CONCAT('intraday_', FORMAT_DATE('%Y%m%d', CURRENT_DATE()))
                    )
                    SELECT
                        utm_content AS ad_group,
                        IFNULL(account_type, '(not set)') AS account_type,
                        COUNT(DISTINCT user_pseudo_id) AS active_users,
                        COUNTIF(event_name = 'signup_success') AS key_events
                    FROM events
                    WHERE utm_source = 'google' AND utm_medium = 'cpc'
                      AND utm_content IS NOT NULL
                    GROUP BY 1, 2
                `;
                const [job] = await bq.createQueryJob({ query: liveQuery, location: 'US' });
                const [rows] = await job.getQueryResults();
                liveRows = rows;
                result.source = 'live';
                result.dataAge = 'Last 28d (live GA4 export)';
            } catch (err) {
                // Fall back to historical if live isn't ready yet
                result.errors.push({ step: 'live_query', error: err.message });
            }
        }

        // Fallback: historical backfill table (always available)
        if (liveRows.length === 0) {
            const histQuery = `
                SELECT
                    ad_group,
                    account_type,
                    SUM(active_users) AS active_users,
                    SUM(key_events) AS key_events
                FROM \`${PROJECT_ID}.${HISTORY_TABLE}\`
                GROUP BY 1, 2
            `;
            const [job] = await bq.createQueryJob({ query: histQuery, location: 'US' });
            const [rows] = await job.getQueryResults();
            liveRows = rows;
            result.source = result.source || 'historical';
            result.dataAge = 'Mar 30 – Apr 26, 2026 (28d backfill)';
        }

        result.rows = liveRows.map(r => ({
            ad_group: r.ad_group,
            account_type: r.account_type,
            active_users: Number(r.active_users) || 0,
            key_events: Number(r.key_events) || 0,
        }));

        // Build totals: per ad_group { vendor, affiliate, notSet, total }
        const byAdGroup = {};
        for (const r of result.rows) {
            const ag = r.ad_group || '(unknown)';
            if (!byAdGroup[ag]) byAdGroup[ag] = { ad_group: ag, vendor: 0, affiliate: 0, notSet: 0, total: 0, signups: 0 };
            const bucket = r.account_type === 'vendor' ? 'vendor'
                         : r.account_type === 'affiliate' ? 'affiliate'
                         : 'notSet';
            byAdGroup[ag][bucket] += r.active_users;
            byAdGroup[ag].total += r.active_users;
            byAdGroup[ag].signups += r.key_events;
        }

        // Sort by total signups desc
        result.byAdGroup = Object.values(byAdGroup).sort((a, b) => b.signups - a.signups);

        // Account-wide totals
        result.totals = result.byAdGroup.reduce((acc, r) => {
            acc.vendor += r.vendor;
            acc.affiliate += r.affiliate;
            acc.notSet += r.notSet;
            acc.total += r.total;
            acc.signups += r.signups;
            return acc;
        }, { vendor: 0, affiliate: 0, notSet: 0, total: 0, signups: 0 });

        result.status = 'success';
        return res.status(200).json(result);

    } catch (error) {
        return res.status(200).json({
            status: 'error',
            error: error.message,
            rows: [], byAdGroup: [], totals: {},
        });
    }
}
