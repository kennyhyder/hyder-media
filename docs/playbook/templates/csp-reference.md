# Reference Content-Security-Policy

For a SaaS product using Stripe (Checkout + Customer Portal) + Google Analytics 4 + Supabase (Auth + Postgres + Realtime) + Resend (email) + custom OG images.

Tested against `securityheaders.com` — achieves A+ rating.

## The CSP

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://*.google-analytics.com https://js.stripe.com https://va.vercel-scripts.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: blob: https://*.google-analytics.com https://www.googletagmanager.com https://q.stripe.com https://js.stripe.com;
connect-src 'self' https://[your-supabase-project].supabase.co https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://api.stripe.com https://checkout.stripe.com wss://*.supabase.co;
frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com;
worker-src 'self' blob:;
media-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self' https://checkout.stripe.com https://billing.stripe.com;
frame-ancestors 'none';
upgrade-insecure-requests
```

## Why each directive is what it is

| Directive | Why this value |
|---|---|
| `default-src 'self'` | Default-deny baseline. Each other directive narrows or expands from here. |
| `script-src 'unsafe-inline' 'unsafe-eval'` | Required by Next.js App Router's RSC payload bootstrap (inline) and some chart libraries (eval). Nonce-based CSP is more secure but breaks Turbopack dev. Accept this for now. |
| `script-src ...googletagmanager.com ...google-analytics.com` | Both required — gtag loader is on GTM domain, but events POST to google-analytics. |
| `script-src js.stripe.com` | Stripe.js library |
| `script-src va.vercel-scripts.com` | Vercel Web Analytics (if used) |
| `style-src 'unsafe-inline'` | Tailwind v4 and shadcn emit inline styles. Required. |
| `style-src fonts.googleapis.com` | If using Google Fonts |
| `font-src fonts.gstatic.com data:` | Google Fonts serves WOFF2 from gstatic; some fonts are inlined as `data:` URLs |
| `img-src data: blob:` | data: for inline images, blob: for canvas-generated OG images |
| `img-src q.stripe.com` | Stripe loads a 1x1 telemetry pixel from q.stripe.com |
| `connect-src wss://*.supabase.co` | Supabase Realtime WebSocket |
| `connect-src *.google-analytics.com *.analytics.google.com *.googletagmanager.com` | All three are used by GA4 for different request types (config, events, region routing) |
| `frame-src js.stripe.com checkout.stripe.com hooks.stripe.com` | Stripe Elements + Checkout iframe + webhook-confirmation iframe |
| `form-action 'self' checkout.stripe.com billing.stripe.com` | **THE GOTCHA**: must include every domain a form might be redirected TO after submission, including 303 responses. Stripe Customer Portal redirects to billing.stripe.com. |
| `frame-ancestors 'none'` | Prevent your site being framed (clickjacking). Modern replacement for X-Frame-Options DENY. |
| `upgrade-insecure-requests` | Auto-upgrade any http:// references to https:// |

## Other security headers (pair with CSP)

```ts
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
```

## OG image route override

OG images need to be loadable cross-origin by social crawlers. Override `Cross-Origin-Resource-Policy` to `cross-origin` for the `/api/og/*` path:

```ts
async headers() {
  return [
    { source: "/(.*)", headers: securityHeaders },
    {
      source: "/api/og/:path*",
      headers: [
        { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        { key: "Cache-Control", value: "public, max-age=300, s-maxage=300" },
      ],
    },
  ];
}
```

## Common CSP mistakes that break things

- **Missing `wss://*.supabase.co`** → Supabase Realtime subscriptions silently fail. Symptoms: no live updates; nothing in error logs because WebSocket failures don't bubble up.
- **`script-src` missing `*.google-analytics.com`** → GA4 events fire to gtag but never reach GA servers. Realtime dashboard stays empty.
- **`form-action` missing `billing.stripe.com`** → Customer Portal button silently fails with browser console violation. No server-side error.
- **`frame-src` missing `hooks.stripe.com`** → Stripe Checkout's success-confirmation iframe fails to load. User sees blank page after payment.
- **`connect-src` missing your Supabase project URL** → Auth calls work via service-role client, fail via anon client. Symptoms: app appears to work for cron jobs, broken for users.

## Verify after deploy

```bash
# Inspect production CSP
curl -sI https://[yoursite] | grep -i "content-security-policy"

# Score against securityheaders.com
open "https://securityheaders.com/?q=https://[yoursite]&followRedirects=on"
```

Target: A+ rating. Anything less than A means at least one header is missing or weak.
