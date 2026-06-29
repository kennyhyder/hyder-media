import type { ReactNode } from "react";
import Link from "next/link";
import { C, display, mono } from "./theme";
import { fontVars } from "./fonts";
import { CurrentWordmark } from "./Brand";

/**
 * Authoritative deep-navy canvas. Signature detail: a soft indigo aurora glow
 * anchored top-center behind the hero, plus crisp indigo hairline dividers.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className={fontVars}
      style={{
        background: C.bg,
        color: C.text,
        fontFamily: display,
        margin: "-24px -16px",
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${C.border}`,
        position: "relative",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 520,
          background:
            "radial-gradient(680px 320px at 50% -8%, rgba(99,102,241,0.22), transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}

export function TopBar({ active }: { active?: "home" | "site" }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 28px",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <Link href="/preview/brand-current" style={{ textDecoration: "none" }}>
        <CurrentWordmark size={27} />
      </Link>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: 28,
          fontFamily: display,
          fontSize: 13.5,
          fontWeight: 500,
        }}
      >
        <NavLink href="/preview/brand-current" on={active === "home"}>
          Explore
        </NavLink>
        <NavLink href="/preview/brand-current/site" on={active === "site"}>
          Sites
        </NavLink>
        <span style={{ color: C.muted }}>Methodology</span>
        <span
          style={{
            fontFamily: display,
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: C.accent,
            padding: "8px 16px",
            borderRadius: 7,
            boxShadow: "0 4px 18px -6px rgba(99,102,241,0.8)",
          }}
        >
          Start free
        </span>
      </nav>
    </header>
  );
}

function NavLink({
  href,
  on,
  children,
}: {
  href: string;
  on?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        color: on ? C.text : C.muted,
        position: "relative",
      }}
    >
      {children}
      {on ? (
        <span
          style={{
            display: "block",
            height: 2,
            background: C.accent,
            borderRadius: 2,
            marginTop: 4,
          }}
        />
      ) : null}
    </Link>
  );
}
