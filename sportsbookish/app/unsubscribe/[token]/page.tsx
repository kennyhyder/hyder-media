import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Unsubscribed | SportsBookISH",
  robots: { index: false, follow: false },
};

interface PageProps { params: Promise<{ token: string }> }

// One-click unsubscribe. Token verified server-side, preferences flipped,
// then the page renders confirmation. Also handles RFC 8058 POST for
// Gmail's one-click unsubscribe header.
//
// We use the service-role client because the user is unauthenticated at
// this point (the token IS their auth).
async function unsubscribeByToken(token: string): Promise<{ ok: boolean; email?: string }> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return { ok: false };
  const client = createClient(url, key, { auth: { persistSession: false } });
  // Rotate token so the link can't be replayed forever, and flip prefs
  const newToken = (await import("node:crypto")).randomBytes(18).toString("hex");
  const { data, error } = await client
    .from("sb_email_preferences")
    .update({
      unsubscribed_all: true,
      unsubscribed_at: new Date().toISOString(),
      marketing_drip: false,
      product_updates: false,
      unsub_token: newToken,
      updated_at: new Date().toISOString(),
    })
    .eq("unsub_token", token)
    .select("user_id")
    .maybeSingle();
  if (error || !data) return { ok: false };
  // Try to resolve email for the confirmation page (best-effort)
  try {
    const { data: u } = await client.auth.admin.getUserById(data.user_id);
    return { ok: true, email: u?.user?.email };
  } catch {
    return { ok: true };
  }
}

export default async function UnsubscribePage({ params }: PageProps) {
  const { token } = await params;
  if (!token || token.length < 20) redirect("/");
  const result = await unsubscribeByToken(token);

  if (!result.ok) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Link expired or invalid</h1>
          <p className="text-muted-foreground text-sm mt-3">
            This unsubscribe link is no longer valid. If you&apos;re still receiving emails you don&apos;t want, manage preferences in
            your <Link href="/settings" className="text-emerald-400 underline">settings</Link> or email
            {" "}<a href="mailto:kenny@hyder.me" className="text-emerald-400 underline">kenny@hyder.me</a>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">You&apos;re unsubscribed.</h1>
        <p className="text-muted-foreground text-sm mt-3">
          {result.email ? <>We&apos;ve removed <strong>{result.email}</strong> from the SportsBookISH email list.</> : "You're off the list."} You won&apos;t receive any more
          marketing emails from us. Transactional emails (receipts, login codes) will still send if needed.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Home</Link>
          <Link href="/settings" className="rounded-md bg-emerald-500 text-emerald-950 px-4 py-2 text-sm font-medium hover:bg-emerald-400">Settings</Link>
        </div>
        <p className="mt-6 text-xs text-muted-foreground/70">
          Changed your mind? Toggle marketing emails back on from your settings page (you&apos;ll need to be logged in).
        </p>
      </div>
    </main>
  );
}
