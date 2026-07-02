/**
 * AG2020 — Halo Lift API
 *
 * GET /api/ag2020/halo-lift
 *   ?bucket=week|month   (default: week)
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD  (optional explicit window)
 *
 * Returns the statistical evidence that ad spend lifts unattributed revenue:
 *   - Pearson r + p-value (same-week + lag 1/2/4)
 *   - OLS slope ($ unattributed revenue per $1 ad spend) + 95% CI
 *   - Quartile comparison (low-spend weeks vs high-spend weeks)
 *   - Implied halo-adjusted attribution rate
 *
 * Pure read endpoint, no auth — dashboard is sessionStorage-gated.
 */

import { createClient } from '@supabase/supabase-js';

const TENANT = 'ag2020';
const PAID_SOURCES = new Set(['google_paid', 'meta_paid']);

// -- statistics helpers (no deps) -------------------------------------------
function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return { r: null, n };
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    if (denom === 0) return { r: 0, n, p: 1 };
    const r = num / denom;
    const t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
    const p = tTwoSidedP(Math.abs(t), n - 2);
    return { r: +r.toFixed(4), n, p: +p.toFixed(5) };
}
function tTwoSidedP(t, df) {
    const x = df / (df + t * t);
    return betaInc(x, df / 2, 0.5);
}
function betaInc(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
    return front * betaCF(x, a, b);
}
function betaCF(x, a, b) {
    const MAX_IT = 200, EPS = 3e-7, FPMIN = 1e-30;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; let h = d;
    for (let m = 1; m <= MAX_IT; m++) {
        const m2 = 2 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
        c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
        d = 1 / d; h *= d * c;
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
        c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
        d = 1 / d; const del = d * c; h *= del;
        if (Math.abs(del - 1) < EPS) break;
    }
    return h;
}
function lgamma(z) {
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function olsSimple(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
    }
    if (sxx === 0) return null;
    const b = sxy / sxx, a = my - b * mx;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (ys[i] - (a + b * xs[i])) ** 2;
    const sigma2 = sse / Math.max(1, n - 2);
    const seB = Math.sqrt(sigma2 / sxx);
    const t975 = 1.96;
    return {
        slope: +b.toFixed(4),
        slope_se: +seB.toFixed(4),
        slope_ci95: [+(b - t975 * seB).toFixed(4), +(b + t975 * seB).toFixed(4)],
        r2: +(1 - sse / ys.reduce((s, y) => s + (y - my) ** 2, 0)).toFixed(4),
        n,
    };
}
function welchT(xs, ys) {
    const nx = xs.length, ny = ys.length;
    if (nx < 2 || ny < 2) return null;
    const mx = mean(xs), my = mean(ys);
    const vx = xs.reduce((s, v) => s + (v - mx) ** 2, 0) / (nx - 1);
    const vy = ys.reduce((s, v) => s + (v - my) ** 2, 0) / (ny - 1);
    const se = Math.sqrt(vx / nx + vy / ny);
    if (se === 0) return { t: 0, p: 1 };
    const t = (my - mx) / se;
    const df = (vx / nx + vy / ny) ** 2 /
        ((vx / nx) ** 2 / (nx - 1) + (vy / ny) ** 2 / (ny - 1));
    return { t: +t.toFixed(3), df: +df.toFixed(1), p: +tTwoSidedP(Math.abs(t), df).toFixed(4) };
}

