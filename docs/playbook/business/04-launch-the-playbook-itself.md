# Launch sequence — for the playbook itself

The playbook teaches you how to launch SaaS. The playbook itself is also a launch. Apply your own medicine.

## Pre-launch week (do before you tweet anything)

### Day -7 to -5: Set up the funnel

- [ ] Hyder.me landing page live at `/playbook` (use `business/03-landing-page.md`)
- [ ] Free intro PDF exported from `00-playbook.md` (5-page condensed version)
- [ ] $79 product live on Lemon Squeezy (use `business/02-checkout-tech.md`)
- [ ] DFY engagement page at `/services/launch` with Calendly link
- [ ] ConvertKit / Mailerlite account with the 5-email drip sequence loaded

### Day -4 to -3: Test the funnel

- [ ] Submit your own email through the free PDF form → does it arrive? Does the drip start?
- [ ] Buy your own $79 product (refund yourself after) → does the download link work? Does Lemon Squeezy handle EU VAT correctly?
- [ ] Book your own Calendly slot → does it land in your calendar with the right Zoom link?

### Day -2: Pre-warm

- [ ] Add `/playbook` URLs to your sitemap and resubmit in Search Console
- [ ] Fire IndexNow at hyder.me/playbook + the sub-pages
- [ ] Reach out to 3-5 friends/peers asking if they'd review the playbook in exchange for a free copy + feedback by email. (Don't ask for public testimonials — just feedback. Public testimonials come later.)

### Day -1: Final polish

- [ ] Double-check the Stripe webhook is configured correctly (test event from dashboard)
- [ ] Test the LinkedIn / X / Bluesky posts pre-scheduled for launch day
- [ ] Email the 3-5 reviewers asking them to be ready to share their honest reaction on launch day

## Launch day

The order matters. Don't broadcast publicly until your funnel is verified working with at least 1-2 real (friendly) buyers.

### 8:00 AM HST / 11:00 AM PT / 2:00 PM ET

- [ ] X thread (use `docs/launch/01-x-thread.md` as a template — adapt for the playbook). Pin the thread.
- [ ] LinkedIn long-form post. Personal profile. Link in first comment.
- [ ] Bluesky thread.
- [ ] Email your existing newsletter / client list (whatever audience you have, even if it's 50 people). Don't BCC — use proper newsletter tool.

### 10:00 AM PT (peak Show HN window)

- [ ] Show HN submission: "Show HN: The AI-Discoverable SaaS Launch Playbook"
- [ ] First-comment within 10 min (use the pattern from `docs/launch/04-show-hn.md` — adapt)

### Throughout the day

- [ ] Reply to every comment/DM within 30 min for the first 8 hours. Engagement signals matter on every platform.
- [ ] When someone buys, send a personal thank-you DM (not a templated email — actually personal). They become testimonial-eligible later.

### Evening

- [ ] Reddit posts (stagger across r/SaaS, r/IndieHackers, r/marketing, r/EntrepreneurRideAlong). Each with a different framing.

## Week 1 after launch

### Days 2-3: Press push

- [ ] Pitch 5 journalists who cover SaaS / dev tools / marketing. Use the template in `docs/launch/07-journalist-pitches.md`.
- [ ] Targets:
  - Indie Hackers (Courtland Allen if he still writes)
  - Pavilion / RevGenius newsletters
  - SaaStr blog editors
  - A relevant Substack newsletter (Lenny's Newsletter if you can land it; smaller B2B writers as backup)

### Days 4-7: Podcast pitching

The playbook is podcast-bait. "I shipped a SaaS and documented every optimization" is a great hook for:

- Indie Hackers podcast
- The Founder Hour
- Build Your SaaS
- Default Alive
- Smaller niche pods (the listenership conversion is higher than mega-pods)

Pitch 10 podcasts with personalized DMs/emails. Expect 1-2 yeses. Each yes is worth ~$5k-15k in downstream business.

## Week 2-4

### Compound the launch

- [ ] Cross-post the playbook (with canonical link back to hyder.me) on:
  - Medium (gated by their algo, but big SEO surface)
  - Substack as a paywalled post → free preview, paid full
  - Hacker Noon, Dev.to (developer audience)
- [ ] Write 3 short blog posts on hyder.me that expand on specific defensive patterns:
  - "The Stripe newline bug we hit on production"
  - "Why I switched from 308 to 307 redirects everywhere"
  - "GA4's gtag race condition and how to bypass it"
  Each links back to the playbook. Each ranks for long-tail technical queries.

### Speak at one event

If you have any speaking opportunities (local meetups, virtual conferences, podcast guest spots), use the playbook as your hook. Even a 50-person local meetup is worth doing — talks get recorded, the recording lives on YouTube forever.

## Month 2-3

### Iterate based on signal

- Look at what people are buying ($79 vs free PDF download rate)
- Look at where DFY inquiries come from (which channel?)
- Double down on what works; cut what doesn't
- Update the playbook with new patterns you encounter on real projects

### Build the next thing

A playbook is the start of a content series. Branch:

- **Industry-specific playbooks:** "The AI-Discoverable SaaS Playbook for B2B Tools" / "...for Consumer Apps" / "...for Marketplaces"
- **Tool-specific deep-dives:** "Wikidata for Founders: The 30-Day Setup Guide" / "JSON-LD Cookbook"
- **Updated annual edition:** Every May, ship a v2 with new patterns discovered in the prior year

Each new asset compounds with the original playbook. Bundle them at higher price points.

## Honest expected outcomes

If you do all of this aggressively:

**Week 1:**
- 500-2,000 free PDF downloads
- 10-30 paid $79 sales
- 1-3 DFY inquiries → 1 booked engagement

**Month 1:**
- 2,000-5,000 free downloads (compounded from launch)
- 50-150 paid sales ($4k-12k revenue)
- 5-10 DFY inquiries → 2-4 booked engagements ($7k-20k revenue)

**Month 3:**
- 5,000-15,000 free downloads
- 100-400 paid sales total ($8k-32k cumulative)
- 15-30 DFY inquiries → 5-12 booked engagements ($17k-60k cumulative)

**Year 1 total: $50k-150k direct revenue, plus 5-15 consulting clients that mention reading the playbook (additional $50k-200k attributed).**

If you do nothing (just publish the PDF on hyder.me and don't promote): expect 200-500 organic downloads via SEO over 12 months. Maybe 5-10 paid sales. The playbook works as a credibility asset for your existing consulting business but won't generate meaningful direct revenue.

**Promotion is what determines the outcome, not the asset quality.**

## What to do if launch underperforms

If after 2 weeks you have <100 free downloads and <5 paid sales:

1. **Don't blame the product.** The playbook is solid. The problem is distribution.
2. **Audit each channel.** Where did your traffic actually come from? Look in GA4.
3. **Re-pitch with sharper hook.** "The 12 named bugs that cost me real launches" might convert better than "AI-discoverable SaaS playbook." Test 3-5 hooks.
4. **Buy ads for one week.** Spend $200 on Twitter Ads + $200 on LinkedIn Ads targeting "indie hackers" / "SaaS founder" interest groups. See if paid traffic converts. If yes, scale.
5. **Cold-pitch 50 newsletter operators.** Offer them a free copy + first-look exclusive in exchange for a mention in their next issue.

The playbook itself is correct. The work is in getting it in front of the right people.
