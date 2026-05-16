import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "SportsBookISH API — Kalshi + Sportsbook + DataGolf odds in one endpoint",
  description: "REST API for live Kalshi event-contract prices vs US sportsbooks across 9 sports + golf. The only API combining Kalshi exchange + 13 sportsbooks + DataGolf model. Cheaper than the-odds-api.com, with data sources nobody else has.",
  alternates: { canonical: `${SITE_URL}/api/docs` },
};

const FAQ = [
  {
    question: "What does this API give me that the-odds-api.com doesn't?",
    answer: "Three things: (1) Kalshi event-contract prices — the CFTC-regulated exchange. No other public sports API has Kalshi data. (2) Polymarket peer-to-peer prices on overlapping events. (3) Pre-computed pricing edges (Kalshi vs book consensus) so you don't have to do the de-vig math client-side. We also include DataGolf model probabilities for golf, which DataGolf charges $30/mo extra for.",
  },
  {
    question: "What's the pricing?",
    answer: "Demo tier: 1,000 requests/month shared across all users (use the demo key embedded in the curl examples below — no signup). API ($50/mo) or API Annual ($500/yr — save $100): 20,000 requests/month per personal key, commercial usage rights. Enterprise: custom volume + WebSocket + historical archive, contact for pricing.",
  },
  {
    question: "How is this different from sportsbook APIs?",
    answer: "We aggregate 13+ sportsbooks PLUS Kalshi PLUS Polymarket into a single normalized schema. You get the comparison data — best book per side, edge vs consensus, no-vig probabilities — pre-computed. Individual sportsbook APIs don't exist as public products. The-odds-api.com gives you raw book data; we give you the comparison + edge layer on top.",
  },
  {
    question: "Can I use this for commercial products?",
    answer: "Yes. Every paid tier (Builder, Business, Enterprise) includes commercial usage rights. You can build betting tools, analytics dashboards, recommendation engines, model training data sets, etc. Attribution to sportsbookish.com is appreciated but not required for the API tiers.",
  },
  {
    question: "How fresh is the data?",
    answer: "Kalshi quotes refresh every 5 minutes via cron. Sportsbook lines refresh every 15-30 minutes (we pay the same Odds API rates you would). DataGolf model probabilities refresh every 10 minutes during active tournaments. Polymarket every 15 minutes. References older than 30 minutes are filtered out automatically so you never get phantom edges.",
  },
  {
    question: "How do I authenticate?",
    answer: "Bearer token in the Authorization header. Format: 'Authorization: Bearer sbi_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'. Create your key at /settings/api-keys after subscribing.",
  },
  {
    question: "Is there an OpenAPI spec?",
    answer: "Yes — published at /api/v1/openapi.json (no auth required to fetch the spec itself). OpenAPI 3.1.0 format. Use it to auto-generate clients in any language (Python, TypeScript, Go, etc.) or with LLM tool-calling frameworks (LangChain, LlamaIndex).",
  },
  {
    question: "Rate limits + quotas?",
    answer: "Per-key monthly quota (resets at start of UTC month). Demo: 1,000/mo shared. API: 20,000/mo per personal key. Enterprise: custom. No per-second rate limit on paid tiers — burst as needed. Every response includes a tier-aware Cache-Control header so HTTP caches (Cloudflare, AWS CloudFront, browser) can serve repeat queries without consuming your quota.",
  },
];

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "API", url: "/api/docs" },
        ]),
        faqLd(FAQ),
        {
          "@context": "https://schema.org",
          "@type": "WebAPI",
          name: "SportsBookISH Public API",
          description: "Real-time Kalshi event-contract prices vs US sportsbook consensus across nine sports. The only public API combining Kalshi + Polymarket + 13 sportsbooks + DataGolf model.",
          provider: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
          documentation: `${SITE_URL}/api/docs`,
          termsOfService: `${SITE_URL}/pricing`,
          potentialAction: { "@type": "ConsumeAction", target: `${SITE_URL}/api/v1/odds` },
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground/80">← Home</Link>
          <div className="text-sm font-semibold">API docs</div>
          <Link href="/pricing#api" className="text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 font-semibold">Get API key</Link>
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-4xl md:text-5xl font-bold mb-3">SportsBookISH API</h1>
        <p className="text-xl text-muted-foreground mb-8 max-w-3xl">
          The only public API combining <strong>Kalshi event-contract prices</strong>,
          <strong className="ml-1">13+ US sportsbooks</strong>, <strong className="ml-1">Polymarket</strong>,
          and the <strong className="ml-1">DataGolf model</strong> into one normalized schema, with pricing edges pre-computed.
          Built for sports betting apps, ML pipelines, prediction-market research, and any tool that needs better data than what <a className="text-emerald-500 hover:underline" href="https://the-odds-api.com" target="_blank" rel="noopener noreferrer">the-odds-api.com</a> ships.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-10">
          <Card title="🎯 Unique data" body="Kalshi + Polymarket + DataGolf model that no other public sports API has." />
          <Card title="⚡ Pre-computed edges" body="Edge vs book consensus, best book per side, no-vig probabilities — all done server-side." />
          <Card title="💰 Cheaper than alternatives" body="$50/mo for 20k requests + Kalshi + Polymarket + DataGolf. The-odds-api.com Starter is $30/mo for 500 requests and has none of those data sources." />
        </div>

        {/* Quick start */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-3">Quick start — try it now</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Public demo key is embedded below — copy any curl command and run it. No signup required. The demo key has a 1,000 requests/month quota shared across all users.
          </p>
          <pre className="bg-card border border-border rounded-lg p-4 text-sm overflow-auto"><code>{`# Get every Kalshi vs sportsbook market for tonight's NBA games
curl https://sportsbookish.com/api/v1/odds?league=nba \\
  -H "Authorization: Bearer sbi_live_84fdd6cc6a6b2df3e38a9f19a49537a5"

# Get top 50 buy/sell edges across all sports
curl https://sportsbookish.com/api/v1/edges?min_edge=0.02 \\
  -H "Authorization: Bearer sbi_live_84fdd6cc6a6b2df3e38a9f19a49537a5"

# Active PGA Tour tournament with every player's Kalshi vs DataGolf
curl https://sportsbookish.com/api/v1/golf?market_type=win \\
  -H "Authorization: Bearer sbi_live_84fdd6cc6a6b2df3e38a9f19a49537a5"`}</code></pre>
        </section>

        {/* Endpoints */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4">Endpoints</h2>

          <Endpoint
            method="GET"
            path="/api/v1/odds"
            title="Live odds across all sports"
            body="Returns Kalshi event-contract prices and US sportsbook consensus for every active market. Edge calculations pre-computed per side."
            params={[
              { name: "league", optional: true, type: "string", desc: "nfl, nba, mlb, nhl, epl, mls, ucl, wc, golf" },
              { name: "limit", optional: true, type: "integer", desc: "max events (default 100, max 500)" },
            ]}
            example={`{
  "events": [
    {
      "league": "nba",
      "event_title": "Lakers vs Celtics",
      "event_slug": "lakers-vs-celtics",
      "sides": [
        {
          "contestant": "Lakers",
          "kalshi_implied_prob": 0.42,
          "books_median_novig": 0.45,
          "books_count": 11,
          "edge_pct": 0.03,
          "best_book": { "name": "DraftKings", "price_american": 150 }
        }
      ]
    }
  ]
}`}
          />

          <Endpoint
            method="GET"
            path="/api/v1/edges"
            title="Top pricing edges, pre-sorted"
            body="'What should I bet right now?' The most-used endpoint — returns mispricings between Kalshi and sportsbook consensus sorted by edge size."
            params={[
              { name: "min_edge", optional: true, type: "number", desc: "Minimum edge in fractional prob (0.02 = 2pp). Default 0.02." },
              { name: "league", optional: true, type: "string", desc: "Filter to one league" },
              { name: "limit", optional: true, type: "integer", desc: "max edges (default 50, max 200)" },
            ]}
            example={`{
  "edges": [
    {
      "league": "nba",
      "event_title": "Lakers vs Celtics",
      "contestant": "Celtics",
      "direction": "buy",
      "kalshi_prob": 0.55,
      "reference_prob": 0.62,
      "edge_pct": 0.07,
      "best_book": { "name": "FanDuel", "price_american": -130 },
      "url": "https://sportsbookish.com/sports/nba/2026/lakers-vs-celtics"
    }
  ]
}`}
          />

          <Endpoint
            method="GET"
            path="/api/v1/golf"
            title="Active PGA Tour tournament — Kalshi + DataGolf + books"
            body="Every player in the active major/tournament with Kalshi probability, DataGolf model probability, and de-vigged book consensus from 13+ sportsbooks. Unique to this API."
            params={[
              { name: "market_type", optional: true, type: "string", desc: "win (default) | t5 | t10 | t20 | t40 | mc | r1lead | r2lead | etc." },
              { name: "min_edge", optional: true, type: "number", desc: "Filter to players with Kalshi-vs-books edge ≥ X" },
            ]}
            example={`{
  "tournament": { "name": "PGA Championship", "is_major": true },
  "market_type": "win",
  "players": [
    {
      "name": "Scottie Scheffler",
      "owgr_rank": 1,
      "kalshi_prob": 0.143,
      "datagolf_model_prob": 0.164,
      "books_median_novig": 0.155,
      "book_count": 12,
      "edge_vs_books_pct": 0.012,
      "edge_vs_datagolf_pct": 0.021,
      "url": "https://sportsbookish.com/golf/players/scottie-scheffler"
    }
  ]
}`}
          />
        </section>

        {/* Comparison */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-3">How we compare to alternatives</h2>
          <table className="w-full text-sm border-collapse border border-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="border border-border px-3 py-2 text-left">Feature</th>
                <th className="border border-border px-3 py-2 text-left">SportsBookISH</th>
                <th className="border border-border px-3 py-2 text-left">the-odds-api.com</th>
                <th className="border border-border px-3 py-2 text-left">DataGolf</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Kalshi event-contract prices" you="✅ Every active series" them1="❌ Not available" them2="❌ Not available" />
              <Row label="Polymarket prices" you="✅ Overlapping events" them1="❌ Not available" them2="❌ Not available" />
              <Row label="DataGolf model probabilities" you="✅ Built-in for golf" them1="❌ Not available" them2="✅ Their core product" />
              <Row label="13+ US sportsbooks" you="✅ Aggregated" them1="✅ Per-book" them2="🟡 Golf only" />
              <Row label="Pre-computed edges" you="✅ Per side per market" them1="❌ Client-side math" them2="❌ Client-side math" />
              <Row label="No-vig probabilities" you="✅ Per book + median" them1="❌ Client-side math" them2="✅ Built-in" />
              <Row label="Starting price (10k req/mo)" you="$99/mo" them1="$30/mo (500 req)" them2="$30/mo (unlimited)" />
              <Row label="OpenAPI spec" you="✅ /api/v1/openapi.json" them1="✅" them2="❌" />
              <Row label="WebSocket (real-time)" you="🟡 Business tier" them1="❌" them2="❌" />
            </tbody>
          </table>
        </section>

        {/* Pricing */}
        <section className="mb-10" id="pricing">
          <h2 className="text-2xl font-bold mb-4">API pricing</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Tier name="Demo" price="$0" reqs="1,000 / month" notes="Shared key — no signup. AI-friendly for tool evaluation." />
            <Tier name="API" price="$50 / month" reqs="20,000 / month" notes="Personal key, commercial usage, full endpoints." highlight />
            <Tier name="API Annual" price="$500 / year" reqs="20,000 / month" notes="Same as monthly, save $100/yr. Priority email support." />
            <Tier name="Enterprise" price="Custom" reqs="50k+ / month" notes="WebSocket, historical archive, SLA. Contact us." />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Quotas reset at the start of each UTC month. No overage charges — calls beyond your quota return 429 until reset (or upgrade).{" "}
            <Link href="/pricing" className="text-emerald-500 hover:underline">Subscribe →</Link>
          </p>
        </section>

        {/* SDK examples */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4">Language examples</h2>

          <details className="mb-3 rounded-lg border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">Python</summary>
            <pre className="mt-3 text-sm overflow-auto"><code>{`import requests

API_KEY = "sbi_live_84fdd6cc6a6b2df3e38a9f19a49537a5"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

# Top edges across all sports
r = requests.get(
    "https://sportsbookish.com/api/v1/edges",
    headers=HEADERS,
    params={"min_edge": 0.03, "limit": 20},
)
edges = r.json()["edges"]
for e in edges:
    print(f"{e['contestant']} {e['direction'].upper()} +{e['edge_pct']*100:.1f}pp — {e['url']}")`}</code></pre>
          </details>

          <details className="mb-3 rounded-lg border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">TypeScript / Node</summary>
            <pre className="mt-3 text-sm overflow-auto"><code>{`const API_KEY = process.env.SPORTSBOOKISH_API_KEY!;

const r = await fetch("https://sportsbookish.com/api/v1/odds?league=nba", {
  headers: { Authorization: \`Bearer \${API_KEY}\` },
});
const { events } = await r.json();
console.log(\`\${events.length} NBA events with live Kalshi+book data\`);`}</code></pre>
          </details>

          <details className="mb-3 rounded-lg border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">LangChain (LLM tool-calling)</summary>
            <pre className="mt-3 text-sm overflow-auto"><code>{`from langchain.tools import OpenAPISpec
from langchain.agents import create_openapi_agent

spec = OpenAPISpec.from_url("https://sportsbookish.com/api/v1/openapi.json")
agent = create_openapi_agent(spec, llm, headers={"Authorization": "Bearer sbi_live_84fdd6cc6a6b2df3e38a9f19a49537a5"})

agent.run("What's the best NBA edge right now?")`}</code></pre>
          </details>
        </section>

        {/* OpenAPI */}
        <section className="mb-10 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-5">
          <h2 className="text-2xl font-bold mb-2">OpenAPI 3.1 spec</h2>
          <p className="text-sm mb-3">
            Machine-readable spec at <a href="/api/v1/openapi.json" className="text-emerald-500 hover:underline font-mono">/api/v1/openapi.json</a> — use it to auto-generate clients in any language, plug into LLM tool-calling frameworks, or import into Postman/Insomnia.
          </p>
          <a href="/api/v1/openapi.json" className="inline-flex items-center gap-1.5 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 font-semibold">
            Download spec →
          </a>
        </section>

        <h2 className="text-2xl font-bold mb-4">FAQ</h2>
        <div className="space-y-2 mb-10">
          {FAQ.map((f) => (
            <details key={f.question} className="group rounded border border-border/60 bg-card/50 px-4 py-3">
              <summary className="cursor-pointer font-medium text-sm">{f.question}</summary>
              <div className="mt-2 text-sm text-muted-foreground">{f.answer}</div>
            </details>
          ))}
        </div>
      </main>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-semibold text-base mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Endpoint({ method, path, title, body, params, example }: { method: string; path: string; title: string; body: string; params: { name: string; optional: boolean; type: string; desc: string }[]; example: string }) {
  return (
    <div className="mb-6 rounded-lg border border-border bg-card/50 p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-500/15 text-emerald-400">{method}</span>
        <code className="text-sm font-semibold">{path}</code>
      </div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-3">{body}</p>
      {params.length > 0 && (
        <div className="mb-3 text-xs">
          <div className="text-muted-foreground uppercase tracking-wider mb-1">Parameters</div>
          <ul className="space-y-0.5">
            {params.map((p) => (
              <li key={p.name}>
                <code className="text-emerald-400">{p.name}</code> <span className="text-muted-foreground">({p.type}{p.optional ? ", optional" : ""})</span> — {p.desc}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Example response</summary>
        <pre className="mt-2 text-xs bg-background border border-border/60 rounded p-3 overflow-auto"><code>{example}</code></pre>
      </details>
    </div>
  );
}

function Row({ label, you, them1, them2 }: { label: string; you: string; them1: string; them2: string }) {
  return (
    <tr>
      <td className="border border-border px-3 py-2 font-medium">{label}</td>
      <td className="border border-border px-3 py-2 text-emerald-400">{you}</td>
      <td className="border border-border px-3 py-2 text-muted-foreground">{them1}</td>
      <td className="border border-border px-3 py-2 text-muted-foreground">{them2}</td>
    </tr>
  );
}

function Tier({ name, price, reqs, notes, highlight }: { name: string; price: string; reqs: string; notes: string; highlight?: boolean }) {
  const cls = highlight ? "border-emerald-500/50 bg-emerald-500/5" : "border-border bg-card";
  return (
    <div className={`rounded-lg border ${cls} p-4`}>
      <div className="text-sm uppercase tracking-wider text-muted-foreground mb-1">{name}</div>
      <div className="text-2xl font-bold">{price}</div>
      <div className="text-sm font-mono text-emerald-400 mt-1">{reqs}</div>
      <p className="text-xs text-muted-foreground mt-2">{notes}</p>
    </div>
  );
}
