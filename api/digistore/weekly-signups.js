/**
 * Google Ads - Digistore24 Weekly Vendor / Affiliate Signups
 * GET /api/digistore/weekly-signups
 *
 * Returns weekly vendor + affiliate signup counts from April 10, 2026 forward.
 *
 * Data source by date range:
 *   • Apr 10 - Apr 30:  GA4 BigQuery export (acct_type event param split)
 *   • May  1 - today:    Google Ads conversion actions (Vendor / Affiliate Sign-up)
 *
 * The Apr 30 boundary matches the existing convention in:
 *   - api/digistore/ga4-insights.js   (clamps end ≤ 2026-04-30)
 *   - api/digistore/performance.js    (vendor-affiliate clamps start ≥ 2026-05-01)
 * which avoids double-counting the 3-day overlap window (Apr 30 - May 2) when
 * both the legacy combined conversion action and the new split actions were
 * active simultaneously. Old combined action was disabled May 3.
 *
 * Weeks are ISO weeks (Monday-Sunday), labelled by their starting Monday.
 * Partial first and current weeks are flagged with daysCovered < 7.
 */

import { BigQuery } from '@google-cloud/bigquery';
import { createClient } from '@supabase/supabase-js';

const REPORT_START = '2026-04-10';
const GA4_LAST_DATE = '2026-04-30';
const GADS_FIRST_DATE = '2026-05-01';

const CUSTOMER_ID = '2466246400';
const LOGIN_CUSTOMER_ID = '2466246400';
const VENDOR_NAME = 'Vendor Sign-up';
const AFFILIATE_NAME = 'Affiliate Sign-up';

const GA4_PROJECT_ID = (process.env.GA4_BQ_PROJECT_ID || 'ds24-analytics-9338').trim();
const GA4_PROPERTY_ID = (process.env.GA4_BQ_PROPERTY_ID || '').trim() || null;
const GA4_GA4_HISTORY_TABLE = (process.env.GA4_BQ_GA4_HISTORY_TABLE || 'ds24_views.signup_history_apr2026').trim();

function todayISO() {
    return new Date().toISOString().split('T')[0];
}

// Monday-start ISO week. Returns { weekStart, weekEnd } strings.
function isoWeekBounds(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day; // shift Sunday back 6, Mon forward 0, Tue back 1, etc.
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() + diffToMonday);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return {
        weekStart: mon.toISOString().split('T')[0],
        weekEnd: sun.toISOString().split('T')[0],
    };
}

function daysBetweenInclusive(startStr, endStr) {
    const s = new Date(startStr + 'T00:00:00Z');
    const e = new Date(endStr + 'T00:00:00Z');
    return Math.round((e - s) / 86400000) + 1;
}

function getBigQueryClient() {
    const keyJson = process.env.GA4_BQ_SERVICE_ACCOUNT_KEY;
    if (!keyJson) throw new Error('GA4_BQ_SERVICE_ACCOUNT_KEY not set in env');
    const credentials = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
    return new BigQuery({ projectId: GA4_PROJECT_ID, credentials });
}

