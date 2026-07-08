# Reusable Patterns Library

Patterns and gotchas worth pulling into any new project in this monorepo. Cross-references to the relevant source files + memory notes. (Moved from root CLAUDE.md 2026-07; root file keeps only a pointer.)

## Cross-pipeline shared libs: `/api/_platform/` (added 2026-06-03)
- `odds.js` — americanToDecimal, decimalToImplied, americanToProb, devigProbs, devigToSum, devigOutcomes
- `constants.js` — STALE_THRESHOLD_MS (30 min), isStaleQuote()
- `names.js` — normalizeName (ASCII default — DB-keying convention), normalizeNameUnicode (NFD-stripped, for matching external sources like Polymarket)
- **Rule:** Before copy-pasting odds math / constants / normalization between sports/ and golfodds/, add it here. Sports + golf had drifted into 3 independent copies of americanToDecimal and 5 of normalizeName before extraction. See `memory/api-platform-shared-libs.md`.

## Vercel serverless + ESM
- **Vercel auto-compiles `api/**/*.js` ESM → CJS** when `package.json` lacks `"type": "module"` (deploy log shows: `Compiling "X.js" from ESM to CommonJS`). Constructs that don't survive: `import.meta.url`, top-level `await`, dynamic ESM-only imports.
  - Symptom: `FUNCTION_INVOCATION_FAILED` with no JSON body. Vercel `logs` won't show the underlying error.
  - Fix: avoid `import.meta.url`; either embed file contents inline or hardcode paths. See `api/data/sync-huggingface.js` for a worked example (README upload removed after this bit us in May 2026).
- **All `api/**/*.js` should be self-contained for serverless cold start.** Don't import from `../lib/` outside `api/`.
- **CRON_SECRET pattern**: every cron handler accepts `Authorization: Bearer ${CRON_SECRET}`. Test locally with `curl -H "Authorization: Bearer $(grep ^CRON_SECRET= .env.local | cut -d= -f2)" https://hyder.me/api/...`.

## Supabase + Postgres performance
- **Pooler ports matter for index ops.** Port `6543` (transaction mode) wraps everything in a transaction, so `CREATE INDEX CONCURRENTLY` fails with "cannot run inside a transaction block". Use port `5432` (session mode) for DDL. Region = `us-west-2`, not us-west-1.
- **High-volume tables: avoid `count('exact')`.** Past ~1M rows the count query times out (>10s) under serverless 10s limit, returns null, coalesces to 0, fires false alerts. Switch to latest-row recency check: `select fetched_at order by fetched_at desc limit 1` (O(1) with a `fetched_at DESC` index). See `api/seo/cron-health-check.js` for pattern.
- **Add a `fetched_at DESC` index on any quote/log table** that grows by >100k rows/day. Without it, even "find latest row" is a seq scan.
- **Service-role key naming**: in `api/*.js` serverless functions use `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. The `NEXT_PUBLIC_*` prefix is only for client-side Next.js bundles — won't be available server-side in API routes.

## Stripe gotchas
- **`echo` adds trailing newlines** when piped to `vercel env add`. The `\n` ends up baked into `STRIPE_SECRET_KEY`, the SDK puts it into the Authorization header, request never reaches Stripe, error reads as "connection error, retried 2 times" (sounds network — is local). Always `.trim()` defensively when reading Stripe env vars; use `printf %s` not `echo` to set them. Documented in [[stripe-env-trailing-newline]].
- **Customer Portal CSP**: `form-action` must include `https://billing.stripe.com`. Browsers check `form-action` against the final redirect destination, not just the immediate POST target.
- **Stripe v22 moved subscription period dates** to `subscription.items[0]` (was on `subscription` directly). Webhook handlers need `periodOf(sub)` helpers.
- **Webhook race with checkout success URL**: pass tier as a URL param to `success_url` rather than waiting for the webhook to update DB, so `purchase` GA4 events have correct value instantly.

## SEO + freshness ("quality deserves freshness")
- Reusable `<LastUpdated iso={...} variant="header|inline|footer" />` component lives in `sportsbookish/components/LastUpdated.tsx`. Renders `<time datetime="...">` + relative time ("3 min ago"). Helper `datasetFreshnessLd()` emits `Dataset` JSON-LD with `dateModified`.
- Apply across all page surfaces that change (event detail, league hub, player profile, team profile, leaderboards, movers, etc). For tournament/event lists: sort `next event first chronologically` (open events ASC, closed DESC).
- Pages with `export const dynamic = "force-dynamic"` can honestly use render time as the freshness signal — Vercel cron + dynamic rendering means "now" is genuinely fresh.

## GA4 conversion events
- **Don't trust `window.gtag` from useEffect** — it's race-y with `@next/third-parties/google`. Push to `window.dataLayer` directly:
  ```js
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "purchase", value: 19, currency: "USD" });
  ```
