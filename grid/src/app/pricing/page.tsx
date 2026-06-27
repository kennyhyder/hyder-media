import type { Metadata } from "next";
import { SITE_NAME, SITE_URL, CONTACT_EMAIL } from "@/lib/site";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Pricing",
  description: `${SITE_NAME} plans — free public screening, Pro full-dataset access, and Enterprise API + custom site-selection support.`,
  alternates: { canonical: `${SITE_URL}/pricing` },
};

const TIERS = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    blurb: "Public site-selection screening for analysts and the curious.",
    features: [
      "State, ISO, county & site-type rankings",
      "Top scored sites per geography",
      "DC Readiness methodology",
      "Monthly dataset refresh",
    ],
    cta: { label: "Browse the data", href: "/datacenter-sites" },
    highlight: false,
  },
  {
    name: "Pro",
    price: "$249",
    cadence: "/mo",
    blurb: "The full catalog for developers, brokers, and site-selection teams.",
    features: [
      "All 164,098 sites with full sub-scores",
      "Parcel ownership & interconnection-queue detail",
      "Saved searches & CSV export",
      "Custom scoring weights",
      "Email support",
    ],
    cta: { label: "Contact sales", href: `mailto:${CONTACT_EMAIL}?subject=MegaWatt%20Site%20Pro` },
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    blurb: "API access and bespoke site-selection support for hyperscalers and funds.",
    features: [
      "Programmatic REST API + bulk data",
      "Custom datasets & dedicated scoring models",
      "Transmission corridor & speed-to-power studies",
      "Priority analyst support",
      "SLA & onboarding",
    ],
    cta: { label: "Talk to us", href: `mailto:${CONTACT_EMAIL}?subject=MegaWatt%20Site%20Enterprise` },
    highlight: false,
  },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "Pricing", url: "/pricing" },
        ])}
      />
      <header className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">Plans &amp; access</h1>
        <p className="mx-auto mt-3 max-w-2xl text-gray-600">
          {SITE_NAME} turns public infrastructure data into a datacenter
          site-selection screen. Start free; upgrade when you need the full
          catalog, raw scores, or API access. Billing wiring is in progress —
          reach out to get set up today.
        </p>
      </header>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={`flex flex-col rounded-2xl border p-6 ${
              t.highlight
                ? "border-purple-400 bg-purple-50 shadow-sm ring-1 ring-purple-200"
                : "border-gray-200 bg-white"
            }`}
          >
            <h2 className="text-lg font-bold text-gray-900">{t.name}</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-extrabold text-gray-900">{t.price}</span>
              <span className="text-sm text-gray-500">{t.cadence}</span>
            </div>
            <p className="mt-2 text-sm text-gray-600">{t.blurb}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-700">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-purple-600">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <a
              href={t.cta.href}
              className={`mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-semibold ${
                t.highlight
                  ? "bg-purple-600 text-white hover:bg-purple-700"
                  : "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
              }`}
            >
              {t.cta.label}
            </a>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-gray-400">
        Real checkout (Stripe) is a later milestone. Questions? {CONTACT_EMAIL}
      </p>
    </div>
  );
}
