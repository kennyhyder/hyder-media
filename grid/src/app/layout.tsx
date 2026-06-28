import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "../components/Sidebar";
import MobileNav from "../components/MobileNav";
import ThemeScript from "../components/ThemeScript";
import ErrorBoundary from "../components/ErrorBoundary";
import JsonLd from "../components/JsonLd";
import { organizationSchema, webApplicationSchema } from "../lib/schema";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION, SITE_TAGLINE } from "../lib/site";
import "./globals.css";

const GA_ID = "G-1198D11DJH";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* No-flash theme bootstrap — must run before first paint. */}
        <ThemeScript />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ background: "var(--bg)", color: "var(--text)" }}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[1000] focus:rounded focus:px-4 focus:py-2"
          style={{ background: "var(--accent)", color: "var(--tw-on-accent, #fff)" }}
        >
          Skip to content
        </a>
        {/* Google Analytics 4 — site-wide (every page inherits the root layout) */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
        </Script>
        <JsonLd data={[organizationSchema(), webApplicationSchema()]} />

        {/* App shell: fixed sidebar (desktop) + mobile top-bar/drawer. */}
        <Sidebar />
        <MobileNav />

        {/* Main content area. Offset by the 248px sidebar on lg+, full width
            below. Pages manage their own readable max-width (long-form text
            wraps; tables/maps/grids go full-bleed). */}
        <main id="main" className="min-h-screen lg:pl-[248px]">
          <div className="px-4 py-6 sm:px-6 lg:px-8">
            <ErrorBoundary>{children}</ErrorBoundary>
          </div>
        </main>
      </body>
    </html>
  );
}
