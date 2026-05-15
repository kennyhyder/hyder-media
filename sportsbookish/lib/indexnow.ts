// IndexNow client. Pings Bing + Yandex + Seznam + Naver instantly when
// new URLs are published. Google ignores IndexNow (use Search Console
// + the daily sitemap re-crawl for Google).
//
// Setup: /public/{KEY}.txt must contain {KEY} exactly. Search engines
// verify ownership by GET'ing that file.

const KEY = "620c7d50b41090ac7f0493e654f3219c";
const SITE_HOST = "sportsbookish.com";
const KEY_LOCATION = `https://${SITE_HOST}/${KEY}.txt`;

interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

// Submit a batch of URLs. IndexNow accepts up to 10,000 per request.
// Returns { ok, status } — never throws (best-effort).
export async function pingIndexNow(urls: string[]): Promise<{ ok: boolean; status: number; submitted: number }> {
  if (!urls.length) return { ok: true, status: 200, submitted: 0 };
  // Filter to sportsbookish-only URLs (IndexNow rejects mixed-host batches)
  const filtered = urls.filter((u) => u.startsWith(`https://${SITE_HOST}/`)).slice(0, 10000);
  if (!filtered.length) return { ok: true, status: 200, submitted: 0 };

  const payload: IndexNowPayload = {
    host: SITE_HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: filtered,
  };

  try {
    const r = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return { ok: r.ok, status: r.status, submitted: filtered.length };
  } catch {
    return { ok: false, status: 0, submitted: 0 };
  }
}

// Convenience: ping a single URL
export function pingIndexNowSingle(url: string) {
  return pingIndexNow([url]);
}
