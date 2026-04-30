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

const PROJECT_ID = (process.env.GA4_BQ_PROJECT_ID || 'ds24-analytics-9338').trim();
const HISTORY_TABLE = (process.env.GA4_BQ_HISTORY_TABLE || 'ds24_views.signup_history_apr2026').trim();
const PROPERTY_ID = (process.env.GA4_BQ_PROPERTY_ID || '').trim() || null; // e.g. "314577708" — set once GA4 export lands

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
    let bq;

    // Resolve date range (start/end ISO dates) — same pattern as the other endpoints
    const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    let start, end;
    if (isISO(req.query.start) && isISO(req.query.end)) {
        start = req.query.start; end = req.query.end;
    } else {
        const days = parseInt(req.query.days) || 28;
        const e = new Date(); const s = new Date();
        s.setDate(s.getDate() - days);
        start = s.toISOString().split('T')[0];
        end = e.toISOString().split('T')[0];
    }
    const startSuffix = start.replace(/-/g, '');
    const endSuffix = end.replace(/-/g, '');
    result.dateRange = { start, end };

    try {
        bq = getBigQueryClient();

        // Try the live GA4 export first (most current)
        let liveRows = [];
        if (PROPERTY_ID) {
            try {
                // Use GA4's session-level Google Ads attribution
                // (session_traffic_source_last_click.google_ads_campaign), which
                // survives cross-domain hops between the LP and signup form.
                // collected_traffic_source.manual_* would be empty here because
                // the URL params don't reach the signup domain — but GA4's own
                // session attribution preserves the original ad group.
                // acct_type (not account_type) per dev team's implementation.
                const liveQuery = `
                    SELECT
                        session_traffic_source_last_click.google_ads_campaign.ad_group_name AS ad_group,
                        IFNULL(
                          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'acct_type'),
                          (SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'acct_type'),
                          '(not set)'
                        ) AS account_type,
                        COUNT(DISTINCT user_pseudo_id) AS active_users,
                        COUNT(*) AS key_events
                    FROM \`${PROJECT_ID}.analytics_${PROPERTY_ID}.events_*\`
                    WHERE (
                            _TABLE_SUFFIX BETWEEN '${startSuffix}' AND '${endSuffix}'
                            OR _TABLE_SUFFIX BETWEEN 'intraday_${startSuffix}' AND 'intraday_${endSuffix}'
                          )
                      AND event_name = 'signup_success'
                      AND session_traffic_source_last_click.google_ads_campaign.ad_group_name IS NOT NULL
                    GROUP BY 1, 2
                `;
                // (DACH-DE traffic on same property is filtered out downstream
                //  — the dashboard's ad-group→campaign mapping only knows about
                //  US ad groups, so DE rows have no campaign and get dropped.)
                const [job] = await bq.createQueryJob({ query: liveQuery, location: 'US' });
                const [rows] = await job.getQueryResults();
                liveRows = rows;
                if (liveRows.length > 0) {
                    result.source = 'live';
                    result.dataAge = `${start} → ${end} (live GA4 export)`;
                }
            } catch (err) {
                // Fall back to historical if live isn't ready yet
                result.errors.push({ step: 'live_query', error: err.message });
            }
        }

        // Fallback: historical backfill table (always available)
        if (liveRows.length === 0) {
            // Column names from GA4 CSV autodetect: spaces → underscores, original case preserved
            // First, discover what columns actually exist in the table — handles either schema
            const schemaQuery = `
                SELECT column_name
                FROM \`${PROJECT_ID}.ds24_views.INFORMATION_SCHEMA.COLUMNS\`
                WHERE table_name = 'signup_history_apr2026'
            `;
            const [schemaJob] = await bq.createQueryJob({ query: schemaQuery, location: 'US' });
            const [schemaRows] = await schemaJob.getQueryResults();
            const cols = schemaRows.map(r => r.column_name);

            // Map our logical names → actual column names (case-insensitive substring match)
            const findCol = (...patterns) => {
                for (const p of patterns) {
                    const found = cols.find(c => c.toLowerCase() === p.toLowerCase());
                    if (found) return found;
                }
                for (const p of patterns) {
                    const found = cols.find(c => c.toLowerCase().includes(p.toLowerCase()));
                    if (found) return found;
                }
                return null;
            };
            const adGroupCol = findCol('ad_group', 'Session_Google_Ads_ad_group_name', 'ad group name');
            const accountTypeCol = findCol('account_type', 'Account_Type');
            const usersCol = findCol('active_users', 'Active_users');
            const keyEventsCol = findCol('key_events', 'Key_events');

            if (!adGroupCol || !accountTypeCol || !usersCol) {
                throw new Error(`Schema mismatch in historical table. Found columns: ${cols.join(', ')}`);
            }

            const histQuery = `
                SELECT
                    \`${adGroupCol}\` AS ad_group,
                    \`${accountTypeCol}\` AS account_type,
                    SUM(\`${usersCol}\`) AS active_users,
                    SUM(\`${keyEventsCol || usersCol}\`) AS key_events
                FROM \`${PROJECT_ID}.${HISTORY_TABLE}\`
                GROUP BY 1, 2
            `;
            const [job] = await bq.createQueryJob({ query: histQuery, location: 'US' });
            const [rows] = await job.getQueryResults();
            liveRows = rows;
            result.source = 'historical';
            result.historicalRange = 'Mar 30 – Apr 26, 2026';
            result.dataAge = `Historical 28d backfill (${result.historicalRange}) — does NOT reflect selected ${start} → ${end} window`;
            result.schemaUsed = { adGroupCol, accountTypeCol, usersCol, keyEventsCol };
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
        // Try to attach schema info for debugging
        let actualColumns = null;
        try {
            const [schemaRows] = await bq.query({
                query: `SELECT column_name, data_type FROM \`${PROJECT_ID}.ds24_views.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'signup_history_apr2026'`,
                location: 'US',
            });
            actualColumns = schemaRows.map(r => `${r.column_name} (${r.data_type})`);
        } catch (schemaErr) {
            actualColumns = `schema lookup also failed: ${schemaErr.message}`;
        }
        return res.status(200).json({
            status: 'error',
            error: error.message,
            actualColumns,
            rows: [], byAdGroup: [], totals: {},
        });
    }
}
