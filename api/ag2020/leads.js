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

const AC_PAGE_SIZE = 100; // AC max
const AC_MAX_PAGES = 20;  // safety cap (2000 contacts per request)

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

async function fetchTagBreakdown(baseUrl, headers, startDate, endDate, errors) {
    const { contacts, total, truncated } = await fetchAllContacts(baseUrl, headers, startDate, endDate);
    if (truncated) errors.push({ step: 'pagination', error: `Truncated at ${contacts.length} of ${total}` });

    // Need tag names -> fetch all tags used on these contacts
    // First, collect tag IDs from contactTags links
    const contactIds = contacts.map(c => c.id);
    if (contactIds.length === 0) return { total: 0, tags: [] };

    // Pull contactTag relations via include (included in fetchAllContacts response)
    // But since we fetched includes, we need to re-fetch with includes parsed
    // Simpler: fetch /contactTags for each contact. Too slow.
    // Best: fetch tags in range as a separate query by contact
    // For performance, fetch all contactTags for these contacts
    const tagCounts = {};
    const tagNames = {};

    // Batch: fetch contacts with full tag includes
    // We already did that via include=contactTags.tag; parsed result from fetchAllContacts throws away include data
    // Re-fetch with include and parse
    const filter = dateFilter(startDate, endDate);
    let offset = 0;
    for (let page = 0; page < AC_MAX_PAGES; page++) {
        const params = {
            ...filter,
            limit: AC_PAGE_SIZE,
            offset,
            include: 'contactTags.tag',
            'orders[cdate]': 'DESC',
        };
        const url = `${baseUrl}/contacts?${buildQuery(params)}`;
        const data = await acGet(url, headers);

        // data.contactTags is a list of { id, contact, tag }
        // data.tags is a list of { id, tag, tagType }
        const tagMap = {};
        for (const t of (data.tags || [])) tagMap[t.id] = t.tag;

        for (const ct of (data.contactTags || [])) {
            const name = tagMap[ct.tag] || `tag-${ct.tag}`;
            tagCounts[ct.tag] = (tagCounts[ct.tag] || 0) + 1;
            tagNames[ct.tag] = name;
        }

        if ((data.contacts || []).length < AC_PAGE_SIZE) break;
        offset += AC_PAGE_SIZE;
    }

    const tags = Object.entries(tagCounts)
        .map(([id, count]) => ({ id, name: tagNames[id], count }))
        .sort((a, b) => b.count - a.count);

    return { total: contacts.length, tags };
}

async function fetchListBreakdown(baseUrl, headers, startDate, endDate, errors) {
    // Fetch contacts with list includes
    const filter = dateFilter(startDate, endDate);
    const listCounts = {};
    const listNames = {};
    let totalContacts = 0;
    let offset = 0;

    for (let page = 0; page < AC_MAX_PAGES; page++) {
        const params = {
            ...filter,
            limit: AC_PAGE_SIZE,
            offset,
            include: 'contactLists.list',
            'orders[cdate]': 'DESC',
        };
        const url = `${baseUrl}/contacts?${buildQuery(params)}`;
        const data = await acGet(url, headers);

        totalContacts = parseInt(data.meta?.total || totalContacts, 10);

        const listMap = {};
        for (const l of (data.lists || [])) listMap[l.id] = l.name;

        for (const cl of (data.contactLists || [])) {
            // only count subscribed (status==1), not unsubscribed
            if (String(cl.status) !== '1') continue;
            const name = listMap[cl.list] || `list-${cl.list}`;
            listCounts[cl.list] = (listCounts[cl.list] || 0) + 1;
            listNames[cl.list] = name;
        }

        const got = (data.contacts || []).length;
        if (got < AC_PAGE_SIZE) break;
        offset += AC_PAGE_SIZE;
    }

    const lists = Object.entries(listCounts)
        .map(([id, count]) => ({ id, name: listNames[id], count }))
        .sort((a, b) => b.count - a.count);

    return { total: totalContacts, lists };
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
