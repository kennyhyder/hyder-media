# The Modern AI-Discoverable SaaS Playbook

The vendor-agnostic playbook Hyder Media uses on every web product we ship. Every optimization, every defensive pattern, every checklist. Reusable on any project.

## Structure

- **`00-playbook.md`** — The full long-form playbook. Read this end-to-end the first time. Reference specific sections after.
- **`SKILL.md`** — Claude skill manifest. Invoke when starting a new SaaS / web project; tells Claude what to apply.
- **`checklists/`** — Pull-out checklists that the playbook references.
- **`patterns/`** — Defensive engineering patterns with exact code.
- **`templates/`** — Ready-to-paste templates (llms.txt, JSON-LD blocks, OpenAPI skeleton, etc.).
- **`publish/`** — Instructions for converting to PDF and publishing on hyder.me.
- **`business/`** — Monetization options, pricing, landing-page copy, and a launch sequence for the playbook itself as a product.

## Three ways to use this

1. **As a Claude skill** — drop `SKILL.md` into `~/.claude/skills/saas-launch-playbook/SKILL.md` (or your project's `.claude/skills/`). Invoke with `/saas-launch-playbook` to have Claude apply the patterns to the project you're building.
2. **As a PDF for clients / sharing** — see `publish/pdf.md` for the export recipe.
3. **As a marketing publication on hyder.me** — see `publish/website.md` for the canonical URL structure and JSON-LD.

## Quick reference

| Topic | Playbook section |
|---|---|
| Pre-flight: domain, DNS, GA4, Search Console, Bing WMT, email auth | §0 |
| Wikidata + llms.txt + JSON-LD identity | §3 |
| Per-page SEO schemas + OpenAPI for LLM tool calling | §4 |
| CSP, headers, RLS, secret management | §5 |
| GA4 events without webhook races | §6 |
| Launch distribution (10 channels, ranked) | §7 |
| Defensive patterns (12 named bugs by symptom) | §8 |
| Pre-launch / weekly / recovery checklists | §9 |
