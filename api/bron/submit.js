/**
 * Bron intake questionnaire — submission handler.
 * POST /api/bron/submit  { token, respondent, role, answers:{...} }
 *
 * Flow (fail-safe): store the raw answers FIRST (so they're never lost even if
 * the AI step fails), then run Claude to turn the free-text answers into
 * structured pitch implications, then update the row. If Claude fails the row
 * still holds the raw answers with analysis_status='failed'.
 */
import nodemailer from 'nodemailer';

const INTAKE_TOKEN = 'bron-intake-9f3ax7'; // anti-spam; baked into the form
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const NOTIFY_TO = process.env.ADMIN_EMAIL || 'kenny@hyder.me';
const DASH_URL = 'https://hyder.me/clients/bron';

// Human labels for the choice/free-text answers (so the email reads cleanly).
const ANSWER_LABELS = {
  license: 'License status', license_detail: 'License detail',
  priority_segment: 'Priority segment', geos: 'Geos',
  channels_now: 'Channels live now', current_marketing: 'Marketing today / what worked',
  token_status: 'Token role in growth', budget_band: 'Monthly budget',
  target_cac: 'Target CAC / payback', has_brand_assets: 'Has brand assets',
  biggest_challenge: 'Biggest challenge', content_bottleneck: 'Content bottleneck',
  success_6mo: '6-month success', brand_donts: "Brand don'ts", anything_else: 'Anything else',
};

// The free-text questions Claude should analyze (must match the form ids).
const FREE_TEXT = {
  current_marketing: "What they're doing for marketing today + what's worked/not",
  biggest_challenge: 'Their single biggest growth/marketing bottleneck',
  target_cac: 'Their target CAC / payback economics',
  success_6mo: 'What success looks like in 6 months',
  content_bottleneck: 'Who produces content today + the constraint',
  brand_donts: "Brand guardrails / hard don'ts",
  anything_else: 'Anything else they added',
};

async function sb(path, method, body, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const ANALYSIS_SYSTEM = `You are a senior growth-marketing strategist prepping Kenny Hyder (paid-media + AI-content-production consultant) for a call with Bron — a self-custodial MPC crypto wallet (founder Dmitry Tokarev ex-Copper CEO; co-founder Mike Lobanov of Target Global VC; marketing led by Tyler Kenyon, a brand/PR marketer). Kenny's usual channels (Google/Meta search) are heavily restricted for crypto; the viable playbook is X Ads, crypto ad networks (Coinzilla/Bitmedia/Brave), KOL/influencer, Telegram community, content/SEO+PR, and referral/token loops — plus a compliance path to unlock Google (Canada/FINTRAC) and Meta (regulator license). Kenny's differentiators: he knows the crypto ad-policy maze, and he builds AI-accelerated content-production pipelines (framed as lower cost-per-creative / higher test velocity → lower CAC, NOT product dev).

You are given Bron's own answers to a pre-call questionnaire. Turn them into a decision-useful update to Kenny's pitch. Reply with ONLY a single JSON object, no prose, no markdown fences, in exactly this shape:
{
  "headline": "one punchy sentence: the single most important thing their answers change",
  "key_takeaways": ["4-6 short bullets of what their answers reveal"],
  "pitch_adjustments": [{"because": "the specific answer that triggers this", "do": "the concrete adjustment Kenny should make on the call"}],
  "channel_recommendation": "1-3 sentences: given their license status, priority segment, geos and budget, the recommended channel mix and the compliance move to unlock more",
  "flags": ["green flags (good fit signals) and red flags (risks/blockers), each prefixed 'GREEN:' or 'RED:'"],
  "per_answer": [{"question": "the free-text question label", "answer": "their verbatim answer (trimmed to <220 chars)", "insight": "what it means for the pitch, 1-2 sentences"}]
}
Limits to keep the response complete: key_takeaways 4-6 bullets; pitch_adjustments up to 5; per_answer ONLY for the non-empty free-text answers, insight max 2 sentences. Be specific and tactical. Skip blank answers. Ground everything in what they actually said.`;

async function analyze(answers) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('no anthropic key');
  const userMsg = `Bron's questionnaire answers (JSON):\n\n${JSON.stringify(answers, null, 2)}\n\nFree-text questions to prioritise in per_answer: ${Object.keys(FREE_TEXT).join(', ')}.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      temperature: 0.3,
      system: ANALYSIS_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  // extract the first balanced JSON object
  const start = text.indexOf('{');
  if (start === -1) throw new Error('no json in analysis');
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return JSON.parse(text.slice(start, end + 1));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Build the notification email HTML from the analysis + raw answers.
function buildEmailHtml(respondent, role, answers, analysis, status) {
  const a = analysis || {};
  const brand = '#8b5cf6';
  const P = [];
  P.push(`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e">`);
  P.push(`<div style="background:${brand};color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
    <div style="font-size:13px;opacity:.85;letter-spacing:.04em;text-transform:uppercase">Bron intake — new response</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(respondent || 'Someone at Bron')}${role ? ` · ${esc(role)}` : ''}</div>
  </div>`);
  P.push(`<div style="border:1px solid #e6e6ef;border-top:none;border-radius:0 0 10px 10px;padding:22px">`);

  if (status !== 'done') {
    P.push(`<div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:16px">
      AI analysis didn't run on this one — the raw answers are below, and it's on the dashboard. (analysis_status: ${esc(status)})</div>`);
  }

  if (a.headline) {
    P.push(`<div style="font-size:16px;font-weight:700;line-height:1.4;margin:0 0 18px;padding:14px 16px;background:#f5f3ff;border-left:3px solid ${brand};border-radius:6px">${esc(a.headline)}</div>`);
  }
  if (Array.isArray(a.key_takeaways) && a.key_takeaways.length) {
    P.push(`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:18px 0 8px">Key takeaways</h3><ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.55">`);
    a.key_takeaways.forEach((t) => P.push(`<li>${esc(t)}</li>`));
    P.push(`</ul>`);
  }
  if (Array.isArray(a.pitch_adjustments) && a.pitch_adjustments.length) {
    P.push(`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:20px 0 8px">Pitch adjustments</h3>`);
    a.pitch_adjustments.forEach((p) => P.push(`<div style="margin:0 0 12px;font-size:14px;line-height:1.5">
      <div style="color:#6b7280"><b>Because:</b> ${esc(p.because)}</div>
      <div style="margin-top:2px"><b style="color:${brand}">→ Do:</b> ${esc(p.do)}</div></div>`));
  }
  if (a.channel_recommendation) {
    P.push(`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:20px 0 8px">Channel recommendation</h3>
      <div style="font-size:14px;line-height:1.55">${esc(a.channel_recommendation)}</div>`);
  }
  if (Array.isArray(a.flags) && a.flags.length) {
    P.push(`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:20px 0 8px">Flags</h3>`);
    a.flags.forEach((f) => {
      const green = /^GREEN/i.test(f);
      P.push(`<div style="font-size:13.5px;line-height:1.5;margin:0 0 5px;color:${green ? '#166534' : '#991b1b'}">${esc(f)}</div>`);
    });
  }
  if (Array.isArray(a.per_answer) && a.per_answer.length) {
    P.push(`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:20px 0 8px">Per-answer read</h3>`);
    a.per_answer.forEach((pa) => P.push(`<div style="margin:0 0 12px;font-size:13.5px;line-height:1.5">
      <div style="color:#6b7280;font-weight:600">${esc(pa.question)}</div>
      <div style="font-style:italic;color:#374151">“${esc(pa.answer)}”</div>
      <div style="margin-top:2px"><b>Insight:</b> ${esc(pa.insight)}</div></div>`));
  }

  // Raw answers (all fields, so nothing is hidden)
  P.push(`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:22px 0 8px">All answers</h3><table style="width:100%;border-collapse:collapse;font-size:13px">`);
  Object.keys(ANSWER_LABELS).forEach((k) => {
    let v = answers ? answers[k] : '';
    if (Array.isArray(v)) v = v.join(', ');
    if (v == null || v === '') return;
    P.push(`<tr><td style="padding:6px 10px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${esc(ANSWER_LABELS[k])}</td><td style="padding:6px 0;border-bottom:1px solid #f0f0f5">${esc(v)}</td></tr>`);
  });
  P.push(`</table>`);

  P.push(`<div style="margin-top:22px"><a href="${DASH_URL}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Open the dashboard →</a></div>`);
  P.push(`</div></div>`);
  return P.join('');
}

