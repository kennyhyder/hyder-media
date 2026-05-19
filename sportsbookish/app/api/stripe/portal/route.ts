import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

// POST /api/stripe/portal — creates a Stripe Customer Portal session.
// Supports both fetch (returns JSON) and traditional form submit (302 redirect).
//
// Common failure mode: Stripe's Customer Portal requires a one-time
// configuration in the Stripe dashboard. Without it, billingPortal.sessions
// .create throws "No configuration provided" with status 400 — which used
// to surface as an opaque generic 500. Now caught + surfaced via reason=.
async function createPortalSession(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr) return { error: `auth: ${authErr.message}`, status: 500 as const };
  if (!user) return { error: "unauthorized", status: 401 as const };

  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sub?.stripe_customer_id) return { error: "no_customer", status: 400 as const };

  try {
    const stripe = getStripe();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${siteUrl}/settings`,
    });
    return { url: session.url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stripe/portal] create failed", { user_id: user.id, customer: sub.stripe_customer_id, error: msg });
    return { error: msg.slice(0, 200), status: 500 as const };
  }
}

export async function POST(request: NextRequest) {
  const result = await createPortalSession(request);
  const wantsJson = (request.headers.get("accept") || "").includes("json");
  if ("error" in result) {
    if (wantsJson) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    // Form submit (HTML accept) — redirect back to settings with the
    // failure reason instead of dumping the user on a 500 page.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    const reason = encodeURIComponent(result.error.slice(0, 200));
    return NextResponse.redirect(`${siteUrl}/settings?error=portal_failed&reason=${reason}`, 303);
  }
  if (wantsJson) return NextResponse.json({ url: result.url });
  return NextResponse.redirect(result.url, 303);
}
