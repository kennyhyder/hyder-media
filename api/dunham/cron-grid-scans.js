/**
 * Dunham grid tracking — weekly LocalFalcon scan cron
 * GET /api/dunham/cron-grid-scans     (Mondays 14:00 UTC)
 *
 * Cadence (fits the 7,500-credit/month LocalFalcon package):
 *   - 6 priority metros × 3 keywords, every week           (882 credits/week)
 *   - 10 small markets × 3 keywords, first Monday of month (1,470 credits/month)
 *   ≈ 5,290 credits/month total, ~2,200 headroom for ad-hoc scans.
 *
 * Each scan: 7×7 grid, 5 mi radius, jail-centered, eager (fire and return —
 * reports are pulled by the dashboard via /api/dunham/grid-reports).
 * After firing, syncs the latest completed report summaries into
 * dunham_grid_scans for the historical trend line.
 *
 * Auth (fail-closed): Bearer CRON_SECRET or same-origin.
 */

import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 300 };

const KEYWORDS = ['bail bonds', 'fianzas', 'jail release'];   // 'bail bondsman' dropped 2026-07-23: 83-95% result overlap w/ 'bail bonds'; fianzas = 35% overlap (distinct Spanish market)
const METROS = [
    ['houston', 'ChIJFbCscprBQIYRM53MaGUqvkI', '29.7687', '-95.3576'],
    ['dallas', 'ChIJOe9WbTuZToYRdjnk3g4hdlc', '32.7770', '-96.8090'],
    ['san-antonio', 'ChIJESzDklNfXIYRSKnhjEOc-5w', '29.4290', '-98.5040'],
    ['austin', 'ChIJobIg8XW1RIYRI2NijdXj8vY', '30.2710', '-97.7480'],
    ['fort-worth', 'ChIJ9Z7XgTlxToYRK-9kFoWG1u4', '32.7590', '-97.3320'],
    ['el-paso', 'ChIJXdT6qO9Z54YRgyZUcFLPH2Y', '31.7570', '-106.4800'],
];
const SMALL_MARKETS = [
    ['midland', 'ChIJkRtD_3vY-4YRuM7O3pL2vaI', '31.9973', '-102.0779'],
    ['lubbock', 'ChIJSUlIfLoT_oYRGGIjN9DF9tU', '33.6290', '-101.8220'],
    ['amarillo', 'ChIJn4Fc4H1PAYcRXCg2fBAF1jg', '35.2220', '-101.8310'],
    ['bryan', 'ChIJ2alzKVmBRoYRtksX2EK0-dA', '30.6850', '-96.4050'],
    ['abilene', 'ChIJkwnwiTaNVoYRKOwYks3a1-s', '32.4158', '-99.7340'],
    ['waco', 'ChIJXbFFdeCDT4YRY03SEa83fGw', '31.5493', '-97.1467'],
    ['harker-heights', 'ChIJaWJDyaRJRYYRNT9soTv6pLE', '31.0567', '-97.4646'],
    ['corpus-christi', 'ChIJ9W27gONfaIYRJPL6ubakDfQ', '27.7963', '-97.3997'],
    ['denton', 'ChIJiz2HdarLTYYRBJPfKtKa4O4', '33.2153', '-97.1120'],
    ['plano', 'ChIJ30Fdd4AZTIYR83clEzrjSYs', '33.2468', '-96.6361'],
];
const PLACE_TO_METRO = Object.fromEntries(
    [...METROS, ...SMALL_MARKETS].map(([slug, pid]) => [pid, slug]));

export default async function handler(req, res) {
    const auth = req.headers['authorization'] || '';
    const referer = req.headers['referer'] || '';
    const isCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
    const isSameOrigin = /^https:\/\/(www\.)?hyder\.me\//.test(referer);
    if (!isCron && !isSameOrigin) return res.status(403).json({ error: 'Forbidden' });

    const apiKey = (process.env.LOCALFALCON_API_KEY || '').trim();
    if (!apiKey) return res.status(500).json({ error: 'LOCALFALCON_API_KEY not set' });

    const includeSmall = new Date().getUTCDate() <= 7;   // first Monday of the month
    const targets = includeSmall ? [...METROS, ...SMALL_MARKETS] : METROS;

    const fired = [];
    const errors = [];
    for (const [slug, pid, lat, lng] of targets) {
        for (const kw of KEYWORDS) {
            const body = new URLSearchParams({
                api_key: apiKey, place_id: pid, keyword: kw,
                lat, lng, grid_size: '7', radius: '5',
                measurement: 'mi', platform: 'google', eager: 'true',
            });
            try {
                const d = await (await fetch('https://api.localfalcon.com/v2/run-scan/', {
                    method: 'POST', body,
                })).json();
                if (d.success) fired.push(`${slug}:${kw}`);
                else errors.push(`${slug}:${kw}: ${d.message}`);
            } catch (e) {
                errors.push(`${slug}:${kw}: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 1200));
        }
    }

    // Sync completed report summaries into the history table
    let synced = 0;
    try {
        const list = await (await fetch(
            `https://api.localfalcon.com/v1/reports/?api_key=${apiKey}`)).json();
        let reports = list?.data?.reports ?? list?.data ?? [];
        if (!Array.isArray(reports)) reports = Object.values(reports);
        const rows = reports.filter(r => r?.report_key && PLACE_TO_METRO[r.place_id]).map(r => {
            const t = Date.parse(r.date);
            return {
                scan_date: Number.isFinite(t)
                    ? new Date(t).toISOString().slice(0, 10)
                    : new Date().toISOString().slice(0, 10),
                metro: PLACE_TO_METRO[r.place_id],
                keyword: r.keyword,
                place_id: r.place_id,
                report_key: r.report_key,
                grid_size: 7, radius_miles: 5,
                arp: parseFloat(r.arp) || null,
                atrp: parseFloat(r.atrp) || null,
                solv: parseFloat(r.solv) || 0,
            };
        });
        if (rows.length) {
            const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
            const { error } = await sb.from('dunham_grid_scans')
                .upsert(rows, { onConflict: 'scan_date,metro,keyword' });
            if (error) errors.push(`history sync: ${error.message}`);
            else synced = rows.length;
        }
    } catch (e) {
        errors.push(`history sync: ${e.message}`);
    }

    return res.status(200).json({
        status: errors.length && !fired.length ? 'error' : 'success',
        firedScans: fired.length,
        creditsUsed: fired.length * 49,
        includedSmallMarkets: includeSmall,
        historySynced: synced,
        errors: errors.slice(0, 10),
    });
}
