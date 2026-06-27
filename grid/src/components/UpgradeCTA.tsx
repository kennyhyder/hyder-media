// Subscription / contact CTA block used at the bottom of pSEO pages.

import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";

export default function UpgradeCTA({
  context,
}: {
  context?: string;
}) {
  return (
    <section className="mt-12 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-6 md:p-8">
      <h2 className="text-xl font-bold text-gray-900">
        Go deeper than the public screen
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-gray-700">
        This page shows a public slice of the {SITE_NAME} dataset
        {context ? ` for ${context}` : ""}. Pro and Enterprise plans unlock the
        full {Intl.NumberFormat("en-US").format(164098)}-site catalog, raw
        sub-scores, parcel ownership, interconnection-queue detail, saved
        searches, and programmatic API access.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href="/pricing"
          className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700"
        >
          See plans &amp; API access
        </a>
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
            "MegaWatt Site — dataset / API inquiry"
          )}`}
          className="rounded-lg border border-purple-300 bg-white px-5 py-2.5 text-sm font-semibold text-purple-700 hover:bg-purple-50"
        >
          Talk to us
        </a>
      </div>
    </section>
  );
}
