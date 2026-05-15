import Link from "next/link";
import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "Contact",
  description: "Send a message to SportsBookISH. We respond to all inquiries within a few business days.",
  alternates: { canonical: `${SITE_URL}/contact` },
};

export default function ContactPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Contact", url: "/contact" },
        ]),
        {
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: "Contact SportsBookISH",
          url: `${SITE_URL}/contact`,
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground/80">← Home</Link>
          <div className="text-sm font-semibold">Contact</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">Get in touch</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Feedback, bug reports, feature requests, press inquiries, or research access requests — drop a note and I&apos;ll respond.
        </p>

        <ContactForm />
      </main>
    </div>
  );
}
