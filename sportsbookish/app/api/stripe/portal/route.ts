import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

// POST /api/stripe/portal — creates a Customer Portal session.
// Supports both fetch (returns JSON) and traditional form submit (302 redirect).
async function createPortalSession(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized", status: 401 as const };

  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sub?.stripe_customer_id) return { error: "no_customer", status: 400 as const };

  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${siteUrl}/settings`,
  });
  return { url: session.url };
}

export async function POST(request: NextRequest) {
  const result = await createPortalSession(request);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  // If the request came from a form submit (HTML accept), redirect; else JSON
  const wantsJson = (request.headers.get("accept") || "").includes("json");
  if (wantsJson) return NextResponse.json({ url: result.url });
  return NextResponse.redirect(result.url, 303);
}
