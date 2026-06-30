import { scoreColor, CR, mono, sans } from "./theme";

interface SubScoreBarProps {
  label: string;
  value: number | null | undefined;
  /** optional sub-caption shown right of the label (e.g. unit) */
  hint?: string;
}

/**
 * Horizontal sub-score bar: uppercase label, mono value, and a glowing gradient
 * fill on a hairline track. Used for the avgSubScores breakdowns.
 */
export default function SubScoreBar({ label, value, hint }: SubScoreBarProps) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const color = scoreColor(value);
  const pct = v ?? 0;

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: 11,
            color: CR.muted,
            fontFamily: sans,
          }}
        >
          {label}
          {hint ? (
            <span style={{ color: CR.border, marginLeft: 8, textTransform: "none" }}>
              {hint}
            </span>
          ) : null}
        </span>
        <span
          style={{
            fontFamily: mono,
            fontVariantNumeric: "tabular-nums",
            fontSize: 13,
            fontWeight: 600,
            color: v == null ? CR.muted : CR.text,
          }}
        >
          {v == null ? "—" : v.toFixed(1)}
        </span>
      </div>
      <div
        style={{
          height: 8,
          width: "100%",
          background: CR.surface2,
          border: `1px solid ${CR.border}`,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: `0 0 12px -2px ${color}`,
            transition: "width .4s ease",
          }}
        />
      </div>
    </div>
  );
}
