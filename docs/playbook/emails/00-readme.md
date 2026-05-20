# Drip email sequence — playbook lead magnet

5 emails over 14 days for subscribers who download the free intro PDF.

| File | When | Subject | Goal |
|---|---|---|---|
| `01-day-0-instant.md` | Within 1 min of signup | Your free playbook + a quick note | Deliver the PDF; soft trust-building |
| `02-day-2-stripe-newline.md` | Day 2 | The bug that broke every Stripe call (and how to spot it) | Demonstrate depth; hook them into reading more |
| `03-day-5-upsell-paid.md` | Day 5 | When the free version isn't enough | Soft pitch the $79 tier |
| `04-day-9-upsell-dfy.md` | Day 9 | When you don't want to do it yourself | Soft pitch the DFY engagement |
| `05-day-14-last-call.md` | Day 14 | Last reminder, then I'll stop | Final conversion push; close the sequence |

## Voice + format guidelines

- **Plain text only.** No HTML templates. Looks like a personal email from Kenny, not a marketing blast.
- **From: Kenny Hyder \<kenny@hyder.me\>** (not "newsletter@" or "hello@"). Replies should land in Kenny's actual inbox.
- **Subject lines are sentence-case, lowercase first word.** "Your free playbook + a quick note", not "YOUR FREE PLAYBOOK + A QUICK NOTE" or "Your Free Playbook + A Quick Note".
- **Sign each one with just "—Kenny"** at the bottom. No formal sig block (the from-name carries it).
- **Length: 150-300 words each.** Nobody reads long marketing emails. Each one makes one point and stops.
- **One link per email** (with UTM tags so you can attribute conversions in GA4). Two links if absolutely needed; never three.
- **No images.** Plain-text-only delivers faster, doesn't trigger spam filters, and reads as personal.

## UTM convention

All links from drip emails use:

```
?utm_source=drip&utm_medium=email&utm_campaign=playbook-intro&utm_content=day-{N}-{purpose}
```

E.g. `?utm_source=drip&utm_medium=email&utm_campaign=playbook-intro&utm_content=day-5-paid-upsell`

This lets you see in GA4 which specific email drove a $79 conversion vs which drove a DFY inquiry.

## Tools

Set up in ConvertKit (recommended) or Mailerlite:

1. Create a sequence called "Playbook intro drip"
2. Add 5 emails per the spec below, each as a separate step in the sequence
3. Trigger: subscriber gets the "playbook-intro" tag (set when they submit the form on /playbook)
4. Day 0 is "instant" (no delay), Day 2-14 use the "wait N days" delay step

After day 14, subscribers stay on your "Hyder Media — engaged" list but don't get more playbook-specific emails. If you have a quarterly newsletter, they roll into that.

## What to expect

Open rate benchmarks for cold-list drip sequences:

- Day 0 (instant delivery): 60-80% open (high — they JUST signed up)
- Day 2 (one-day gap): 35-50% open
- Day 5 (three-day gap): 25-40% open
- Day 9: 18-30% open
- Day 14: 12-25% open

Click rates: 5-12% per email is the band for premium B2B audiences.

Conversion to $79 tier: 1-3% over the full sequence is solid for a $79 product. Higher if you have an existing audience that knows you.

Conversion to DFY ($2,500+): much rarer (0.1-0.5% conversion) but each one is worth 30+ $79 sales, so still the highest-revenue path.
