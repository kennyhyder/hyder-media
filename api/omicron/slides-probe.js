// Phase-2 feasibility probe for the native Google Slides version of the Omicron
// weekly report. Uses the existing BigQuery service account (GA4_BQ_SERVICE_ACCOUNT_KEY)
// to mint a token (manual RS256 JWT — no extra deps), create a Slides deck with a
// title + one chart image, share it anyone-with-link, and return the URL. Tells us
// whether the Slides + Drive APIs are enabled and the SA can use them. CRON_SECRET-gated.
import crypto from 'crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function loadKey() {
  let raw = (process.env.GA4_BQ_SERVICE_ACCOUNT_KEY || '').trim();
  if (!raw) throw new Error('GA4_BQ_SERVICE_ACCOUNT_KEY not set');
  try { return JSON.parse(raw); } catch {}
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

async function getToken(key, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: key.client_email, scope: scopes.join(' '), aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(key.private_key);
  const jwt = `${header}.${claim}.${b64url(sig)}`;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const j = await r.json();
  if (!j.access_token) throw new Error('token exchange: ' + JSON.stringify(j));
  return j.access_token;
}

export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret && (req.headers.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  try {
    const key = loadKey();

    // ?enable=1 — try to enable the Slides + Drive APIs on the SA's project
    // (works only if the SA has serviceusage.services.enable permission).
    if (req.query?.enable === '1') {
      const tok = await getToken(key, ['https://www.googleapis.com/auth/cloud-platform']);
      const proj = key.project_id;
      const out = {};
      for (const svc of ['slides.googleapis.com', 'drive.googleapis.com']) {
        const r = await fetch(`https://serviceusage.googleapis.com/v1/projects/${proj}/services/${svc}:enable`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json().catch(() => ({}));
        out[svc] = r.ok ? 'enabled (or already)' : (j.error?.message || r.status);
      }
      return res.status(200).json({ ok: true, enable: out, project: proj });
    }

    const token = await getToken(key, ['https://www.googleapis.com/auth/presentations', 'https://www.googleapis.com/auth/drive']);
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // create presentation
    let r = await fetch('https://slides.googleapis.com/v1/presentations', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Omicron Weekly — Slides Probe' }) });
    let pres = await r.json();
    if (!r.ok) return res.status(200).json({ ok: false, stage: 'create', status: r.status, error: pres.error });
    const pid = pres.presentationId;
    const slideId = pres.slides?.[0]?.objectId;

    // add a title + one chart image
    const imgUrl = 'https://quickchart.io/chart?w=520&h=300&c=' + encodeURIComponent(JSON.stringify({ type: 'bar', data: { labels: ['Apr', 'May', 'Jun'], datasets: [{ label: 'Conv', data: [1200, 1350, 1100], backgroundColor: '#3b82f6' }] } }));
    r = await fetch(`https://slides.googleapis.com/v1/presentations/${pid}:batchUpdate`, { method: 'POST', headers: H, body: JSON.stringify({ requests: [
      { createImage: { url: imgUrl, elementProperties: { pageObjectId: slideId, size: { width: { magnitude: 4000000, unit: 'EMU' }, height: { magnitude: 2300000, unit: 'EMU' } }, transform: { scaleX: 1, scaleY: 1, translateX: 1000000, translateY: 1500000, unit: 'EMU' } } } },
    ] }) });
    const upd = await r.json();
    if (!r.ok) return res.status(200).json({ ok: false, stage: 'batchUpdate', status: r.status, error: upd.error, presentationId: pid });

    // share anyone-with-link (viewer)
    r = await fetch(`https://www.googleapis.com/drive/v3/files/${pid}/permissions`, { method: 'POST', headers: H, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
    const perm = await r.json();
    const shareOk = r.ok;

    return res.status(200).json({ ok: true, presentationId: pid, url: `https://docs.google.com/presentation/d/${pid}/edit`, shared: shareOk, shareError: shareOk ? null : perm.error, sa: key.client_email });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
