"use client";

// Shared login/signup form. Email+password, magic link, and Google OAuth.
// Every signup passes data: { product: 'gridcensus' } so the shared-project
// auth.users trigger gate works (see supabase-browser.ts + migration 001).

import { useState } from "react";
import {
  getBrowserSupabase,
  authConfigured,
  GC_PRODUCT_META,
} from "@/lib/supabase-browser";

type Mode = "login" | "signup";
type Tab = "password" | "magic";

export default function AuthForm({ mode }: { mode: Mode }) {
  const [tab, setTab] = useState<Tab>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configured = authConfigured();
  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/account` : undefined;

  async function withClient<T>(fn: (sb: NonNullable<ReturnType<typeof getBrowserSupabase>>) => Promise<T>) {
    const sb = getBrowserSupabase();
    if (!sb) {
      setError("Accounts aren't enabled yet. Check back soon.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn(sb);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    await withClient(async (sb) => {
      if (mode === "signup") {
        const { error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: { ...GC_PRODUCT_META, display_name: displayName || undefined },
            emailRedirectTo: redirectTo,
          },
        });
        if (error) throw error;
        setNotice(
          "Account created. Check your email to confirm, then sign in.",
        );
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = "/account";
      }
    });
  }

  async function onMagicLink(e: React.FormEvent) {
    e.preventDefault();
    await withClient(async (sb) => {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          // shouldCreateUser true so magic-link doubles as signup; product flag
          // travels on the created user.
          data: GC_PRODUCT_META,
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;
      setNotice("Magic link sent. Check your email.");
    });
  }

  async function onGoogle() {
    await withClient(async (sb) => {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          // OAuth metadata can't carry our product flag at signUp time; the
          // gc trigger gates on it, so OAuth users won't auto-get a gc_users
          // row from the trigger. getCurrentUser() backfills lazily on first
          // load (see note in /account). This keeps cross-product safe.
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    });
  }

  if (!configured) {
    return (
      <div className="surface-card rounded-xl p-6 text-sm" style={{ color: "var(--muted)" }}>
        Accounts aren&apos;t enabled in this environment yet. The sign-in flow
        will light up once Supabase Auth is configured.
      </div>
    );
  }

  const inputCls =
    "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2";
  const inputStyle = {
    background: "var(--surface-2)",
    borderColor: "var(--border)",
    color: "var(--text)",
  } as React.CSSProperties;

  return (
    <div className="surface-card rounded-xl p-6">
      {/* Tab switch */}
      <div className="mb-5 flex gap-1 rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
        {(["password", "magic"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition"
            style={
              tab === t
                ? { background: "var(--surface)", color: "var(--text)" }
                : { color: "var(--muted)" }
            }
          >
            {t === "password" ? "Password" : "Magic link"}
          </button>
        ))}
      </div>

      {tab === "password" ? (
        <form onSubmit={onPasswordSubmit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>
                Name <span className="opacity-60">(optional)</span>
              </label>
              <input
                className={inputCls}
                style={inputStyle}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>Email</label>
            <input
              type="email"
              required
              className={inputCls}
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>Password</label>
            <input
              type="password"
              required
              minLength={8}
              className={inputCls}
              style={inputStyle}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="accent-fill mt-1 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
      ) : (
        <form onSubmit={onMagicLink} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>Email</label>
            <input
              type="email"
              required
              className={inputCls}
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="accent-fill mt-1 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}

      {/* OAuth */}
      <div className="my-4 flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
        <span className="h-px flex-1" style={{ background: "var(--border)" }} />
        or
        <span className="h-px flex-1" style={{ background: "var(--border)" }} />
      </div>
      <button
        type="button"
        onClick={onGoogle}
        disabled={busy}
        className="w-full rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        Continue with Google
      </button>

      {error && (
        <p className="mt-4 rounded-lg px-3 py-2 text-xs" style={{ background: "color-mix(in srgb, var(--score-low) 14%, transparent)", color: "var(--score-low)" }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-lg px-3 py-2 text-xs" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }}>
          {notice}
        </p>
      )}

      <p className="mt-5 text-center text-xs" style={{ color: "var(--muted)" }}>
        {mode === "signup" ? (
          <>Already have an account? <a href="/login" className="underline">Sign in</a></>
        ) : (
          <>New to GridCensus? <a href="/signup" className="underline">Create a free account</a></>
        )}
      </p>
    </div>
  );
}