async function getGoogleAdsAccessToken() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: connection, error } = await supabase
        .from('google_ads_connections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    if (error || !connection) throw new Error(`Google Ads connection not found: ${error?.message || 'no row'}`);

    let accessToken = connection.access_token;
    if (new Date(connection.token_expires_at) < new Date() && connection.refresh_token) {
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
        if (!refreshData.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(refreshData)}`);
        accessToken = refreshData.access_token;
        await supabase
            .from('google_ads_connections')
            .update({
                access_token: accessToken,
                token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
            })
            .eq('id', connection.id);
    }
    return accessToken;
}

// Returns { 'YYYY-MM-DD': { vendor, affiliate, approx? } } for the GA4 window.
// Uses live BigQuery export when GA4_PROPERTY_ID is set. For days in the
// requested range that have no live data (early April, before the live export
// was provisioned), falls back to the historical 28-day aggregate distributed
// uniformly across its coverage window (Mar 30 - Apr 26).
const HISTORICAL_COVERAGE_START = '2026-03-30';
const HISTORICAL_COVERAGE_END = '2026-04-26';
const HISTORICAL_COVERAGE_DAYS = 28;

async function fetchGA4DailySignups(start, end) {
    if (!GA4_PROPERTY_ID) {
        return { daily: {}, note: 'GA4_BQ_PROPERTY_ID not set; GA4 source returned empty' };
    }
    const bq = getBigQueryClient();
    const startSuffix = start.replace(/-/g, '');
    const endSuffix = end.replace(/-/g, '');

    // 1. Live BigQuery export per-day (works from ~Apr 23 onward typically).
    const liveQuery = `
        SELECT
            event_date,
            COALESCE(
                (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'acct_type'),
                (SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'acct_type'),
                '(not set)'
            ) AS account_type,
            COUNT(DISTINCT user_pseudo_id) AS users
        FROM \`${GA4_PROJECT_ID}.analytics_${GA4_PROPERTY_ID}.events_*\`
        WHERE (
                _TABLE_SUFFIX BETWEEN '${startSuffix}' AND '${endSuffix}'
                OR _TABLE_SUFFIX BETWEEN 'intraday_${startSuffix}' AND 'intraday_${endSuffix}'
              )
          AND event_name = 'signup_success'
          AND session_traffic_source_last_click.google_ads_campaign.customer_id = '${CUSTOMER_ID}'
        GROUP BY 1, 2
    `;

    const daily = {};
    try {
        const [job] = await bq.createQueryJob({ query: liveQuery, location: 'US' });
        const [rows] = await job.getQueryResults();
        for (const r of rows) {
            const date = r.event_date;
            if (!date) continue;
            const isoDate = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
            if (!daily[isoDate]) daily[isoDate] = { vendor: 0, affiliate: 0, approx: false };
            const bucket = r.account_type === 'vendor' ? 'vendor'
                         : r.account_type === 'affiliate' ? 'affiliate'
                         : null;
            if (bucket) daily[isoDate][bucket] += Number(r.users) || 0;
        }
    } catch (err) {
        // Live query may fail if the export table doesn't exist yet; continue
        // and fill from historical aggregate.
        if (!err.message?.includes('Not found')) throw err;
    }

    // 2. Identify days in the requested range with no live data.
    const allDays = [];
    {
        const cursor = new Date(start + 'T00:00:00Z');
        const endDate = new Date(end + 'T00:00:00Z');
        while (cursor <= endDate) {
            allDays.push(cursor.toISOString().split('T')[0]);
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
    }
    const missingDays = allDays.filter(d => !daily[d]);

    // 3. If gap days fall within the historical coverage window, distribute
    // historical aggregate uniformly across the historical days and fill the
    // gap days with the per-day rate. This is an approximation (early-period
    // signup volume probably wasn't perfectly uniform) but it's the best
    // available source for that window.
    const gapWithinHist = missingDays.filter(d =>
        d >= HISTORICAL_COVERAGE_START && d <= HISTORICAL_COVERAGE_END
    );

    if (gapWithinHist.length > 0) {
        try {
            const histTable = GA4_HISTORY_TABLE.replace(/^ds24_views\./, '');
            const schemaQuery = `
                SELECT column_name
                FROM \`${GA4_PROJECT_ID}.ds24_views.INFORMATION_SCHEMA.COLUMNS\`
                WHERE table_name = '${histTable}'
            `;
            const [schemaJob] = await bq.createQueryJob({ query: schemaQuery, location: 'US' });
            const [schemaRows] = await schemaJob.getQueryResults();
            const cols = schemaRows.map(r => r.column_name);
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
            const accountTypeCol = findCol('account_type', 'Account_Type');
            const usersCol = findCol('active_users', 'Active_users');
            if (accountTypeCol && usersCol) {
                const histQuery = `
                    SELECT
                        \`${accountTypeCol}\` AS account_type,
                        SUM(\`${usersCol}\`) AS active_users
                    FROM \`${GA4_PROJECT_ID}.${GA4_HISTORY_TABLE}\`
                    GROUP BY 1
                `;
                const [histJob] = await bq.createQueryJob({ query: histQuery, location: 'US' });
                const [histRows] = await histJob.getQueryResults();
                let vendor = 0, affiliate = 0;
                for (const r of histRows) {
                    const users = Number(r.active_users) || 0;
                    if (r.account_type === 'vendor') vendor += users;
                    else if (r.account_type === 'affiliate') affiliate += users;
                }
                const vendorPerDay = vendor / HISTORICAL_COVERAGE_DAYS;
                const affiliatePerDay = affiliate / HISTORICAL_COVERAGE_DAYS;
                for (const day of gapWithinHist) {
                    daily[day] = {
                        vendor: vendorPerDay,
                        affiliate: affiliatePerDay,
                        approx: true,
                    };
                }
            }
        } catch (err) {
            // Historical fallback failed; gap days stay empty.
            return { daily, note: `historical fallback failed: ${err.message}` };
        }
    }

    return { daily };
}

// Returns { 'YYYY-MM-DD': { vendor, affiliate } } for the Google Ads window.
async function fetchGoogleAdsDailySignups(start, end) {
    const accessToken = await getGoogleAdsAccessToken();
    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': LOGIN_CUSTOMER_ID,
        'Content-Type': 'application/json',
    };
    const query = `
        SELECT
            segments.date,
            segments.conversion_action_name,
            metrics.conversions
        FROM customer
        WHERE segments.date BETWEEN '${start}' AND '${end}'
            AND segments.conversion_action_name IN ('${VENDOR_NAME}', '${AFFILIATE_NAME}')
    `;
    const response = await fetch(
        `https://googleads.googleapis.com/v23/customers/${CUSTOMER_ID}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
    );
    const data = await response.json();
    if (data.error) throw new Error(`Google Ads API error: ${data.error.message}`);

    const daily = {};
    for (const row of (data.results || [])) {
        const date = row.segments?.date;
        const action = row.segments?.conversionActionName;
        const conv = parseFloat(row.metrics?.conversions || 0);
        if (!date || !action || conv === 0) continue;
        if (!daily[date]) daily[date] = { vendor: 0, affiliate: 0 };
        if (action === VENDOR_NAME) daily[date].vendor += conv;
        else if (action === AFFILIATE_NAME) daily[date].affiliate += conv;
    }
    return { daily };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const reportEnd = (req.query.end && /^\d{4}-\d{2}-\d{2}$/.test(req.query.end)) ? req.query.end : todayISO();
    const reportStart = REPORT_START;

    const errors = [];
    const sources = [];
    const dailyCombined = {}; // YYYY-MM-DD → { vendor, affiliate, source, approx? }

    // GA4 window (Apr 10 - Apr 30, clamped to reportEnd if earlier)
    const ga4End = reportEnd < GA4_LAST_DATE ? reportEnd : GA4_LAST_DATE;
    if (reportStart <= ga4End) {
        try {
            const { daily: ga4Daily, note } = await fetchGA4DailySignups(reportStart, ga4End);
            if (note) errors.push({ step: 'ga4_query', note });
            let hasApprox = false, hasLive = false;
            for (const [d, v] of Object.entries(ga4Daily)) {
                dailyCombined[d] = { vendor: v.vendor, affiliate: v.affiliate, source: 'ga4', approx: !!v.approx };
                if (v.approx) hasApprox = true; else hasLive = true;
            }
            const parts = [];
            if (hasLive) parts.push(`live BigQuery export`);
            if (hasApprox) parts.push(`historical 28d aggregate (uniform daily distribution)`);
            sources.push(`GA4 ${reportStart} → ${ga4End} (${parts.join(' + ') || 'no data'})`);
        } catch (err) {
            errors.push({ step: 'ga4_query', error: err.message });
        }
    }

    // Google Ads window (May 1 - reportEnd)
    if (reportEnd >= GADS_FIRST_DATE) {
        try {
            const { daily: gadsDaily } = await fetchGoogleAdsDailySignups(GADS_FIRST_DATE, reportEnd);
            for (const [d, v] of Object.entries(gadsDaily)) {
                dailyCombined[d] = { vendor: v.vendor, affiliate: v.affiliate, source: 'google_ads', approx: false };
            }
            sources.push(`Google Ads conversion actions ${GADS_FIRST_DATE} → ${reportEnd}`);
        } catch (err) {
            errors.push({ step: 'google_ads_query', error: err.message });
        }
    }

    // Bucket into ISO weeks (Monday-start)
    const weekMap = {};
    for (const [date, v] of Object.entries(dailyCombined)) {
        if (date < reportStart || date > reportEnd) continue;
        const { weekStart, weekEnd } = isoWeekBounds(date);
        if (!weekMap[weekStart]) {
            weekMap[weekStart] = {
                weekStart, weekEnd,
                vendor: 0, affiliate: 0,
                daysWithData: new Set(),
                sources: new Set(),
                anyApprox: false,
            };
        }
        weekMap[weekStart].vendor += v.vendor;
        weekMap[weekStart].affiliate += v.affiliate;
        weekMap[weekStart].daysWithData.add(date);
        weekMap[weekStart].sources.add(v.source);
        if (v.approx) weekMap[weekStart].anyApprox = true;
    }

    // Also include weeks that fall in the report range but have no data, so the
    // chart and table show a continuous timeline. Iterate week-by-week.
    {
        const firstWeek = isoWeekBounds(reportStart).weekStart;
        const lastWeek = isoWeekBounds(reportEnd).weekStart;
        let cursor = new Date(firstWeek + 'T00:00:00Z');
        while (cursor.toISOString().split('T')[0] <= lastWeek) {
            const weekStart = cursor.toISOString().split('T')[0];
            const weekEnd = isoWeekBounds(weekStart).weekEnd;
            if (!weekMap[weekStart]) {
                weekMap[weekStart] = {
                    weekStart, weekEnd,
                    vendor: 0, affiliate: 0,
                    daysWithData: new Set(),
                    sources: new Set(),
                    anyApprox: false,
                };
            }
            cursor.setUTCDate(cursor.getUTCDate() + 7);
        }
    }

    // Build the response. Clamp week ranges to the report's effective window so
    // the "days covered" reflects the reportable portion of each week.
    const weeks = Object.values(weekMap)
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
        .map(w => {
            const effStart = w.weekStart < reportStart ? reportStart : w.weekStart;
            const effEnd = w.weekEnd > reportEnd ? reportEnd : w.weekEnd;
            const possibleDays = daysBetweenInclusive(effStart, effEnd);
            const total = w.vendor + w.affiliate;
            return {
                weekStart: w.weekStart,
                weekEnd: w.weekEnd,
                effectiveStart: effStart,
                effectiveEnd: effEnd,
                possibleDays,
                vendor: Math.round(w.vendor * 10) / 10,
                affiliate: Math.round(w.affiliate * 10) / 10,
                total: Math.round(total * 10) / 10,
                vendorPct: total > 0 ? Math.round((w.vendor / total) * 1000) / 10 : 0,
                affiliatePct: total > 0 ? Math.round((w.affiliate / total) * 1000) / 10 : 0,
                sources: [...w.sources],
                isPartial: possibleDays < 7,
                isApprox: w.anyApprox,
            };
        });

    const totals = weeks.reduce((acc, w) => {
        acc.vendor += w.vendor;
        acc.affiliate += w.affiliate;
        acc.total += w.total;
        return acc;
    }, { vendor: 0, affiliate: 0, total: 0 });
    totals.vendor = Math.round(totals.vendor * 10) / 10;
    totals.affiliate = Math.round(totals.affiliate * 10) / 10;
    totals.total = Math.round(totals.total * 10) / 10;
    totals.vendorPct = totals.total > 0 ? Math.round((totals.vendor / totals.total) * 1000) / 10 : 0;
    totals.affiliatePct = totals.total > 0 ? Math.round((totals.affiliate / totals.total) * 1000) / 10 : 0;

    return res.status(200).json({
        status: errors.length > 0 ? 'partial' : 'success',
        reportStart,
        reportEnd,
        boundaries: {
            ga4_last_date: GA4_LAST_DATE,
            google_ads_first_date: GADS_FIRST_DATE,
            overlap_note: 'Apr 30 - May 2 had both legacy combined and new split actions active. GA4 covers through Apr 30; Google Ads covers May 1+. No double-counting.',
        },
        sources,
        weeks,
        totals,
        errors,
        generatedAt: new Date().toISOString(),
    });
}
