#!/usr/bin/env python3
"""Build the initial PageWheel launch campaign import CSV for Google Ads Editor.

Output: pagewheel-campaign-import-2026-07-22.csv (upload via Ads Editor > Account > Import)
Campaign uploads PAUSED — review in Editor preview, then enable to launch.

Conventions matched to the live Digistore24 account (246-624-6400):
- Campaign naming: pipe-delimited, "PageWheel" prefix to sort apart from DS24 campaigns
- UTM: final URL carries utm_source/medium/campaign; campaign Final URL suffix
  appends utm_content={_adgroup}; each ad group sets {_adgroup}=<slug>
- Manual CPC (Enhanced CPC disabled), Google search only, English, United States
- RSA: 15 headlines (H1 pinned to position 1), 4 descriptions, path1/path2
"""
import csv, sys

CAMPAIGN = 'PageWheel | Nonbrand | AI Pages | US'
BUDGET = '500.00'
FINAL_URL = ('https://experience.digistore24.com/pagewheel-ai-page-builder'
             '?utm_source=google&utm_medium=cpc&utm_campaign=pagewheel')
URL_SUFFIX = 'utm_content={_adgroup}'
PATH1, PATH2 = 'pagewheel', 'free-trial'

# ---------------------------------------------------------------- ad groups
# (name, slug, default max CPC, [(keyword, match, kw-level bid or None)])
AD_GROUPS = [
    ('AI Page Builder', 'ai-page-builder', '4.00', [
        ('ai page builder', 'Phrase', None),
        ('ai page builder', 'Exact', None),
        ('ai landing page builder', 'Phrase', None),
        ('ai landing page builder', 'Exact', None),
        ('ai landing pages', 'Phrase', None),
        ('ai website page builder', 'Phrase', None),
        ('ai landing page generator', 'Phrase', None),
        ('ai landing page design', 'Phrase', None),
        ('ai page creator', 'Phrase', None),
        ('ai sales page builder', 'Phrase', None),
        ('ai funnel builder', 'Phrase', None),
    ]),
    ('Sales Page & Funnel Builder', 'sales-page-funnels', '4.00', [
        ('sales page builder', 'Phrase', None),
        ('sales page creator', 'Phrase', None),
        ('create a sales page', 'Phrase', None),
        ('sales page templates', 'Phrase', None),
        ('sales page', 'Exact', None),
        ('funnel builder', 'Phrase', '4.50'),
        ('marketing funnel builder', 'Phrase', None),
        ('funnel builder software', 'Phrase', None),
        ('cheap funnel builder', 'Phrase', None),
        ('easy funnel builder', 'Phrase', None),
        ('simple funnel builder', 'Phrase', None),
    ]),
    ('Ebook Creator', 'ebook-creator', '2.50', [
        ('ebook creator', 'Phrase', None),
        ('ebook creator', 'Exact', None),
        ('ebook maker', 'Phrase', None),
        ('create an ebook', 'Phrase', None),
        ('make an ebook', 'Phrase', None),
        ('ebook generator', 'Phrase', None),
        ('ebook builder', 'Phrase', None),
        ('ai ebook creator', 'Phrase', None),
        ('ai ebook generator', 'Phrase', None),
        ('how to create an ebook', 'Phrase', None),
    ]),
    ('Landing Page Builder', 'landing-page-builder', '4.00', [
        ('landing page builder', 'Exact', '4.50'),
        ('best landing page builder', 'Exact', '4.50'),
        ('easy landing page builder', 'Phrase', None),
        ('cheap landing page builder', 'Phrase', None),
        ('simple landing page builder', 'Phrase', None),
        ('no code landing page builder', 'Phrase', None),
        ('drag and drop landing page builder', 'Phrase', None),
        ('landing page creator', 'Phrase', None),
        ('landing page maker', 'Phrase', None),
        ('landing page builder tool', 'Phrase', None),
        ('landing page generator', 'Phrase', None),
        ('free landing page builder', 'Phrase', '3.00'),
    ]),
    ('Lead Magnet Pages', 'lead-magnet-pages', '3.50', [
        ('lead magnet funnel', 'Phrase', None),
        ('lead magnet landing page', 'Phrase', None),
        ('lead magnet templates', 'Phrase', None),
        ('lead magnet creator', 'Phrase', None),
        ('lead magnet generator', 'Phrase', None),
        ('create a lead magnet', 'Phrase', None),
        ('freebie lead magnet', 'Phrase', None),
        ('quiz lead magnet', 'Phrase', None),
    ]),
    ('One Page Website', 'one-page-website', '3.00', [
        ('one page website builder', 'Phrase', None),
        ('single page website builder', 'Phrase', None),
        ('one page website', 'Exact', None),
        ('single page website', 'Exact', None),
        ('one page website design', 'Phrase', None),
        ('build a one page website', 'Phrase', None),
    ]),
    ('Digital Product Creator', 'digital-product-creator', '2.50', [
        ('ai digital product creator', 'Phrase', None),
        ('digital product creator', 'Phrase', None),
        ('digital product generator', 'Phrase', None),
        ('digital product maker', 'Phrase', None),
        ('create digital products', 'Phrase', None),
        ('how to create a digital product', 'Phrase', None),
    ]),
]

