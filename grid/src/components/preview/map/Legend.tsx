"use client";

import { CR, glass, labelStyle, RAMP } from "./theme";

export default function Legend() {
  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        bottom: 16,
        zIndex: 1150,
        padding: "12px 14px",
        minWidth: 188,
        ...glass,
      }}
    >
      <div style={{ ...labelStyle, marginBottom: 9 }}>DC Readiness</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {RAMP.map((r) => (
          <div
            key={r.label}
            style={{ display: "flex", alignItems: "center", gap: 9 }}
          >
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: r.color,
                boxShadow: `0 0 7px ${r.color}`,
                flex: "0 0 auto",
              }}
            />
            <span style={{ fontSize: 12.5, color: CR.text, flex: 1 }}>
              {r.label}
            </span>
            <span
              style={{
                fontSize: 11,
                color: CR.muted,
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {r.range}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 10,
          paddingTop: 9,
          borderTop: `1px solid ${CR.border}`,
          display: "flex",
          flexDirection: "column",
          gap: 5,
        }}
      >
        <Meaning
          glyph={<span style={{ width: 11, height: 11, background: CR.cyan, transform: "rotate(45deg)", display: "inline-block", borderRadius: 2 }} />}
          label="Substation"
        />
        <Meaning
          glyph={<span style={{ width: 16, height: 3, borderRadius: 2, background: "#8B5CF6", display: "inline-block" }} />}
          label="Transmission line"
        />
        <Meaning
          glyph={<span style={{ width: 11, height: 11, borderRadius: "50%", border: "2px solid #FB923C", display: "inline-block" }} />}
          label="Brownfield"
        />
      </div>
    </div>
  );
}

function Meaning({ glyph, label }: { glyph: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ width: 16, display: "flex", justifyContent: "center", flex: "0 0 auto" }}>
        {glyph}
      </span>
      <span style={{ fontSize: 11.5, color: CR.muted }}>{label}</span>
    </div>
  );
}