- For SaaS funnels track: `sign_up` (post-magic-link), `begin_checkout` (Stripe checkout creation), `purchase` (success_url landing with tier param).

## AI / LLM discoverability
- Standard package per site: `llms.txt`, `JSON-LD WebApplication`, `JSON-LD Dataset` with `dateModified`, `OpenAPI spec` at `/api/openapi.json`, `Hugging Face dataset mirror` (cron pushes daily CSV — see `api/data/sync-huggingface.js`), IndexNow ping on publish, Wikidata entity with P-claims.
- HF push via `@huggingface/hub` `uploadFiles({ repo: { type: "dataset", name: "..." }, accessToken: process.env.HF_TOKEN, files: [...] })`. Don't bundle README in the cron — push schema docs manually.
- Wikidata entity edits via MediaWiki API (`wbeditentity`, `wbcreateclaim`) with bot password. New accounts can't create new batches in QuickStatements — use direct API or run via Firefox (third-party cookie issue in Chrome).

## Sportsbook futures data vendor gap
- The Odds API ($30/mo) only exposes ~14 futures `sport_key`s (championship/winner). MVP, win-totals, awards, division winners are NOT in the feed at any tier. Books DO publish these prices on their own sites; **don't claim books "don't publish"** in user copy.
- `NoBooksDataNote` component pattern (in `sportsbookish/components/sports/`): for missing market types, render a tier-aware CTA — non-Elite → `/pricing` upsell, Elite → `mailto:` to capture demand signals. See [[sportsbookish-futures-data-vendor]].

## Health-check pattern (any project)
- Daily cron pings: sitemap reachability + URL count, HF dataset `lastModified` age, latest-quote recency per table, slug coverage %.
- Use Resend `alerts@<domain>` for email when checks fail. Only alert when something is meaningfully broken — false alarms erode trust.
- See `api/seo/cron-health-check.js` for the full pattern.

## Pre-deploy verification (full checklist)
Short version lives in root CLAUDE.md; sportsbookish has this baked into its own CLAUDE.md. Before pushing changes that touch UI / routes / nav / data layer, run:

```bash
# 1. TypeScript
npx tsc --noEmit

# 2. Build
npm run build

# 3. Security headers (post-deploy, against live URL)
curl -sI https://sportsbookish.com | grep -iE "^(strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy):"

# 4. W3C validation (post-deploy)
curl -s https://sportsbookish.com | curl -s --data-binary @- -H "Content-Type: text/html" "https://validator.w3.org/nu/?out=json" | python3 -c "import sys,json;r=json.load(sys.stdin);print(f'errors: {len([m for m in r[\"messages\"] if m[\"type\"]==\"error\"])}, warnings: {len([m for m in r[\"messages\"] if m.get(\"subType\")==\"warning\"])}')"

# 5. WAVE accessibility (manual: load page in https://wave.webaim.org/extension/ or use https://wave.webaim.org/api/request)

# 6. Smoke-test core flows in incognito + signed-in:
#    - / (homepage)
#    - /sports/mlb (or any in-season league)
#    - /sports/mlb/event/<id> (any active game)
#    - /alerts (Pro+ only)
#    - /bets (Elite only)
#    - /admin (admin only)
#    - Pricing checkout (don't actually pay — load /pricing and click Subscribe)
```

Targets:
- Security headers: 100/100 (HSTS preload, full CSP, COOP/CORP, Permissions-Policy)
- W3C: 0 errors, 0 warnings (info-only "trailing slash on void element" notes are OK)
- WAVE: 0 errors, ≤2 alerts max
- Build: clean compile, no new console errors in dev
- Smoke tests: no broken routes, no missing data on event pages with active markets

Any regressions on these → revert or patch BEFORE merging.

## Speed-to-lead autodialer (outbound auto-callback + bridge)
- **What:** Trigger fires → Twilio calls the **customer** → on answer, bridges them to a sales rep line. Source-agnostic engine — same code handles CRM form-submit webhooks, missed-call webhooks, manual triggers. Reference implementation: `clients/ag2020/CLAUDE.md` + `/api/ag2020/_autodial-lib.js` + 4 sibling `autodial-*.js`. Live since 2026-05-22 for forms + voicemail-leaver missed calls.
- **File pattern (per client, ~600 LOC total) in `/api/<client>/`:**
  - `_autodial-lib.js` — shared: phone normalize, HMAC callback tokens, business-hours math, `placeCall()`. Underscore-prefixed so Vercel doesn't route it.
  - `autodial.js` — `POST` trigger receiver + `GET` recent attempts. Source-aware gating, 6h dedupe, business-hours deferral, row insert, calls lib `placeCall`.
  - `autodial-twiml.js` — TwiML returned to Twilio on customer answer. AMD voicemail guard; on human → hold message + `<Dial>` bridge with rep whisper TwiML.
  - `autodial-status.js` — Twilio StatusCallback (customer leg) + `<Dial>` action callback (bridge leg). Updates the attempt row.
  - `autodial-cron.js` — Vercel `*/15` cron that drains `deferred` (off-hours) attempts when the business reopens.
