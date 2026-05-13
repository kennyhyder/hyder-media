"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Mail } from "lucide-react";

export default function RedeemForm({ code }: { code: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?invite=${encodeURIComponent(code)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
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

  if (sent) {
    return (
      <div className="text-center space-y-2">
        <Mail className="h-8 w-8 text-emerald-500 mx-auto" />
        <p className="text-sm">We sent a magic link to <strong>{email}</strong>.</p>
        <p className="text-xs text-muted-foreground">Click it to claim your account — your invite will be applied automatically.</p>
        <Button variant="outline" size="sm" onClick={() => setSent(false)}>Send another link</Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="email">Your email</Label>
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
        {loading ? "Sending…" : "Claim my membership"}
      </Button>
      <p className="text-[10px] text-muted-foreground text-center">
        No password, no credit card. Click the magic link in your email and you&apos;re in.
      </p>
    </form>
  );
}
