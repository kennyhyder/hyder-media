import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import VetSite from "@/components/VetSite";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";

export const revalidate = 604800; // page shell caches; the vet tool is live (client-fetched)

export const metadata: Metadata = {
  title: "Vet a Datacenter Site — Address, Town, or Coordinates",
  description:
    "Bring a location and a target build size, and get an instant first-pass read: satellite view, jurisdiction, MW-gated regulatory climate, county power/water/hazard context, nearby scored candidate sites, and the latest local news — free.",
  alternates: { canonical: `${SITE_URL}/vet` },
};

export default function VetPage() {
  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Vet a Site", url: "/vet" },
          ]),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <span className="text-gray-500">Vet a site</span>
      </nav>

      <header className="mt-3">
        <h1 className="text-3xl font-bold text-gray-900">Vet a site</h1>
        <p className="mt-2 max-w-3xl text-gray-700">
          Have a specific parcel, town, or set of coordinates in mind? Drop it in with your target
          build size and {SITE_NAME} returns a first-pass read — latest satellite imagery,
          jurisdiction, a megawatt-gated regulatory climate, county power/water/hazard context,
          the nearest scored candidate sites, and recent local developments.
        </p>
      </header>

      <section className="mt-6">
        <VetSite />
      </section>

      <p className="mt-8 max-w-3xl text-xs text-gray-400">
        A screening read from public data — geocoding via the US Census, jurisdiction via the FCC,
        imagery via Esri World Imagery, news via GDELT. Not a substitute for interconnection,
        environmental, or engineering studies.
      </p>
    </div>
  );
}