# ---------------------------------------------------- campaign negatives
NEG_PHRASE = [
    # keep PageWheel and DS24 vendor campaigns from competing internally
    'sell digital products', 'sell ebooks', 'sell online courses', 'sell courses',
    'digital products marketplace', 'digistore24', 'digistore', 'clickbank',
    # platform-specific builder searches (they want plugins/features of that platform)
    'wix', 'wordpress', 'shopify', 'canva', 'hubspot', 'squarespace', 'webflow',
    'elementor', 'godaddy', 'figma', 'woocommerce', 'framer', 'durable', 'shogun',
    # competitor tool brands — reserved for a phase-2 competitors campaign
    'clickfunnels', 'click funnels', 'leadpages', 'kajabi', 'kartra',
    'gohighlevel', 'go high level', 'systeme', 'unbounce', 'instapage',
    'builderall', 'carrd', 'podia', 'thinkific', 'teachable', 'samcart', 'thrivecart',
    # low intent
    'jobs', 'salary', 'hiring', 'career', 'what is', 'examples', 'tutorial',
    'reddit', 'login', 'sign in', 'certification', 'certified',
]

# ---------------------------------------------------------------- RSA copy
COMMON_HEADLINES = [
    'AI Builds Your Page in Minutes',
    '7-Day Free Trial — $0 Today',
    'Just $47/Mo After Free Trial',
    'AI Writes Your Sales Copy',
    'No Tech Skills Required',
    'Unlimited Pages & Funnels',
    '30+ Proven Templates Included',
    'Stripe Checkout Built In',
    'Hosting & SSL Included',
    'Cancel Anytime in 1 Click',
    'Replace 5 Tools With One',
    '30-Day Money-Back Guarantee',
    'Live in Under 2 Minutes',
    'Trusted by 5,000+ Creators',
]
GROUP_H1 = {
    'AI Page Builder': 'AI Page Builder — Try It Free',
    'Sales Page & Funnel Builder': 'Build a Sales Page With AI',
    'Ebook Creator': 'Create Your Ebook With AI',
    'Landing Page Builder': 'Easy Landing Page Builder',
    'Lead Magnet Pages': 'Build Lead Magnets With AI',
    'One Page Website': 'One-Page Site, Built by AI',
    'Digital Product Creator': 'Create Digital Products Fast',
}
DESCRIPTIONS = [
    "Describe your product in one sentence. Pagewheel's AI writes the copy & builds your page.",
    'Unlimited sales pages, funnels & hosting. Try it free for 7 days, then just $47/month.',
    'Stop paying for 5 tools — pages, funnels, checkout, emails & hosting in one platform.',
    'No design or tech skills needed. 30+ templates, Stripe checkout & instant delivery.',
]
CALLOUTS = ['7-Day Free Trial', 'AI-Generated Pages', 'No Tech Skills Needed',
            'Cancel Anytime', '30+ Page Templates', 'Unlimited Pages']
SNIPPET_HEADER = 'Features'
SNIPPET_VALUES = ['AI Page Builder', 'Sales Funnels', 'Ebook Creator',
                  'Stripe Checkout', 'Email Delivery', 'Page Templates']

# ------------------------------------------------------------- validation
errors = []
for ag, h1 in GROUP_H1.items():
    if len(h1) > 30: errors.append(f'H1 too long ({len(h1)}): {h1}')
for h in COMMON_HEADLINES:
    if len(h) > 30: errors.append(f'Headline too long ({len(h)}): {h}')