// ---------------------------------------------------------------------------
// Multiple linear regression via normal equations β = (XᵀX)⁻¹ Xᵀy.
// Used for the deseasonalized/detrended halo regression — isolates the ad
// spend coefficient after controlling for time trend + monthly seasonality.
// ---------------------------------------------------------------------------
function matT(A) {
    const r = A.length, c = A[0].length;
    const out = Array.from({ length: c }, () => new Array(r));
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j][i] = A[i][j];
    return out;
}
function matMul(A, B) {
    const r = A.length, m = A[0].length, c = B[0].length;
    const out = Array.from({ length: r }, () => new Array(c).fill(0));
    for (let i = 0; i < r; i++) for (let k = 0; k < m; k++) {
        const a = A[i][k];
        for (let j = 0; j < c; j++) out[i][j] += a * B[k][j];
    }
    return out;
}
function matInv(M) {
    const n = M.length;
    const a = M.map((row, i) => [...row, ...row.map((_, j) => i === j ? 1 : 0)]);
    for (let i = 0; i < n; i++) {
        let piv = i;
        for (let k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[piv][i])) piv = k;
        if (Math.abs(a[piv][i]) < 1e-12) throw new Error('matInv: singular at col ' + i);
        if (piv !== i) [a[i], a[piv]] = [a[piv], a[i]];
        const d = a[i][i];
        for (let j = 0; j < 2 * n; j++) a[i][j] /= d;
        for (let k = 0; k < n; k++) {
            if (k === i) continue;
            const f = a[k][i];
            if (f === 0) continue;
            for (let j = 0; j < 2 * n; j++) a[k][j] -= f * a[i][j];
        }
    }
    return a.map(row => row.slice(n));
}
function olsMulti(X, y) {
    const n = y.length, k = X[0].length;
    if (n <= k) return null;
    const Xt = matT(X);
    const XtXinv = matInv(matMul(Xt, X));
    const beta = matMul(XtXinv, matMul(Xt, y.map(v => [v]))).map(r => r[0]);
    const yhat = X.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));
    const res = y.map((v, i) => v - yhat[i]);
    const rss = res.reduce((s, r) => s + r * r, 0);
    const ymean = y.reduce((a, b) => a + b, 0) / n;
    const tss = y.reduce((s, v) => s + (v - ymean) ** 2, 0);
    const r2 = 1 - rss / tss;
    const sigma2 = rss / (n - k);
    const se = XtXinv.map((row, i) => Math.sqrt(sigma2 * row[i]));
    return { beta, se, r2, rss, sigma2, n, k };
}
function fP(F, df1, df2) {
    if (F <= 0) return 1;
    const x = df2 / (df2 + df1 * F);
    return betaInc(x, df2 / 2, df1 / 2);
}
function monthOf(iso) { return parseInt(iso.slice(5, 7), 10); }

/**
 * Build (controlled) halo coefficient for one revenue series.
 * Design matrix: [intercept, spend, trend, Feb..Dec (11 dummies, Jan=ref)]
 * Returns the spend coefficient + SE + t + p + partial F-test vs reduced
 * model (intercept + trend + season; no spend).
 */
function controlledHalo(rows, yKey) {
    // need >= 14 obs for the 14-col design matrix; demand a healthy buffer
    if (rows.length < 24) return null;
    const buildX = (includeSpend) => rows.map((r, i) => {
        const month = monthOf(r.period);
        const row = [1];
        if (includeSpend) row.push(r.spend);
        row.push(i);
        for (let m = 2; m <= 12; m++) row.push(month === m ? 1 : 0);
        return row;
    });
    const y = rows.map(r => r[yKey]);
    const full = olsMulti(buildX(true), y);
    const reduced = olsMulti(buildX(false), y);
    if (!full || !reduced) return null;
    const SPEND_IDX = 1;
    const beta = full.beta[SPEND_IDX], se = full.se[SPEND_IDX];
    const df = full.n - full.k;
    const t = beta / se;
    const p = tTwoSidedP(Math.abs(t), df);
    const F = ((reduced.rss - full.rss) / 1) / (full.rss / df);
    const Fp = fP(F, 1, df);
    return {
        spend_coef:    +beta.toFixed(4),
        spend_se:      +se.toFixed(4),
        spend_ci95:    [+(beta - 1.96 * se).toFixed(4), +(beta + 1.96 * se).toFixed(4)],
        t:             +t.toFixed(3),
        p:             +p.toFixed(6),
        df,
        full_r2:       +full.r2.toFixed(4),
        reduced_r2:    +reduced.r2.toFixed(4),
        delta_r2:      +(full.r2 - reduced.r2).toFixed(4),
        partial_F:     +F.toFixed(3),
        partial_F_p:   +Fp.toFixed(6),
        n: full.n,
    };
}

