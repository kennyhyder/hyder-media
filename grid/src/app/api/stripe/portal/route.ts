// Stripe customer portal (manage/cancel the Pro subscription).
// POST (auth) -> { url }

import { NextResponse } from "next/server";
import { getCurrentUser, gcRead } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });

  const rows = await gcRead<{ stripe_customer_id: string | null }>("gc_users", {
    id: `eq.${user.id}`,
    select: "stripe_customer_id",
    limit: "1",
  });
  const customer = rows[0]?.stripe_customer_id;
  if (!customer) return NextResponse.json({ error: "no_billing_account" }, { status: 404 });

  const form = new URLSearchParams();
  form.set("customer", customer);
  form.set("return_url", "https://gridcensus.com/account/watchtower");

  try {
    const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json();
    if (!res.ok || !j?.url) {
      console.error("[stripe] portal failed:", res.status, JSON.stringify(j?.error ?? j).slice(0, 200));
      return NextResponse.json({ error: "portal_failed" }, { status: 502 });
    }
    return NextResponse.json({ url: j.url });
  } catch (e) {
    console.error("[stripe] portal error:", e);
    return NextResponse.json({ error: "portal_failed" }, { status: 502 });
  }
}
