import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redeemInvite } from "@/lib/invites";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";
  const tier = searchParams.get("tier");
  const invite = searchParams.get("invite");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  // All Supabase calls wrapped — exchangeCodeForSession + getUser can throw
  // "Unexpected end of JSON input" when the auth service returns an empty
  // body (rare edge-network blip, but it leaks the JS error verbatim to
  // the user when it does). Surface a usable reason= in the URL instead.
  try {
    const supabase = await createClient();
    const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exchErr) throw new Error(`exchangeCodeForSession: ${exchErr.message}`);

    // Invite path
    if (invite) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await redeemInvite(invite, user.id);
      }
      return NextResponse.redirect(`${origin}/dashboard?invite_applied=1&welcome=1`);
    }

    // Paid-tier signup intent → straight to checkout
    if (tier && ["pro", "elite", "api_monthly", "api_annual"].includes(tier)) {
      return NextResponse.redirect(`${origin}/api/stripe/checkout-redirect?tier=${tier}`);
    }

    // Free signup vs returning login: user created <2 min ago = first sign-in,
    // fire ?welcome=1 to trigger the GA4 sign_up event on the dashboard.
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw new Error(`auth.getUser: ${userErr.message}`);
    const createdAt = user?.created_at ? new Date(user.created_at).getTime() : 0;
    const isFirstSignIn = createdAt > 0 && Date.now() - createdAt < 2 * 60 * 1000;
    const target = next || "/dashboard";
    const sep = target.includes("?") ? "&" : "?";
    const url = isFirstSignIn ? `${origin}${target}${sep}welcome=1` : `${origin}${target}`;
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auth/callback] failed", { code: code.slice(0, 8), tier, next, error: msg, stack: e instanceof Error ? e.stack : undefined });
    const reason = encodeURIComponent(msg.slice(0, 200));
    return NextResponse.redirect(`${origin}/login?error=callback&reason=${reason}`);
  }
}