- **Table `<client>_autodial_attempts`** — one row per attempt with full `trigger_payload` JSONB for audit. Status state machine: `deferred → dialing → (customer_answered | machine | no_answer | failed) → (bridged →) completed | rep_no_answer`, plus `skipped_duplicate` and `skipped_form`. Indexes: `(created_at DESC)`, `(customer_number, created_at DESC)`, partial `(dial_after) WHERE status='deferred'`.
- **ActiveCampaign trigger gotchas (the AG2020 build hit all of these):**
  - `subscribe` is **not** a reliable form-submit trigger — only fires when the form subscribes contacts to a list. Many integrations don't.
  - `contact_add` is **NOT** a valid AC event name — `GET /api/3/webhook/events` returns the canonical list (~42 events). Don't trust intuition; check.
  - The reliable form-submit signal is usually a unifying "new lead" tag + `contact_tag_added` event, filtered by tag id/name. AG2020's tag is `NEW LEAD ALERT` (id 2487).
  - **AC API cannot create automations** (UI-only), but it CAN create account-level webhooks (`POST /api/3/webhooks` with `events`, `sources`, `url`).
  - AC webhook payloads have varied shapes — handle scalar `tag` vs `tag[id]`/`tag[name]` vs nested `tag.id`/`tag.name`. Defensive extraction.
- **Fail-closed gating** on CRM webhooks: log the full payload to a `skipped_*` row and do NOT dial when the trigger can't be tied to an allowlist entry. Otherwise the first novel payload shape silently autodials everyone in the CRM.
- **Dedupe gotcha (production-breaking if missed):** dedupe must exclude `failed`, `skipped_duplicate`, AND `skipped_form` (every `skipped_*` status). A skipped row is not a dial. A non-trigger tag webhook lands as `skipped_form` and would otherwise block the real trigger tag webhook that fires moments later. See AG2020 commit `97999f2f`.
- **Twilio call/bridge pattern:**
  - `MachineDetection=Enable` + check `AnsweredBy` in the TwiML — never bridge a rep to a voicemail recording.
  - `answerOnBridge="true"` on `<Dial>` so the customer hears ringback during rep ring, not dead air.
  - **Customer-facing From vs bridge `<Dial callerId>` MUST be different numbers.** Dialing the rep line showing the rep line's own number as caller ID (From == To) is pathological. Use an owned Twilio number for the bridge caller ID.
  - HMAC token on Twilio callback URLs (TwiML + StatusCallback) so they can't be replayed/forged externally.
- **"Callback from the number they dialed":** requires that number to be Twilio-usable — either owned in the account, or **verified as an outgoing caller ID** via `POST /Accounts/{SID}/OutgoingCallerIds.json` (Twilio places a verification call with a 6-digit `validation_code`; someone at the number enters it). Verified caller IDs get lower STIR/SHAKEN attestation than owned numbers (more spam-flag risk) — accept the tradeoff for recognition and pair with branded calling.
- **Branded calling:** Twilio's own Branded Calling **requires owned Twilio numbers** (verified caller IDs aren't eligible) and currently covers only T-Mobile + Verizon (US Public Beta, no AT&T). For verified-caller-ID setups, use **First Orion INFORM** — works with the existing number wherever it's hosted, all 4 major US carriers + iPhone+Android, free business-number registration tier (paid plans from $31/mo at 250 calls for logo + call reason).
- **Per-client env vars:** dedicated Twilio account creds (`*_AUTODIAL_TWILIO_ACCOUNT_SID/AUTH_TOKEN` — don't co-mingle with other clients' Twilio accounts); `*_AUTODIAL_FROM_NUMBER` (customer-facing); `*_AUTODIAL_BRIDGE_CALLER_ID` (owned, distinct); `*_REP_INBOUND_NUMBER`; trigger allowlist (`*_AUTODIAL_TAGS` for AC tag triggering); webhook `*_AUTODIAL_SECRET`. Use `printf %s` (not `echo`) when adding any of these via `vercel env add` — see Stripe gotcha above for why.
- **Business hours:** Mon–Sat 7am–6pm local (Arizona = fixed UTC-7, no DST math). Off-hours triggers insert `status=deferred` with `dial_after = nextBusinessOpen()`; the `*/15` cron picks them up at open.
- **Trigger sources (live at AG2020):** (1) form submits via AC `contact_tag_added` webhook → autodial; (2) missed calls via existing `call-event-webhook.js` (voicemail-to-email pipeline) → autodial; (3) Phase 2 = CallRail webhook for pure-hangup missed calls → autodial (no code change needed, engine is source-agnostic).
