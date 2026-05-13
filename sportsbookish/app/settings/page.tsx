import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { getCurrentTier, getUserPreferences } from "@/lib/tier-guard";
import { TIER_BY_KEY } from "@/lib/tiers";
import SettingsForm from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

const ALL_BOOKS = [
  "draftkings", "fanduel", "betmgm", "caesars", "circa", "pinnacle",
  "bet365", "betonline", "bovada", "skybet", "williamhill", "pointsbet", "unibet", "betcris",
];

export default async function SettingsPage() {
  const { tier, userId, email } = await getCurrentTier();
  if (!userId) redirect("/login?next=/settings");
  const prefs = await getUserPreferences();
  const tierInfo = TIER_BY_KEY[tier];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="font-semibold text-sm">Settings</div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{tierInfo.name}</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>{email}</CardDescription>
          </CardHeader>
        </Card>

        {tier === "free" ? (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader>
              <div className="flex items-start gap-3">
                <Lock className="h-5 w-5 text-amber-400 mt-0.5" />
                <div>
                  <CardTitle>Preferences are a Pro feature</CardTitle>
                  <CardDescription className="mt-1">
                    Upgrade to Pro to pick your home sportsbook (edges shown vs that book) and exclude books from the consensus median. Elite adds custom alert thresholds and SMS.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>
                See plans
              </Link>
            </CardContent>
          </Card>
        ) : (
          <SettingsForm
            tier={tier}
            initial={{
              home_book: prefs.home_book,
              excluded_books: prefs.excluded_books,
              notification_channels: prefs.notification_channels,
              sms_phone: prefs.sms_phone,
              alert_thresholds: prefs.alert_thresholds as Record<string, { buy?: number; sell?: number }>,
            }}
            allBooks={ALL_BOOKS}
          />
        )}
      </main>
    </div>
  );
}
