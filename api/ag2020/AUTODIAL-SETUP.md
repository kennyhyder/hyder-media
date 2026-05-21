# AG2020 Autodial (speed-to-lead) — setup & runbook

Outbound auto-callback for AG2020 leads. When a lead arrives, Twilio places a
call **to the customer**; when the customer answers they hear a short hold
message and are **bridged to AG2020's inbound rep line**.

**Phase 1 (this build): form submissions.** A web-form submit → ActiveCampaign
automation → webhook → autodial.
**Phase 2 (pending CallRail): missed calls.** Same engine, fed by a CallRail
"call completed / abandoned" webhook → `POST /api/ag2020/autodial` with
`source=missed_call`. No code change needed beyond pointing CallRail at it.

> Voice calling does **not** require Twilio A2P 10DLC — the autodialer is
> unaffected by the SMS brand-registration issue and can go live now.

## Files

| File | Role |
|---|---|
| `_autodial-lib.js` | Shared helpers: phone, HMAC token, AZ business hours, `placeCall()` |
| `autodial.js` | `POST` trigger (form/CallRail/manual) · `GET` list attempts |
| `autodial-twiml.js` | TwiML Twilio fetches when the customer answers → bridge; `leg=whisper` plays to the rep |
| `autodial-status.js` | Twilio StatusCallbacks + `<Dial>` action callback → updates the row |
| `autodial-cron.js` | Every 15 min — dials attempts deferred from outside business hours |
| `schema.sql` | `ag2020_autodial_attempts` table (appended) |

## 1. Database

Run the new table in `schema.sql` against the Supabase **transaction pooler**
(region **us-west-2**):

```
psql "postgresql://postgres.ilbovwnhrowvxjdkvrln:[PASSWORD]@aws-0-us-west-2.pooler.supabase.com:6543/postgres" -f api/ag2020/schema.sql
```

(`CREATE TABLE IF NOT EXISTS` — safe to re-run; only `ag2020_autodial_attempts`
and its indexes are new.)

## 2. Vercel environment variables

| Var | Required | Notes |
|---|---|---|
| `AG2020_REP_INBOUND_NUMBER` | **Yes** | E.164 sales line to bridge customers to, e.g. `+1480XXXXXXX` |
| `AG2020_AUTODIAL_FROM_NUMBER` | Recommended | Number the customer sees. **Buy a local Arizona Twilio number.** Falls back to `AG2020_TWILIO_FROM_NUMBER` (a Hawaii `+1808…` number — bad answer rates). |
| `AG2020_AUTODIAL_SECRET` | Recommended | Shared secret for the trigger webhook. Falls back to `AG2020_MISSED_CALL_WEBHOOK_SECRET`. |
| `AG2020_PUBLIC_BASE_URL` | No | Defaults to `https://hyder.me`. |
| `AG2020_TWILIO_ACCOUNT_SID` / `AG2020_TWILIO_AUTH_TOKEN` | **Yes** | Already set (used by the SMS auto-reply). |
| `CRON_SECRET` | Yes | Already set. Authorizes the deferred-dial cron. |

Set values with `printf %s` (not `echo`) to avoid trailing-newline corruption.

## 3. ActiveCampaign automation (form-submit trigger)

1. **Automations → New automation.**
2. Trigger: **"Submits a form"** → select the website quote/contact form.
3. Add action: **Webhook** (under CRM / Conditions & Workflow).
4. URL: `https://hyder.me/api/ag2020/autodial?secret=<AG2020_AUTODIAL_SECRET>`
5. Save & set the automation **Active**.

The webhook posts `contact[phone]`, `contact[first_name]`, `contact[last_name]`,
`contact[id]` — the endpoint reads those automatically.

⚠️ **The form must map the phone number to the contact's standard Phone field.**
If phone lands in a custom field, `contact[phone]` is empty and nothing dials.

## 4. Behavior

- **Business hours:** Mon–Sat 7am–6pm Arizona time (UTC-7, no DST). In hours →
  dials immediately. Out of hours → saved `deferred`; the cron dials it at the
  next 7am open.
- **De-dupe:** the same number triggered within 6h is skipped (`skipped_duplicate`).
- **Answering machine:** if voicemail picks up, the call hangs up — no rep is
  bridged to a recording (`status = machine`).
- **No rep answers:** customer hears "we'll call you right back"
  (`status = rep_no_answer`).
- **Connected:** `status = completed`, `bridge_duration` = seconds connected.

## 5. Test

```bash
# In business hours — dials your own cell, then bridges to the rep line:
curl -X POST "https://hyder.me/api/ag2020/autodial?secret=<SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+1YOURCELL","name":"Test Lead","source":"manual"}'

# List recent attempts:
curl "https://hyder.me/api/ag2020/autodial?secret=<SECRET>&limit=10"
```

Submit the live website form once and confirm a row appears with
`source = form_submit`.

## 6. Outcome statuses (`ag2020_autodial_attempts.status`)

`deferred` · `dialing` · `customer_answered` · `machine` · `bridged` ·
`completed` · `no_answer` · `rep_no_answer` · `failed` · `skipped_duplicate`

## Notes / caveats

- **TCPA:** in scope here — these are inbound callers / form submitters who
  asked to be contacted. Do not reuse this list for cold outreach.
- **Customer-first bridge** (per spec): the customer is dialed first, then the
  rep. If reps are frequently unavailable, consider switching to rep-first
  (dial the inbound line first, bridge the customer only once a rep answers) —
  it's a small change in `autodial-twiml.js` + `placeCall()`.
- **Caller ID to the rep** is the Twilio `From` number; rep context is conveyed
  by the whisper ("New Auto Glass 2020 web lead"). Twilio can't spoof the
  customer's number as caller ID on a call we originated.
