# Auto Glass 2020 — Connecting the website to the lead autodialer
**Handoff instructions for Rick**

## What this does

When someone submits a form on **autoglass2020.com**, the system automatically
calls that customer back within seconds and connects them live to a sales rep.
Speed-to-lead: the faster a web lead gets a call, the more jobs close.

## The key point: you probably don't need to touch the website

The autodialer is triggered by **ActiveCampaign**, not by the website directly.
Auto Glass 2020's web leads already flow into ActiveCampaign (that's the CRM).
So the "deployment" is mostly **one automation inside ActiveCampaign** — the
website keeps doing exactly what it does now.

```
autoglass2020.com form
      │  (lead is created in ActiveCampaign — already happens today)
      ▼
ActiveCampaign  ──►  Automation: "Submits a form"
                          │  Webhook action
                          ▼
              hyder.me/api/ag2020/autodial
                          │
                          ▼
        Twilio calls the customer ──► bridges them to the AG2020 sales line
```

The hyder.me dashboard is **not** part of this flow. The website does **not**
need to be connected to the dashboard.

---

## Step 1 — Confirm form submissions reach ActiveCampaign

1. Log into ActiveCampaign (`autoglass2020.api-us1.com`).
2. Submit a test on the live autoglass2020.com quote/contact form.
3. In AC → **Contacts**, find the test contact (appears within ~1 min).
4. **Critical:** the phone number must be in the contact's standard **Phone**
   field — not only a custom field.

- Phone is there → website is done. Go to **Step 3**.
- Contact missing, or phone missing → **Step 2**.

## Step 2 — Connect the forms to ActiveCampaign (only if Step 1 failed)

Pick whichever fits the site:

- **(a) Use an ActiveCampaign form** — build a form in AC, embed its code on
  the page. Feeds AC natively, captures phone. Simplest.
- **(b) Keep the existing form + AC site tracking** — use AC's form-tracking to
  capture the existing HTML form's submissions.
- **(c) Custom/backend forms** — have the website's form handler call the AC
  API (`POST /api/3/contact/sync`) on submit, creating the contact with phone.

Requirement either way: **every lead becomes an AC contact with the phone
number in the Phone field.**

> ⚠️ **Do NOT wire the website form to call the autodialer endpoint from
> browser JavaScript.** That would expose a secret key in the page source and
> let anyone trigger phone calls. Routing through ActiveCampaign keeps the key
> server-side. If you must integrate without AC, only the website's **backend**
> may POST to the endpoint — ask Kenny for the secret, never put it in
> front-end code.

## Step 3 — Build the ActiveCampaign automation (this is the real "deploy")

Done entirely inside ActiveCampaign — no website code. (If you don't have AC
admin access, Kenny / the AC admin does this part.)

1. **Automations → New Automation → Start from scratch.**
2. **Trigger:** "Submits a form" → select the quote/contact form.
   - Set it so a contact **can enter multiple times** (a returning lead with a
     new inquiry should re-trigger; the endpoint has its own 6-hour de-dupe).
3. **Add action: Webhook** (CRM category).
4. **URL:** `https://hyder.me/api/ag2020/autodial?secret=SECRET`
   — Kenny will give you the actual `SECRET` value.
5. **Save** and set the automation to **Active**.

## Step 4 — Test end to end

Before testing, confirm with Kenny that the sales-line number is configured
(`AG2020_REP_INBOUND_NUMBER`).

1. During business hours (**Mon–Sat, 7am–6pm Arizona time**), submit the live
   form using your own cell number.
2. Your phone rings within ~10–20 seconds.
3. Answer → you hear *"please hold while we connect you with a glass
   specialist."*
4. It rings the AG2020 sales line; a rep picks up and you're connected.

Leads that arrive outside business hours are queued and dialed automatically
at 7am the next business day.

---

## What Rick needs from Kenny

- The **webhook secret** value for the Step 3 automation URL.
- Confirmation that the **rep sales-line number** and Twilio settings are set
  on the hyder.me side.

## Notes

- Everything runs on the **Auto Glass 2020 Twilio account** already in place.
- Missed phone calls (not just web forms) will be added in a later phase via
  CallRail — same engine, no website change.
