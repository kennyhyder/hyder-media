/**
 * Digistore24 — PostHog activation & gclid-capture sync (daily cron)
 *
 * Pulls the Google-Ads-attributed vendor funnel from the client's PostHog
 * (project 91832 Prod_Digistore24, EU cloud) into Supabase:
 *   • ds24_activation_cohorts    — signup-month × geo cohort funnel
 *     (signups w/ real gclid → product started → first sale) + tracked GMV
 *   • ds24_gclid_capture_daily   — last 14 days signups vs gclid capture by geo
 *
 * Geo buckets: US / BR (our campaigns — capture currently broken at the
 * funnel handoff), DACH (client's own campaigns — the working benchmark),
 * other. The literal string "None" is DS24's junk gclid value — excluded.
 *
 * ALERT: emails kenny@ when US or BR capture rate crosses 1% on a full day —
 * i.e. the moment DS24 ships the signup-handoff fix and our attribution
 * starts flowing. Registered in the freshness canary (fetched_at).
 *
 * Schedule: daily 09:40 UTC (vercel.json). CRON_SECRET, fail-closed.
 */

export const config = { maxDuration: 120 };

const PH_HOST = 'https://eu.posthog.com';
const PH_PROJECT = '91832';
const GEO_BUCKET = `multiIf(toString(properties.$geoip_country_code) = 'US', 'US', toString(properties.$geoip_country_code) = 'BR', 'BR', toString(properties.$geoip_country_code) IN ('DE','AT','CH'), 'DACH', 'other')`;
const REAL_GCLID = `toString(properties.gclid) NOT IN ('', 'None') AND length(toString(properties.gclid)) > 15`;
const SIGNUP_EVENTS = `event IN ('Signup Submitted','Signup form submitted')`;

async function hogql(query) {
  const key = (process.env.DIGISTORE_POSTHOG_API_KEY || '').trim();
  if (!key) throw new Error('DIGISTORE_POSTHOG_API_KEY not set');
  const r = await fetch(`${PH_HOST}/api/projects/${PH_PROJECT}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  const j = await r.json();
  if (!r.ok || !j.results) throw new Error('posthog: ' + JSON.stringify(j).slice(0, 200));
  return j.results;
}

async function sbUpsert(table, rows) {
  if (!rows.length) return;
  const r = await fetch(`${(process.env.SUPABASE_URL || '').trim()}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: (process.env.SUPABASE_SERVICE_KEY || '').trim(),
      Authorization: `Bearer ${(process.env.SUPABASE_SERVICE_KEY || '').trim()}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`${table} upsert ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function sbGet(path) {
  const r = await fetch(`${(process.env.SUPABASE_URL || '').trim()}/rest/v1/${path}`, {
    headers: { apikey: (process.env.SUPABASE_SERVICE_KEY || '').trim(), Authorization: `Bearer ${(process.env.SUPABASE_SERVICE_KEY || '').trim()}` },
  });
  return r.json();
}

export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret || (req.headers.authorization || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const now = new Date().toISOString();
  try {
    // 1) Cohort funnel: signup month × geo (real-gclid cohort)
    const cohorts = await hogql(`
      WITH cohort AS (
        SELECT person_id, min(timestamp) AS su, any(${GEO_BUCKET}) AS geo
        FROM events WHERE ${SIGNUP_EVENTS} AND ${REAL_GCLID}
        GROUP BY person_id),
      pcs AS (SELECT person_id, min(timestamp) AS t FROM events WHERE event = 'Product Creation Started' GROUP BY person_id),
      fs AS (SELECT person_id, min(timestamp) AS t, any(toString(properties.userId)) AS uid FROM events WHERE event = 'First Sale' GROUP BY person_id),
      pv AS (SELECT toString(properties.vendor_id) AS vid, sum(toFloat(properties.order_price)) AS gmv FROM events WHERE event = 'Purchase Completed' GROUP BY vid)
      SELECT toStartOfMonth(su) AS cohort_month, cohort.geo AS geo,
        count() AS signups,
        countIf(pcs.t >= su) AS product_started,
        countIf(fs.t >= su) AS first_sales,
        round(countIf(fs.t >= su) / count() * 100, 2) AS activation_pct,
        round(avgIf(dateDiff('day', su, fs.t), fs.t >= su), 1) AS avg_days_to_sale,
        round(sumIf(pv.gmv, fs.t >= su), 2) AS tracked_gmv
      FROM cohort
      LEFT JOIN pcs ON pcs.person_id = cohort.person_id
      LEFT JOIN fs ON fs.person_id = cohort.person_id
      LEFT JOIN pv ON pv.vid = fs.uid
      GROUP BY cohort_month, geo ORDER BY cohort_month, geo`);

    // 2) Daily capture health, last 14 full-ish days
    const daily = await hogql(`
      SELECT toDate(timestamp) AS day, ${GEO_BUCKET} AS geo,
        count() AS signups,
        countIf(${REAL_GCLID}) AS with_gclid,
        round(countIf(${REAL_GCLID}) / count() * 100, 2) AS capture_pct
      FROM events WHERE ${SIGNUP_EVENTS} AND timestamp >= now() - INTERVAL 14 DAY
      GROUP BY day, geo ORDER BY day, geo`);

    // Alert BEFORE upsert: did US/BR capture cross 1% on the latest full day?
    const alerts = [];
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    for (const geo of ['US', 'BR']) {
      const fresh = daily.find((r) => String(r[0]).slice(0, 10) === yesterday && r[1] === geo);
      if (fresh && Number(fresh[4]) >= 1) {
        const prior = await sbGet(`ds24_gclid_capture_daily?geo=eq.${geo}&day=eq.${yesterday}&select=capture_pct`);
        if (!prior.length || Number(prior[0].capture_pct) < 1) alerts.push(`${geo}: ${fresh[4]}% capture on ${yesterday} (${fresh[3]}/${fresh[2]} signups)`);
      }
    }
    if (alerts.length) {
      const rk = (process.env.RESEND_API_KEY || '').trim();
      if (rk) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${rk}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: (process.env.RESEND_FROM || 'alerts@hyder.me').trim(),
            to: 'kenny@hyder.me',
            subject: '🎉 DS24 gclid capture went LIVE for ' + alerts.map(a => a.split(':')[0]).join('+'),
            text: `DS24 shipped the signup-handoff fix — gclid capture is now flowing for our campaigns:\n\n${alerts.join('\n')}\n\nActivation cohorts for US/BR will start maturing from today. Dashboard: https://hyder.me/clients/digistore24/vendor-activation-analysis`,
          }),
        }).catch(() => {});
      }
    }

    await sbUpsert('ds24_activation_cohorts', cohorts.map((r) => ({
      cohort_month: String(r[0]).slice(0, 10), geo: r[1], signups: r[2], product_started: r[3],
      first_sales: r[4], activation_pct: r[5], avg_days_to_sale: r[6], tracked_gmv: r[7], fetched_at: now,
    })));
    await sbUpsert('ds24_gclid_capture_daily', daily.map((r) => ({
      day: String(r[0]).slice(0, 10), geo: r[1], signups: r[2], with_gclid: r[3], capture_pct: r[4], fetched_at: now,
    })));

    return res.status(200).json({ ok: true, cohorts: cohorts.length, daily: daily.length, alerts });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
