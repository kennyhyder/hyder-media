// Shared local-news fetcher (Google News RSS — keyless, works from server IPs;
// GDELT returns empty from cloud IPs). Used by vet-a-site and the developments
// synthesis endpoint. Server-only.

export interface Article {
  title: string;
  url: string;
  domain: string;
  date: string;
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return (m?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

/** Recent DC-siting news for a place (city/county/state string). */
export async function fetchNews(place: string): Promise<Article[]> {
  try {
    const query = `${place} ("data center" OR datacenter OR "large load" OR substation OR interconnection OR megawatt)`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GridCensus/1.0)" },
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.split("<item>").slice(1, 9);
    const out: Article[] = [];
    for (const it of items) {
      let title = tag(it, "title");
      const link = tag(it, "link");
      const source = tag(it, "source");
      const pub = tag(it, "pubDate");
      if (!title || !link) continue;
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      let date = pub;
      const t = Date.parse(pub);
      if (!isNaN(t)) date = new Date(t).toISOString().slice(0, 10);
      out.push({ title, url: link, domain: source, date });
    }
    return out.slice(0, 6);
  } catch {
    return [];
  }
}
