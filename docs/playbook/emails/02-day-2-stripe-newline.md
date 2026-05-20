From: Kenny Hyder <kenny@hyder.me>
Subject: The bug that broke every Stripe call (and how to spot it)

Quick story.

I shipped a SaaS that had Stripe Checkout working in dev for weeks. Hours after launch, every paid signup failed with this error:

  "An error occurred with our connection to Stripe. Request was retried 2 times."

I checked Stripe status. Green. I checked the network from my Vercel function. Fine. I rotated keys. Same error. Spent hours.

The actual cause: when I had originally set the STRIPE_SECRET_KEY env var, I'd piped it from `echo`. Echo's default is to add a trailing newline character. That newline got stored as part of the env value.

When the Stripe Node SDK constructed the Authorization header, it stuck `sk_live_...wn\n` into it. The embedded newline corrupted the HTTP header before it ever left my server. Stripe's API never got the request. The SDK retried twice, gave up, threw a misleading "connection error".

Two rules I now apply on every project:

1. Set env vars with `printf %s "value" | <cli> env add NAME prod`. Never `echo`.
2. In code, `.trim()` every env var read defensively:

  const key = process.env.STRIPE_SECRET_KEY?.trim();

The trim costs nothing. The defensive layer means I never have to debug a 4-hour ghost again.

This is pattern §8.1 in the full playbook. There are 11 more like it. Each one is a named bug from real production code, organized by symptom so you can grep when something goes wrong.

If your future-self would thank you for never hitting this kind of trap again:

https://hyder.me/playbook?utm_source=drip&utm_medium=email&utm_campaign=playbook-intro&utm_content=day-2-pattern-bait

—Kenny
