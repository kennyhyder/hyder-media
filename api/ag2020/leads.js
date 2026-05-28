/**
 * AG2020 - ActiveCampaign Leads
 * GET /api/ag2020/leads
 *
 * Query params:
 *   breakdown  - summary | daily | tags | lists | recent (default: summary)
 *   days       - number of days back from today (default: 30)
 *   startDate  - explicit start date (YYYY-MM-DD, overrides days)
 *   endDate    - explicit end date (YYYY-MM-DD, overrides days)
 *   limit      - max recent contacts to return (recent breakdown only, default 50, max 100)
 *
 * Env vars:
 *   AG2020_ACTIVECAMPAIGN_URL  (e.g. https://autoglass2020.api-us1.com)
 *   AG2020_ACTIVECAMPAIGN_KEY  (API access key)
 *
 * ActiveCampaign API docs: https://developers.activecampaign.com/reference
 */

const AC_PAGE_SIZE = 100;  // AC max
const AC_MAX_PAGES = 150;  // safety cap (15,000 contacts per request; 12mo of AG2020 runs ~10K)

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const AC_URL = process.env.AG2020_ACTIVECAMPAIGN_URL;
    const AC_KEY = process.env.AG2020_ACTIVECAMPAIGN_KEY;

    if (!AC_URL || !AC_KEY) {
        return res.status(200).json({
            status: 'not_configured',
            error: 'ActiveCampaign credentials missing',
            hint: 'Set AG2020_ACTIVECAMPAIGN_URL and AG2020_ACTIVECAMPAIGN_KEY in Vercel env',
        });
    }

    const breakdown = (req.query.breakdown || 'summary').toLowerCase();
    const { startDate, endDate } = resolveDateRange(req.query);
    const result = { dateRange: { start: startDate, end: endDate }, breakdown, status: 'loading', errors: [] };

    const headers = {
        'Api-Token': AC_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    const baseUrl = AC_URL.replace(/\/$/, '') + '/api/3';

    try {
        if (breakdown === 'summary') {
            result.summary = await fetchSummary(baseUrl, headers, startDate, endDate);
        } else if (breakdown === 'daily') {
            result.daily = await fetchDaily(baseUrl, headers, startDate, endDate, result.errors);
        } else if (breakdown === 'tags') {
            result.tags = await fetchTagBreakdown(baseUrl, headers, startDate, endDate, result.errors);
        } else if (breakdown === 'lists') {
            result.lists = await fetchListBreakdown(baseUrl, headers, startDate, endDate, result.errors);
        } else if (breakdown === 'recent') {
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            result.recent = await fetchRecent(baseUrl, headers, startDate, endDate, limit);
        } else {
            result.status = 'error';
            result.errors.push({ step: 'breakdown', error: `Unknown breakdown: ${breakdown}` });
            return res.status(200).json(result);
        }

        result.status = result.errors.length > 0 ? 'partial' : 'success';
        return res.status(200).json(result);
    } catch (err) {
        result.errors.push({ step: 'general', error: err.message });
        result.status = 'error';
        return res.status(200).json(result);
    }
}

// ============================================================================
// Date range helpers
// ============================================================================

function resolveDateRange(query) {
    if (query.startDate && query.endDate) {
        return { startDate: query.startDate, endDate: query.endDate };
    }
    const days = parseInt(query.days) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
    };
}

function dateFilter(startDate, endDate) {
    // AC expects ISO 8601 with timezone
    // filters[created_after] is inclusive; filters[created_before] is exclusive
    const startIso = `${startDate}T00:00:00-00:00`;
    // +1 day for end to make it inclusive
    const endPlus = new Date(endDate);
    endPlus.setDate(endPlus.getDate() + 1);
    const endIso = `${endPlus.toISOString().split('T')[0]}T00:00:00-00:00`;
    return {
        'filters[created_after]': startIso,
        'filters[created_before]': endIso,
    };
}

function buildQuery(params) {
    return Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

async function acGet(url, headers) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`ActiveCampaign ${response.status}: ${text.slice(0, 300)}`);
    }
    return response.json();
}

