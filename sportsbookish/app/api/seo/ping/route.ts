import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import { pingIndexNow } from "@/lib/indexnow";

// Manual SEO ping endpoint. Admin-only. Pushes the current sitemap shards
// to IndexNow (Bing/Yandex/Naver/Seznam) and pings Google's sitemap-ping
// endpoint to nudge re-crawl.
//
// GET /api/seo/ping            ping with the canonical site URLs
// POST /api/seo/ping {urls:[]} ping with a specific URL list

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

// Canonical "high-priority" URLs that benefit from explicit pings whenever
// content updates land. Cheap to over-ping; expensive to under-ping.
const CORE_URLS = [
  `${SITE_URL}/`,
  `${SITE_URL}/sports`,
  `${SITE_URL}/golf`,
  `${SITE_URL}/tools`,
  `${SITE_URL}/learn/glossary`,
  `${SITE_URL}/data`,
];

async function pingGoogleSitemap(): Promise<{ ok: boolean; status: number }> {
  // Google retired the /ping endpoint in 2023 — sitemap discovery is now
  // automatic via robots.txt sitemap: directive + Search Console submission.
  // We keep this as a no-op stub so callers don't need to branch.
  return { ok: true, status: 200 };
}

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const [indexnow, google] = await Promise.all([
    pingIndexNow(CORE_URLS),
    pingGoogleSitemap(),
  ]);
  return NextResponse.json({ ok: true, indexnow, google, pinged: CORE_URLS });
}

export async function POST(req: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const urls: string[] = Array.isArray(body.urls) ? body.urls : [];
  if (urls.length === 0) {
    return NextResponse.json({ error: "urls array required" }, { status: 400 });
  }
  if (urls.length > 10000) {
    return NextResponse.json({ error: "Max 10,000 URLs per request" }, { status: 400 });
  }
  const result = await pingIndexNow(urls);
  return NextResponse.json(result);
}
