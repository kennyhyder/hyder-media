import { NextResponse } from "next/server";
import { CORS_HEADERS, handleError } from "@/lib/grid-api/utils";
import { fetchNews } from "@/lib/grid-api/news";
import { regulatoryClimate } from "@/lib/dc-policy";

// News -> "latest developments & hurdles" synthesis (Phase 3). Click-triggered
// from vet-a-site (NOT auto-run on every request — a public LLM call must be
// cost-guarded), using a cheap model. Turns raw local headlines + the state's
// regulatory posture into a 2-3 sentence read + a sentiment tag. Degrades to a
// no-op if ANTHROPIC_API_KEY is absent or Claude errors.

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const place = (searchParams.get("place") || "").trim();
  const state = (searchParams.get("state") || "").trim() || null;
  const mwRaw = searchParams.get("mw");
  const mw = mwRaw && !isNaN(parseFloat(mwRaw)) ? parseFloat(mwRaw) : null;
  if (!place) return handleError("place is required", 400);
  if (place.length > 120) return handleError("place too long", 400);

  const articles = await fetchNews(place);
  if (articles.length === 0) {
    return NextResponse.json(
      { summary: null, sentiment: null, sources: [] },
      { headers: CORS_HEADERS }
    );
  }

  const key = (process.env.ANTHROPIC_API_KEY || "").trim().replace(/^["']|["']$/g, "").trim();
  if (!key) {
    // No key — return the headlines only, no synthesis.
    return NextResponse.json(
      { summary: null, sentiment: null, sources: articles.slice(0, 5) },
      { headers: CORS_HEADERS }
    );
  }

  const reg = regulatoryClimate(state, mw);
  const headlines = articles.map((a) => `- ${a.title} (${a.domain}, ${a.date})`).join("\n");
  const prompt =
    `You are briefing a datacenter developer on the latest local developments for a candidate site.\n` +
    `Location: ${place}. State DC regulatory posture: ${reg.label}${reg.gated ? ` (${reg.gated})` : ""}.\n` +
    `Recent local news headlines (datacenter / grid / large-load related):\n${headlines}\n\n` +
    `In 2-3 sentences, summarize the latest developments and the key HURDLES a developer should ` +
    `know for siting here (power, permitting, moratoria, community, water). Be specific and factual ` +
    `to the headlines; do not invent. Then on a new line output exactly "SENTIMENT: X" where X is ` +
    `one of supportive, mixed, or cautionary.`;

  try {
    const model = process.env.ANTHROPIC_NEWS_MODEL || "claude-haiku-4-5-20251001";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 320,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
    }
    const j = await res.json();
    const text: string = (j?.content?.[0]?.text || "").trim();
    const sm = text.match(/SENTIMENT:\s*(supportive|mixed|cautionary)/i);
    const sentiment = sm ? sm[1].toLowerCase() : null;
    const summary = text.replace(/\n?SENTIMENT:.*$/i, "").trim() || null;
    return NextResponse.json(
      { summary, sentiment, sources: articles.slice(0, 5) },
      { headers: CORS_HEADERS }
    );
  } catch (e) {
    // Claude synthesis failed — log why so it isn't a silent black box, still return headlines.
    console.error(`[developments] synthesis failed for "${place}":`, e);
    return NextResponse.json(
      { summary: null, sentiment: null, sources: articles.slice(0, 5) },
      { headers: CORS_HEADERS }
    );
  }
}
