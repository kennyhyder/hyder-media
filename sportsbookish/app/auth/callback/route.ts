import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redeemInvite } from "@/lib/invites";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";
  const tier = searchParams.get("tier");
  const invite = searchParams.get("invite");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // If this signup came from an invite link, apply the invite now (sets tier + writes redemption row)
      if (invite) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await redeemInvite(invite, user.id);
        }
        return NextResponse.redirect(`${origin}/dashboard?invite_applied=1&welcome=1`);
      }
      // If they signed up with a paid tier intent (not an invite), jump to checkout
      if (tier && ["pro", "elite", "api_monthly", "api_annual"].includes(tier)) {
        return NextResponse.redirect(`${origin}/api/stripe/checkout-redirect?tier=${tier}`);
      }
      // Detect first-time signup vs returning login: if the user was created
      // within the last 2 minutes, this is the first magic-link confirmation,
      // so append ?welcome=1 to fire the GA4 sign_up event on the dashboard.
      // Anything older = returning login, no event.
      const { data: { user } } = await supabase.auth.getUser();
      const createdAt = user?.created_at ? new Date(user.created_at).getTime() : 0;
      const isFirstSignIn = createdAt > 0 && Date.now() - createdAt < 2 * 60 * 1000;
      const target = next || "/dashboard";
      const sep = target.includes("?") ? "&" : "?";
      const url = isFirstSignIn ? `${origin}${target}${sep}welcome=1` : `${origin}${target}`;
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=callback`);
}
