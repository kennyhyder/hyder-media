import type { NextConfig } from "next";

// Playbook security baseline. CSP accounts for: Leaflet CSS from unpkg
// (style-src), CartoDB + OSM map tiles (img-src), GA4 (script/connect), and the
// same-origin /api/grid proxy. Leaflet JS is npm-bundled, so script-src needs no
// unpkg. 'unsafe-inline' is required for GA4 init + Leaflet inline tile styles.
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://www.google-analytics.com https://www.googletagmanager.com https:",
  "font-src 'self' data:",
  "connect-src 'self' https://www.google-analytics.com https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Server build (NOT a static export) — ISR / dynamic routes / sitemaps need it.
  // NOTE: do not use output:"standalone" here. Vercel packages the app itself,
  // and standalone's node_modules copy step trips iCloud's ENOTEMPTY on this
  // synced Desktop dir. Default output builds clean locally and on Vercel.
  // This app has its own lockfile but lives inside the hyder-media monorepo,
  // which also has one. Pin the root so Next stops inferring the parent dir.
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: ContentSecurityPolicy },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), browsing-topics=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    // The legacy interactive client pages (/sites, /map, /brownfields, etc.)
    // fetch relative /api/grid/* endpoints. Proxy them server-side to the
    // existing live API on hyder.me so those pages keep working with zero
    // changes and no CORS issues.
    return [
      {
        source: "/api/grid/:path*",
        destination: "https://hyder.me/api/grid/:path*",
      },
    ];
  },
};

export default nextConfig;
