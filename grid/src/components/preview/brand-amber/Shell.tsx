import type { ReactNode } from "react";
import Link from "next/link";
import { A, sans, mono } from "./theme";
import { fontVars } from "./fonts";
import { AmberWordmark } from "./Brand";

/**
 * Warm full-bleed canvas. Signature detail: a thin gold rule under the top bar
 * and a faint ticker-tape row of live national figures — Bloomberg energy.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className={fontVars}
      style={{
        background: A.bg,
        color: A.text,
        fontFamily: sans,
        margin: "-24px -16px",
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${A.border}`,
      }}
    >
      {children}
    </div>
  );
}

export function TopBar({
  active,
  ticker,
}: {
  active?: "home" | "site";
  ticker?: Array<[string, string]>;
}) {
  return (
    <header style={{ borderBottom: `1px solid ${A.border}` }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 28px",
        }}
      >
        <Link href="/preview/brand-amber" style={{ textDecoration: "none" }}>
          <AmberWordmark size={28} />
        </Link>
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 26,
            fontFamily: sans,
            fontSize: 13.5,
          }}
        >
          <NavLink href="/preview/brand-amber" on={active === "home"}>
            Markets
          </NavLink>
          <NavLink href="/preview/brand-amber/site" on={active === "site"}>
            Sites
          </NavLink>
          <span style={{ color: A.muted }}>Methodology</span>
          <span
            style={{
              fontFamily: sans,
              fontSize: 13,
              color: A.text,
              border: `1px solid ${A.accent}`,
              padding: "7px 14px",
              borderRadius: 4,
            }}
          >
            Request terminal
          </span>
        </nav>
      </div>
      {/* gold hairline */}
      <div style={{ height: 1, background: `linear-gradient(90deg, ${A.accent}, transparent 60%)` }} />
      {/* ticker tape */}
      {ticker ? (
        <div
          style={{
            display: "flex",
            gap: 28,
            padding: "8px 28px",
            background: A.surface2,
            fontFamily: mono,
            fontSize: 11.5,
            color: A.muted,
            overflowX: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {ticker.map(([k, v]) => (
            <span key={k}>
              <span style={{ color: A.muted }}>{k} </span>
              <span style={{ color: A.text }}>{v}</span>
            </span>
          ))}
        </div>
      ) : null}
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
        color: on ? A.text : A.muted,
        borderBottom: on ? `1.5px solid ${A.accent}` : "1.5px solid transparent",
        paddingBottom: 3,
      }}
    >
      {children}
    </Link>
  );
}
