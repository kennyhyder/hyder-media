import { Geist, Geist_Mono } from "next/font/google";
import NavBar from "../components/NavBar";
import ErrorBoundary from "../components/ErrorBoundary";
import DemoWrapper from "../components/DemoWrapper";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <title>GridScout - Transmission Infrastructure Intelligence</title>
        <meta name="description" content="Datacenter site selection intelligence: scored candidate sites, brownfield opportunities, and market analysis across the United States." />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 text-gray-900`}
      >
        <NavBar />
        <main className="max-w-7xl mx-auto px-4 py-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
        <DemoWrapper />
      </body>
    </html>
  );
}
