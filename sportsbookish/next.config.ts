import type { NextConfig } from "next";

// Content-Security-Policy — has to permit:
//   - Self (default)
//   - Google Tag Manager / GA4 (gtag.js + region1.google-analytics.com)
//   - Stripe checkout (js.stripe.com + api.stripe.com + checkout.stripe.com)
//   - Supabase Auth (the project's *.supabase.co)
//   - Resend (server-side; no browser CSP needed)
//   - Vercel insights (vercel.live, vitals.vercel-insights.com)
//   - Inline styles (Tailwind v4 + shadcn emit some)
//   - Inline scripts via `'unsafe-inline'` — required by Next.js App Router
//     for the runtime bootstrap; nonce-based CSP is the alternative but it
//     breaks turbopack dev mode. We accept 'unsafe-inline' on scripts for
//     now because Next.js itself injects inline RSC payload scripts.
const SUPABASE_URL = "https://irzbgxemhmhmrlkjynuy.supabase.co";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://*.google-analytics.com https://js.stripe.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.google-analytics.com https://www.googletagmanager.com https://q.stripe.com https://js.stripe.com",
  `connect-src 'self' ${SUPABASE_URL} https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://api.stripe.com https://checkout.stripe.com https://hyder.me wss://*.supabase.co`,
  "frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=(), payment=(self "https://checkout.stripe.com")' },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // OG images need to be loadable cross-origin by social crawlers
        source: "/api/og/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=300, s-maxage=300" },
        ],
      },
    ];
  },
};

export default nextConfig;
