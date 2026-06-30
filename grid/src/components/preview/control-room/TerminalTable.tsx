import { CR, mono, sans } from "./theme";
import { ScoreChip } from "./ui";
import type { DcSite } from "@/lib/db";

function fmtMw(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(1)} GW`;
  return `${v.toFixed(0)} MW`;
}

/** Terminal-styled top-sites table: mono figures, hairline rows, score chips. */
export default function TerminalTable({ sites }: { sites: DcSite[] }) {
  const cols = [
    { key: "rank", label: "#", align: "left" as const, w: "36px" },
    { key: "name", label: "Site", align: "left" as const },
    { key: "county", label: "County", align: "left" as const },
    { key: "kv", label: "kV", align: "right" as const, w: "60px" },
    { key: "cap", label: "Capacity", align: "right" as const, w: "92px" },
    { key: "iso", label: "ISO", align: "left" as const, w: "64px" },
    { key: "score", label: "Score", align: "right" as const, w: "64px" },
  ];

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: sans,
        }}
      >
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align,
                  padding: "8px 12px",
                  borderBottom: `1px solid ${CR.border}`,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontSize: 10.5,
                  color: CR.muted,
                  fontWeight: 600,
                  width: c.w,
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sites.map((s, i) => (
            <tr
              key={s.id}
              className="cr-row"
              style={{ transition: "background .15s" }}
            >
              <td style={cell({ mono: true, muted: true })}>
                {String(i + 1).padStart(2, "0")}
              </td>
              <td style={cell({ weight: 600 })}>
                {s.name
                  ? s.name.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())
                  : "Unnamed site"}
              </td>
              <td style={cell({ muted: true })}>{s.county || "—"}</td>
              <td style={cell({ mono: true, align: "right" })}>
                {s.substation_voltage_kv ?? "—"}
              </td>
              <td style={cell({ mono: true, align: "right" })}>
                {fmtMw(s.available_capacity_mw)}
              </td>
              <td style={cell({ mono: true })}>{s.iso_region || "—"}</td>
              <td style={{ ...cell({ align: "right" }), paddingRight: 12 }}>
                <ScoreChip score={s.dc_score} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`.cr-row:hover td { background: rgba(34,211,238,.05); }`}</style>
    </div>
  );
}

function cell(opts: {
  mono?: boolean;
  muted?: boolean;
  weight?: number;
  align?: "left" | "right";
}): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderBottom: `1px solid ${CR.border}`,
    fontFamily: opts.mono ? mono : sans,
    fontVariantNumeric: opts.mono ? "tabular-nums" : undefined,
    fontSize: 13.5,
    color: opts.muted ? CR.muted : CR.text,
    fontWeight: opts.weight ?? 400,
    textAlign: opts.align ?? "left",
    whiteSpace: "nowrap",
  };
}
