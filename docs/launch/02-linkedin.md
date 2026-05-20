# LinkedIn post

LinkedIn's algorithm weights long-form, no-link-in-body posts. Paste this into a new post on your **personal** profile (more reach than a company page). Drop the link in the first comment, not the post body.

---

Six months ago I noticed something weird: sharp sports bettors I respected were quietly trading Kalshi alongside their sportsbooks, and almost nobody was talking about it.

Kalshi is a CFTC-regulated event-contract exchange — meaning prices are set by traders, not by a sportsbook setting a line and baking in 4-8% vig. When Kalshi trades a team at 42¢ and the no-vig book consensus implies 47%, that's a real 5-point pricing edge for the same outcome.

The problem: nobody had built the tool to surface this in real time across every sport, every market, every book. Line-shopping software exists for sportsbook-vs-sportsbook. Nothing did sportsbook-vs-Kalshi at the depth the data deserved.

So I built it.

→ SportsBookISH (https://sportsbookish.com) launched this week. It compares Kalshi event-contract pricing against the no-vig consensus from DraftKings, FanDuel, BetMGM, Caesars, and 8+ more US sportsbooks. Refreshed every 5 minutes. NFL, NBA, MLB, NHL, EPL, MLS, UCL, World Cup, PGA Tour.

→ For developers + researchers, the public API has an OpenAPI 3.1 spec, free demo key (no signup needed), and a $50/mo personal tier for commercial use. Cheaper and more comprehensive than the-odds-api.com — and the only public API that includes Kalshi pricing data.

→ For AI training pipelines + academic researchers, daily CSV snapshots are published CC-BY-4.0 on Hugging Face at kennyhyder/sportsbookish-daily-odds. Kalshi opening up event contracts is one of the biggest structural changes in US betting this decade and nobody had a clean academic dataset to study it.

The product is free for game-line comparisons across all sports. Pro is $10/month for full market depth, $100/year (Elite) for SMS alerts + smart presets + sub-minute Kalshi WebSocket updates.

If you've been line-shopping books and ignoring Kalshi, you're leaving sharp edges on the table. The data is finally in one place. Link in comments.

---

(In the first comment, paste: "https://sportsbookish.com — feedback welcome. DMs open if you want a free Pro/Elite code in exchange for an honest review of where the dashboard could be sharper.")
