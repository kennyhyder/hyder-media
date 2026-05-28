/**
 * Halo coefficient — single source of truth for the "$ of unattributed
 * revenue per $1 of ad spend" multiplier used to estimate halo lift
 * per platform.
 *
 * Value comes from the deseasonalized + detrended multiple regression
 * documented in /api/ag2020/halo-lift.js. As of 2026-05-28:
 *
 *   unattributed_revenue ~ spend + trend + 11 month dummies
 *   spend coefficient (β₁) = $2.81 per $1 ad spend
 *   95% CI: [$2.00, $3.62]
 *   t = 6.84 on 103 df,  p < 0.00001
 *   ΔR² from adding spend: +6.7pp  (78.5% → 85.2%)
 *
 * Updatable via env var AG2020_HALO_PER_DOLLAR if a future regression
 * run produces a meaningfully different coefficient. Set to 0 to disable
 * halo attribution entirely.
 *
 * Allocation rule: each platform's share of the total system halo equals
 * (platform_spend / total_ad_spend) × (total_ad_spend × coefficient),
 * which simplifies to platform_spend × coefficient. So per-platform
 * halo revenue is just spend × coefficient, and the per-platform
 * halo-adjusted ROAS is (direct_attributed + halo_revenue) / spend.
 */

const DEFAULT_HALO_PER_DOLLAR = 2.81;
const DEFAULT_HALO_CI_LOW = 2.00;
const DEFAULT_HALO_CI_HIGH = 3.62;

export function getHaloPerDollar() {
    const env = process.env.AG2020_HALO_PER_DOLLAR;
    const v = env != null ? parseFloat(env) : DEFAULT_HALO_PER_DOLLAR;
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_HALO_PER_DOLLAR;
}

export function getHaloMeta() {
    return {
        per_dollar: getHaloPerDollar(),
        ci_low_per_dollar: DEFAULT_HALO_CI_LOW,
        ci_high_per_dollar: DEFAULT_HALO_CI_HIGH,
        source: 'deseasonalized + detrended OLS on 117 weekly buckets',
        p_value: '<0.00001',
        t_statistic: 6.84,
        r2_delta_pp: 6.7,
    };
}

/**
 * Apply halo to a per-platform metrics object that already has:
 *   spend, conversionValue (direct attributed revenue), roas
 * Mutates and returns the input, adding:
 *   haloRevenue, haloAdjustedRevenue, haloAdjustedRoas, haloPerDollar
 */
export function applyHalo(metrics) {
    const spend = Number(metrics.spend) || 0;
    const direct = Number(metrics.conversionValue) || 0;
    const perDollar = getHaloPerDollar();
    const haloRevenue = spend * perDollar;
    const total = direct + haloRevenue;
    metrics.haloPerDollar = perDollar;
    metrics.haloRevenue = haloRevenue;
    metrics.haloAdjustedRevenue = total;
    metrics.haloAdjustedRoas = spend > 0 ? total / spend : 0;
    return metrics;
}
