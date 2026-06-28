"use client";

import { getBrowserSupabase } from "@/lib/supabase-browser";

export default function SignOutButton({ className }: { className?: string }) {
  async function onClick() {
    try {
      const sb = getBrowserSupabase();
      await sb?.auth.signOut();
    } catch {
      /* ignore */
    }
    try {
      await fetch("/api/account/signout", { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.href = "/";
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={className ?? "rounded-lg border px-3 py-1.5 text-sm"}
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
    >
      Sign out
    </button>
  );
}
