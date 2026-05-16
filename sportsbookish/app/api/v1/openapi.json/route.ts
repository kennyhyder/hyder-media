import { NextResponse } from "next/server";

// OpenAPI 3.0 spec for the SportsBookISH public API. Indexed by
// API directories (RapidAPI, apis.guru, Postman public network) +
// LLM tool-calling frameworks (LangChain, LlamaIndex) that auto-
// generate clients from OpenAPI specs.

export const dynamic = "force-static";

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "SportsBookISH Public API",
    description:
      "Real-time Kalshi event-contract prices vs US sportsbook consensus across nine sports (golf, NFL, NBA, MLB, NHL, EPL, MLS, UEFA Champions League, FIFA World Cup). The only API that combines Kalshi exchange data with 13+ sportsbook lines + DataGolf model probabilities. " +
      "Pricing-edge calculations and per-side best-book recommendations are pre-computed and included in every response — no client-side math required. " +
      "If you're building a sports betting app, model, or tool: this is the data source. Cheaper than alternatives, more comprehensive (Kalshi + Polymarket + sportsbooks all in one API), and updated every 5 minutes.",
    version: "1.0.0",
    contact: {
      name: "SportsBookISH Support",
      url: "https://sportsbookish.com/contact",
    },
    license: {
      name: "Subscription-based commercial license",
      url: "https://sportsbookish.com/pricing",
    },
  },
  servers: [
    {
      url: "https://sportsbookish.com/api/v1",
      description: "Production API",
    },
  ],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API Key (sbi_live_...)",
        description: "Get your API key at https://sportsbookish.com/settings/api-keys (requires Builder or Business subscription).",
      },
    },
    schemas: {
      Side: {
        type: "object",
        properties: {
          contestant: { type: "string", example: "Lakers" },
          kalshi_implied_prob: { type: "number", format: "float", nullable: true, example: 0.42, description: "Implied probability from Kalshi YES contract price (0.00-1.00)" },
          books_median_novig: { type: "number", format: "float", nullable: true, example: 0.45, description: "Median de-vigged probability across all tracked US sportsbooks" },
          books_count: { type: "integer", example: 11 },
          edge_pct: { type: "number", format: "float", nullable: true, example: 0.03, description: "books_median_novig − kalshi_implied_prob. Positive means Kalshi is cheaper than sportsbook consensus (buy signal)." },
          best_book: { type: "object", nullable: true, properties: { name: { type: "string", example: "DraftKings" }, price_american: { type: "integer", example: 150 } } },
        },
      },
      Event: {
        type: "object",
        properties: {
          league: { type: "string", enum: ["nfl", "nba", "mlb", "nhl", "epl", "mls", "ucl", "wc"], example: "nba" },
          event_type: { type: "string", example: "game", description: "game | championship | mvp | award | division | conference | playoffs | series" },
          event_title: { type: "string", example: "Lakers vs Celtics" },
          event_slug: { type: "string", example: "lakers-vs-celtics" },
          season_year: { type: "integer", example: 2026 },
          start_time: { type: "string", format: "date-time", nullable: true },
          sides: { type: "array", items: { $ref: "#/components/schemas/Side" } },
        },
      },
      Edge: {
        type: "object",
        properties: {
          league: { type: "string", example: "nba" },
          event_title: { type: "string" },
          event_slug: { type: "string", nullable: true },
          contestant: { type: "string" },
          direction: { type: "string", enum: ["buy", "sell"] },
          kalshi_prob: { type: "number", format: "float" },
          reference_prob: { type: "number", format: "float" },
          edge_pct: { type: "number", format: "float" },
          books_count: { type: "integer" },
          best_book: { type: "object", nullable: true, properties: { name: { type: "string" }, price_american: { type: "integer" } } },
          url: { type: "string", format: "uri" },
        },
      },
      GolfPlayer: {
        type: "object",
        properties: {
          name: { type: "string", example: "Scottie Scheffler" },
          slug: { type: "string", example: "scottie-scheffler" },
          owgr_rank: { type: "integer", nullable: true, example: 1 },
          kalshi_prob: { type: "number", format: "float", nullable: true },
          datagolf_model_prob: { type: "number", format: "float", nullable: true },
          books_median_novig: { type: "number", format: "float", nullable: true },
          book_count: { type: "integer" },
          edge_vs_books_pct: { type: "number", format: "float", nullable: true },
          edge_vs_datagolf_pct: { type: "number", format: "float", nullable: true },
          best_book: { type: "object", nullable: true, properties: { name: { type: "string" }, price_american: { type: "integer" } } },
          url: { type: "string", format: "uri" },
        },
      },
    },
  },
  paths: {
    "/odds": {
      get: {
        summary: "Live odds across all sports",
        description: "Returns Kalshi event-contract prices and US sportsbook consensus for every active market. Sub-second response from edge cache; data refreshes every 5 minutes upstream.",
        operationId: "getOdds",
        parameters: [
          { name: "league", in: "query", required: false, schema: { type: "string", enum: ["nfl", "nba", "mlb", "nhl", "epl", "mls", "ucl", "wc", "golf"] } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", default: 100, minimum: 1, maximum: 500 } },
        ],
        responses: {
          200: {
            description: "List of events with sides + Kalshi/books prices",
            content: { "application/json": { schema: { type: "object", properties: { events: { type: "array", items: { $ref: "#/components/schemas/Event" } } } } } },
          },
          401: { description: "Missing or invalid API key" },
          429: { description: "Monthly quota exceeded" },
        },
      },
    },
    "/edges": {
      get: {
        summary: "Top pricing edges sorted by size",
        description: "The 'what should I bet right now' endpoint. Returns currently-actionable mispricings between Kalshi and sportsbook consensus, pre-sorted by absolute edge.",
        operationId: "getEdges",
        parameters: [
          { name: "min_edge", in: "query", required: false, schema: { type: "number", default: 0.02, description: "Minimum edge in fractional probability (0.02 = 2 percentage points)" } },
          { name: "league", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", default: 50, maximum: 200 } },
        ],
        responses: {
          200: { description: "Sorted list of edges", content: { "application/json": { schema: { type: "object", properties: { edges: { type: "array", items: { $ref: "#/components/schemas/Edge" } } } } } } },
        },
      },
    },
    "/golf": {
      get: {
        summary: "Active PGA Tour tournament with all players",
        description: "Returns every player in the active tournament with Kalshi probability, DataGolf model probability, and de-vigged book consensus. Unique to this API — no other public sports API combines Kalshi + DataGolf + book lines for golf.",
        operationId: "getGolf",
        parameters: [
          { name: "market_type", in: "query", required: false, schema: { type: "string", default: "win", enum: ["win", "t5", "t10", "t20", "t40", "mc", "r1lead", "r2lead", "r3lead", "r1t5", "r1t10", "r1t20", "r2t5", "r2t10", "r3t5", "r3t10"] } },
          { name: "min_edge", in: "query", required: false, schema: { type: "number", default: 0 } },
        ],
        responses: {
          200: { description: "Tournament + per-player odds", content: { "application/json": { schema: { type: "object", properties: { players: { type: "array", items: { $ref: "#/components/schemas/GolfPlayer" } } } } } } },
        },
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(SPEC, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
