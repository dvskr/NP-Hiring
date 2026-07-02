# Templatization Plan — Multi-Niche Job Board Template

> Produced from a full 13-agent codebase audit (2026-07-02, ~1,200 files read).
> Goal: turn this codebase into a template for launching multiple niche job boards
> with the same infrastructure and **zero downgrades** to quality, SEO, or compliance.

## STATUS (2026-07-02): Phases 0–2 COMPLETE · Phase 3 = runbook ready
- **Phase 0** done — repairs + centralization (brand config coverage, salary
  config, taxonomy registry, DB bootstrap migrations, brand-leak ratchet).
- **Phase 1** done — niche packs shipped under `config/niche/`: relevance.ts
  (all filter keyword data; engine untouched, 63 regression tests prove no-op),
  salary.ts, copy.ts, content-map.ts, stats.ts, credentials.ts, regulatory.ts
  (seam), plus completed `lib/aggregators/search-terms/` extraction (workday ×2,
  doccafe, healthcareercenter) and `brand.assets.storageBase` (943 asset URLs
  derive from one value). Deliberate deferrals, documented below: credential
  SCHEMA fields/consent logic (§4 credentials row), namespace prefixes (renamed
  at fork time — see pilot runbook §2.8, not runtime config), sources.ts (the
  aggregator registry is already pluggable; a separate pack added no value).
- **Phase 2** done — `npm run crons:generate` (vercel.json crons generated from
  config/cron-schedule.ts + chunk constants, drift-tested), `npm run
  fork:preflight` (env/config/coherence/pack validator), docs updated.
- **Phase 3** — see `docs/pilot-fork-runbook.md`; requires niche/domain/account
  decisions, so it executes per-fork rather than in the template.

---

## 1. Architecture decision: keep fork-per-board

**Recommendation: template repo + one fork per board (git-merge upstream for infra updates).**
Do NOT convert to runtime multi-tenant.

Why this is settled:
- Brand/niche values are baked at build time into static metadata, ISR pages, and
  JSON-LD. A runtime-brand model would force dynamic rendering on SEO-critical pages —
  a direct downgrade.
- Each board needs its own DB, Supabase project, Stripe account, Resend domain,
  Inngest app id, Upstash namespace, GSC property, and cron schedule anyway.
