import { V } from "@/components/preview/brand-voltage/theme";
import { VoltageGlyph, VoltageGlyphWordmark } from "@/components/preview/brand-voltage/Glyph";
import { VoltageMark, VoltageWordmark } from "@/components/preview/brand-voltage/Brand";

export const dynamic = "force-static";

const SIZES = [16, 24, 32, 48, 96];

function MarkRow({ letter }: { letter: "C" | "G" }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 28, flexWrap: "wrap" }}>
      {SIZES.map((s) => (
        <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <VoltageGlyph letter={letter} size={s} />
          <span style={{ fontFamily: "var(--vlt-mono), monospace", fontSize: 11, color: V.muted }}>{s}px</span>
        </div>
      ))}
    </div>
  );
}

function FaviconTile({ letter, bg }: { letter: "C" | "G"; bg: string }) {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 9,
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${V.border}`,
      }}
    >
      <VoltageGlyph letter={letter} size={28} />
    </div>
  );
}

export default function LogoLab() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: V.bg,
        color: V.text,
        fontFamily: "var(--vlt-display), system-ui, sans-serif",
        padding: "56px 40px 96px",
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <p style={{ fontFamily: "var(--vlt-mono), monospace", fontSize: 12, letterSpacing: "0.2em", color: V.accent, textTransform: "uppercase", margin: 0 }}>
          Voltage · logo lab
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 600, margin: "10px 0 6px", letterSpacing: "-0.01em" }}>
          Letterform marks — pick C or G
        </h1>
        <p style={{ color: V.muted, fontSize: 15, lineHeight: 1.6, maxWidth: 620, margin: 0 }}>
          The lit nodes now spell a letter, routed by the power trace, with one energized node.
          C sits in a clean 3×3; G uses a 4×4 field to keep its inner spur.
        </p>

        {(["G", "C"] as const).map((letter) => (
          <section key={letter} style={{ marginTop: 48 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
                Option {letter === "G" ? "1" : "2"} — “{letter}”
              </h2>
              <span style={{ height: 1, flex: 1, background: V.border }} />
              <span style={{ fontFamily: "var(--vlt-mono), monospace", fontSize: 11, color: V.muted }}>
                {letter === "G" ? "4×4 field · inner spur" : "3×3 field · also reads Census"}
              </span>
            </div>

            {/* scaling row */}
            <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: "26px 28px" }}>
              <MarkRow letter={letter} />
            </div>

            {/* lockup + favicon tiles */}
            <div style={{ display: "flex", gap: 18, marginTop: 18, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 360px", background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: "26px 28px", display: "flex", alignItems: "center" }}>
                <VoltageGlyphWordmark letter={letter} size={34} />
              </div>
              <div style={{ flex: "0 1 280px", background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: "22px 24px", display: "flex", alignItems: "center", gap: 14 }}>
                <FaviconTile letter={letter} bg={V.bg} />
                <FaviconTile letter={letter} bg="#000" />
                <FaviconTile letter={letter} bg="#fff" />
                <span style={{ fontFamily: "var(--vlt-mono), monospace", fontSize: 11, color: V.muted }}>favicon @ 28</span>
              </div>
            </div>

            {/* on light background */}
            <div style={{ marginTop: 18, background: "#F4F6F8", border: `1px solid ${V.border}`, borderRadius: 12, padding: "26px 28px", display: "flex", alignItems: "center", gap: 28 }}>
              <VoltageGlyph letter={letter} size={56} />
              <span style={{ fontFamily: "var(--vlt-display), system-ui, sans-serif", fontWeight: 600, fontSize: 22, letterSpacing: "0.15em", color: "#0A0B0D", textTransform: "uppercase" }}>
                Grid<span style={{ color: "#8B919B" }}>census</span>
              </span>
              <span style={{ marginLeft: "auto", fontFamily: "var(--vlt-mono), monospace", fontSize: 11, color: "#8B919B" }}>light mode</span>
            </div>
          </section>
        ))}

        {/* original single-spark, for reference */}
        <section style={{ marginTop: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: V.muted }}>For reference — the original single-spark mark</h2>
            <span style={{ height: 1, flex: 1, background: V.border }} />
          </div>
          <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: "26px 28px", display: "flex", alignItems: "center", gap: 28 }}>
            <VoltageMark size={48} />
            <VoltageWordmark size={30} />
          </div>
        </section>
      </div>
    </main>
  );
}
