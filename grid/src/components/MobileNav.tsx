"use client";

// Mobile top bar + slide-in drawer. The ONLY client behavior here is the
// open/close of the drawer. The nav links themselves render via <NavContent>,
// which (despite being a client component for active-state) emits every <a href>
// unconditionally — so all nav links are in the SSR HTML even before hydration.
// The drawer is positioned off-canvas with CSS and slid in on open.

import { useState } from "react";
import NavContent from "./NavContent";
import Brand from "./Brand";

export default function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          className="nav-link flex h-10 w-10 items-center justify-center"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        aria-hidden={!open}
      >
        <div className="flex h-14 items-center justify-between border-b px-4" style={{ borderColor: "var(--border)" }}>
          <Brand />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="nav-link flex h-9 w-9 items-center justify-center"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <NavContent onNavigate={() => setOpen(false)} />
        </div>
      </aside>
    </div>
  );
}
