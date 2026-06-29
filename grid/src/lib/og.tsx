// Shared Open Graph image renderer (1200×630) used by every opengraph-image.tsx.
//
// The Control Room palette: dark navy (#0A0E1A) background, cyan (#22D3EE)
// accent. Each card renders the entity name + a single headline stat so the
// shared cards double as AI-citation bait. Next auto-wires opengraph-image into
// BOTH og:image and twitter:image.
//
// Kept dependency-free (no remote fonts) so it renders fast under ISR and never
// blocks on a network fetch.

import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const BG = "#0A0E1A";
const BG_2 = "#0F1629";
const ACCENT = "#22D3EE";
const TEXT = "#F8FAFC";
const MUTED = "#94A3B8";
const BORDER = "#1E293B";

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
          <div
            style={{
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: "rotate(45deg)",
              borderRadius: 8,
              background: ACCENT,
            }}
          />
          <div
            style={{
              fontSize: 30,
              fontWeight: 800,
              color: TEXT,
              letterSpacing: -0.5,
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