async function notify(respondent, role, answers, analysis, status) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) throw new Error('no email creds (EMAIL_USER/EMAIL_PASS)');
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  const who = respondent || 'Someone at Bron';
  const subject = status === 'done' && analysis && analysis.headline
    ? `Bron intake · ${who}: ${String(analysis.headline).slice(0, 110)}`
    : `Bron intake · ${who} responded${status === 'done' ? '' : ' (analysis pending)'}`;
  await transporter.sendMail({
    from: user, to: NOTIFY_TO, subject,
    html: buildEmailHtml(who, role, answers, analysis, status),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.token !== INTAKE_TOKEN) return res.status(403).json({ error: 'forbidden' });
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : null;
    if (!answers || Object.keys(answers).length === 0) {
      return res.status(400).json({ error: 'No answers provided' });
    }
    const respondent = (body.respondent || '').toString().slice(0, 120) || null;
    const role = (body.role || '').toString().slice(0, 120) || null;

    // 1) store raw answers FIRST (never lose them)
    const inserted = await sb('bron_intake', 'POST', {
      respondent, role, answers,
      analysis_status: 'pending',
      meta: { ua: (req.headers['user-agent'] || '').slice(0, 200) },
    }, { Prefer: 'return=representation' });
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    const id = row?.id;

    // 2) analyze (best-effort) and update
    let analysis = null, status = 'failed', analysisError = null;
    try {
      analysis = await analyze({ respondent, role, ...answers });
      status = 'done';
    } catch (e) {
      analysisError = e.message;
      console.error('bron analyze failed:', e.message);
    }
    if (id) {
      try {
        await sb(`bron_intake?id=eq.${id}`, 'PATCH', {
          analysis, analysis_status: status,
          meta: { ua: (req.headers['user-agent'] || '').slice(0, 200), analysisError },
        });
      } catch (e) { console.error('bron update failed:', e.message); }
    }

    // 3) email Kenny the response + analysis (best-effort — never fail the request)
    let emailed = false;
    try {
      await notify(respondent, role, answers, analysis, status);
      emailed = true;
    } catch (e) { console.error('bron notify failed:', e.message); }

    return res.status(200).json({ ok: true, id, analyzed: status === 'done', emailed });
  } catch (error) {
    console.error('bron submit error:', error.message);
    return res.status(500).json({ error: 'submit_failed' });
  }
}
