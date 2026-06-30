// Auto-apply an SEO opportunity (overlay metadata) — the "write" side of the
// autonomous loop.
//
// POST { opportunityId } — staff-gated OR CRON_SECRET-gated. Flow:
//   1. Load the opportunity + the page's current title/description.
//   2. Ask Claude for an improved title + description (given the GSC query +
//      position context). If ANTHROPIC_API_KEY is absent, skip Claude and
//      return the stored recommendation for manual apply.
//   3. Compliance check (length limits, no keyword stuffing).
//   4. Upsert gc_page_overrides (source='claude'), mark opportunity applied.
//   5. Log gc_seo_actions. Ping IndexNow for the URL.
//
// Everything is logged. We only act on a real, open opportunity row.

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { getCurrentUser } from "@/lib/auth";
import { normalizePath } from "@/lib/gsc/page-override";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INDEXNOW_KEY = "08991895ceb042ab8aacdc14bedff651cee608bf9c714b95967b284e815abe5d";
const INDEXNOW_HOST = "gridcensus.com";

interface Opportunity {
  id: string;
  type: string;
  page: string;
  query: string | null;
  impressions: number | null;
  clicks: number | null;
  position: number | null;
  ctr: number | null;
  priority: number | null;
  status: string;
  recommendation: Record<string, unknown> | null;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function authorize(request: Request): Promise<{ ok: boolean; actor: string }> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (secret && auth === `Bearer ${secret}`) return { ok: true, actor: "cron" };
  const user = await getCurrentUser();
  if (user && user.role === "staff") return { ok: true, actor: user.email || user.id };
  return { ok: false, actor: "" };
}

// ── Compliance ───────────────────────────────────────────────────────────────

interface ComplianceResult {
  ok: boolean;
  problems: string[];
}

function checkCompliance(title: string, description: string): ComplianceResult {
  const problems: string[] = [];
  if (!title || title.trim().length < 10) problems.push("title too short (<10 chars)");
  if (title.length > 65) problems.push(`title too long (${title.length} > 65 chars)`);
  if (!description || description.trim().length < 50)
    problems.push("description too short (<50 chars)");
  if (description.length > 160) problems.push(`description too long (${description.length} > 160 chars)`);

  // Keyword stuffing: any single word repeated >4 times in title+description.
  const words = `${title} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  for (const [w, n] of counts) {
    if (n > 4) problems.push(`keyword stuffing: "${w}" repeated ${n} times`);
  }
  return { ok: problems.length === 0, problems };
}

// ── Claude ───────────────────────────────────────────────────────────────────

interface ClaudeSuggestion {
  title: string;
  description: string;
  rationale?: string;
}

async function askClaude(
  current: { title: string; description: string },
  ctx: { page: string; query: string | null; type: string; metrics: Record<string, unknown> },
): Promise<ClaudeSuggestion | null> {
  // Defensive: strip surrounding quotes (some .env loaders keep them) and any
  // trailing newline (the classic `echo`-into-env-var corruption).
  const key = (process.env.ANTHROPIC_API_KEY || "").trim().replace(/^["']|["']$/g, "").trim();
  if (!key) return null;

  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const sys =
    "You are an SEO specialist improving the HTML <title> and <meta name=description> for a single web page on GridCensus, a public dataset of US power-grid + datacenter infrastructure. " +
    "Rewrite to maximize organic click-through for the target query WITHOUT keyword stuffing and WITHOUT misrepresenting the page. " +
    "Hard limits: title <= 60 characters, description 120-155 characters. Keep it factual, specific, and compelling. " +
    'Respond ONLY with minified JSON: {"title":"...","description":"...","rationale":"..."}';

  const user =
    `Page path: ${ctx.page}\n` +
    `Opportunity type: ${ctx.type}\n` +
    `Target search query: ${ctx.query ?? "(none)"}\n` +
    `GSC metrics: ${JSON.stringify(ctx.metrics ?? {})}\n\n` +
    `Current title: ${current.title}\n` +
    `Current description: ${current.description}\n\n` +
    `Improve the title and description for this query. Return JSON only.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        system: sys,
        messages: [{ role: "user", content: user }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content || []).map((c) => c.text || "").join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as ClaudeSuggestion;
    if (!parsed.title || !parsed.description) return null;
    return parsed;
  } catch (e) {
    throw new Error(`Claude call failed: ${(e as Error).message}`);
  }
}

// ── IndexNow ─────────────────────────────────────────────────────────────────

