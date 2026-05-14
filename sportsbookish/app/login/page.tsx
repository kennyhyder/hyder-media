"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { LineChart, Mail } from "lucide-react";

function LoginInner() {
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
      if (error) throw error;
      setSent(true);
      toast.success("Magic link sent — check your email.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <main className="container mx-auto max-w-md px-4 py-16">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
              <LineChart className="h-6 w-6 text-emerald-500" />
            </div>
            <CardTitle className="text-2xl">{sent ? "Check your email" : "Log in"}</CardTitle>
            <CardDescription>
              {sent ? (
                <>Magic link sent to <strong>{email}</strong>.</>
              ) : (
                <>We&apos;ll email you a link — no password required.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
                <Mail className="mr-2 h-4 w-4" />
                Send another link
              </Button>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    required
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white" disabled={loading}>
                  {loading ? "Sending…" : "Send magic link"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  No account?{" "}
                  <Link href={`/signup${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-emerald-400 hover:underline">
                    Sign up
                  </Link>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
