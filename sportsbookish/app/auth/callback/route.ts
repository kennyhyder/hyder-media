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
        return NextResponse.redirect(`${origin}/dashboard?invite_applied=1`);
      }
      // If they signed up with a paid tier intent (not an invite), jump to checkout
      if (tier && (tier === "pro" || tier === "elite")) {
        return NextResponse.redirect(`${origin}/api/stripe/checkout-redirect?tier=${tier}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=callback`);
}
