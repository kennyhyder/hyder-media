import { ImageResponse } from "next/og";

// Voltage favicon: the G monogram — lit grid nodes + an energized lime node on
// near-black. Hardcoded Voltage palette (no CSS vars available in OG runtime).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const BG = "#0A0B0D";
const TEXT = "#ECEFF3";
const ACCENT = "#C4F000";

export default function Icon() {
  // 3×3 G monogram on a 32px field. Square nodes; center node energized lime.
  const S = 32;
  const pad = S * 0.17;
  const span = S - pad * 2;
  const step = span / 2;
  const lit = new Set(["0,0", "1,0", "2,0", "0,1", "0,2", "1,2", "2,2"]);
  const energized = "1,1";
  const n = S * 0.05;
  const litR = S * 0.07;
  const eR = S * 0.1;
  const rects: { x: number; y: number; s: number; fill: string }[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const k = `${c},${r}`;
      const cx = pad + c * step;
      const cy = pad + r * step;
      if (k === energized) rects.push({ x: cx - eR, y: cy - eR, s: eR * 2, fill: ACCENT });
      else if (lit.has(k)) rects.push({ x: cx - litR, y: cy - litR, s: litR * 2, fill: TEXT });
      else rects.push({ x: cx - n, y: cy - n, s: n * 2, fill: "#4A4F58" });
    }
  }

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: BG }}>
        <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
          {rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.s} height={r.s} fill={r.fill} />
          ))}
        </svg>
      </div>
    ),
    { ...size },
  );
}
