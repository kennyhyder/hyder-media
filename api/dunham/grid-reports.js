/**
 * Dunham grid tracking — LocalFalcon report proxy
 *
 * GET /api/dunham/grid-reports              → list of scan reports (slim), newest first
 * GET /api/dunham/grid-reports?key=<report> → full report: summary, insights,
 *      49 grid points (rank per pin + top results), competitor table with
 *      ARP/ATRP/SoLV + coverage (data points / % of results), center, business.
 *
 * The LocalFalcon API key stays server-side. Competitor coverage stats are
 * computed here from the raw data_points so the dashboard matches the
 * localfalcon.com report view without shipping the heavy raw payload.
 */

const LF = 'https://api.localfalcon.com/v1';

const PLACE_TO_METRO = {
    'ChIJFbCscprBQIYRM53MaGUqvkI': 'Houston',
    'ChIJOe9WbTuZToYRdjnk3g4hdlc': 'Dallas',
    'ChIJESzDklNfXIYRSKnhjEOc-5w': 'San Antonio',
    'ChIJobIg8XW1RIYRI2NijdXj8vY': 'Austin',
    'ChIJ9Z7XgTlxToYRK-9kFoWG1u4': 'Fort Worth',
    'ChIJXdT6qO9Z54YRgyZUcFLPH2Y': 'El Paso',
    'ChIJkRtD_3vY-4YRuM7O3pL2vaI': 'Midland',
    'ChIJSUlIfLoT_oYRGGIjN9DF9tU': 'Lubbock',
    'ChIJn4Fc4H1PAYcRXCg2fBAF1jg': 'Amarillo',
    'ChIJ2alzKVmBRoYRtksX2EK0-dA': 'Bryan',
    'ChIJkwnwiTaNVoYRKOwYks3a1-s': 'Abilene',
    'ChIJXbFFdeCDT4YRY03SEa83fGw': 'Waco',
    'ChIJaWJDyaRJRYYRNT9soTv6pLE': 'Harker Heights',
    'ChIJ9W27gONfaIYRJPL6ubakDfQ': 'Corpus Christi',
    'ChIJiz2HdarLTYYRBJPfKtKa4O4': 'Denton',
    'ChIJ30Fdd4AZTIYR83clEzrjSYs': 'Plano',
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = (process.env.LOCALFALCON_API_KEY || '').trim();
    if (!apiKey) return res.status(500).json({ error: 'LOCALFALCON_API_KEY not set' });

    try {
        if (req.query.key) {
            const data = await lf(`reports/${encodeURIComponent(req.query.key)}/`, apiKey);
            return res.status(200).json(reportDetail(data));
        }
        let reports = [];
        let nextToken = null;
        for (let page = 0; page < 10; page++) {
            const params = { limit: '100' };
            if (nextToken) params.next_token = nextToken;
            const data = await lf('reports/', apiKey, params);
            let batch = data?.data?.reports ?? data?.data ?? [];
            if (!Array.isArray(batch)) batch = Object.values(batch);
            reports.push(...batch);
            nextToken = data?.data?.next_token || data?.next_token || null;
            if (!nextToken) break;
        }
        const slim = reports.filter(r => r && r.report_key).map(r => ({
            reportKey: r.report_key,
            date: r.date,
            keyword: r.keyword,
            placeId: r.place_id,
            metro: PLACE_TO_METRO[r.place_id] || r.location?.name || 'Unknown',
            business: r.location?.name || null,
            address: r.location?.address || null,
            arp: num(r.arp), atrp: num(r.atrp), solv: num(r.solv),
            gridSize: num(r.grid_size), radius: num(r.radius),
            measurement: r.measurement || 'mi',
        }));
        slim.sort((a, b) => parseLfDate(b.date) - parseLfDate(a.date));
        return res.status(200).json({ status: 'success', reports: slim });
    } catch (err) {
        return res.status(200).json({ status: 'error', error: err.message });
    }
}

async function lf(path, apiKey, params = {}) {
    const qs = new URLSearchParams({ api_key: apiKey, ...params });
    const resp = await fetch(`${LF}/${path}?${qs}`);
    const data = await resp.json();
    if (!data.success) throw new Error(data.message || `LocalFalcon ${resp.status}`);
    return data;
}

function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

export function parseLfDate(s) {
    // "7/22/2026 1:46 PM" → epoch
    const t = Date.parse(String(s || '').replace(/(\d+)\/(\d+)\/(\d+)/, '$1/$2/$3'));
    return Number.isFinite(t) ? t : 0;
}

function reportDetail(payload) {
    const d = payload.data;
    const totalPoints = (d.data_points || []).length || 1;

    // Coverage per competitor: how many grid points it appears in
    const coverage = {};
    for (const pt of d.data_points || []) {
        for (const r of pt.results || []) {
            coverage[r.place_id] = (coverage[r.place_id] || 0) + 1;
        }
    }

    const byArp = d.rankings?.by_arp || {};
    const byAtrp = d.rankings?.by_atrp || {};
    const bySolv = d.rankings?.by_solv || {};
    const competitors = Object.entries(d.places || {}).map(([pid, p]) => ({
        placeId: pid,
        name: p.name,
        address: p.address,
        rating: num(p.rating),
        reviews: num(p.reviews),
        phone: p.phone || null,
        website: p.display_url || null,
        claimed: !!p.claimed,
        categories: Object.values(p.categories || {}),
        isTarget: pid === d.place_id,
        dataPoints: coverage[pid] || 0,
        coveragePct: Math.round(100 * (coverage[pid] || 0) / totalPoints * 100) / 100,
        arp: num(byArp[pid]), atrp: num(byAtrp[pid]), solv: num(bySolv[pid]),
    }));
    competitors.sort((a, b) => (b.solv ?? -1) - (a.solv ?? -1)
        || (a.arp ?? 99) - (b.arp ?? 99) || b.dataPoints - a.dataPoints);

    const points = (d.data_points || []).map(pt => ({
        lat: num(pt.lat), lng: num(pt.lng),
        rank: pt.found ? num(pt.rank) : null,          // null = not found (20+)
        top: (pt.results || []).slice(0, 3).map(r => ({
            rank: r.rank, name: r.name, rating: num(r.rating), reviews: num(r.reviews),
        })),
    }));

    return {
        status: 'success',
        reportKey: d.report_key,
        date: d.date,
        keyword: d.keyword,
        platform: d.platform,
        metro: PLACE_TO_METRO[d.place_id] || d.location?.name,
        business: {
            name: d.location?.name, address: d.location?.address,
            rating: num(d.location?.rating), reviews: num(d.location?.reviews),
            placeId: d.place_id, claimed: !!d.location?.claimed,
            categories: Object.values(d.location?.categories || {}),
        },
        summary: {
            arp: num(d.arp), atrp: num(d.atrp), solv: num(d.solv),
            foundIn: num(d.found_in), totalPoints,
            foundPct: Math.round(1000 * (num(d.found_in) || 0) / totalPoints) / 10,
        },
        grid: {
            size: num(d.grid_size), radius: num(d.radius),
            measurement: d.measurement, centerLat: num(d.lat), centerLng: num(d.lng),
        },
        insights: {
            osolv: d.insights?.osolv || null,                 // {yours, top}
            solvDistance: d.insights?.solv_distance || null,  // {yours, average}
            competitors: d.insights?.solv_competitors || null, // {total, active}
        },
        points,
        competitors,
        publicUrl: d.public_url || null,
    };
}
