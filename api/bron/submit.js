/**
 * Bron intake questionnaire — submission handler.
 * POST /api/bron/submit  { token, respondent, role, answers:{...} }
 *
 * Flow (fail-safe): store the raw answers FIRST (so they're never lost even if
 * the AI step fails), then run Claude to turn the free-text answers into
 * structured pitch implications, then update the row. If Claude fails the row
 * still holds the raw answers with analysis_status='failed'.
 */
const INTAKE_TOKEN = 'bron-intake-9f3ax7'; // anti-spam; baked into the form
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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
  "per_answer": [{"question": "the free-text question label", "answer": "their verbatim answer (trimmed)", "insight": "what it means for the pitch"}]
}
Be specific and tactical. If an answer is blank, skip it. Ground everything in what they actually said.`;

async function analyze(answers) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('no anthropic key');
  const userMsg = `Bron's questionnaire answers (JSON):\n\n${JSON.stringify(answers, null, 2)}\n\nFree-text questions to prioritise in per_answer: ${Object.keys(FREE_TEXT).join(', ')}.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
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

    return res.status(200).json({ ok: true, id, analyzed: status === 'done', debug: req.query.debug === '1' ? analysisError : undefined });
  } catch (error) {
    console.error('bron submit error:', error.message);
    return res.status(500).json({ error: 'submit_failed' });
  }
}
