// Drip email templates. Each template is a pure function from UserContext
// → { subject, html, text }. UserContext is built by the cron from
// sb_user_events + sb_subscriptions + auth.users so the same template
// renders with personalized data without touching the DB during render.

export interface UserContext {
  user_id: string;
  email: string;
  first_name: string | null;
  signup_at: string;
  tier: "free" | "pro" | "elite";
  // Activity counts (last 30d)
  event_views: number;
  positive_ev_views: number;
  pricing_views: number;
  paywall_hits: number;
  bet_count: number;
  last_active_at: string | null;
  // Most-viewed sport (for personalization)
  top_sport: string | null;
  // Unsubscribe token for one-click link
  unsub_token: string;
  // Live aggregate stats for content blocks
  current_top_edge_pct: number | null;     // biggest +EV right now
  current_top_event_title: string | null;
  active_alerts_count: number;             // platform-wide
  active_leagues: number;
}

const SITE = "https://sportsbookish.com";
const SUPPORT_EMAIL = "kenny@hyder.me";

// ---- Shared layout chrome ----

function chrome(opts: { content: string; preheader: string; unsubToken: string }): string {
  const unsubUrl = `${SITE}/unsubscribe/${opts.unsubToken}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SportsBookISH</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e4e4e7;">
<div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#111;border:1px solid #222;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:20px 28px;border-bottom:1px solid #1f1f1f;">
    <a href="${SITE}" style="text-decoration:none;color:#10b981;font-weight:700;font-size:16px;letter-spacing:-0.01em;">SportsBookISH</a>
    <span style="color:#525252;font-size:12px;margin-left:8px;">Kalshi vs the books · live</span>
  </td></tr>
  <tr><td style="padding:28px;color:#e4e4e7;line-height:1.55;font-size:15px;">
    ${opts.content}
  </td></tr>
  <tr><td style="padding:16px 28px;background:#0a0a0a;border-top:1px solid #1f1f1f;color:#6b7280;font-size:12px;text-align:center;">
    <a href="${SITE}" style="color:#10b981;text-decoration:none;">sportsbookish.com</a>
    &nbsp;·&nbsp;<a href="${SITE}/settings" style="color:#9ca3af;text-decoration:none;">Preferences</a>
    &nbsp;·&nbsp;<a href="${unsubUrl}" style="color:#9ca3af;text-decoration:none;">Unsubscribe</a>
    <div style="margin-top:10px;color:#525252;font-size:11px;">Hyder Media · Hawaii, USA · You're getting this because you signed up at sportsbookish.com.</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function btn(href: string, label: string, primary = true): string {
  const bg = primary ? "#10b981" : "transparent";
  const color = primary ? "#022c22" : "#10b981";
  const border = primary ? "#10b981" : "#10b981";
  return `<a href="${href}" style="display:inline-block;background:${bg};color:${color};border:1px solid ${border};border-radius:8px;padding:11px 22px;font-weight:600;font-size:14px;text-decoration:none;margin-right:8px;margin-top:8px;">${label}</a>`;
}

function html(content: string): string {
  return content;
}

// Plain-text fallback (Gmail uses this for spam scoring). Strip HTML.
function textFromHtml(input: string): string {
  return input
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function greet(ctx: UserContext): string {
  return ctx.first_name ? `Hey ${ctx.first_name},` : "Hey there,";
}

// ============================================================
// Welcome sequence (D0 → D21)
// ============================================================

export interface EmailRender {
  subject: string;
  html: string;
  text: string;
}

export const TEMPLATES: Record<string, (ctx: UserContext) => EmailRender> = {
  // ----- D0: Welcome (~1 min after signup) -----
  welcome_d0(ctx) {
    const subject = "You're in. Here's how SportsBookISH actually works.";
    const preheader = "60-second onboarding so the first edge you spot isn't your last.";
    const body = html(`
<p>${greet(ctx)}</p>
<p>Most odds tools give you a wall of numbers and call it a day. SportsBookISH is different — every line is compared against Kalshi (the regulated event-contracts exchange) and the no-vig consensus of 14+ sportsbooks. <strong>Where they disagree is your edge.</strong></p>
<p>The fastest way to see it work:</p>
<ol style="padding-left:20px;line-height:1.7;">
<li><strong>Open the +EV scanner.</strong> Every market with a Kalshi-vs-books gap, ranked by size. <a href="${SITE}/sports/positive-ev" style="color:#10b981;">→ Live scan</a></li>
<li><strong>Pick your home book.</strong> The site recolors every edge as "vs <em>your</em> book" instead of consensus. <a href="${SITE}/settings" style="color:#10b981;">→ 30 seconds</a></li>
<li><strong>Bookmark a sport.</strong> <a href="${SITE}/sports/mlb" style="color:#10b981;">MLB</a>, <a href="${SITE}/sports/nba" style="color:#10b981;">NBA</a>, <a href="${SITE}/golf" style="color:#10b981;">Golf</a>.</li>
</ol>
<p>${btn(SITE + "/sports/positive-ev", "Open the +EV scanner →")}</p>
<p style="color:#9ca3af;font-size:13px;">Email back if you get stuck — replies go straight to me. — Kenny (founder)</p>
`);
    return { subject, html: chrome({ content: body, preheader, unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },

  // ----- D2: Demonstrate value with live numbers -----
  value_d2(ctx) {
    const subject = ctx.current_top_edge_pct != null
      ? `Right now: +${(ctx.current_top_edge_pct * 100).toFixed(1)}% edge on Kalshi`
      : `What "+EV" actually means (with a worked example)`;
    const preheader = "The biggest live mispricing on the platform, with the math.";
    const live = ctx.current_top_edge_pct != null && ctx.current_top_event_title
      ? `<p>Quick example. Right now the biggest live +EV on the platform is <strong>${ctx.current_top_event_title}</strong>, where Kalshi is pricing <strong>${(ctx.current_top_edge_pct * 100).toFixed(1)} percentage points</strong> below the 14-book consensus fair value. If books are right, Kalshi is the cheaper buy by that much.</p>`
      : `<p>(There aren't enough live +EV opportunities at this exact moment to highlight one — they'll be back shortly during peak game hours.)</p>`;
    const body = html(`
<p>${greet(ctx)}</p>
<p>Two days in. Let me show you the actual math.</p>
<p>For a YES contract on Kalshi at $0.45, the implied probability is 45%. If you devig DraftKings, FanDuel, BetMGM, Caesars, BetRivers, and Fanatics on the same outcome and the median lands at 51%, Kalshi is 6 percentage points cheaper than the fair book consensus says it should be. That's a <strong>+6pp edge</strong> — over many bets, mathematically profitable.</p>
${live}
<p>${btn(SITE + "/sports/positive-ev", "See every +EV opportunity →")} ${btn(SITE + "/learn/no-vig-explained", "How devigging works", false)}</p>
<p style="color:#9ca3af;font-size:13px;">Tomorrow: how Kalshi prices move differently from sportsbooks (and why that matters more than the gap itself).</p>
`);
    return { subject, html: chrome({ content: body, preheader, unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },

  // ----- D4: Tactical guide -----
  tactic_d4(ctx) {
    const subject = "Why Kalshi prices move different from books (and how to use it)";
    const preheader = "Two pricing engines, same outcome, frequent disagreement.";
    const body = html(`
<p>${greet(ctx)}</p>
<p>Sportsbooks set prices to attract balanced action on both sides — they're risk managers first. Kalshi prices are set by users buying and selling YES/NO contracts on real outcomes — they're a true peer-to-peer market.</p>
<p><strong>The practical implication:</strong> Kalshi moves on actual money. Sportsbooks move on a mix of money, public sentiment, and house exposure. When a sportsbook line drifts but Kalshi doesn't — or vice versa — one of them is wrong, and the gap is the edge.</p>
<p>Three places this shows up:</p>
<ul style="padding-left:20px;line-height:1.7;">
<li><strong>Pre-game line drifts.</strong> Sportsbook lifts the price on the public favorite with no news. Kalshi sits still. That's a fade signal.</li>
<li><strong>Mid-game repricing.</strong> Sportsbooks pause/lag during action. Kalshi keeps trading. Watch the divergence in the last 5-10 min before lock.</li>
<li><strong>Player props.</strong> Sportsbooks anchor on season averages. Kalshi traders price recency. Disagreement on second-half props is common.</li>
</ul>
<p>${btn(SITE + "/sports/movers", "See live movers →", false)} ${btn(SITE + "/sports/positive-ev", "Live +EV scanner →")}</p>
<p style="color:#9ca3af;font-size:13px;">Next email: the one feature that pays for itself in a single bet.</p>
`);
    return { subject, html: chrome({ content: body, preheader, unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },

  // ----- D7: First upsell (gentle, Pro positioning) -----
  upsell_d7(ctx) {
    const usageLine = ctx.event_views > 5
      ? `You've viewed <strong>${ctx.event_views}+ markets</strong> this week — you're already past the casual usage line.`
      : `You're still feeling the tool out — totally fine.`;
    const subject = ctx.event_views > 5 ? `Your usage already justifies Pro` : `What you don't see on the free tier`;
    const preheader = "Bigger book list, your home-book lens, alerts, bet log.";
    const body = html(`
<p>${greet(ctx)}</p>
<p>${usageLine}</p>
<p>Free shows you 5 of the 14 sportsbooks we track. Pro at $19/mo opens up everything: every book on every market, your home-book lens (every edge recolored against <em>your</em> sportsbook instead of consensus), the bet log, and excluded-book filtering.</p>
<p>Where Pro pays for itself: a single 2pp edge on a $100 bet gets you most of the way to a month's subscription. The whole point of the tool is finding those edges.</p>
<p>${btn(SITE + "/pricing", "See Pro vs Free →")} ${btn(SITE + "/sports/positive-ev", "Find an edge first", false)}</p>
<p style="color:#9ca3af;font-size:13px;">No FOMO email — just letting you know. You'll get more value walking your usage up first if you'd rather.</p>
`);
    return { subject, html: chrome({ content: body, preheader, unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },

  // ----- D10: Activation push — show what they're missing -----
  activation_d10(ctx) {
    const subject = "The 30-second setup most new users skip";
    const preheader = "Home book + watchlist makes everything else faster.";
    const body = html(`
<p>${greet(ctx)}</p>
<p>One quick thing. Most users set their home book once and the entire site changes how it ranks edges.</p>
<p>Without it: every edge is "vs the 14-book consensus median." Useful, but generic.</p>
<p>With it: every edge becomes "vs <em>your</em> sportsbook's price." That's the number you'd actually bet against, so it's the one that matters.</p>
<p>${btn(SITE + "/settings", "Set your home book →")} ${btn(SITE + "/sports/positive-ev", "Browse first", false)}</p>
<p style="color:#9ca3af;font-size:13px;">Also: if you're not sure which book is your "home" — DraftKings and FanDuel are the most common, BetMGM if you're a Mariner / Mets / Caesars rewards user.</p>
`);
    return { subject, html: chrome({ content: body, preheader, unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },

  // ----- D14: Behavior-aware upsell -----
  upsell_d14(ctx) {
    let lede: string;
    let subject: string;
    if (ctx.pricing_views >= 2) {
      subject = "Still on the fence? Here's the math";
      lede = `<p>I noticed you've looked at the pricing page a couple times. Totally reasonable to wait — let me make the case clean.</p>`;
    } else if (ctx.event_views >= 10) {
      subject = "You've checked 10+ markets — Pro pays for itself on one";
      lede = `<p>You've looked at <strong>${ctx.event_views}+ markets</strong> in the last two weeks. That's not casual usage — that's active line shopping.</p>`;
    } else if (ctx.paywall_hits >= 1) {
      subject = "You hit a paywall last week — here's what's behind it";
      lede = `<p>You ran into a Pro feature recently. Quick context on what it unlocks.</p>`;
    } else {
      subject = "Two weeks in — what's working, what's missing";
      lede = `<p>Two weeks in. Quick check-in on whether the tool is doing what you hoped.</p>`;
    }
    const body = html(`
<p>${greet(ctx)}</p>
${lede}
<p><strong>Pro at $19/mo gets you:</strong></p>
<ul style="padding-left:20px;line-height:1.7;">
<li>Every book on every market (free shows 5 of 14)</li>
<li>Home-book lens — every edge recolored against the book you actually bet at</li>
<li>Excluded-book filter — drop the books you don't have accounts at</li>
<li>Bet log with closing line value (CLV) tracking</li>
<li>Player props and futures depth</li>
</ul>
<p><strong>Elite at $39/mo adds:</strong> email + SMS alerts, sub-minute Kalshi updates, watchlist, custom alert thresholds.</p>
<p>${btn(SITE + "/pricing", "Compare plans →")} ${btn(SITE + "/sports/positive-ev", "One more browse", false)}</p>
<p style="color:#9ca3af;font-size:13px;">If price is a thing, reply to this — I'll send a code. The goal here is users who get real value, not maximum revenue.</p>
`);
    return { subject, html: chrome({ content: body, preheader: "Two weeks in. What's working.", unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },

  // ----- D21: Last in series, social proof + final close -----
  finalupsell_d21(ctx) {
    const subject = "What our paid users actually use SportsBookISH for";
    const preheader = "Three workflows that justify the $19. Pick the one closest to yours.";
    const body = html(`
<p>${greet(ctx)}</p>
<p>Three weeks of data. Here's the honest breakdown of how Pro and Elite users actually spend their time on the platform.</p>
<p><strong>Workflow 1 — Pre-game line shopping (most common).</strong> Open the +EV scanner 60 min before lock. Filter to your sport. Hit "vs Best" sort. Place the best 2-3 bets across your books. Average user logs 4-6 of these a week, 30-45 sec each.</p>
<p><strong>Workflow 2 — Steam chasing.</strong> Open the movers dashboard, watch for ≥3 books moving the same direction within 5 min, follow. Pro users who do this hit ~+1.5pp CLV consistently.</p>
<p><strong>Workflow 3 — Kalshi arbitrage.</strong> Find markets where Kalshi YES is below the sportsbook NO (or vice versa) enough to lock in a positive return regardless of outcome. Rare but real, especially on player props.</p>
<p>${btn(SITE + "/pricing", "Pick a plan →")} ${btn(SITE + "/sports/positive-ev", "Or browse one more time", false)}</p>
<p style="color:#9ca3af;font-size:13px;">After this email I'll stop nudging you — promise. If the free tier keeps doing what you need, that's a great outcome too.</p>
`);
    return { subject, html: chrome({ content: body, preheader, unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },

  // ============================================================
  // Behavior-triggered emails (fire outside the linear cadence)
  // ============================================================

  // Triggered when user hits a paywall (free trying to use Pro feature)
  behavior_paywall_hit(ctx) {
    const subject = "That feature you just hit — here's the 20-second pitch";
    const preheader = "What Pro adds, in one screen.";
    const body = html(`
<p>${greet(ctx)}</p>
<p>You bumped into a Pro-tier feature. Quick pitch:</p>
<p>The feature you hit is gated because it's where most of the platform's actual value lives — alerts, bet tracking with CLV, full book list, home-book lens. Free is enough to see the tool work; Pro is what makes it a habit.</p>
<p>${btn(SITE + "/pricing", "See Pro →")} ${btn(SITE + "/sports/positive-ev", "Keep browsing free", false)}</p>
`);
    return { subject, html: chrome({ content: body, preheader, unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },

  // Triggered when user has visited pricing 2+ times without subscribing
  behavior_pricing_indecision(ctx) {
    const subject = "Pricing page — let me answer the question you're probably stuck on";
    const preheader = "Pro vs Elite, and what's actually different.";
    const body = html(`
<p>${greet(ctx)}</p>
<p>You've come back to pricing a few times. Most likely question: Pro vs Elite, what's the difference?</p>
<p><strong>Pro ($19/mo)</strong> is for users who check the platform once a day, line shop before placing bets, and track CLV. Active use.</p>
<p><strong>Elite ($39/mo)</strong> is for users who want the platform to tap them on the shoulder — email + SMS alerts when Kalshi moves >X%, sub-minute Kalshi updates, custom thresholds per sport. Passive coverage.</p>
<p>If you're checking 1-2x/day already, Pro is the right answer. If you'd rather have the platform watch for you, Elite.</p>
<p>${btn(SITE + "/pricing", "Pick a plan →")}</p>
<p style="color:#9ca3af;font-size:13px;">Stuck on something else? Reply — I'll get you an answer fast.</p>
`);
    return { subject, html: chrome({ content: body, preheader, unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },

  // Triggered after 30 days inactive
  winback_d30(ctx) {
    const subject = "Was it the tool, or just timing?";
    const preheader = "Quick check-in — and a couple updates since you signed up.";
    const body = html(`
<p>${greet(ctx)}</p>
<p>It's been a while. Wanted to check in honestly — either the tool didn't click, or life got in the way. Both fair.</p>
<p>Since you signed up, a few things changed that might matter:</p>
<ul style="padding-left:20px;line-height:1.7;">
<li><strong>+EV scanner</strong> — one page, every +EV opportunity across every league, ranked. <a href="${SITE}/sports/positive-ev" style="color:#10b981;">Take a look</a>.</li>
<li><strong>${ctx.active_leagues} active leagues</strong> right now with live odds compared against Kalshi.</li>
<li><strong>${ctx.active_alerts_count}+ alerts</strong> fired today across the platform.</li>
</ul>
<p>${btn(SITE + "/sports/positive-ev", "Quick look →")} ${btn(SITE + "/unsubscribe/" + ctx.unsub_token, "Or unsubscribe", false)}</p>
<p style="color:#9ca3af;font-size:13px;">If you don't open this one, I'll stop emailing entirely. Thanks for the consideration.</p>
`);
    return { subject, html: chrome({ content: body, preheader, unsubToken: ctx.unsub_token }), text: textFromHtml(body) };
  },
};
