"use client";

// Sidebar account entry. Renders "Sign in" when logged out, "Account" when a
// Supabase session is present. Client-only so it can read the session from the
// browser client; the link is a real <a> either way (works without JS —
// defaults to Sign in).

import { useEffect, useState } from "react";
import { getBrowserSupabase, authConfigured } from "@/lib/supabase-browser";

export default function AccountNavLink({ onNavigate }: { onNavigate?: () => void }) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const sb = getBrowserSupabase();
    if (!sb) return;
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });
    // Keep the label in sync if the user signs in/out in another tab.
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setSignedIn(Boolean(session));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Hide entirely if accounts aren't configured in this environment.
  if (!authConfigured()) return null;

  const href = signedIn ? "/account" : "/login";
  const label = signedIn ? "Account" : "Sign in";

  return (
    <a
      href={href}
      onClick={onNavigate}
      className="nav-link flex items-center gap-2.5 px-3 py-2 text-sm font-medium"
    >
      <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
      <span>{label}</span>
    </a>
  );
}
