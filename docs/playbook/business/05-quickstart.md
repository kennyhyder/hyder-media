# Quickstart — ship the product in one weekend

If you want to skip the deliberation and just ship, here's the minimum-viable path. Two days, ~16 hours of work, your playbook is for sale by Sunday night.

## Saturday morning (4 hours)

### 9:00 — Polish the playbook PDF (1.5h)

```bash
cd docs/playbook
# Generate the full PDF
pandoc 00-playbook.md -o playbook-v1.0.pdf \
  --pdf-engine=xelatex \
  --variable=geometry:margin=1in \
  --variable=mainfont:"Charter" \
  --variable=monofont:"JetBrains Mono" \
  --variable=colorlinks:true \
  --toc --toc-depth=2 \
  --metadata title="The Modern AI-Discoverable SaaS Launch Playbook" \
  --metadata author="Kenny Hyder · Hyder Media" \
  --metadata date="May 2026"
```

Skim the PDF. Fix any rendering issues (page breaks in weird places, code overflow). Re-export.

### 10:30 — Generate the free intro PDF (1h)

Create a `00-playbook-intro.md` that includes:
- Foreword
- §1 (5-layer model)
- Three named patterns from §8 (pick the three most viscerally relatable: 8.1 Stripe newline, 8.3 gtag race, 8.5 slug collision)
- §11 closing

Export to `playbook-intro-v1.0.pdf` using the same pandoc command. Should land at 5-7 pages.

### 11:30 — Bundle the templates (30min)

```bash
mkdir -p /tmp/playbook-bundle
cp playbook-v1.0.pdf /tmp/playbook-bundle/
cp -r templates /tmp/playbook-bundle/
cp SKILL.md /tmp/playbook-bundle/
cp README.md /tmp/playbook-bundle/

cd /tmp
zip -r playbook-bundle-v1.0.zip playbook-bundle/
```

That's your $79 product file.

### 12:00 — Lunch

## Saturday afternoon (4 hours)

### 13:00 — Set up Lemon Squeezy (1h)

1. https://www.lemonsqueezy.com → Sign up
2. Create store: "Hyder Media"
3. Create product: "Modern AI-Discoverable SaaS Launch Playbook"
4. Upload `playbook-bundle-v1.0.zip` as the digital file
5. Set price: $79
6. Description: paste sections 3-4 of `business/03-landing-page.md`
7. Cover image: design a simple 1200×630 cover in Figma/Canva (use your brand colors, big bold title text)
8. Publish

You now have a checkout URL like `https://yourstore.lemonsqueezy.com/buy/uuid-here`. Save it.

### 14:00 — Set up the landing page (2h)

Build `hyder.me/playbook` using `business/03-landing-page.md` as the source.

If your hyder.me is built on Next.js / Astro / your existing static site, add a new page. Use the structure from the landing-page doc verbatim — every section, every annotation reflects on the structure.

The two CTAs:
- "Get the free intro" → opens a Lemon Squeezy email-capture form OR submits to your ConvertKit list (with the PDF as a delivery email)
- "Buy the playbook — $79" → links to the Lemon Squeezy checkout URL

### 16:00 — Set up the free PDF email delivery (1h)

In ConvertKit (or Mailerlite):

1. Create a form: "Playbook intro download"
2. After submit, the user gets an email with the free PDF attached + a CTA to upgrade to $79
3. Create the Day 0 / Day 2 / Day 5 / Day 9 / Day 14 drip sequence (use `business/02-checkout-tech.md` outline)

### 17:00 — Take a break. You're past the hardest part.

## Sunday morning (4 hours)

### 9:00 — Test the full funnel (1h)

Use a fresh email address:
1. Visit hyder.me/playbook
2. Submit the free PDF form → does the email arrive within 30s? Does it have the PDF attached?
3. Click "Buy" → does Lemon Squeezy checkout open with the right price?
4. Buy the playbook (you can refund yourself after)
5. Verify the download link in the post-purchase email works
6. Verify Day 0 of the drip arrives in your inbox

If anything broken, fix before continuing.

### 10:00 — Set up DFY landing page (1.5h)

Build `hyder.me/services/launch`.

Content:
- Hero: "Done-for-you Modern SaaS Launch — 2 weeks, $3,500"
- "What you get" (use `business/01-product-tiers.md` Tier 3 deliverables)
- Calendly embed for the "Is this engagement right?" 20-min call
- One-paragraph "About Kenny" with link to the free playbook
- Testimonial slot (empty for now; fill after first 3 engagements)

### 11:30 — Connect Calendly (30min)

1. Calendly account → new event type: "Modern SaaS Launch — Fit Check" (20 min, Zoom)
2. Limit to 3 slots per week (you don't want to fill your calendar with discovery calls)
3. Add pre-call questions: "What product are you launching?" / "Where are you in the build?" / "Anything specific you want to discuss?"
4. Embed on `/services/launch`

### 12:00 — Lunch

## Sunday afternoon (4 hours)

### 13:00 — Draft launch content (2h)

Using `business/04-launch-the-playbook-itself.md` as your guide, draft:

- X thread (8 tweets)
- LinkedIn post
- Bluesky thread
- Show HN submission + first comment
- Reddit posts for r/SaaS, r/IndieHackers, r/EntrepreneurRideAlong

Save them all in a doc. Don't post yet.

### 15:00 — Schedule the launch (1h)

Pick your launch day. Recommended: next Tuesday or Wednesday at 11am ET / 8am PT.

Schedule:
- X thread (via Twitter / X scheduling)
- LinkedIn post (via Buffer or directly in LinkedIn)
- Bluesky thread (manual at launch time — Bluesky scheduling is limited)
- Email blast to your existing list (via ConvertKit, scheduled)

Show HN and Reddit posts have to be manual at the time of launch (no scheduling allowed).

### 16:00 — Prep your launch-day notes

Create a single launch-day Google Doc with:
- The launch tweet thread (in case scheduling fails)
- LinkedIn post
- Show HN title + URL + body + first comment
- Reddit post variants
- 5 journalist names + emails + personalized pitches
- Calendly availability for any inbound DFY calls

### 17:00 — Done

You have shipped a product. The funnel is tested. Launch day is scheduled. The asset is for sale.

## Monday morning — pre-launch sanity check

- [ ] Lemon Squeezy: test purchase still works
- [ ] Landing page loads + no broken links
- [ ] Free PDF download triggers email
- [ ] Drip emails are scheduled correctly
- [ ] Calendly slots available

## Tuesday (launch day)

Follow `04-launch-the-playbook-itself.md` minute-by-minute schedule.

---

## What this skips

This quickstart skips:
- Polished design (use a clean template from your existing site; perfection later)
- A/B testing (no traffic to test against yet)
- Custom checkout on Stripe (Lemon Squeezy is fine until you hit $5k/mo)
- Affiliate program (set up later if there's demand)
- Multiple language translations (English-only is fine for v1)
- A YouTube video version of the playbook (later)

These all matter eventually. They don't matter for shipping.

## What this gets right

- Functional funnel from cold visitor → email captured → $79 buyer → DFY lead
- Both tiers (free + paid) tested before announcing publicly
- Launch content prepped so launch day is execution, not creation
- Realistic 2-day timeline that fits a weekend

Ship by Sunday night. Iterate based on what happens Tuesday.
