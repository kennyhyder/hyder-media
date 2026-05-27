# AG2020 ActiveCampaign Tag Inventory

**Generated:** 2026-05-27
**Source:** `GET https://autoglass2020.api-us1.com/api/3/tags`
**Total tags:** 252

Phase 0 artifact for the Lead-Attribution Platform plan. The tag classification below is heuristic (regex-based on tag name) — use as a starting point for the per-tenant source_map config in `tenant_config.source_map`. Review and adjust before Phase 1.

## Manual addendum — actionable source-map (post-enumeration review)

The heuristic classifier missed several source tags and the entire Meta convention. Real picture as of 2026-05-27:

**Active Google-paid source tags (applied to every new Google-traffic lead):**
- `2449` `NEW Google ad`
- `2467` `NEW LEAD FORM (G.Ads)`
- `2471` `NewGoogle-CNTCT` (Google → contact page)
- `2472` `NewGoogle-LP` (Google → landing page, e.g. `/windshieldreplacement-3`)
- `2473` `NewGoogle-HP` (Google → homepage form)
- `2474` `NewGoogle-SRV` (Google → service page)

**Meta-paid leads are NOT tag-based.** The "Managing META Leads in AC" Scribe shows Meta leads land via AC's **native Facebook Business integration** with the **"FB Facebook Business" native source field** on the contact — not a tag. Phase 1's adapter must read AC's contact-level source/integration field for Meta attribution, not search for a tag. Legacy/inactive tags `facebook` (9), `NIKKI FB` (12), `NIKKI GOOGLE AD` (11) pre-date the native integration and shouldn't be relied on.

**Active organic / referral tags:**
- `2450` `Organic Landing page`
- `2484` `Referral Program Introduced`
- `19` `Organic` (legacy — verify before relying)

**Workflow / operational (NOT source classifiers — exclude from source map):**
- `2487` `NEW LEAD ALERT` — universal new-lead flag and the autodial trigger (`AG2020_AUTODIAL_TAGS`)
- `2488` `Missed Call - Vonage` — missed-call attribution
- `2470` `REBATE PAID`
- `2482` / `2483` / `2485` Review request / thank-you / reminder

