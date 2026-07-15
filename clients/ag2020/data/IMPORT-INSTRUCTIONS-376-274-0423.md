# Duplicate Auto Glass 2020 → account 376-274-0423

**Source account:** 505-336-5860
**Target account:** 376-274-0423
**Import file:** `Auto Glass 2020 - IMPORT to 376-274-0423 - 2026-05-20.csv`
**Generated:** 2026-05-20 from `Auto Glass 2020-1++18_Campaigns+163_Ad groups+2_Asset groups+2026-05-20.csv`

## What's in the import file

18 campaigns, 163 ad groups, 2 PMax asset groups, 236 ads, ~2,600 keywords,
campaign negatives, location targeting (308 locations), ad schedules, audience
segments, sitelink/callout/structured-snippet/call extensions, and labels — all
copied 1:1 from 505-336-5860.

Two changes were made vs. the raw export so it imports cleanly into a new account:

1. **`ID` column blanked** — the export carries source-account entity IDs.
   Clearing them forces Google Ads Editor to create every entity fresh in the
   target account instead of trying to match IDs that don't exist there.
2. **65 "Automatically created" asset rows dropped** — these are Google-generated
   assets. They should not be re-imported as advertiser assets; Google will
   regenerate its own in the new account.

## How to import

1. Open **Google Ads Editor** and add / open account **376-274-0423**.
2. `Account` menu → **Import** → **From file…** → select
   `Auto Glass 2020 - IMPORT to 376-274-0423 - 2026-05-20.csv`.
3. Review the import preview. Editor will flag the items in "Won't transfer"
   below as errors/warnings — that is expected; let the rest import.
4. **Before "Post changes": select all campaigns → set status to Paused.**
   The export keeps original statuses, and one campaign ("Nonbrand - Auto
   Glass 2020 - HM") is Enabled. A brand-new account has no conversion tracking
   yet, so don't let anything spend until you've completed the manual steps.
5. `Post changes` to push to the account.

## Won't transfer via CSV — do these manually in the Google Ads web UI

A CSV import cannot carry account-level config or binary media. Set these up in
**376-274-0423** for a true 1:1 duplicate:

- **Conversion tracking** — Conversion actions are account-level and are NOT in
  the Editor file. Recreate them under `Goals → Conversions` (calls, form leads,
  GA4 imports, etc.), or link the same Google tag / GA4 property. Campaigns are
  set to "Account-level" standard conversion goals, so they'll pick these up
  once they exist. The call extensions reference "Use account settings" — they
  also depend on account-level call conversion config.
- **Image assets & image ads** — image binaries can't travel in a CSV. The
  ~25 advertiser image assets, the 20 Image ads, and PMax image assets will
  error on import. Re-upload the images to the new account's asset library and
  rebuild those ads / PMax asset group images.
- **Performance Max asset groups (2)** — text/structured fields import, but
  PMax in Editor is partial. Open each PMax campaign in the web UI and confirm
  images, logos, videos, audience signals, and final URLs.
- **Account settings** — auto-tagging, business info, billing, ad scheduling
  timezone, and currency are not set by the import. Enable auto-tagging and
  confirm billing before turning campaigns on.
- **Audience lists / remarketing** — the Display remarketing campaign and any
  data-segment audiences depend on audience lists that live in the source
  account. New accounts start with empty lists; re-create remarketing tags or
  share lists via the MCC.
- **Negative keyword lists / shared budgets** — campaign negatives are inline
  in the file and will import. There were no shared (portfolio) bid strategies
  or shared budgets to recreate.

## Before you turn it on

- [ ] Conversion actions created and verified (test a conversion)
- [ ] Billing set up on 376-274-0423
- [ ] Auto-tagging enabled
- [ ] Images re-uploaded; image ads + PMax asset groups rebuilt
- [ ] Final URLs spot-checked (still point to autoglass2020.com)
- [ ] Budgets/bids reviewed (campaigns copied real budgets — e.g. PMax at
      $120/day and $260/day)
- [ ] Start dates: campaigns carry 2024 start dates; that's fine (Google treats
      a past start date as "start now"), but review End Date fields
- [ ] Enable campaigns deliberately, a few at a time
