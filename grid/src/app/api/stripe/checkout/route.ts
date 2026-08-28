// GridCensus Pro checkout — Stripe-hosted Checkout via REST (no SDK, no
// Stripe.js on-page, zero CSP changes). POST (auth) -> { url } to redirect to.
// Spec: grid/docs/watchtower-v1-spec.md §5

import { NextResponse } from "next/server";
import { getCurrentUser, gcRead } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SITE = "https://gridcensus.com";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  const price = (process.env.STRIPE_PRICE_GC_PRO || "").trim();
  if (!key || !price) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  if (user.role === "owner" || user.role === "enterprise" || user.role === "staff") {
    return NextResponse.json({ error: "already_pro" }, { status: 409 });
  }

  // Reuse the Stripe customer if this user subscribed before.
  const rows = await gcRead<{ stripe_customer_id: string | null }>("gc_users", {
    id: `eq.${user.id}`,
    select: "stripe_customer_id",
    limit: "1",
  });
  const existingCustomer = rows[0]?.stripe_customer_id || null;

  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", price);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", `${SITE}/account/watchtower?upgraded=1`);
  form.set("cancel_url", `${SITE}/pricing`);
  form.set("client_reference_id", user.id);
  form.set("allow_promotion_codes", "true");
  form.set("subscription_data[metadata][gc_user_id]", user.id);
  if (existingCustomer) form.set("customer", existingCustomer);
  else if (user.email) form.set("customer_email", user.email);

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
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
      console.error("[stripe] checkout create failed:", res.status, JSON.stringify(j?.error ?? j).slice(0, 300));
      return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
    }
    return NextResponse.json({ url: j.url });
  } catch (e) {
    console.error("[stripe] checkout error:", e);
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}
