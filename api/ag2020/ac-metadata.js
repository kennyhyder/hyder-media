/**
 * AG2020 - ActiveCampaign metadata for the Call Triage UI
 * GET /api/ag2020/ac-metadata
 *
 * Returns a flat snapshot of tags, pipelines (deal groups), stages, and
 * users from the AG2020 ActiveCampaign account so the triage tab can
 * populate its pickers without each agent's browser hitting AC directly.
 *
 * 5-minute in-memory cache to keep page loads snappy.
 */

let _cache = null;
let _cacheAt = 0;
const TTL_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const url = process.env.AG2020_ACTIVECAMPAIGN_URL;
    const key = process.env.AG2020_ACTIVECAMPAIGN_KEY;
    if (!url || !key) {
        return res.status(200).json({
            status: 'not_configured',
            error: 'AG2020_ACTIVECAMPAIGN_URL and AG2020_ACTIVECAMPAIGN_KEY required',
        });
    }

    const now = Date.now();
    if (_cache && (now - _cacheAt) < TTL_MS && req.query.refresh !== 'true') {
        return res.status(200).json({ ..._cache, cached: true });
    }

    const base = url.replace(/\/$/, '') + '/api/3';
    const headers = {
        'Api-Token': key,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    try {
        const [tagsRaw, pipelinesRaw, stagesRaw, usersRaw] = await Promise.all([
            fetchAll(`${base}/tags`, headers, 'tags'),
            fetchAll(`${base}/dealGroups`, headers, 'dealGroups'),
            fetchAll(`${base}/dealStages`, headers, 'dealStages'),
            fetchAll(`${base}/users`, headers, 'users'),
        ]);

        const tags = tagsRaw
            .filter(t => (t.tagType || 'contact') === 'contact')
            .map(t => ({ id: String(t.id), name: t.tag, description: t.description || null }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const pipelines = pipelinesRaw
            .map(g => ({ id: String(g.id), name: g.title }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const stagesByPipeline = {};
        for (const s of stagesRaw) {
            const gid = String(s.group);
            if (!stagesByPipeline[gid]) stagesByPipeline[gid] = [];
            stagesByPipeline[gid].push({
                id: String(s.id),
                name: s.title,
                order: parseInt(s.order, 10) || 0,
            });
        }
        for (const gid of Object.keys(stagesByPipeline)) {
            stagesByPipeline[gid].sort((a, b) => a.order - b.order);
        }

        const users = usersRaw
            .map(u => ({
                id: String(u.id),
                name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || `User ${u.id}`,
                username: u.username || null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const payload = {
            status: 'success',
            tags,
            pipelines,
            stagesByPipeline,
            users,
            fetchedAt: new Date().toISOString(),
        };

        _cache = payload;
        _cacheAt = now;
        return res.status(200).json(payload);
    } catch (err) {
        return res.status(200).json({ status: 'error', error: err.message });
    }
}

async function fetchAll(url, headers, key) {
    const all = [];
    let offset = 0;
    const LIMIT = 100;
    for (let page = 0; page < 20; page++) {
        const sep = url.includes('?') ? '&' : '?';
        const r = await fetch(`${url}${sep}limit=${LIMIT}&offset=${offset}`, { headers });
        if (!r.ok) {
            const t = await r.text();
            throw new Error(`AC ${url} ${r.status}: ${t.slice(0, 200)}`);
        }
        const d = await r.json();
        const chunk = d[key] || [];
        all.push(...chunk);
        if (chunk.length < LIMIT) break;
        offset += LIMIT;
    }
    return all;
}