function weekKey(isoDate) {
    const d = new Date(isoDate + 'T00:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
}
function monthKey(iso) { return iso.slice(0, 7) + '-01'; }

async function pageAll(supabase, table, select, eqFilter = {}, notNull = null, gteCol = null, gteVal = null, lteCol = null, lteVal = null) {
    const out = [];
    let off = 0; const PAGE = 1000;
    for (;;) {
        let q = supabase.from(table).select(select).range(off, off + PAGE - 1);
        for (const [k, v] of Object.entries(eqFilter)) q = q.eq(k, v);
        if (notNull) q = q.not(notNull, 'is', null);
        if (gteCol) q = q.gte(gteCol, gteVal);
        if (lteCol) q = q.lte(lteCol, lteVal);
        const { data, error } = await q;
        if (error) throw new Error(`${table}: ${error.message}`);
        if (!data || !data.length) break;
        out.push(...data);
        if (data.length < PAGE) break;
        off += PAGE;
    }
    return out;
}

import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    if (!(await requireAuth(req, res))) return;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const bucket = (req.query.bucket || 'week').toLowerCase();
    const BUCKET = bucket === 'month' ? monthKey : weekKey;
    const start = req.query.start || null;
    const end = req.query.end || null;

    try {
        // Spend (filtered to window if provided)
        const spend = await pageAll(supabase, 'ag2020_ad_spend_daily', 'date, spend',
            { tenant_id: TENANT }, null, start ? 'date' : null, start, end ? 'date' : null, end);
        // Jobs with invoice_date (filtered)
        const jobs = await pageAll(supabase, 'ag2020_crm_jobs', 'invoice_date, invoice_amount, journey_id',
            { tenant_id: TENANT }, 'invoice_date', start ? 'invoice_date' : null, start, end ? 'invoice_date' : null, end);
        // Journey source map
        const journeys = await pageAll(supabase, 'ag2020_lead_journey', 'id, first_touch_source',
            { tenant_id: TENANT });
        const jourSrc = new Map();
        for (const j of journeys) jourSrc.set(j.id, j.first_touch_source || 'unknown');

        // Bucketize
        const series = new Map();
        const get = (k) => {
            if (!series.has(k)) series.set(k, { period: k, spend: 0, attributed: 0, unattributed: 0, total: 0 });
            return series.get(k);
        };
        for (const s of spend) get(BUCKET(s.date)).spend += Number(s.spend) || 0;
        for (const j of jobs) {
            const b = get(BUCKET(j.invoice_date));
            const amt = Number(j.invoice_amount) || 0;
            b.total += amt;
            const src = j.journey_id ? jourSrc.get(j.journey_id) : null;
            if (src && PAID_SOURCES.has(src)) b.attributed += amt;
            else b.unattributed += amt;
        }
        const sortedAll = [...series.values()].sort((a, b) => a.period.localeCompare(b.period));
        const both = sortedAll.filter(r => r.spend > 0 && r.total > 0);

        if (both.length < 8) {
            return res.status(200).json({
                status: 'insufficient_data',
                weeks: both.length, bucket,
                hint: 'Need at least 8 periods with both ad spend and revenue.',
            });
        }

        const spends = both.map(r => r.spend);
        const unattribs = both.map(r => r.unattributed);
        const totals = both.map(r => r.total);
        const attribs = both.map(r => r.attributed);

        // Correlations
        const corrs = {
            same_week_unattributed: pearson(spends, unattribs),
            same_week_total:        pearson(spends, totals),
            same_week_attributed:   pearson(spends, attribs),
        };
        for (const lag of [1, 2, 4]) {
            if (both.length <= lag + 2) continue;
            corrs[`lag${lag}_unattributed`] = pearson(spends.slice(0, -lag), unattribs.slice(lag));
            corrs[`lag${lag}_total`]        = pearson(spends.slice(0, -lag), totals.slice(lag));
        }

        // OLS (simple — no controls)
        const ols = {
            unattributed_per_spend: olsSimple(spends, unattribs),
            total_per_spend:        olsSimple(spends, totals),
        };

        // Controlled multi-regression — only if we're in weekly mode with
        // enough observations to fit the 14-col design matrix.
        let controlled = null;
        if (bucket === 'week' && both.length >= 24) {
            controlled = {
                unattributed: controlledHalo(both, 'unattributed'),
                total:        controlledHalo(both, 'total'),
            };
        }

        // Quartile
        let quartile = null;
        const qSize = Math.floor(both.length / 4);
        if (qSize >= 3) {
            const sortedBy = [...both].sort((a, b) => a.spend - b.spend);
            const q1 = sortedBy.slice(0, qSize);
            const q4 = sortedBy.slice(-qSize);
            const wU = welchT(q1.map(r => r.unattributed), q4.map(r => r.unattributed));
            const wT = welchT(q1.map(r => r.total), q4.map(r => r.total));
            quartile = {
                size: qSize,
                low_avg_spend:        +mean(q1.map(r => r.spend)).toFixed(2),
                low_avg_unattributed: +mean(q1.map(r => r.unattributed)).toFixed(2),
                low_avg_total:        +mean(q1.map(r => r.total)).toFixed(2),
                high_avg_spend:        +mean(q4.map(r => r.spend)).toFixed(2),
                high_avg_unattributed: +mean(q4.map(r => r.unattributed)).toFixed(2),
                high_avg_total:        +mean(q4.map(r => r.total)).toFixed(2),
                welch_unattributed: wU,
                welch_total: wT,
            };
        }

        const totSpend = spends.reduce((a, b) => a + b, 0);
        const totAttr  = attribs.reduce((a, b) => a + b, 0);
        const totUnat  = unattribs.reduce((a, b) => a + b, 0);
        const totAll   = totals.reduce((a, b) => a + b, 0);
        // Use the CONTROLLED coefficient for halo revenue if available — it's
        // a much better estimate of true causal lift than the simple OLS.
        const slope = controlled?.unattributed?.spend_coef ?? ols.unattributed_per_spend?.slope ?? 0;
        const haloRev = Math.max(0, slope * totSpend);
        const naiveAttrRate = totAll > 0 ? totAttr / totAll : 0;
        const adjustedAttrRate = totAll > 0 ? Math.min(1, (totAttr + haloRev) / totAll) : 0;

        return res.status(200).json({
            status: 'ok',
            bucket,
            date_range: { start: both[0].period, end: both[both.length - 1].period },
            weeks_analyzed: both.length,
            correlations: corrs,
            ols,
            controlled,  // multi-regression with trend + monthly seasonality
            quartile,
            totals: {
                spend: +totSpend.toFixed(2),
                revenue: +totAll.toFixed(2),
                attributed: +totAttr.toFixed(2),
                unattributed: +totUnat.toFixed(2),
                naive_attribution_rate: +naiveAttrRate.toFixed(4),
                implied_halo_revenue: +haloRev.toFixed(2),
                halo_per_dollar: +(haloRev / Math.max(1, totSpend)).toFixed(4),
                adjusted_attribution_rate: +adjustedAttrRate.toFixed(4),
            },
            // Tiny series for sparkline
            series: sortedAll.map(r => ({
                period: r.period,
                spend: +r.spend.toFixed(2),
                attributed: +r.attributed.toFixed(2),
                unattributed: +r.unattributed.toFixed(2),
                total: +r.total.toFixed(2),
            })),
        });
    } catch (e) {
        console.error('halo-lift error:', e);
        return res.status(500).json({ status: 'error', error: e.message });
    }
}
