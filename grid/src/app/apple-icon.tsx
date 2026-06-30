import { ImageResponse } from "next/og";

// Apple touch icon: the Voltage G monogram on near-black, energized lime node.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const BG = "#0A0B0D";
const TEXT = "#ECEFF3";
const ACCENT = "#C4F000";

export default function AppleIcon() {
  const S = 180;
  const pad = S * 0.24;
  const span = S - pad * 2;
  const step = span / 2;
  const lit = new Set(["0,0", "1,0", "2,0", "0,1", "0,2", "1,2", "2,2"]);
  const energized = "1,1";
  const n = S * 0.045;
  const litR = S * 0.062;
  const eR = S * 0.088;
  const gap = S * 0.045;
  const rects: { x: number; y: number; s: number; fill: string }[] = [];
  let eCell: { cx: number; cy: number } | null = null;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const k = `${c},${r}`;
      const cx = pad + c * step;
      const cy = pad + r * step;
      if (k === energized) {
        rects.push({ x: cx - eR, y: cy - eR, s: eR * 2, fill: ACCENT });
        eCell = { cx, cy };
      } else if (lit.has(k)) rects.push({ x: cx - litR, y: cy - litR, s: litR * 2, fill: TEXT });
      else rects.push({ x: cx - n, y: cy - n, s: n * 2, fill: "#4A4F58" });
    }
  }

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: BG }}>
        <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
          {eCell && (
            <rect
              x={eCell.cx - eR - gap}
              y={eCell.cy - eR - gap}
              width={(eR + gap) * 2}
              height={(eR + gap) * 2}
              fill="none"
              stroke={ACCENT}
              strokeWidth={S * 0.016}
              opacity={0.4}
            />
          )}
          {rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.s} height={r.s} fill={r.fill} />
          ))}
        </svg>
      </div>
    ),
    { ...size },
  );
}
