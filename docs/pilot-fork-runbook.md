# Pilot Fork Runbook — launching board #2 from this template

> Phase 3 of docs/templatization-plan.md. Phases 0–2 made the code ready;
> this runbook is the operational sequence for the first real fork. The
> pilot's purpose is dual: launch a board AND harden the template — every
> leak or friction found here becomes a new guardrail test upstream.

## 0. Decisions you make before touching code

| Decision | Notes |
|---|---|
| Niche | Adjacent clinical niches (CRNA, PA, other NP specialties, dental) reuse the most: credential schema, healthcare ATS sources, extension matcher packs. |
| Domain + brand name | Needed for config/brand.ts, DNS, all account setup. |
| Legal entity | Same LLC or new one? Terms venue/descriptor come from brand.legal — a NEW entity needs counsel review of the ToS prose, not just config values. |
| Salary reality | Pull BLS/market data for the niche BEFORE tuning config/niche/salary.ts — wrong bands FABRICATE salaries (clamp-not-drop). |

## 1. Create the fork

```bash
# copy the template (keep this repo pristine as upstream)
git clone <template> <new-board> && cd <new-board>
git remote add upstream <template>   # infra updates: git fetch upstream && merge
```

## 2. Edit the declared surfaces (code-side, ~1–2 days)

Work through in this order; each is one file unless noted:

1. `config/brand.ts` — identity, legal, emails, socials, assets.storageBase,
   indexerUserAgent.
2. `config/niche/salary.ts` — every band, re-derived from niche pay data.
3. `config/niche/relevance.ts` — positive/negative keywords, context terms,
   employer patterns, dual-role/credential exceptions. Start STRICT.
4. `lib/pseo/taxonomy-registry.ts` + create matching `app/jobs/<slug>/`
   folders (copy an existing category folder as the shell; the drift test
   fails until registry == folders).
5. `lib/aggregators/search-terms/*.ts` — per-source query terms. Disable
   healthcare-only sources (doccafe, healthcareercenter) and USAJobs series
   code if not applicable; keep chunk math in sync (config/cron-schedule.ts
   → `npm run crons:generate`).
6. `lib/aggregators/tenants/*.ts` — seed lists. Day one: run broad sources
   (adzuna, fantastic-jobs-db, jsearch) only; mine rejected_jobs after 2–3
   weeks with scripts/discover-ats-tenants-from-db.ts to build ATS tenant
   lists.
7. `config/niche/copy.ts`, `stats.ts`, `content-map.ts`, `credentials.ts`,
   `regulatory.ts` — copy fragments, claims (EMPTY the fallback employers!),
   blog maps (must match your authored posts), credential taxonomy,
   regulatory module.
8. Guided rename of frozen namespaces (cookies/localStorage/Inngest id):
   safe at fork time ONLY because no users exist yet — grep `pmhnp_` and
   `pmhnp-job-board`; never do this on a live board.
9. Replace `/public` brand assets (logo, favicons, OG default, manifest,
   llms.txt/humans.txt/ai.txt regenerated with TRUE numbers — a new board
   has 0 jobs, don't ship inherited claims).

## 3. Content pack (the real cost, ~1–3 weeks, parallelizable with §4)

- ~28 category landing pages: keep structure, author niche copy + FAQs +
  salary claims per page.
- pSEO: category-tagger keyword rules, narrative phrase banks, FAQ
  generators, regenerated city-data columns (shortage/ratio equivalents),
  per-category imagery in YOUR bucket.
- Blog seed set: minimum the state-licensure series equivalent (the pSEO
  templates link it from every city page) + 5–10 core guides.
- Salary guide data + PDF lead magnet.
- AI eval fixtures (tests/ai/golden + bias) re-curated BEFORE enabling AI
  feature flags; leave flags OFF at launch otherwise.

## 4. Accounts & infrastructure (checklist)

Supabase project (DB + storage buckets + auth) · Vercel project + domain +
env vars · Stripe (products, webhook endpoint, statement descriptor =
brand.legal.stripeDescriptor) · Resend (domain verified, webhook secret) ·
Upstash Redis (per-board, don't share) · Inngest app · GSC + Bing +
IndexNow keys (set BOTH INDEXNOW_API_KEY and INDEXNOW_KEY) · VAPID pair ·
GitHub Actions secret PROD_DIRECT_DATABASE_URL (direct 5432, not pooler).

## 5. Validate before launch

```bash
npm run fork:preflight    # env/config/coherence/pack checks — zero FAILs
npm run crons:generate    # regenerate vercel.json crons from your source mix
npx vitest run            # all suites incl. drift guards + brand-leak ratchet
UPDATE_BRAND_LEAK_BASELINE=1 npx vitest run tests/regressions/brand-leak-ratchet.test.ts
npm run build
```

Then: `prisma migrate deploy` against the fresh DB (works end-to-end since
the Phase-0 baseline migrations), seed NOTHING (the seed script is for dev),
deploy, and run the smoke checks in docs/fork-checklist.md §9.

## 6. Post-launch tuning loop (first month)

Weekly: rejected_jobs funnel review → relevance pack adjustments (this is
where filter quality is actually earned); dead-link/health dashboards;
GSC coverage; deliverability (DMARC reports). Feed every template-level gap
you find back upstream as a PR + a new guardrail test.

## Known deliberately-deferred items (do not be surprised)

- Credential SCHEMA fields (npiNumber/deaNumber etc.), consent/redaction
  logic, and profile-completeness weights are still nursing-shaped —
  acceptable for clinical niches; non-clinical niches need the deeper
  refactor documented in docs/templatization-plan.md §4.
- lib/pseo content (narratives, FAQ generators, category-tagger rules) is
  authored TS per board, not config — by design (thin-content risk).
- Namespace prefixes are renamed at fork time (step 2.8), not runtime
  config — frozen forever after launch.
