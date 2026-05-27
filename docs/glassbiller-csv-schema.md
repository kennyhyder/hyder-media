# GlassBiller CSV Schema (Phase 0)

**Generated:** 2026-05-27
**Phase 0 artifact** for the Lead-Attribution Platform plan.
**Sources inspected** (all in `clients/ag2020/data/`):
- `Margin_report - 05_27_2026 10_12 AM.csv` (current; 1,668 rows)
- `Sales_report - 05_27_2026 10_15 AM.csv` (current; 1,668 rows; same period as margin)
- `ag2020-margins-jan2020_jan2026.csv` (historical; ~54K rows)
- `ag2020-sales-jan2020_jan2026.csv` (historical; ~54K rows)
- `Margin_report - 12_15_2025 12_14 PM.csv` (Dec 2025 snapshot; same schema)

## TL;DR

GlassBiller exports **two complementary reports** that join 1:1 on `Invoice #`:

- **Margin Report** — per-invoice financials (materials, labor, part cost, commissions, rebate, margin) plus customer name. **No dates, no contact info.**
- **Sales Report** — per-invoice date, payer, external referral #, gross sales. **No customer name, no contact info.**

Joined, they give us: invoice #, date, customer name, payer (insurance/cash), referral #, full financials. **They DO NOT give us phone, email, or address.**

That last point is the critical Phase 0 finding — see §5.

## 1. Margin Report — column spec

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| 1 | `Invoice #` | string | `452-5279568` | Primary key; joins to Sales Report 1:1 |
| 2 | `Customer Name` | string | `Della Negrete` | Free-form; case + spacing inconsistent |
| 3 | `Materials` | decimal | `546.36` | |
| 4 | `Labor` | decimal | `480` | |
| 5 | `Subtotal` | decimal | `1026.36` | = Materials + Labor |
| 6 | `Part Cost` | decimal | `261.99` | COGS — parts |
| 7 | `Commissions` | decimal | `65` | Sales commission paid out |
| 8 | `Rebate` | decimal | `175` | Customer rebate paid out |
| 9 | `Other` | decimal | `0` | |
| 10 | `Margin` | decimal | `524.37` | = Subtotal − Part Cost − Commissions − Rebate − Other |

Schema is **stable**: current 2026 export matches the December 2025 snapshot and the historical 6-year file.