for d in DESCRIPTIONS:
    if len(d) > 90: errors.append(f'Description too long ({len(d)}): {d}')
for p in (PATH1, PATH2):
    if len(p) > 15: errors.append(f'Path too long: {p}')
for c in CALLOUTS:
    if len(c) > 25: errors.append(f'Callout too long ({len(c)}): {c}')
for s in SNIPPET_VALUES:
    if len(s) > 25: errors.append(f'Snippet value too long ({len(s)}): {s}')
if errors:
    sys.exit('VALIDATION FAILED:\n' + '\n'.join(errors))

# ------------------------------------------------------------- CSV build
COLS = ['Campaign', 'Campaign Type', 'Networks', 'Budget', 'Budget type',
        'Languages', 'Bid Strategy Type', 'Enhanced CPC', 'Broad match keywords',
        'Location', 'Final URL suffix', 'Ad Group', 'Max CPC', 'Custom parameters',
        'Keyword', 'Criterion Type', 'Ad type', 'Final URL', 'Path 1', 'Path 2'] \
    + [x for i in range(1, 16) for x in (f'Headline {i}', f'Headline {i} position')] \
    + [x for i in range(1, 5) for x in (f'Description {i}',)] \
    + ['Callout text', 'Header', 'Snippet Values',
       'Campaign Status', 'Ad Group Status', 'Status']

rows = []
def row(**kw):
    r = {c: '' for c in COLS}
    r.update(kw)
    rows.append(r)

# campaign (PAUSED for safe preview/launch control)
row(**{'Campaign': CAMPAIGN, 'Campaign Type': 'Search',
       'Networks': 'Google search', 'Budget': BUDGET, 'Budget type': 'Daily',
       'Languages': 'en', 'Bid Strategy Type': 'Manual CPC',
       'Enhanced CPC': 'Disabled', 'Broad match keywords': 'Off',
       'Final URL suffix': URL_SUFFIX, 'Campaign Status': 'Paused'})
# geo target
row(**{'Campaign': CAMPAIGN, 'Location': 'United States'})
# campaign negatives
for neg in NEG_PHRASE:
    row(**{'Campaign': CAMPAIGN, 'Keyword': neg,
           'Criterion Type': 'Campaign Negative Phrase', 'Status': 'Enabled'})
# campaign-level callouts + structured snippet (override DS24 account-level assets)
for c in CALLOUTS:
    row(**{'Campaign': CAMPAIGN, 'Callout text': c, 'Status': 'Enabled'})
row(**{'Campaign': CAMPAIGN, 'Header': SNIPPET_HEADER,
       'Snippet Values': '\n'.join(SNIPPET_VALUES), 'Status': 'Enabled'})

for name, slug, cpc, kws in AD_GROUPS:
    row(**{'Campaign': CAMPAIGN, 'Ad Group': name, 'Max CPC': cpc,
           'Custom parameters': '{_adgroup}=' + slug, 'Ad Group Status': 'Enabled'})
    for kw, match, bid in kws:
        row(**{'Campaign': CAMPAIGN, 'Ad Group': name, 'Keyword': kw,
               'Criterion Type': match, 'Max CPC': bid or '', 'Status': 'Enabled'})
    ad = {'Campaign': CAMPAIGN, 'Ad Group': name,
          'Ad type': 'Responsive search ad', 'Final URL': FINAL_URL,
          'Path 1': PATH1, 'Path 2': PATH2, 'Status': 'Enabled'}
    heads = [GROUP_H1[name]] + COMMON_HEADLINES
    for i, h in enumerate(heads, 1):
        ad[f'Headline {i}'] = h
        ad[f'Headline {i} position'] = '1' if i == 1 else ''
    for i, d in enumerate(DESCRIPTIONS, 1):
        ad[f'Description {i}'] = d
    row(**ad)

out = 'pagewheel-campaign-import-2026-07-22.csv'
with open(out, 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=COLS)
    w.writeheader()
    w.writerows(rows)

nk = sum(len(k) for _, _, _, k in AD_GROUPS)
print(f'Wrote {out}: {len(rows)} rows — 1 campaign, {len(AD_GROUPS)} ad groups, '
      f'{nk} keywords, {len(NEG_PHRASE)} campaign negatives, {len(AD_GROUPS)} RSAs, '
      f'{len(CALLOUTS)} callouts, 1 snippet.')
