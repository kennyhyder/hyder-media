"use client";

// Theme toggle: flips `html.dark` + persists to localStorage.
// This is one of only two client islands in the shell. All nav + content
// remains server-rendered.

import { useEffect, useState } from "react";

function getIsDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Sync state to whatever the no-flash inline script already decided.
  useEffect(() => {
    setDark(getIsDark());
    setMounted(true);
  }, []);

  function toggle() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    // brief cross-fade
    root.classList.add("theme-anim");
    root.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore (private mode) */
    }
    setDark(next);
    window.setTimeout(() => root.classList.remove("theme-anim"), 220);
  }

  // Render a stable button on the server / first paint to avoid hydration
  // mismatch; icon swaps in after mount.
  const label = dark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`nav-link flex w-full items-center gap-2.5 px-3 py-2 text-sm ${className}`}
    >
      <span className="flex h-5 w-5 items-center justify-center" aria-hidden="true">
        {mounted && dark ? (
          // Sun
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        ) : (
          // Moon
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </span>
      <span>{mounted && dark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
