import type { ReactNode } from "react";
import Link from "next/link";
import { V, mono } from "./theme";
import { fontVars } from "./fonts";
import { VoltageWordmark } from "./Brand";

/**
 * Full-bleed dark canvas that breaks out of the light root <main> container
 * (root padding is px-4 py-6 on a centered main). Applies scoped font vars.
 * Signature detail: a faint hairline-grid texture washed across the top.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className={fontVars}
      style={{
        background: V.bg,
        color: V.text,
        fontFamily: "var(--vlt-display), system-ui, sans-serif",
        margin: "-24px -16px",
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${V.border}`,
        position: "relative",
      }}
    >
      {/* signature: hairline grid texture, fading out downward */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${V.border} 1px, transparent 1px), linear-gradient(90deg, ${V.border} 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          opacity: 0.5,
          maskImage:
            "linear-gradient(180deg, rgba(0,0,0,0.5), transparent 480px)",
          WebkitMaskImage:
            "linear-gradient(180deg, rgba(0,0,0,0.5), transparent 480px)",
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
        padding: "16px 28px",
        borderBottom: `1px solid ${V.border}`,
        background: "rgba(10,11,13,0.7)",
        backdropFilter: "blur(6px)",
      }}
    >
      <Link
        href="/preview/brand-voltage"
        style={{ textDecoration: "none" }}
      >
        <VoltageWordmark size={26} />
      </Link>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: 26,
          fontFamily: mono,
          fontSize: 12.5,
          letterSpacing: "0.02em",
        }}
      >
        <NavLink href="/preview/brand-voltage" on={active === "home"}>
          National
        </NavLink>
        <NavLink href="/preview/brand-voltage/site" on={active === "site"}>
          Sites
        </NavLink>
        <span style={{ color: V.muted }}>Methodology</span>
        <span
          style={{
            fontFamily: mono,
            fontSize: 12,
            color: V.bg,
            background: V.accent,
            padding: "6px 12px",
            borderRadius: 4,
            fontWeight: 500,
          }}
        >
          Get access
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
        color: on ? V.text : V.muted,
        borderBottom: on ? `1px solid ${V.accent}` : "1px solid transparent",
        paddingBottom: 2,
      }}
    >
      {children}
    </Link>
  );
}
