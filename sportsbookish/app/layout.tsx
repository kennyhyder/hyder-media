import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { GoogleAnalytics } from "@next/third-parties/google";
import ThemeProviderClient from "@/components/ThemeProviderClient";
import ThemeToggle from "@/components/ThemeToggle";
import { JsonLd, organizationLd, websiteLd, SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "@/lib/seo";
import "./globals.css";

const GA_ID = "G-WVTRLTCENT";

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
    default: `${SITE_NAME} — Live Kalshi odds vs the sportsbooks`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "kalshi odds",
    "kalshi vs sportsbooks",
    "kalshi vs draftkings",
    "kalshi vs fanduel",
    "nba kalshi odds",
    "mlb kalshi odds",
    "nhl kalshi odds",
    "epl kalshi odds",
    "pga kalshi odds",
    "sports edge calculator",
    "event-contract sports betting",
    "no-vig odds comparison",
  ],
  authors: [{ name: "Hyder Media", url: "https://hyder.me" }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Live Kalshi odds vs the sportsbooks`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Live Kalshi odds vs the sportsbooks`,
    description: SITE_DESCRIPTION,
    creator: "@sportsbookish",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <JsonLd data={[organizationLd(), websiteLd()]} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-emerald-600 focus:text-white focus:px-3 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>
        <ThemeProviderClient>
          {children}
          <Toaster position="top-right" richColors />
          {/* Site-wide floating theme toggle — visible on every page */}
          <div className="fixed bottom-3 right-3 z-50 rounded-full border border-border bg-background/80 backdrop-blur shadow-md">
            <ThemeToggle compact />
          </div>
        </ThemeProviderClient>
        <GoogleAnalytics gaId={GA_ID} />
      </body>
    </html>
  );
}
