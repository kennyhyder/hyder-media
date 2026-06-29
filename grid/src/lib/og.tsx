// Shared Open Graph image renderer (1200×630) used by every opengraph-image.tsx.
//
// The Voltage palette: near-black (#0A0B0D) background, electric-lime
// (#C4F000) accent used as a SIGNAL. Each card renders the entity name + a
// single headline stat so the shared cards double as AI-citation bait. Next
// auto-wires opengraph-image into BOTH og:image and twitter:image.
//
// Kept dependency-free (no remote fonts) so it renders fast under ISR and never
// blocks on a network fetch.

import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const BG = "#0A0B0D";
const BG_2 = "#131519";
const ACCENT = "#C4F000";
const TEXT = "#ECEFF3";
const MUTED = "#8B919B";
const BORDER = "#232830";

/** Voltage G monogram rendered for the OG brand row (3×3 grid, lime spur). */
function OgGlyph({ size = 48 }: { size?: number }) {
  const S = size;
  const pad = S * 0.16;
  const span = S - pad * 2;
  const step = span / 2;
  const lit = new Set(["0,0", "1,0", "2,0", "0,1", "0,2", "1,2", "2,2"]);
  const energized = "1,1";
  const n = S * 0.05;
  const litR = S * 0.066;
  const eR = S * 0.094;
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
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.s} height={r.s} fill={r.fill} />
      ))}
    </svg>
  );
}

export interface OgStat {
  label: string;
  value: string;
}

export interface OgCardOpts {
  /** Small uppercase eyebrow above the title (e.g. "Datacenter site · Virginia"). */
  eyebrow?: string;
  /** Main entity name / headline. */
  title: string;
  /** Up to three headline stats rendered as a row of figures. */
  stats?: OgStat[];
  /** Optional one-line subtitle under the title. */
  subtitle?: string;
}

/**
 * Build the standard GridCensus OG card. Returns an `ImageResponse` ready to be
 * the default export of an `opengraph-image.tsx` route.
 */
export function ogCard(opts: OgCardOpts): ImageResponse {
  const { eyebrow, title, stats = [], subtitle } = opts;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `radial-gradient(1200px 600px at 0% 0%, ${BG_2} 0%, ${BG} 60%)`,
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <OgGlyph size={48} />
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: TEXT,
              textTransform: "uppercase",
              letterSpacing: 4,
            }}
          >
            GridCensus
          </div>
          <div
            style={{
              marginLeft: "auto",
              fontSize: 22,
              fontWeight: 600,
              color: ACCENT,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            gridcensus.com
          </div>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {eyebrow ? (
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: ACCENT,
                textTransform: "uppercase",
                letterSpacing: 3,
                marginBottom: 18,
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          <div
            style={{
              fontSize: title.length > 48 ? 60 : 76,
              fontWeight: 800,
              color: TEXT,
              lineHeight: 1.04,
              letterSpacing: -1.5,
              maxWidth: 1010,
              // clamp very long names
              display: "flex",
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                marginTop: 20,
                fontSize: 30,
                color: MUTED,
                maxWidth: 1010,
                display: "flex",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>

        {/* Stat row */}
        {stats.length > 0 ? (
          <div
            style={{
              display: "flex",
              gap: 28,
              borderTop: `1px solid ${BORDER}`,
              paddingTop: 28,
            }}
          >
            {stats.slice(0, 3).map((s) => (
              <div
                key={s.label}
                style={{ display: "flex", flexDirection: "column" }}
              >
                <div
                  style={{
                    fontSize: 52,
                    fontWeight: 800,
                    color: ACCENT,
                    letterSpacing: -1,
                  }}
                >
                  {s.value}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    color: MUTED,
                    marginTop: 4,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
      </div>
    ),
    { ...OG_SIZE },
  );
}
