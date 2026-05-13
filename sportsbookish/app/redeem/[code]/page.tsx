import { notFound } from "next/navigation";
import Link from "next/link";
import { validateInvite } from "@/lib/invites";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TIER_BY_KEY } from "@/lib/tiers";
import MarketingNav from "@/components/nav/MarketingNav";
import { LineChart, Gift, AlertCircle, CheckCircle2 } from "lucide-react";
import RedeemForm from "./RedeemForm";
import RedeemForLoggedIn from "./RedeemForLoggedIn";

export const dynamic = "force-dynamic";

export default async function RedeemPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const result = await validateInvite(code);

  // Is the user already signed in? Skip the email step.
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!result.ok) {
    return (
      <div className="min-h-screen">
        <MarketingNav />
        <main className="container mx-auto max-w-md px-4 py-16">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15">
                <AlertCircle className="h-6 w-6 text-rose-500" />
              </div>
              <CardTitle>This invite link can&apos;t be used</CardTitle>
              <CardDescription>
                {result.reason === "not_found" && "We couldn't find that invite code. Double-check the URL or ask whoever shared it for a new link."}
                {result.reason === "disabled" && "This invite has been disabled."}
                {result.reason === "expired" && "This invite has expired."}
                {result.reason === "exhausted" && "This invite has already been redeemed by the maximum number of people."}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Link href="/pricing" className="text-sm text-emerald-500 hover:underline">See plans →</Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const tierInfo = TIER_BY_KEY[result.invite.tier];

  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="container mx-auto max-w-md px-4 py-16">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
              <Gift className="h-6 w-6 text-emerald-500" />
            </div>
            <CardTitle className="text-2xl">You&apos;ve been gifted {tierInfo.name}</CardTitle>
            <CardDescription>
              Full <strong className="text-foreground">{tierInfo.name}</strong> access (normally ${tierInfo.priceMonthly}/mo) — free, no card required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm space-y-1.5 text-muted-foreground">
              {tierInfo.features.filter((f) => f.included).slice(0, 4).map((f) => (
                <li key={f.text} className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-border/40 pt-4">
              {user ? (
                <RedeemForLoggedIn code={code} email={user.email || ""} />
              ) : (
                <RedeemForm code={code} />
              )}
            </div>
            {result.invite.label && (
              <div className="text-[10px] text-muted-foreground/60 text-center">
                Invite: {result.invite.label}
              </div>
            )}
          </CardContent>
        </Card>
        <div className="text-center mt-4">
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <LineChart className="h-3 w-3" /> SportsBook<span className="text-emerald-500">ISH</span>
          </Link>
        </div>
      </main>
    </div>
  );
}
