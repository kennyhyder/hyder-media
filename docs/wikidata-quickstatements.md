# Wikidata QuickStatements batch for Q139814938 (SportsBookISH)

QuickStatements is the official Wikidata bulk-edit tool. You paste this script into it, sign in with your Wikidata account, and it applies every edit in one batch with proper audit trail.

## How to run

1. Open <https://quickstatements.toolforge.org/#/batch>
2. Sign in (top right) — uses your Wikidata account, OAuth handshake
3. Paste the **V1 commands** block below into the textarea
4. Click **Import V1 commands**
5. Click **Run** on the next screen

The whole batch should run in <60 seconds. Watch the green/red rows scroll past — green = applied, red = error (usually because a Q-ID can't be resolved, see notes below the script).

## V1 commands (copy everything below this line)

```
# Remove the wrong P31 claim (Q3406134 = "date of establishment", not a class)
-Q139814938	P31	Q3406134

# Remove the questionable copyright license claim (unless you actually CC-BY-4.0 license the entire site, which most SaaS products don't)
-Q139814938	P275	Q20007257

# Add a more specific instance-of: web application (alongside the existing Q35127 = website)
Q139814938	P31	Q1668024

# Inception date — when SportsBookISH launched
Q139814938	P571	+2026-05-12T00:00:00Z/11

# Short name
Q139814938	P1813	en:"SportsBookISH"

# Official X / Twitter username
Q139814938	P2002	"sportsbookish"

# Link to related entities — Kalshi, Polymarket, prediction market concept
Q139814938	P527	Q114586938	# has part: Kalshi data
Q139814938	P527	Q123502863	# has part: Polymarket data

# Multilingual labels (just the product name in each language)
Lfr	Q139814938	"SportsBookISH"
Lde	Q139814938	"SportsBookISH"
Les	Q139814938	"SportsBookISH"
Lit	Q139814938	"SportsBookISH"
Lpt	Q139814938	"SportsBookISH"
Lnl	Q139814938	"SportsBookISH"
Lja	Q139814938	"SportsBookISH"
Lko	Q139814938	"SportsBookISH"
Lzh	Q139814938	"SportsBookISH"
Lru	Q139814938	"СпортсБукИш"

# Multilingual descriptions
Dfr	Q139814938	"Plateforme de comparaison des cotes sportives (Kalshi vs sportsbooks américains)"
Dde	Q139814938	"Sportwetten-Quotenvergleichsplattform (Kalshi vs US-Buchmacher)"
Des	Q139814938	"Plataforma de comparación de cuotas deportivas (Kalshi vs casas de apuestas EE.UU.)"
Dit	Q139814938	"Piattaforma di confronto quote sportive (Kalshi vs scommesse USA)"
Dpt	Q139814938	"Plataforma de comparação de odds esportivas (Kalshi vs apostas EUA)"

# Additional English aliases (each line adds one alias)
Aen	Q139814938	"Kalshi odds tracker"
Aen	Q139814938	"Kalshi vs sportsbooks"
Aen	Q139814938	"Kalshi event contract odds"
Aen	Q139814938	"no-vig sportsbook comparison"
Aen	Q139814938	"Kalshi vs DraftKings"
Aen	Q139814938	"Kalshi vs FanDuel"
Aen	Q139814938	"Kalshi odds comparison"
Aen	Q139814938	"event contract odds tracker"
```

## Verification after running

After the batch runs, visit <https://www.wikidata.org/wiki/Q139814938> and confirm:

- ✅ Two `P31` statements: `website` (Q35127) AND `web application` (Q1668024)
- ❌ No more `P31` claim of `date of establishment`
- ❌ No more `P275` copyright license claim
- ✅ `P571` inception = May 12, 2026
- ✅ `P1813` short name = SportsBookISH
- ✅ `P2002` X username = sportsbookish
- ✅ Labels in 10 languages
- ✅ 8 English aliases

## What's intentionally NOT in this batch (do these manually)

These three need new Q-IDs created first, which QuickStatements can't do (it can only edit existing items):

1. **`P112` founded by → "Kenny Hyder"**
   Search Wikidata for "Kenny Hyder". If a Q-ID exists, add the P112 claim manually (Edit → Add statement → P112 → that Q-ID).
   If no Q-ID exists, the bar for creating a person item on Wikidata is "verifiable notability" — usually a media mention or independent source. If you have a press feature or interview anywhere, you can create the item and link it. Otherwise leave it.

2. **`P127` owned by → "Hyder Media"**
   Same — search for Hyder Media as an organization. If no Q-ID, you can create one with at least: P31=Q4830453 (business), P17=Q30 (United States), official website, and one independent source.

3. **`P154` logo**
   Upload `https://sportsbookish.com/logo-1024.png` to Wikimedia Commons (<https://commons.wikimedia.org/wiki/Special:UploadWizard>) under your own work with CC-BY-4.0. Then add P154 pointing to that Commons filename. Roughly 5 min once you're logged into Commons.

## What to do if a line errors out

Common QuickStatements errors and fixes:

- **"Constraint violation"** on `P31 Q1668024` — means Wikidata thinks "web application" isn't a valid instance-of for the existing claims. Skip the line, fall back to keeping just Q35127 (website).
- **"Duplicate label"** on a multilingual label line — means that language already has the same label. Safe to ignore.
- **"Date precision"** error on the inception statement — change `/11` (day precision) to `/10` (month) or `/9` (year) if needed.

## Related: linking your other entities

Once Q-IDs exist for Kenny Hyder + Hyder Media, you can also run these reciprocal links:

```
# On the Kenny Hyder item:
Q<KENNY>	P800	Q139814938	# notable work: SportsBookISH

# On the Hyder Media item:
Q<HM>	P1830	Q139814938	# owner of: SportsBookISH
```

Cross-linked entities help LLMs build the relationship graph more confidently.
