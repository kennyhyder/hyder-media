import type { Metadata } from "next";

// API docs are a reference surface, not an indexable content page.
export const metadata: Metadata = {
  title: "API Documentation",
  robots: { index: false, follow: true },
};

export default function ApiDocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
