// Lightweight, email-first lead capture. Public (anon) — writes via the service
// key into grid_leads. Fire-and-forget confirmation + owner-notification email
// (nodemailer, dynamically imported like the demo alerts; never blocks the response).
//
// POST { email, intent?, entity_type?, entity_id?, entity_name?, criteria?, source_page? }
//   -> { ok: true }
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { CORS_HEADERS } from "@/lib/grid-api/utils";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTENTS = new Set(["watch", "export", "access"]);

function clip(v: unknown, n = 300): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, n) : null;
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

function notify(lead: Record<string, string | null>): void {
  // Dynamic import so the build never hard-depends on nodemailer.
  void (async () => {
    try {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
      type NM = { createTransport: (o: unknown) => { sendMail: (m: unknown) => Promise<unknown> } };
      const specifier = "nodemailer";
      const mod = (await import(/* webpackIgnore: true */ specifier).catch(() => null)) as
        | ({ default?: NM } & Partial<NM>) | null;
      const nm = mod?.default ?? (mod as NM | null);
      if (!nm?.createTransport) return;
      const t = nm.createTransport({ service: "gmail", auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
      const label = lead.entity_name || lead.entity_type || "GridCensus";
      // 1) owner notification
      await t.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
        subject: `GridCensus lead (${lead.intent || "signup"}): ${lead.email}`,
        text: `New lead\n\nEmail: ${lead.email}\nIntent: ${lead.intent}\nEntity: ${label} (${lead.entity_type}/${lead.entity_id})\nCriteria: ${lead.criteria || "—"}\nPage: ${lead.source_page || "—"}`,
      });
      // 2) confirmation to the lead
      await t.sendMail({
        from: process.env.EMAIL_USER,
        to: lead.email!,
        subject: "You're on the list — GridCensus",
        text: `Thanks — you'll get updates${lead.entity_name ? ` on ${lead.entity_name}` : ""} from GridCensus.\n\nGridCensus scores 147,000+ US datacenter candidate sites on power, fiber, water, hazard and interconnection-queue readiness.\n\nhttps://gridcensus.com`,
      });
    } catch (err) {
      console.error("GridCensus lead email failed:", (err as Error)?.message || err);
    }
  })();
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch { /* empty */ }

    const email = clip(body.email, 254)?.toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ ok: false, error: "A valid email is required." }, { status: 400, headers: CORS_HEADERS });
    }
    const intentRaw = clip(body.intent);
    const lead = {
      email,
      intent: intentRaw && INTENTS.has(intentRaw) ? intentRaw : "watch",
      entity_type: clip(body.entity_type, 40),
      entity_id: clip(body.entity_id, 80),
      entity_name: clip(body.entity_name, 200),
      criteria: clip(body.criteria, 500),
      source_page: clip(body.source_page, 300),
      user_agent: clip(request.headers.get("user-agent"), 300),
      ip: clip(clientIp(request), 60),
    };

    const supabase = getSupabase();
    const { error } = await supabase.from("grid_leads").insert(lead);
    if (error) {
      console.error("GridCensus lead insert error:", error.message);
      // Don't lose the lead to the user — still fire the email and report soft-ok.
    }
    notify(lead);
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("GridCensus lead error:", err);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500, headers: CORS_HEADERS });
  }
}