// Fetch all contacts in date range (paginated)
async function fetchAllContacts(baseUrl, headers, startDate, endDate, extraParams = {}) {
    const filter = dateFilter(startDate, endDate);
    const all = [];
    let offset = 0;
    let total = null;

    for (let page = 0; page < AC_MAX_PAGES; page++) {
        const params = {
            ...filter,
            ...extraParams,
            limit: AC_PAGE_SIZE,
            offset,
            'orders[cdate]': 'DESC',
            include: 'contactTags.tag,contactLists.list',
        };
        const url = `${baseUrl}/contacts?${buildQuery(params)}`;
        const data = await acGet(url, headers);

        const contacts = data.contacts || [];
        all.push(...contacts);

        if (total === null) total = parseInt(data.meta?.total || 0, 10);

        if (contacts.length < AC_PAGE_SIZE) break;
        offset += AC_PAGE_SIZE;
        if (all.length >= total) break;
    }

    return { contacts: all, total, truncated: all.length < (total || 0) };
}

// ============================================================================
// Breakdowns
// ============================================================================

async function fetchSummary(baseUrl, headers, startDate, endDate) {
    // Use meta.total with limit=1 (fast; no need to paginate)
    const filter = dateFilter(startDate, endDate);
    const params = { ...filter, limit: 1, offset: 0 };
    const url = `${baseUrl}/contacts?${buildQuery(params)}`;
    const data = await acGet(url, headers);
    const total = parseInt(data.meta?.total || 0, 10);

    // Also get total active contacts in account (no date filter)
    let accountTotal = null;
    try {
        const allUrl = `${baseUrl}/contacts?limit=1&offset=0`;
        const allData = await acGet(allUrl, headers);
        accountTotal = parseInt(allData.meta?.total || 0, 10);
    } catch (e) {
        // ignore
    }

    // Days in range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);

    return {
        totalLeads: total,
        avgPerDay: total / days,
        days,
        accountTotal,
    };
}

async function fetchDaily(baseUrl, headers, startDate, endDate, errors) {
    const { contacts, total, truncated } = await fetchAllContacts(baseUrl, headers, startDate, endDate);
    if (truncated) errors.push({ step: 'pagination', error: `Truncated at ${contacts.length} of ${total}` });

    const byDay = {};
    // Initialize zeros for every day in range
    const cur = new Date(startDate);
    const end = new Date(endDate);
    while (cur <= end) {
        const key = cur.toISOString().split('T')[0];
        byDay[key] = { date: key, count: 0 };
        cur.setDate(cur.getDate() + 1);
    }

    for (const c of contacts) {
        const cdate = c.cdate;
        if (!cdate) continue;
        const key = cdate.split('T')[0];
        if (byDay[key]) byDay[key].count += 1;
        else byDay[key] = { date: key, count: 1 };
    }

    return {
        total,
        series: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    };
}

// Pulled out of AC pagination — paginating 100K+ "recent" AC contacts with
// tag includes hit the 30s function timeout. AC's contactTags endpoint
// doesn't honor date filters either (verified 2026-05-28). Solution: read
// from our own ag2020_lead_journey table, which already has first_touch_at
// + first_touch_source/channel + ac_contact_id, indexed and instant.
//
// We expose two layers of "tags":
//   1. Friendly source labels (Google Ads, Meta Ads, Organic, …) grouped by
//      first_touch_source. These map back to the AC tags that classified
//      them (see /api/ag2020/_attribution-lib.js source_map).
//   2. Channel breakdown within each source (lead_form_d, homepage_form, …)
//      so you can see which specific AC tag drove the lead.
async function fetchTagBreakdown(_baseUrl, _headers, startDate, endDate, _errors) {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const startIso = `${startDate}T00:00:00Z`;
    // include the full end date by adding one day
    const endPlus = new Date(endDate); endPlus.setDate(endPlus.getDate() + 1);
    const endIso = endPlus.toISOString().slice(0, 19) + 'Z';

    // Paginate ag2020_lead_journey rows in the window (Supabase 1000-row cap)
    const rows = [];
    let off = 0;
    const PAGE = 1000;
    for (let page = 0; page < 100; page++) {
        const { data, error } = await sb
            .from('ag2020_lead_journey')
            .select('first_touch_source, first_touch_channel')
            .eq('tenant_id', 'ag2020')
            .gte('first_touch_at', startIso)
            .lt('first_touch_at', endIso)
            .range(off, off + PAGE - 1);
        if (error) throw new Error('Supabase journeys: ' + error.message);
        if (!data || !data.length) break;
        rows.push(...data);
        if (data.length < PAGE) break;
        off += PAGE;
    }

    // SOURCE_LABELS — keep in sync with DashboardTab.tsx / AttributionTab.tsx
    const labels = {
        google_paid:   'Google Ads',
        meta_paid:     'Meta Ads',
        organic:       'Organic',
        referral:      'Referral',
        call_inbound:  'Inbound Call',
        call_outbound: 'Outbound Call',
        unknown:       'Unknown / Historical',
    };

    // Aggregate by source AND by source/channel
    const bySource = {};
    const byChannel = {};
    for (const r of rows) {
        const src = r.first_touch_source || 'unknown';
        const ch = r.first_touch_channel || null;
        bySource[src] = (bySource[src] || 0) + 1;
        const key = ch ? `${src}::${ch}` : src;
        byChannel[key] = (byChannel[key] || 0) + 1;
    }

    const tags = Object.entries(bySource)
        .map(([src, count]) => ({
            id: src,
            name: labels[src] || src,
            count,
            channels: Object.entries(byChannel)
                .filter(([k]) => k.startsWith(src + '::'))
                .map(([k, c]) => ({ name: k.slice(src.length + 2), count: c }))
                .sort((a, b) => b.count - a.count),
        }))
        .sort((a, b) => b.count - a.count);

    return { total: rows.length, tags, source: 'ag2020_lead_journey' };
}

