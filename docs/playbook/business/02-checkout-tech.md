# Checkout tech — how to actually sell the playbook

You need a way to take money for the $79 tier and the $2,500-5,000 DFY tier. Don't roll your own — use existing tools.

## For the $79 digital product

Three viable options, ranked:

### Option 1 (Recommended): Lemon Squeezy

- **Why:** Lower fees than Gumroad (5% + $0.50 vs 10%), handles EU VAT automatically (a real headache otherwise), built-in license keys, affiliate program built in.
- **Setup:** https://www.lemonsqueezy.com → create store → upload PDF + ZIP → set price → connect domain for checkout
- **Time to live:** 30 minutes
- **Fees:** 5% + $0.50 per transaction
- **Payouts:** Weekly to your bank
- **VAT/tax handling:** They're the merchant of record. They collect, file, and remit EU VAT for you. Worth the 5% alone if you sell to EU.

### Option 2: Gumroad

- **Why:** Larger built-in audience (Gumroad has a marketplace; people browse). Familiar UX.
- **Setup:** https://gumroad.com → product → done
- **Time to live:** 15 minutes
- **Fees:** 10% + 50¢ (significantly higher than Lemon Squeezy)
- **Payouts:** Weekly
- **VAT/tax:** They handle EU VAT (also merchant of record)

### Option 3 (DIY): Stripe Checkout on hyder.me

- **Why:** Lowest fees (2.9% + 30¢), full control of the checkout experience.
- **Setup:** Stripe product + price + a checkout page on hyder.me that opens a Stripe Checkout session
- **Time to live:** 1-2 days
- **Fees:** 2.9% + 30¢
- **Payouts:** Daily
- **VAT/tax:** YOU are the merchant of record. You handle EU VAT (real work — use a service like Quaderno or Octobat for ~$30/mo).

**Recommendation:** Lemon Squeezy first. The 5% premium vs Stripe is worth not dealing with EU VAT. Switch to Stripe later if/when you're doing 100+ sales/month and the fees become material.

## For the $2,500-5,000 DFY engagement

Different game. Higher ticket = different friction tolerance.

### Booking flow

1. **Calendly link** (https://calendly.com — free tier is fine) for a free 20-min "Is this engagement right for you?" call
2. During the call, you assess fit, they assess you
3. If aligned, you send a proposal + Stripe invoice via dashboard.stripe.com → Customers → Invoices
4. They pay (Stripe handles wire/ACH for larger amounts; card for $2.5k+ is fine but has higher fees)
5. You start the engagement

### Don't use a self-serve checkout for DFY

The friction of the call is a feature. It filters out clients who don't actually have $2,500+ to spend (or who don't have an actual project that's ready). It also gives you a chance to scope properly. A self-serve checkout for high-ticket consulting creates more refund disputes than it saves time.

### Payment terms

- 50% upfront, 50% on completion (industry standard for 2-week engagements)
- For larger ($10k+): 30/40/30 (kickoff / mid-engagement / completion)
- Use Stripe invoices not personal Venmo — invoices establish a paper trail + tax record

### Refund policy

Be explicit in the proposal:

> "If we discover within the first 3 days of the engagement that the playbook doesn't apply to your project, I'll refund 100% of the deposit and we part ways. After day 3, no refunds — by that point the work has been substantial. If the engagement completes and you're unhappy with the deliverables, I'll spend up to 5 additional hours fixing it before considering a refund."

## Email infrastructure for the funnel

You need:

- **Lead-magnet email capture** on hyder.me/playbook
- **Drip email sequence** for the free PDF audience (3-5 emails over 14 days)
- **Broadcast email** to announce updates or new content

### Recommended stack

- **ConvertKit** ($15-49/mo): purpose-built for creator email funnels. Tags > lists. Easy automation builder.
- **Mailerlite** ($10-30/mo): cheaper alternative, slightly less powerful automation.
- **Beehiiv** (free tier for small lists): newsletter-focused but has automation now.

DO NOT use Mailchimp for this. Their automation builder is worse than ConvertKit at 3x the price. Their "newsletter list" model is also outdated vs tag-based.

### Sequence outline (drip email after free PDF download)

1. **Day 0 (instant):** "Here's your playbook + a quick note." Plain text from Kenny, no design. Includes the PDF link and a one-line "reply to this if you have questions" CTA.
2. **Day 2:** "The Stripe newline bug" — share one of the defensive patterns as a standalone email. Builds depth. Hooks them.
3. **Day 5:** "When the free playbook isn't enough" — soft-sell the $79 paid tier. Mention the templates, the Claude skill, the code snippets.
4. **Day 9:** "When you don't want to do it yourself" — soft-sell the DFY engagement. Case study tone (anonymized if needed).
5. **Day 14:** "Final reminder — playbook + DFY links again, then I'll stop emailing about this for a while."

After Day 14, switch them to your regular newsletter list (if you have one) or "monthly tips" cadence.

### Tracking attribution

Use UTM parameters on every link out of every email:

```
https://hyder.me/playbook?utm_source=drip&utm_medium=email&utm_campaign=playbook-day-0
```

Then in GA4 you'll see exactly which emails drove $79 conversions vs DFY bookings. Optimize the sequence based on data.

## What NOT to do

- **Don't sell via PayPal or Venmo.** Looks unprofessional, no proper invoice trail, harder to handle refunds + chargebacks. Stripe or Lemon Squeezy only.
- **Don't price too low.** $19 PDFs feel disposable. $79 is the floor for "this is serious content." If you're tempted to price lower, you might not have written something premium enough.
- **Don't price too high.** $299 PDFs need a 100-page+ length and verifiable case studies. Save that price tier for cohort courses or full digital products.
- **Don't bundle "future updates" forever.** Promise 12 months of updates max. After that, charge for v2.
- **Don't gate the free PDF behind a hard signup.** Single email field. No name, no company, no "tell us about yourself." Friction kills conversion.
