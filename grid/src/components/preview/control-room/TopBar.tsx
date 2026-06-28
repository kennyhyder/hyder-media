import Link from "next/link";
import { CR, mono, sans } from "./theme";

const NAV = ["Map", "Rankings", "Sites", "Corridors", "Methodology"];

/** Mini nav mockup styled in the Control Room theme. Non-functional links. */
export default function TopBar() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 28px",
        background: "rgba(10,14,26,.82)",
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${CR.border}`,
      }}
    >
      <Link
        href="/preview/control-room"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          textDecoration: "none",
        }}
      >
        <span
          style={{
            color: CR.cyan,
            fontSize: 16,
            filter: "drop-shadow(0 0 6px rgba(34,211,238,.6))",
          }}
        >
          ◆
        </span>
        <span
          style={{
            fontFamily: mono,
            letterSpacing: "0.14em",
            fontWeight: 700,
            fontSize: 15,
            color: CR.text,
          }}
        >
          GRIDCENSUS
        </span>
      </Link>

      <nav style={{ display: "flex", gap: 26, alignItems: "center" }}>
        {NAV.map((n) => (
          <span
            key={n}
            style={{
              fontFamily: sans,
              fontSize: 13,
              color: CR.muted,
              letterSpacing: "0.02em",
            }}
          >
            {n}
          </span>
        ))}
        <span
          style={{
            fontFamily: sans,
            fontSize: 13,
            fontWeight: 600,
            color: CR.canvas,
            background: CR.cyan,
            padding: "7px 14px",
            borderRadius: 8,
            boxShadow: "0 0 18px -4px rgba(34,211,238,.7)",
          }}
        >
          Request Access
        </span>
      </nav>
    </header>
  );
}
