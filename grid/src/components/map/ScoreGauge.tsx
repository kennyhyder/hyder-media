import { scoreColor, mono } from "./theme";

interface ScoreGaugeProps {
  score: number | null | undefined;
  size?: number;
  /** caption rendered under the number, e.g. "READINESS" */
  label?: string;
  strokeWidth?: number;
}

/**
 * Radial score gauge — a glowing 270° arc, 0–100, coloured by the score ramp,
 * the figure in Geist Mono dead-center. Pure SVG, server-safe, THEME-AWARE
 * (track + text read --border / --text / --muted CSS vars).
 */
export default function ScoreGauge({
  score,
  size = 180,
  label = "READINESS",
  strokeWidth = 12,
}: ScoreGaugeProps) {
  const s = Math.max(0, Math.min(100, score ?? 0));
  const color = scoreColor(score);
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const START = 135;
  const SWEEP = 270;
  const circumference = 2 * Math.PI * r;
  const arcLen = (SWEEP / 360) * circumference;
  const dash = (s / 100) * arcLen;
  const gapId = `mapgauge-glow-${size}-${Math.round(s)}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Score ${s.toFixed(0)} of 100`}
    >
      <defs>
        <filter id={gapId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${arcLen} ${circumference}`}
        transform={`rotate(${START} ${cx} ${cy})`}
        opacity={0.7}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform={`rotate(${START} ${cx} ${cy})`}
        filter={`url(#${gapId})`}
      />

      <text
        x={cx}
        y={cy + size * 0.02}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontFamily: mono, fontVariantNumeric: "tabular-nums" }}
        fontSize={size * 0.3}
        fontWeight={700}
        fill="var(--text)"
      >
        {s.toFixed(s % 1 === 0 ? 0 : 1)}
      </text>
      <text
        x={cx}
        y={cy + size * 0.22}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ letterSpacing: "0.12em" }}
        fontSize={size * 0.065}
        fill="var(--muted)"
      >
        {label}
      </text>
      <text
        x={cx}
        y={cy - size * 0.18}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontFamily: mono, letterSpacing: "0.1em" }}
        fontSize={size * 0.058}
        fill="var(--muted)"
      >
        / 100
      </text>
    </svg>
  );
}