// Previously: paginated 100K+ AC contacts with include=contactLists.list.
// Timed out. New strategy: fetch the (small) list of AC lists, then in
// parallel get each list's active-subscriber count via the contactLists
// endpoint (which DOES respect filters[list]+filters[status]). 25-50 small
// requests, total ~3-5 sec, well under the 30s function timeout. We ignore
// the date window here — "Top Lists" is more useful as all-time subscriber
// counts than as "new subs in last 30 days" (which is sparse).
async function fetchListBreakdown(baseUrl, headers, _startDate, _endDate, errors) {
    let listsResp;
    try {
        listsResp = await acGet(`${baseUrl}/lists?limit=100`, headers);
    } catch (e) {
        errors.push({ step: 'fetch_lists', error: e.message });
        return { total: 0, lists: [] };
    }
    const lists = listsResp.lists || [];
    if (lists.length === 0) return { total: 0, lists: [] };

    // Count subscribers per list in parallel — AC limits ~5 req/s, so cap
    // concurrency at 5 and stagger.
    const results = [];
    const CONCURRENCY = 5;
    let idx = 0;
    async function worker() {
        while (idx < lists.length) {
            const i = idx++;
            const l = lists[i];
            try {
                const r = await acGet(
                    `${baseUrl}/contactLists?filters%5Blist%5D=${l.id}&filters%5Bstatus%5D=1&limit=1`,
                    headers,
                );
                const count = parseInt(r.meta?.total || 0, 10);
                results.push({ id: String(l.id), name: l.name, count });
            } catch (e) {
                results.push({ id: String(l.id), name: l.name, count: 0, error: e.message });
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const filtered = results
        .filter(r => r.count > 0)
        .sort((a, b) => b.count - a.count);

    return {
        total: filtered.reduce((s, r) => s + r.count, 0),
        lists: filtered,
        note: 'All-time active subscribers (date window does not apply to lists)',
    };
}

async function fetchRecent(baseUrl, headers, startDate, endDate, limit) {
    const filter = dateFilter(startDate, endDate);
    const params = {
        ...filter,
        limit,
        offset: 0,
        'orders[cdate]': 'DESC',
        include: 'contactTags.tag',
    };
    const url = `${baseUrl}/contacts?${buildQuery(params)}`;
    const data = await acGet(url, headers);

    const tagMap = {};
    for (const t of (data.tags || [])) tagMap[t.id] = t.tag;
    // Map contact -> tag names
    const contactTagMap = {};
    for (const ct of (data.contactTags || [])) {
        if (!contactTagMap[ct.contact]) contactTagMap[ct.contact] = [];
        const tagName = tagMap[ct.tag];
        if (tagName) contactTagMap[ct.contact].push(tagName);
    }

    const contacts = (data.contacts || []).map(c => ({
        id: c.id,
        email: c.email,
        phone: c.phone,
        firstName: c.firstName,
        lastName: c.lastName,
        cdate: c.cdate,
        udate: c.udate,
        tags: contactTagMap[c.id] || [],
    }));

    return {
        total: parseInt(data.meta?.total || 0, 10),
        contacts,
    };
}