- `docs/fork-checklist.md` already encodes this intent ("consolidate into a package
  only at 3+ forks") — that rule stands.

What changes: the *variance surface* gets consolidated from ~700 scattered files into
a **niche pack** (§4) + `config/brand.ts`, with drift-guard tests so a fork can't
silently miss a spot.

## 2. What already exists (don't rebuild)

- `config/brand.ts` — brand/legal/email/social config; imported by 66 files.
- `docs/fork-checklist.md` — written fork procedure (but it overpromises, see §3.10).
- Aggregator layer: generic `Aggregator` interface + registry, tenants extracted to
  `lib/aggregators/tenants/`, search terms partially extracted to `search-terms/`
  (adzuna, usajobs, fantastic-jobs-db), chunk-count drift test vs vercel.json.
- AI layer: versioned prompt JSONs + registry, task→model routing in one file,
  env-killable feature flags, external eval fixtures, idempotent embedding backfill.
- pSEO layer: niche-neutral machinery (render gates, 308/410 guards, canonical logic,
  Layer-2 DB content overrides) cleanly separated from (inlined) niche content.
- Extension: industry-profile pattern registry (core/healthcare/tech packs);
  `API_BASE_URL` is a single constant.
- Compliance plumbing: sendAndLog, suppression, List-Unsubscribe, consent gates.
- Existing drift tests: `tests/seo/jobs-segments-drift.test.ts`,
  `tests/aggregators/chunk-count.test.ts` — the pattern to extend everywhere.

## 3. Fork-breaking bugs — fix regardless of templatization (Phase 0)

These bite the CURRENT board or any fork made today:

1. **DB bootstrap is broken.** Several `jobs` columns (`clinical_setting`,
   `patient_population`, `benefits`, `quality_score`, `apply_on_platform`, more)
   exist on prod only via `db push` — no migration creates them. A fresh fork
   following the checklist (`prisma migrate deploy`) crashes on first Prisma select.
   The migrations-cover-schema CI test checks tables only, so this ships green.
   → Author a catch-up migration; extend the CI test to columns.
2. **`lib/search-indexing.ts`** hardcodes `BASE_URL='https://pmhnphiring.com'` with
   NO env fallback — a fork pings Google/Bing/IndexNow with the old domain's URLs
   forever, reporting success. Same hardcode in `app/api/webhooks/stripe` pings,
   `cron/index-urls`, `cron/deindex-expired`, `lib/ingestion-service.ts`.
3. **`lib/csrf.ts` ALLOWED_ORIGINS** + middleware CORS allowlist hardcode the domain —
   on a new domain every form POST 403s ("demo works, nothing saves").
4. **Email sender defaults exist in THREE places** (`config/brand.ts`,
   `lib/env.ts` Zod defaults, `lib/email-service.ts` fallbacks). Unset env on a fork
   silently sends as `noreply@pmhnphiring.com` from an unverified domain → DMARC fail.
5. **`lib/invoice-generator.tsx`** falls back to PMHNP Hiring / Akari Labs seller
   identity — a fork issues financial documents under the wrong legal entity.
6. **`app/terms/page.tsx`** body hardcodes Akari Labs LLC, Wyoming venue, and the
   PMHNPHIRING Stripe descriptor ~24×, while the checklist claims legal pages are
   config-driven. (Privacy/security/sub-processors/do-not-sell ARE config-driven.)
7. **OG images**: `/api/og` fetches the logo from live `pmhnphiring.com` at edge
   runtime and caches 30 days — forks ship wrong-brand social cards that persist.
   Homepage OG also hardcodes "10,000+ PMHNP Jobs" claims (must be data-driven).
8. **`public/push-sw.js`** (static asset, can't import config) matches
   `client.url.includes('pmhnphiring.com')` — push click-to-focus breaks on forks.
   → Needs a build-time templating step.
9. **E2E prod guard** (`AGAINST_PROD` in journey specs) matches `pmhnphiring.com`
   only — on a fork, mutation tests will happily run against the fork's production DB.
10. **`docs/fork-checklist.md` overpromises** — update it to match reality once
    Phase 0 lands (terms prose, invoice, CSRF, OG logo, search-indexing host were
    all claimed-or-implied covered but are hardcoded).

Also load-bearing, same phase: `app/api/email-job` same-origin allowlist,
`auth/forgot-password` ALLOWED_REDIRECT_HOSTS, `lib/lead-mining.ts` NOISE_URL_HOSTS
(a fork cold-emails itself), widget CSP frame-ancestors, `feed.xml`/image/video
sitemap BASE_URL consts, hardcoded JSON-LD `https://pmhnphiring.com` in ~35 pages
and `lib/pseo` (15 literals), Breadcrumbs/JobCard fallback URLs.

**Guardrail to make this stick:** a CI test that greps built source for
`pmhnphiring` outside `config/`, `docs/`, `content/`, and per-board packs — every
future leak fails CI instead of silently shipping in the next fork.

## 4. The "niche pack" — where all per-board variance lives

Create `config/niche/` (PMHNP is the first pack). The engine code never changes per
board; only pack data does. Contents:

| Module | Replaces hardcodes in | Notes |
|---|---|---|
| `relevance.ts` — positive/negative keywords, tier rules, employer allowlist, dual-role exceptions | `lib/utils/job-filter.ts`, `lib/filters.ts` GLOBAL_EXCLUSIONS | **Keep the tier ENGINE intact in lib/** — only the keyword data moves. Both ingest-time and query-time gates read the same pack. |
| `salary.ts` — one salary band + period-inference thresholds derived from it | 4 independent systems: `salary-normalizer`, `salary-utils`, `job-normalizer` PERIOD_BOUNDS, `llm-enrichment` (prompt + JS check) | Clamp-not-drop behavior fabricates wrong salaries when the band is wrong. One source of truth, all four consumers. |
| `taxonomy.ts` — category registry: slug, label, classifier keyword rules, exclusions, faqCategory mapping, salary claims, hero copy refs | 28 static `app/jobs/*` folders, `app/sitemap.ts` (6 slug arrays), middleware 410 allowlists, `cron/index-pseo`, both sitemap routes, footer columns, `category-tagger.ts`, `jobs-segments-edge.ts` | Static route folders STAY (SEO/ISR/410 guards depend on them). Registry becomes the source; drift tests enforce folders == registry == sitemap == middleware. |
| `search-terms/` per source | Already exists for 3 sources; still INLINE in `workday.ts` (×2 lists), `doccafe.ts`, `healthcareercenter.ts` | Preserve per-API syntax contracts (Adzuna 1-phrase, fantastic-jobs-db no-OR title filter, USAJobs series code). |
| `sources.ts` — enabled sources + chunk counts + quota budgets | `registry.ts` JobSource union, vercel.json math, `chunked-presence.ts` chunk map | doccafe/healthcareercenter are healthcare-only; USAJobs series 0610 is nursing-only. |
| `credentials.ts` — credential registry (NPI/DEA/licenses/certs) | Prisma UserProfile block, profile-completeness weights, consent/redaction, resume-parser schema, autofill context, cert whitelists | Needs design: per-niche eligibility strategy (license-state filtering in recommendations), not deletion. |
| `regulatory.ts` — per-state professional context | `state-practice-authority.ts`, NLC data in state-narrative, StateFAQ practice-authority model | YMYL: shipping PMHNP regulatory claims on another niche is liability, not just wrong copy. |
| `copy.ts` — tagline, boardDescriptor, email subject/preheader fragments, OG headlines, hashtags, wordmark parts | `email-service.ts` (~15 templates), `email-templates-v2` header, `social-post-generator.ts`, OG routes, Header split wordmark | Compliance plumbing (unsubscribe, sender split) untouched. |
| `content-map.ts` — blog slug maps, video/image SEO maps, internal-link targets | `RelatedBlogPosts`, `HomepageBlogSection`, `video-seo.ts`, `image-seo.ts`, pSEO license-blog links | Prevents sitewide 404 internal links on a fork without the PMHNP blog series. |
| `assets.ts` — storage bucket base + image registry | 375 hardcoded `sggccmqjzuimwlahocmy.supabase.co` URLs in pSEO + components | Fork = new bucket; fallbacks must not point at the PMHNP bucket. |
| `stats.ts` — marketing claims wired to live data or per-board authored | WhyUs/Comparison/SidebarVisualCards/llms.txt/OG stats, EmployerTrustSection FALLBACK_EMPLOYERS | Fabricated fallbacks (Talkiatry chips, "10,000+ jobs") on a day-one board = FTC exposure. |
| `namespace.ts` — cookie/localStorage/Redis/Inngest prefixes | `pmhnp_*` cookies, `pmhnp-job-board` Inngest id, rate-limit keys | **Existing board keeps its values forever** (renaming = consent reset, orphaned durable state). Derived per new board only. |

pSEO per-niche content (narrative phrase banks, FAQ generators, city-data columns
like `mentalHealthShortage`/`providerRatio`, per-category imagery) is a **content
pack** authored per board — the thresholds (MIN_JOBS=3), render gates, and
canonical logic stay byte-identical (files literally say "do NOT raise").

## 5. Anti-downgrade guardrails (the actual "no downgrades" mechanism)

1. **Brand-leak CI test** — no `pmhnphiring` outside allowed paths (see §3).
2. **Taxonomy drift test** — registry == route folders == sitemap == middleware
   410 lists == index-pseo list == footer links (extends existing
   `jobs-segments-drift.test.ts`).
3. **Snapshot equivalence during extraction** — while extracting the PMHNP pack,
   golden tests assert the filter verdicts, salary normalization outputs, category
   tags, and rendered email HTML are byte-identical before/after. The extraction
   itself is proven to be a no-op for the live board.
4. **Keep every relevance-filter regression test** — they pin months of audit fixes;
   they become the PMHNP pack's test suite, and each new pack needs its own set (the
   audit harness scripts `audit-non-pmhnp.ts` / `deep-relevance-audit.ts` get
   parameterized to read the pack).
5. **AI prompt discipline** — niche context templated through the prompt registry's
   `render()` (extend it to template system prompts), version bump on content change
   (Redis cache keys include version, not content hash), per-niche eval fixtures
   REQUIRED before enabling each AI feature flag on a new board.
6. **Cron generator** — `scripts/generate-vercel-crons.ts` derives vercel.json from
   the source registry + chunk counts, preserving the wave/stagger structure
   (PgBouncer-pool protection) and the ingest-wave-summary window math. Hand-editing
   68 entries per fork is how chunks get silently skipped.
7. **Fork bootstrap validator** — extend `lib/env.ts` startup validation with a
   per-board preflight: both INDEXNOW keys, GSC/Bing tokens, Stripe webhook, VAPID
   keys, Resend domain verified, CSRF origins include the new domain, no
   `pmhnphiring` in resolved config.

## 6. Phased plan

**Phase 0 — Repair + centralize (helps the CURRENT board; zero behavior change)**
Fix §3 items 1–10 + load-bearing leaks; add the brand-leak CI test; unify salary
band; dedupe taxonomy lists into the registry (folders unchanged). Verified by
snapshot tests + existing suite.

**Phase 1 — Niche pack extraction**
Move data (not engines) into `config/niche/pmhnp/` per §4. Golden-snapshot proof of
no-op. Update fork-checklist.md to match reality.

**Phase 2 — Fork tooling**
Cron generator, bootstrap validator, `scripts/new-board.ts` scaffolder (niche pack
skeleton + env checklist + eval-fixture templates + extension build variant +
per-board Chrome Web Store listing notes), tenant-list bootstrap runbook (broad
sources first, then `discover-ats-tenants-from-db.ts` after data accumulates).

**Phase 3 — Pilot fork**
Launch board #2 on the template; every leak it finds becomes a new guardrail test.
Only consider extracting a shared package at 3+ boards (per existing checklist rule).

## 7. Per-board content bill (cannot be templated — budget for it)

- Relevance keyword pack + its own audit cycle (start strict, loosen with data)
- 28 category pages' editorial copy + FAQs + salary claims (structure templated,
  copy authored; the "№ NN / 28" labels derive from the registry)
- pSEO narrative phrase banks + FAQ generators + regenerated city-data columns
- Regulatory module (practice-authority equivalent) — needs domain research
- Blog: minimum viable authored set (PMHNP board has 87 posts; the license-by-state
  series is linked from ~100K pSEO pages — plan the equivalent)
- Salary guide data + PDF lead magnet
- AI eval fixtures (golden + bias) re-curated per niche; thresholds re-measured
- ATS tenant lists (seed lists + weeks of broad-source mining)
- Testimonials, marquee employers, stats claims, videos/hero imagery, OG assets
- Legal: entity/venue review of terms (counsel, not find-replace); DPIA reissue with
  niche-correct data categories
- Chrome extension: separate build + store listing (matcher already supports packs)
