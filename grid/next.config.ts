import type { NextConfig } from "next";

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
