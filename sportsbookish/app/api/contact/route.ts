import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Spam-resistant contact form endpoint. Layered defenses:
//   1. Honeypot field — bots fill it, humans don't (UI hides it visually)
//   2. Time-gate — submission must take >= 3 seconds from page render
//   3. Token IP rate limit — max 3 messages per IP per 24h
//   4. Origin check — only same-site submissions allowed
//   5. Basic content heuristics — block obvious spam patterns
//   6. Body size cap — reject anything > 10KB
//
// Successful submissions stored in sb_contact_messages + emailed to admin.

export const runtime = "nodejs";

interface ContactPayload {
  name?: string;
  email?: string;
  message?: string;
  honey?: string;       // honeypot — must be empty
  rendered_at?: number; // client-side timestamp when the form first rendered
}

const MIN_DELAY_MS = 3000;
const DAILY_PER_IP = 3;
const SPAM_PATTERNS = [
  /\bviagra\b/i,
  /\bcasino\b/i,
  /\bseo\s+(services|expert|agency)\b/i,
  /\b(crypto|bitcoin)\s+(investment|trading)\b/i,
  /\bbacklinks?\b/i,
  /\b(buy|cheap)\s+(followers|likes)\b/i,
  /\bxxx\b/i,
  /<a\s+href=/i,
  /https?:\/\/\S+\.\S+.*https?:\/\/\S+\.\S+/i, // 2+ urls in message
];

export async function POST(req: Request) {
  // Origin check — production only allow same-site
  const origin = req.headers.get("origin") || "";
  const referer = req.headers.get("referer") || "";
  const allowedOrigins = [
    "https://sportsbookish.com",
    "https://www.sportsbookish.com",
    "https://sportsbookish.vercel.app",
    "http://localhost:3000",
  ];
  if (origin && !allowedOrigins.some((o) => origin.startsWith(o))) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (referer && !allowedOrigins.some((o) => referer.startsWith(o))) {
    return NextResponse.json({ error: "Invalid referer" }, { status: 403 });
  }

  // Size cap
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 10_000) {
    return NextResponse.json({ error: "Message too large" }, { status: 413 });
  }

  let body: ContactPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot
  if (body.honey && body.honey.trim() !== "") {
    // Silently 200 — don't tell bots they were caught
    return NextResponse.json({ ok: true });
  }

  // Time gate
  if (!body.rendered_at || (Date.now() - body.rendered_at) < MIN_DELAY_MS) {
    return NextResponse.json({ error: "Form submitted too quickly. Please wait a moment and try again." }, { status: 429 });
  }

  // Field validation
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const message = (body.message || "").trim();
  if (!name || name.length > 100) return NextResponse.json({ error: "Name required (1-100 chars)" }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (!message || message.length < 10 || message.length > 5000) {
    return NextResponse.json({ error: "Message must be 10-5000 chars" }, { status: 400 });
  }

  // Spam pattern check
  const combined = `${name}\n${email}\n${message}`;
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(combined)) {
      // Silently drop
      return NextResponse.json({ ok: true });
    }
  }

  // IP rate limit (24h)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const service = createServiceClient();
  const dayStart = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await service
    .from("sb_contact_messages")
    .select("id", { count: "exact", head: true })
    .eq("ip_address", ip)
    .gte("created_at", dayStart);
  if ((count || 0) >= DAILY_PER_IP) {
    return NextResponse.json({ error: "Rate limit hit. Try again tomorrow." }, { status: 429 });
  }

  // Persist + email
  const userAgent = req.headers.get("user-agent")?.slice(0, 200) || null;
  const { error: insertErr } = await service
    .from("sb_contact_messages")
    .insert({
      name,
      email,
      message,
      ip_address: ip,
      user_agent: userAgent,
      status: "received",
    });
  if (insertErr) {
    return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
  }

  // Send email via Resend (don't fail the request if email fails — message is saved)
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from: "SportsBookISH Contact <contact@sportsbookish.com>",
          to: ["kenny@hyder.me"],
          reply_to: email,
          subject: `[SportsBookISH] Contact: ${name}`,
          text: `From: ${name} <${email}>\nIP: ${ip}\n\n${message}`,
        }),
      });
    } catch {
      // Already persisted; silent fail is OK
    }
  }

  return NextResponse.json({ ok: true });
}