**Operational noise (don't include anywhere):** dozens of `resurfaced leads <date>` (ids 20–43+), `text upload <date>`, `leads inbox duct tape`. List-management for re-engagement, not source attribution.

### Proposed starting `tenant_config.source_map` for AG2020

```js
{
  "ag2020": {
    "tag_to_source": {
      "2449": { "source": "google_paid", "channel": "general" },
      "2467": { "source": "google_paid", "channel": "lead_form" },
      "2471": { "source": "google_paid", "channel": "contact_page" },
      "2472": { "source": "google_paid", "channel": "landing_page" },
      "2473": { "source": "google_paid", "channel": "homepage_form" },
      "2474": { "source": "google_paid", "channel": "service_page" },
      "2450": { "source": "organic",     "channel": "landing_page" },
      "2484": { "source": "referral",    "channel": "referral_program" }
    },
    "native_source_map": {
      // AC native contact.referrer / contact.source values (from FB integration etc.)
      "Facebook Business": { "source": "meta_paid", "channel": "lead_form" }
    },
    "trigger_tags":      ["NEW LEAD ALERT", "2487"],
    "missed_call_tags":  ["Missed Call - Vonage", "2488"]
  }
}
```

## Classification summary

| Bucket | Count |
|---|---|
| `source:google_paid` | 5 |
| `source:meta_paid` | 1 |
| `source:organic` | 2 |
| `source:referral` | 1 |
| `source:direct_mail` | 1 |
| `source:call_inbound` | 1 |
| `source:other_new_lead` | 2 |
| `workflow:customer_state` | 1 |
| `workflow:product_attr` | 7 |
| `noise:test_or_old` | 4 |
| `unclassified` | 227 |

## Tags by bucket

Each table sorted by id. Bucket meaning:
- `source:*` — candidate lead-source classifier (becomes a `first_touch_source` mapping in the engine).
- `workflow:*` — operational state (autodial triggers, DNC flags, customer/quote state markers).
- `noise:*` — test/old/superseded tags; exclude from source map and consider archiving.
- `unclassified` — needs manual review.

### source:google_paid (5)

| ID | Tag | Description |
|---|---|---|
| 2449 | `NEW Google ad` |  |
| 2471 | `NewGoogle-CNTCT` |  |
| 2472 | `NewGoogle-LP` |  |
| 2473 | `NewGoogle-HP` |  |
| 2474 | `NewGoogle-SRV` |  |

### source:meta_paid (1)

| ID | Tag | Description |
|---|---|---|
| 9 | `facebook` |  |

### source:organic (2)

| ID | Tag | Description |
|---|---|---|
| 19 | `Organic` |  |
| 2450 | `Organic Landing page` |  |

### source:referral (1)

| ID | Tag | Description |
|---|---|---|
| 2484 | `Referral Program Introduced` |  |

### source:direct_mail (1)

| ID | Tag | Description |
|---|---|---|
| 2395 | `nikki direct mail` |  |

### source:call_inbound (1)

| ID | Tag | Description |
|---|---|---|
| 2488 | `Missed Call - Vonage` | Auto-applied to contacts created from Vonage missed calls (via webhook or CSV) |

### source:other_new_lead (2)

| ID | Tag | Description |
|---|---|---|
| 2467 | `NEW LEAD FORM (G.Ads)` |  |
| 2487 | `NEW LEAD ALERT` |  |

### workflow:customer_state (1)

| ID | Tag | Description |
|---|---|---|
| 2476 | `GB-JFM2025(previous customers)` |  |

### workflow:product_attr (7)

| ID | Tag | Description |
|---|---|---|
| 2459 | `PHX auto glass tint` |  |
| 2468 | `REBATE` |  |
| 2469 | `REBATE PRIORITY` |  |
| 2470 | `REBATE PAID` |  |
| 2482 | `Review Request Sent` |  |
| 2483 | `Review Thank You Sent` |  |
| 2485 | `Review Reminder Sent` |  |

### noise:test_or_old (4)

| ID | Tag | Description |
|---|---|---|
| 3 | `Sold Resurfaced 11-4-21` |  |
| 23 | `Sold` |  |
| 2458 | `PHX auto glass test` |  |
| 2475 | `RickTest` |  |

### unclassified (227)

| ID | Tag | Description |
|---|---|---|
| 4 | `resurfaced` |  |
| 11 | `NIKKI GOOGLE AD` |  |
| 12 | `NIKKI FB` |  |
| 17 | `PHX auto glass` |  |
| 18 | `oranic` |  |
| 20 | `Resurfaced Leads Dec 3 2021` |  |
| 21 | `Resurfaced Leads Dec 5 2021` |  |
| 22 | `phx auto glass incoming` |  |
| 25 | `leads inbox duct tape` |  |
| 31 | `text upload 12102021` |  |
| 32 | `text12202021` |  |
| 33 | `text upload 12102021B` |  |
| 35 | `TEXT BLAST` |  |
| 36 | `resurfaced leads Dec 20 2021` |  |
| 37 | `resurfaced leads Dec 29 2021` |  |
| 38 | `resurfaced leads Jan 1 2022` |  |
| 39 | `resurfaced leads Jan 5 2022` |  |
| 40 | `resurfaced leads Jan 10 2022` |  |
| 41 | `resurfaced leads Jan 12 2022` |  |
| 42 | `resurfaced leads Jan 18 2022` |  |
| 43 | `resurfaced leads Jan 27 2022` |  |
| 44 | `resurfaced leads Jan 30 2022` |  |
| 46 | `text upload 01312022` |  |
| 47 | `resurfaced leads Feb 2 2022` |  |
| 48 | `text upload 02032022` |  |
| 49 | `resurfaced leads feb 3 2022` |  |
| 50 | `resurfaced Feb 03` |  |
| 51 | `resurfaced leads feb 4 2022` |  |
| 52 | `resurfaced leads Feb 8 2022` |  |
| 53 | `text upload 02092022` |  |
| 54 | `text upload 02102022` |  |
| 55 | `resurfaced leads Feb 11 2022` |  |
| 56 | `text blast feb 14 2022` |  |
| 57 | `text upload 02142022` |  |
| 58 | `resurfaced leads Feb 14 2022` |  |
| 59 | `resurfaced leads feb 14 2022 2` |  |
| 60 | `text upload 02172022` |  |
| 61 | `resurfaced leads feb 17 22` |  |
| 62 | `resurfaced leads Feb 20 2022` |  |
| 63 | `resurfaced leads feb 21 2022` |  |
| 64 | `Resurfaced leads feb 22 22` |  |
| 65 | `text upload 02222022` |  |
| 66 | `text upload 02222022 b` |  |
| 67 | `resurfaced leads feb 23 2022` |  |
| 68 | `resurfaced leads feb 25 2022` |  |
| 69 | `resurfaced leads feb 26 2022` |  |
| 72 | `text upload 03012022` |  |
| 73 | `resurfaced leads march 01 2022` |  |
| 74 | `resurfaced leads march 02 2022` |  |
| 75 | `resurfaced leads march 04 2022` |  |
| 76 | `resurfaced leads 03072022` |  |
| 77 | `text upload 03082022` |  |
| 78 | `resurfaced leads 03082022` |  |
| 79 | `resurfaced 03092022` |  |
| 80 | `resurfaced leads 03112022` |  |
| 81 | `resurfaced leads 03152022` |  |
| 82 | `resurfaced leads 03172022` |  |
| 83 | `resurfaced 03212022` |  |
| 84 | `resurfaced leads 03222022` |  |
| 85 | `text upload 032422` |  |
| 86 | `resurfaced 032522` |  |
| 87 | `resurfaced leads 032922` |  |
| 88 | `text upload 032922` |  |
| 91 | `resurfaced leads 04032022 big list one 1` |  |
| 92 | `resurfaced leads 04052022` |  |
| 93 | `text upload 04052022` |  |
| 94 | `resurfaced leads 04072022` |  |
| 95 | `resurfaced leads 04092022` |  |
| 96 | `text upload 04122022` |  |
| 97 | `resurfaced leads 04132022` |  |
| 98 | `text upload 04142022` |  |
| 99 | `resurfaced 04142022` |  |
| 100 | `resurfaced leads 04162022` |  |
| 101 | `resurfaced leads 04202022` |  |
| 102 | `resurfaced leads 04242022` |  |
| 103 | `resurfaced leads 04262022` |  |
| 104 | `text upload 04262022` |  |
| 105 | `PHX Ads` |  |
| 106 | `resurfaced leads 04282022` |  |
| 107 | `text upload 04282022` |  |
| 108 | `resurfaced 05032022` |  |
| 109 | `text upload 05032022` |  |
| 110 | `resurfaced 05052022` |  |
| 111 | `text upload 05052022` |  |
| 112 | `resurfaced 05102022` |  |
| 113 | `text upload 05102022` |  |
| 114 | `resurfaced 05122022` |  |
| 115 | `text upload 05132022` |  |
| 116 | `resurfaced 05172022` |  |
| 117 | `text upload 05172022` |  |
| 118 | `resurfaced 05192022` |  |
| 119 | `text upload 05192022` |  |
| 120 | `resurfaced 052422` |  |
| 121 | `text upload 05242022` |  |
| 122 | `resurfaced05262022` |  |
| 123 | `resurfaced 05312022` |  |
| 124 | `text upload 05312022` |  |
| 125 | `resurfaced 06012022` |  |
| 126 | `resurfaced 06022022` |  |
| 127 | `text upload 06032022` |  |
| 128 | `resurfaced 06072022` |  |
| 129 | `text upload 06072022` |  |
| 130 | `resurfaced 060922` |  |
| 131 | `text upload 06092022` |  |
| 132 | `resurfaced 06092022` |  |
| 133 | `text upload 06092022-2` |  |
| 135 | `resurfaced leads 06142022` |  |
| 136 | `resurfaced 06142022` |  |
| 138 | `resurfaced 062022` |  |
| 139 | `Resurfaced 06202022` |  |
| 140 | `resurfaced 0620222` |  |
| 141 | `resurfaced  062022` |  |
| 142 | `resurfaced 062122` |  |
| 144 | `resurfaced 06232022` |  |
| 145 | `resurfaced 062322` |  |
| 148 | `RECAL` |  |
| 149 | `HIGH END MARGINS $300+` |  |
| 150 | `NO INCENTIVE` |  |
| 151 | `resurfaced leads 063022` |  |
| 153 | `PROGRESSIVE` |  |
| 154 | `LIBERTY MUTUAL` |  |
| 155 | `SAFCO` |  |
| 156 | `HIGH PAYING RECAL` |  |
| 157 | `resurfaced 07052022` |  |
| 158 | `resurfaced 070722` |  |
| 161 | `robert` |  |
| 163 | `resurfaced 072122` |  |
| 164 | `resurfaced 07212022` |  |
| 165 | `resurfaced leads 072122` |  |
| 166 | `resurfaced 072522` |  |
| 167 | `resurfaced 072622` |  |
| 168 | `resurfaced 072722` |  |
| 169 | `resurfaced 072822` |  |
| 171 | `resurfaced 073022` |  |
| 172 | `resurfaced leads 08022022` |  |
| 173 | `resurfaced 080222` |  |
| 174 | `resurfaced 080422` |  |
| 176 | `resurfaced 08092022` |  |
| 177 | `resurfaced 08112022` |  |
| 179 | `resurfaced 08122022` |  |
| 180 | `resurfaced 08162022` |  |
| 181 | `ONLY BING (2022)` |  |
| 182 | `Text 08192022` |  |
| 183 | `resurfaced 08192022` |  |
| 184 | `text 08232022` |  |
| 185 | `resurface 08232022` |  |
| 186 | `text 082522` |  |
| 188 | `resurfaced 082622` |  |
| 189 | `resurfaced 083022` |  |
| 190 | `text 08302022` |  |
| 191 | `text 09012022` |  |
| 192 | `text 09062022` |  |
| 193 | `text 09082022` |  |
| 194 | `resurfaced 09/13/2022` |  |
| 195 | `text 09132022` |  |
| 197 | `Nikki Trumpia` |  |
| 198 | `resurfaced 09/20/2022` |  |
| 200 | `resurfaced 09/26/2022` |  |
| 201 | `resurfaced 09/27/2022` |  |
| 202 | `reserufaced 10/10/2022` |  |
| 204 | `resurfaced 10/13/2022` |  |
| 205 | `resurfaced 10/20/2022` |  |
| 206 | `resurfaced 10/24/2022` |  |
| 207 | `resurfaced 10/26/2022` |  |
| 209 | `Nikki Text Blast` |  |
| 210 | `resurfaced 11/01/2022` |  |
| 211 | `Resurfaced 11/03/2022` |  |
| 213 | `resurfaced 11/07/2022` |  |
| 214 | `resurfaced 11/10/2022` |  |
| 215 | `resurfaced 11/14/2022` |  |
| 2373 | `resurfaced 11032022` |  |
| 2375 | `resurfaced 09272022` |  |
| 2376 | `resurfaced 11102022` |  |
| 2377 | `resurfaced 10202022` |  |
| 2378 | `resurfaced 09132022` |  |
| 2379 | `reserufaced 10102022` |  |
| 2380 | `resurfaced 11072022` |  |
| 2381 | `resurfaced 11012022` |  |
| 2382 | `resurfaced 09262022` |  |
| 2383 | `resurfaced02142022` |  |
| 2384 | `resurfaced 10132022` |  |
| 2385 | `resurfaced 10242022` |  |
| 2386 | `resurfaced 10262022` |  |
| 2388 | `resurfaced 09202022` |  |
| 2389 | `resurfaced leads 12032021` |  |
| 2390 | `resurfaced 11/16/2022` |  |
| 2391 | `resurfaced 11/21/2022` |  |
| 2392 | `resurfaced 11/27/2022` |  |
| 2394 | `resurfaced 12/02/2022` |  |
| 2396 | `resurfaced 12/07/2022` |  |
| 2399 | `resurfaced 12/11/2022` |  |
| 2400 | `resurfaced 12/26/2022` |  |
| 2403 | `Live (radio) 101.5` |  |
| 2405 | `resurfaced 01/16/2023` |  |
| 2406 | `resurfaced 01/19/2023` |  |
| 2407 | `resurfaced 01/26/2023` |  |
| 2408 | `resurfaced 02/06/2023` |  |
| 2409 | `resurfaced 02/13/2023` |  |
| 2410 | `resurfaced 02/19/2023` |  |
| 2411 | `resurfaced 02/27/2023` |  |
| 2414 | `Florida Alex` |  |
| 2416 | `SIGNS` |  |
| 2417 | `Nikki Nuseal` |  |
| 2444 | `Lost transfer` |  |
| 2445 | `outofstatejunk` |  |
| 2446 | `soldwithin3months` |  |
| 2451 | `AC Form Organic` |  |
| 2452 | `AC Form-Website` |  |
| 2454 | `AC Form-Google Ads` |  |
| 2456 | `Nextdoor Lead` |  |
| 2457 | `NUSEAL` |  |
| 2461 | `AC Form-Google Ad` |  |
| 2462 | `FB Leads C - Revised` |  |
| 2463 | `FB Leads D - Revised` |  |
| 2465 | `FB Leads C - Revised - ALI UPDATE` |  |
| 2466 | `newpxl` |  |
| 2477 | `TAM lead` |  |
| 2478 | `CARLO Lead` |  |
| 2479 | `fix` |  |
| 2480 | `xx` |  |
| 2481 | `jesse` |  |
| 2486 | `FB` |  |
| 2489 | `Jesse resurfaced 3/25 - 6/25` |  |
| 2490 | `All GB Import 1-1-26 to 5-8-26` |  |
| 2491 | `Jesse Resurfaced` |  |
| 2492 | `ALL contacts from ALL sources import` |  |
| 2493 | `Follow-Up Sequence Complete` |  |

## Full list (alphabetical)

| ID | Tag | Bucket |
|---|---|---|
| 2451 | `AC Form Organic` | `unclassified` |
| 2461 | `AC Form-Google Ad` | `unclassified` |
| 2454 | `AC Form-Google Ads` | `unclassified` |
| 2452 | `AC Form-Website` | `unclassified` |
| 2492 | `ALL contacts from ALL sources import` | `unclassified` |
| 2490 | `All GB Import 1-1-26 to 5-8-26` | `unclassified` |
| 2478 | `CARLO Lead` | `unclassified` |
| 9 | `facebook` | `source:meta_paid` |
| 2486 | `FB` | `unclassified` |
| 2462 | `FB Leads C - Revised` | `unclassified` |
| 2465 | `FB Leads C - Revised - ALI UPDATE` | `unclassified` |
| 2463 | `FB Leads D - Revised` | `unclassified` |
| 2479 | `fix` | `unclassified` |
| 2414 | `Florida Alex` | `unclassified` |
| 2493 | `Follow-Up Sequence Complete` | `unclassified` |
| 2476 | `GB-JFM2025(previous customers)` | `workflow:customer_state` |
| 149 | `HIGH END MARGINS $300+` | `unclassified` |
| 156 | `HIGH PAYING RECAL` | `unclassified` |
| 2481 | `jesse` | `unclassified` |
| 2491 | `Jesse Resurfaced` | `unclassified` |
| 2489 | `Jesse resurfaced 3/25 - 6/25` | `unclassified` |
| 25 | `leads inbox duct tape` | `unclassified` |
| 154 | `LIBERTY MUTUAL` | `unclassified` |
| 2403 | `Live (radio) 101.5` | `unclassified` |
| 2444 | `Lost transfer` | `unclassified` |
| 2488 | `Missed Call - Vonage` | `source:call_inbound` |
| 2449 | `NEW Google ad` | `source:google_paid` |
| 2487 | `NEW LEAD ALERT` | `source:other_new_lead` |
| 2467 | `NEW LEAD FORM (G.Ads)` | `source:other_new_lead` |
| 2471 | `NewGoogle-CNTCT` | `source:google_paid` |
| 2473 | `NewGoogle-HP` | `source:google_paid` |
| 2472 | `NewGoogle-LP` | `source:google_paid` |
| 2474 | `NewGoogle-SRV` | `source:google_paid` |
| 2466 | `newpxl` | `unclassified` |
| 2456 | `Nextdoor Lead` | `unclassified` |
| 2395 | `nikki direct mail` | `source:direct_mail` |
| 12 | `NIKKI FB` | `unclassified` |
| 11 | `NIKKI GOOGLE AD` | `unclassified` |
| 2417 | `Nikki Nuseal` | `unclassified` |
| 209 | `Nikki Text Blast` | `unclassified` |
| 197 | `Nikki Trumpia` | `unclassified` |
| 150 | `NO INCENTIVE` | `unclassified` |
| 2457 | `NUSEAL` | `unclassified` |
| 181 | `ONLY BING (2022)` | `unclassified` |
| 18 | `oranic` | `unclassified` |
| 19 | `Organic` | `source:organic` |
| 2450 | `Organic Landing page` | `source:organic` |
| 2445 | `outofstatejunk` | `unclassified` |
| 105 | `PHX Ads` | `unclassified` |
| 17 | `PHX auto glass` | `unclassified` |
| 22 | `phx auto glass incoming` | `unclassified` |
| 2458 | `PHX auto glass test` | `noise:test_or_old` |
| 2459 | `PHX auto glass tint` | `workflow:product_attr` |
| 153 | `PROGRESSIVE` | `unclassified` |
| 2468 | `REBATE` | `workflow:product_attr` |
| 2470 | `REBATE PAID` | `workflow:product_attr` |
| 2469 | `REBATE PRIORITY` | `workflow:product_attr` |
| 148 | `RECAL` | `unclassified` |
| 2484 | `Referral Program Introduced` | `source:referral` |
| 202 | `reserufaced 10/10/2022` | `unclassified` |
| 2379 | `reserufaced 10102022` | `unclassified` |
| 185 | `resurface 08232022` | `unclassified` |
| 4 | `resurfaced` | `unclassified` |
| 141 | `resurfaced  062022` | `unclassified` |
| 2405 | `resurfaced 01/16/2023` | `unclassified` |
| 2406 | `resurfaced 01/19/2023` | `unclassified` |
| 2407 | `resurfaced 01/26/2023` | `unclassified` |
| 2408 | `resurfaced 02/06/2023` | `unclassified` |
| 2409 | `resurfaced 02/13/2023` | `unclassified` |
| 2410 | `resurfaced 02/19/2023` | `unclassified` |
| 2411 | `resurfaced 02/27/2023` | `unclassified` |
| 79 | `resurfaced 03092022` | `unclassified` |
| 83 | `resurfaced 03212022` | `unclassified` |
| 86 | `resurfaced 032522` | `unclassified` |
| 99 | `resurfaced 04142022` | `unclassified` |
| 108 | `resurfaced 05032022` | `unclassified` |
| 110 | `resurfaced 05052022` | `unclassified` |
| 112 | `resurfaced 05102022` | `unclassified` |
| 114 | `resurfaced 05122022` | `unclassified` |
| 116 | `resurfaced 05172022` | `unclassified` |
| 118 | `resurfaced 05192022` | `unclassified` |
| 120 | `resurfaced 052422` | `unclassified` |
| 123 | `resurfaced 05312022` | `unclassified` |
| 125 | `resurfaced 06012022` | `unclassified` |
| 126 | `resurfaced 06022022` | `unclassified` |
| 128 | `resurfaced 06072022` | `unclassified` |
| 132 | `resurfaced 06092022` | `unclassified` |
| 130 | `resurfaced 060922` | `unclassified` |
| 136 | `resurfaced 06142022` | `unclassified` |
| 139 | `Resurfaced 06202022` | `unclassified` |
| 138 | `resurfaced 062022` | `unclassified` |
| 140 | `resurfaced 0620222` | `unclassified` |
| 142 | `resurfaced 062122` | `unclassified` |
| 144 | `resurfaced 06232022` | `unclassified` |
| 145 | `resurfaced 062322` | `unclassified` |
| 157 | `resurfaced 07052022` | `unclassified` |
| 158 | `resurfaced 070722` | `unclassified` |
| 164 | `resurfaced 07212022` | `unclassified` |
| 163 | `resurfaced 072122` | `unclassified` |
| 166 | `resurfaced 072522` | `unclassified` |
| 167 | `resurfaced 072622` | `unclassified` |
| 168 | `resurfaced 072722` | `unclassified` |
| 169 | `resurfaced 072822` | `unclassified` |
| 171 | `resurfaced 073022` | `unclassified` |
| 173 | `resurfaced 080222` | `unclassified` |
| 174 | `resurfaced 080422` | `unclassified` |
| 176 | `resurfaced 08092022` | `unclassified` |
| 177 | `resurfaced 08112022` | `unclassified` |
| 179 | `resurfaced 08122022` | `unclassified` |
| 180 | `resurfaced 08162022` | `unclassified` |
| 183 | `resurfaced 08192022` | `unclassified` |
| 188 | `resurfaced 082622` | `unclassified` |
| 189 | `resurfaced 083022` | `unclassified` |
| 194 | `resurfaced 09/13/2022` | `unclassified` |
| 198 | `resurfaced 09/20/2022` | `unclassified` |
| 200 | `resurfaced 09/26/2022` | `unclassified` |
| 201 | `resurfaced 09/27/2022` | `unclassified` |
| 2378 | `resurfaced 09132022` | `unclassified` |
| 2388 | `resurfaced 09202022` | `unclassified` |
| 2382 | `resurfaced 09262022` | `unclassified` |
| 2375 | `resurfaced 09272022` | `unclassified` |
| 204 | `resurfaced 10/13/2022` | `unclassified` |
| 205 | `resurfaced 10/20/2022` | `unclassified` |
| 206 | `resurfaced 10/24/2022` | `unclassified` |
| 207 | `resurfaced 10/26/2022` | `unclassified` |
| 2384 | `resurfaced 10132022` | `unclassified` |
| 2377 | `resurfaced 10202022` | `unclassified` |
| 2385 | `resurfaced 10242022` | `unclassified` |
| 2386 | `resurfaced 10262022` | `unclassified` |
| 210 | `resurfaced 11/01/2022` | `unclassified` |
| 211 | `Resurfaced 11/03/2022` | `unclassified` |
| 213 | `resurfaced 11/07/2022` | `unclassified` |
| 214 | `resurfaced 11/10/2022` | `unclassified` |
| 215 | `resurfaced 11/14/2022` | `unclassified` |
| 2390 | `resurfaced 11/16/2022` | `unclassified` |
| 2391 | `resurfaced 11/21/2022` | `unclassified` |
| 2392 | `resurfaced 11/27/2022` | `unclassified` |
| 2381 | `resurfaced 11012022` | `unclassified` |
| 2373 | `resurfaced 11032022` | `unclassified` |
| 2380 | `resurfaced 11072022` | `unclassified` |
| 2376 | `resurfaced 11102022` | `unclassified` |
| 2394 | `resurfaced 12/02/2022` | `unclassified` |
| 2396 | `resurfaced 12/07/2022` | `unclassified` |
| 2399 | `resurfaced 12/11/2022` | `unclassified` |
| 2400 | `resurfaced 12/26/2022` | `unclassified` |
| 50 | `resurfaced Feb 03` | `unclassified` |
| 76 | `resurfaced leads 03072022` | `unclassified` |
| 78 | `resurfaced leads 03082022` | `unclassified` |
| 80 | `resurfaced leads 03112022` | `unclassified` |
| 81 | `resurfaced leads 03152022` | `unclassified` |
| 82 | `resurfaced leads 03172022` | `unclassified` |
| 84 | `resurfaced leads 03222022` | `unclassified` |
| 87 | `resurfaced leads 032922` | `unclassified` |
| 91 | `resurfaced leads 04032022 big list one 1` | `unclassified` |
| 92 | `resurfaced leads 04052022` | `unclassified` |
| 94 | `resurfaced leads 04072022` | `unclassified` |
| 95 | `resurfaced leads 04092022` | `unclassified` |
| 97 | `resurfaced leads 04132022` | `unclassified` |
| 100 | `resurfaced leads 04162022` | `unclassified` |
| 101 | `resurfaced leads 04202022` | `unclassified` |
| 102 | `resurfaced leads 04242022` | `unclassified` |
| 103 | `resurfaced leads 04262022` | `unclassified` |
| 106 | `resurfaced leads 04282022` | `unclassified` |
| 135 | `resurfaced leads 06142022` | `unclassified` |
| 151 | `resurfaced leads 063022` | `unclassified` |
| 165 | `resurfaced leads 072122` | `unclassified` |
| 172 | `resurfaced leads 08022022` | `unclassified` |
| 2389 | `resurfaced leads 12032021` | `unclassified` |
| 36 | `resurfaced leads Dec 20 2021` | `unclassified` |
| 37 | `resurfaced leads Dec 29 2021` | `unclassified` |
| 20 | `Resurfaced Leads Dec 3 2021` | `unclassified` |
| 21 | `Resurfaced Leads Dec 5 2021` | `unclassified` |
| 55 | `resurfaced leads Feb 11 2022` | `unclassified` |
| 58 | `resurfaced leads Feb 14 2022` | `unclassified` |
| 59 | `resurfaced leads feb 14 2022 2` | `unclassified` |
| 61 | `resurfaced leads feb 17 22` | `unclassified` |
| 47 | `resurfaced leads Feb 2 2022` | `unclassified` |
| 62 | `resurfaced leads Feb 20 2022` | `unclassified` |
| 63 | `resurfaced leads feb 21 2022` | `unclassified` |
| 64 | `Resurfaced leads feb 22 22` | `unclassified` |
| 67 | `resurfaced leads feb 23 2022` | `unclassified` |
| 68 | `resurfaced leads feb 25 2022` | `unclassified` |
| 69 | `resurfaced leads feb 26 2022` | `unclassified` |
| 49 | `resurfaced leads feb 3 2022` | `unclassified` |
| 51 | `resurfaced leads feb 4 2022` | `unclassified` |
| 52 | `resurfaced leads Feb 8 2022` | `unclassified` |
| 38 | `resurfaced leads Jan 1 2022` | `unclassified` |
| 40 | `resurfaced leads Jan 10 2022` | `unclassified` |
| 41 | `resurfaced leads Jan 12 2022` | `unclassified` |
| 42 | `resurfaced leads Jan 18 2022` | `unclassified` |
| 43 | `resurfaced leads Jan 27 2022` | `unclassified` |
| 44 | `resurfaced leads Jan 30 2022` | `unclassified` |
| 39 | `resurfaced leads Jan 5 2022` | `unclassified` |
| 73 | `resurfaced leads march 01 2022` | `unclassified` |
| 74 | `resurfaced leads march 02 2022` | `unclassified` |
| 75 | `resurfaced leads march 04 2022` | `unclassified` |
| 2383 | `resurfaced02142022` | `unclassified` |
| 122 | `resurfaced05262022` | `unclassified` |
| 2485 | `Review Reminder Sent` | `workflow:product_attr` |
| 2482 | `Review Request Sent` | `workflow:product_attr` |
| 2483 | `Review Thank You Sent` | `workflow:product_attr` |
| 2475 | `RickTest` | `noise:test_or_old` |
| 161 | `robert` | `unclassified` |
| 155 | `SAFCO` | `unclassified` |
| 2416 | `SIGNS` | `unclassified` |
| 23 | `Sold` | `noise:test_or_old` |
| 3 | `Sold Resurfaced 11-4-21` | `noise:test_or_old` |
| 2446 | `soldwithin3months` | `unclassified` |
| 2477 | `TAM lead` | `unclassified` |
| 182 | `Text 08192022` | `unclassified` |
| 184 | `text 08232022` | `unclassified` |
| 186 | `text 082522` | `unclassified` |
| 190 | `text 08302022` | `unclassified` |
| 191 | `text 09012022` | `unclassified` |
| 192 | `text 09062022` | `unclassified` |
| 193 | `text 09082022` | `unclassified` |
| 195 | `text 09132022` | `unclassified` |
| 35 | `TEXT BLAST` | `unclassified` |
| 56 | `text blast feb 14 2022` | `unclassified` |
| 46 | `text upload 01312022` | `unclassified` |
| 48 | `text upload 02032022` | `unclassified` |
| 53 | `text upload 02092022` | `unclassified` |
| 54 | `text upload 02102022` | `unclassified` |
| 57 | `text upload 02142022` | `unclassified` |
| 60 | `text upload 02172022` | `unclassified` |
| 65 | `text upload 02222022` | `unclassified` |
| 66 | `text upload 02222022 b` | `unclassified` |
| 72 | `text upload 03012022` | `unclassified` |
| 77 | `text upload 03082022` | `unclassified` |
| 85 | `text upload 032422` | `unclassified` |
| 88 | `text upload 032922` | `unclassified` |
| 93 | `text upload 04052022` | `unclassified` |
| 96 | `text upload 04122022` | `unclassified` |
| 98 | `text upload 04142022` | `unclassified` |
| 104 | `text upload 04262022` | `unclassified` |
| 107 | `text upload 04282022` | `unclassified` |
| 109 | `text upload 05032022` | `unclassified` |
| 111 | `text upload 05052022` | `unclassified` |
| 113 | `text upload 05102022` | `unclassified` |
| 115 | `text upload 05132022` | `unclassified` |
| 117 | `text upload 05172022` | `unclassified` |
| 119 | `text upload 05192022` | `unclassified` |
| 121 | `text upload 05242022` | `unclassified` |
| 124 | `text upload 05312022` | `unclassified` |
| 127 | `text upload 06032022` | `unclassified` |
| 129 | `text upload 06072022` | `unclassified` |
| 131 | `text upload 06092022` | `unclassified` |
| 133 | `text upload 06092022-2` | `unclassified` |
| 31 | `text upload 12102021` | `unclassified` |
| 33 | `text upload 12102021B` | `unclassified` |
| 32 | `text12202021` | `unclassified` |
| 2480 | `xx` | `unclassified` |