async function pingIndexNow(url: string): Promise<number | null> {
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`,
        urlList: [url],
      }),
    });
    return res.status;
  } catch {
    return null;
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { opportunityId?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const opportunityId = body.opportunityId || body.id;
  if (!opportunityId) {
    return NextResponse.json({ error: "opportunityId required" }, { status: 400 });
  }

  let sb;
  try {
    sb = getSupabase();
  } catch {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // 1) Load the opportunity — must be a real, open row.
  const { data: opp, error: oppErr } = await sb
    .from("gc_seo_opportunities")
    .select("id,type,page,query,impressions,clicks,position,ctr,priority,status,recommendation")
    .eq("id", opportunityId)
    .single();
  if (oppErr || !opp) {
    return NextResponse.json({ error: "opportunity not found" }, { status: 404 });
  }
  const opportunity = opp as Opportunity;
  if (opportunity.status === "applied") {
    return NextResponse.json({ error: "opportunity already applied" }, { status: 409 });
  }

  const path = normalizePath(opportunity.page);

  // Current overlay (if any) gives us the "current" title/desc to improve from.
  const { data: existingOverride } = await sb
    .from("gc_page_overrides")
    .select("title,description")
    .eq("page", path)
    .maybeSingle();
  const current = {
    title: (existingOverride?.title as string) || "",
    description: (existingOverride?.description as string) || "",
  };

  // 2) Ask Claude (or fall back to the recommendation for manual apply).
  let suggestion: ClaudeSuggestion | null = null;
  let claudeError: string | null = null;
  try {
    suggestion = await askClaude(current, {
      page: path,
      query: opportunity.query,
      type: opportunity.type,
      metrics: {
        impressions: opportunity.impressions,
        clicks: opportunity.clicks,
        position: opportunity.position,
        ctr: opportunity.ctr,
        priority: opportunity.priority,
        recommendation: opportunity.recommendation,
      },
    });
  } catch (e) {
    claudeError = (e as Error).message;
  }

  if (!suggestion) {
    // No ANTHROPIC_API_KEY (or Claude failed) → return the stored recommendation
    // for manual application. We do NOT write an override in this case.
    return NextResponse.json({
      ok: false,
      mode: "manual",
      reason: claudeError
        ? `Claude unavailable: ${claudeError}`
        : "ANTHROPIC_API_KEY not set — returning recommendation for manual apply",
      opportunity,
      recommendation: opportunity.recommendation,
    });
  }

  // 3) Compliance check.
  const compliance = checkCompliance(suggestion.title, suggestion.description);
  if (!compliance.ok) {
    // Log the rejected attempt but do not apply.
    await sb
      .from("gc_seo_actions")
      .insert({
        opportunity_id: opportunity.id,
        page: path,
        action_type: "apply_rejected",
        before_state: current,
        after_state: { proposed: suggestion, problems: compliance.problems },
        applied_by: auth.actor,
        compliance_passed: false,
        indexnow_pinged: false,
      })
      .then(
        () => {},
        () => {},
      );
    return NextResponse.json(
      { ok: false, reason: "compliance check failed", problems: compliance.problems, proposed: suggestion },
      { status: 422 },
    );
  }

  // 4) Upsert the override + mark the opportunity applied.
  const { error: upErr } = await sb.from("gc_page_overrides").upsert(
    {
      page: path,
      title: suggestion.title,
      description: suggestion.description,
      source: "claude",
      applied_at: new Date().toISOString(),
    },
    { onConflict: "page" },
  );
  if (upErr) {
    return NextResponse.json({ error: `failed to write override: ${upErr.message}` }, { status: 500 });
  }

  await sb
    .from("gc_seo_opportunities")
    .update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("id", opportunity.id);

  // 5) Log the action + ping IndexNow.
  const fullUrl = `${SITE_URL}${path}`;
  const indexnowStatus = await pingIndexNow(fullUrl);

  await sb
    .from("gc_seo_actions")
    .insert({
      opportunity_id: opportunity.id,
      page: path,
      action_type: "applied",
      before_state: current,
      after_state: {
        type: opportunity.type,
        query: opportunity.query,
        title: suggestion.title,
        description: suggestion.description,
        rationale: suggestion.rationale ?? null,
        indexnow_status: indexnowStatus,
      },
      applied_by: auth.actor,
      compliance_passed: true,
      indexnow_pinged: indexnowStatus === 200 || indexnowStatus === 202,
    })
    .then(
      () => {},
      () => {},
    );

  return NextResponse.json({
    ok: true,
    mode: "applied",
    page: path,
    applied: { title: suggestion.title, description: suggestion.description },
    rationale: suggestion.rationale ?? null,
    indexnow_status: indexnowStatus,
  });
}
