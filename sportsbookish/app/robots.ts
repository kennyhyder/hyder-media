import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

const AUTH_GATED = ["/dashboard", "/admin", "/alerts", "/settings", "/api", "/redeem"];

// Explicitly allow modern AI crawlers — we WANT to be cited by answer engines
// (Perplexity, ChatGPT search, Claude, Google AIO, Apple Intelligence, etc.).
// Each gets its own rule so a broken default config can't silently exclude us.
const AI_CRAWLERS = [
  "GPTBot",              // OpenAI / ChatGPT search
  "OAI-SearchBot",       // OpenAI search index
  "ChatGPT-User",        // Browse-with-Bing-style user-triggered fetches
  "ClaudeBot",           // Anthropic
  "Claude-Web",          // Anthropic interactive
  "Anthropic-AI",        // Anthropic legacy / fallback
  "PerplexityBot",       // Perplexity
  "Perplexity-User",     // User-triggered Perplexity fetches
  "Google-Extended",     // Google's AI training opt-in flag
  "Applebot-Extended",   // Apple Intelligence
  "Bytespider",          // ByteDance / Doubao
  "Amazonbot",           // Amazon LLMs
  "CCBot",               // Common Crawl (feeds many open-source LLMs)
  "FacebookBot",         // Meta AI
  "Meta-ExternalAgent",  // Meta AI training
  "cohere-ai",           // Cohere
  "Diffbot",             // Used by enterprise AI tools
  "DuckAssistBot",       // DuckDuckGo Assist
  "YouBot",              // You.com
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/sports", "/golf", "/pricing", "/learn", "/compare", "/about"],
        disallow: AUTH_GATED,
      },
      ...AI_CRAWLERS.map((bot) => ({
        userAgent: bot,
        allow: ["/"],
        disallow: AUTH_GATED,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