## 2. Sales Report — column spec

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| 1 | `Invoice #` | string | `452-5279568` | Joins to Margin Report |
| 2 | `Invoice date` | date | `2026-01-01` | ISO `YYYY-MM-DD` |
| 3 | `Payer` | string | `GEICO` · `PROGRESSIVE` · `Infinity` · `Cash` etc. | Insurance company or cash/self-pay |
| 4 | `Referral #` | string | `726242` | External reference (insurance claim # / similar) |
| 5 | `Materials` | decimal | `546.36` | duplicate of Margin Report |
| 6 | `Labor` | decimal | `480` | duplicate |
| 7 | `Subtotal` | decimal | `1026.36` | duplicate |
| 8 | `Sales Tax` | decimal | `42.62` | |
| 9 | `Gross Sales` | decimal | `1068.98` | = Subtotal + Sales Tax |

Schema also stable across historical and current exports.

## 3. Joined-row example

Invoice `452-5279568` (margin + sales joined):

- **Date:** 2026-01-01
- **Customer:** Della Negrete
- **Payer:** GEICO
- **Referral #:** 726242
- **Subtotal:** $1,026.36 · **Sales Tax:** $42.62 · **Gross Sales:** $1,068.98
- **Part Cost:** $261.99 · **Commissions:** $65 · **Rebate:** $175
- **Margin:** $524.37

## 4. Row volume

| File | Rows |
|---|---|
| Current Margin / Sales (Jan 1 → May 27, 2026) | 1,668 each |
| Historical Jan 2020 → Jan 2026 | ~54K each |

A typical month produces ~150–300 invoices. Daily exports would be ~5–15 rows.

## 5. CRITICAL: no contact info in either report

Neither report includes **phone**, **email**, or **address**. The Lead-Attribution Platform plan's `lead_journey ↔ crm_jobs` linkage is keyed on phone (with email secondary). Without phone, the automated join from CRM job back to lead source cannot complete by direct key.

### Mitigation options (in priority order)

**Option A — get a phone-bearing GlassBiller export. *Strongly preferred.***
Most CRM report builders allow custom columns. AG2020 / Rick to check the GlassBiller report-builder UI and add `Phone` (or `Mobile`, `Customer Phone`) — and ideally `Email` too — to either report. This is almost certainly a 5-minute config change on their side. Once available, the attribution platform joins on phone exactly as planned, with no fuzzy matching needed.

**Option B — customer-name fuzzy matching. *Fallback.***
Normalize `Customer Name` (lowercase, strip punctuation) and fuzzy-match against AC contact `firstName + lastName` via trigram similarity. Workable but fragile — common names, family-shared households, formatting drift will produce false positives. Implementation: store match confidence per `crm_jobs` row; auto-link at high confidence (≥0.9); flag medium (0.7–0.9) for manual triage in the dashboard; leave low (<0.7) unlinked.

**Option C — manual Invoice # on the AC contact. *Hybrid fallback.***
Reps add the GlassBiller Invoice # into a custom field on the AC contact when the job is created. Join by Invoice #. 100% accurate but adds rep workflow burden — only worth it if A and B both fail.

**Option D — investigate GlassBiller API. *Deferred.***
Current direction is CSV-only per the user's decision, but worth confirming with GlassBiller directly whether the API exposes phone for any future expansion. Not blocking Phase 1.

**Recommendation:** Pursue **A first**. If A is genuinely unavailable, ship **B as the auto-linker** with a triage queue for medium-confidence matches and **C as the manual escape hatch** for the unlinked.

## 6. Implications for the Phase 1 ingester

`api/ag2020/_adapters/glassbiller-csv.js` needs to:

1. Accept **two CSVs per upload** (margin + sales for the same period), stitch on `Invoice #`.
2. **Validate the column schema** matches the spec above; reject mismatched uploads with a clear error (schema-drift alert).
3. **Upsert into `ag2020_crm_jobs`** keyed by `(tenant_id, source_system='glassbiller', source_job_id=Invoice#)`. Idempotent re-uploads.
4. After ingest, call the **linker**:
   - If phone column present (Option A) → exact normalized phone match against `ag2020_lead_journey.phone_normalized`.
   - Else (Option B) → fuzzy customer-name match against AC contacts, store confidence, queue low-confidence rows for triage.
5. **Update `lead_journey`** financial denormalized fields and `crm_job_ids[]` on linked journeys.
6. Set `journey_state = 'completed'` when `paid_at` is present (paid_at not in current CSV — needs to be added by GlassBiller export config OR derived from invoice date + some lag heuristic).

## 7. Export cadence

To confirm with AG2020 in Phase 0:

- **Daily** → near-real-time attribution (≤24h lag); preferred.
- **Weekly** → tolerable; attribution lags up to 7 days, "as of last upload" badge on the dashboard.
- **On demand** → workable fallback; UI label freshness clearly.

The upload endpoint should accept all three patterns transparently.

## 8. Future — generic CRM CSV schema (AutomateDojo, Phase 3)

When this lifts to AutomateDojo, the GlassBiller schema becomes one entry in a per-tenant `crm_csv_schemas` config so the same engine serves other CRMs (AccuLynx, JobNimbus, ServiceTitan, MindBody, Glofox, Spark Membership, etc.):

```yaml
crm_csv_schemas:
  glassbiller:
    join_files: [margin, sales]
    join_key: "Invoice #"
    files:
      margin:
        source_job_id: "Invoice #"
        customer_name: "Customer Name"
        cogs_amount: "Part Cost"
        margin_amount: "Margin"
      sales:
        source_job_id: "Invoice #"
        invoice_date: "Invoice date"
        invoice_amount: "Gross Sales"
        payer_field: "Payer"
        external_ref: "Referral #"
```

Different CRM = different schema entry. Same ingester. Same linker.
