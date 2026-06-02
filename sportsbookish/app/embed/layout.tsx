import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Embed-specific layout — no SiteHeader / SiteFooter / nav. Just the content.
// Used by /embed/event/[id], /embed/biggest-edges, etc.
//
// X-Frame-Options is overridden in next.config.ts for /embed/* to allow
// cross-origin iframe usage by third-party sites.
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#0a0a0a", color: "#e4e4e7" }}>
        {children}
      </body>
    </html>
  );
}
