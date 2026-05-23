# Template Conversion Runbook (2026-05)

> **Goal:** Convert this single-tenant PMHNP job board into a reusable template that can launch N independent job boards across different niches, without diverging codebases.
>
> **Audience:** The engineer(s) executing the conversion. Read this end-to-end once before starting Phase 0.
>
> **Status:** Plan accepted, not yet started. Last reviewed 2026-05-22.

**Related docs**
- [fork-checklist.md](../fork-checklist.md) — the *cheap path* (Option B in §2 below). Use it if you need ONE additional board in the next 60 days and accept the codebase will diverge. **This runbook supersedes it for any plan to ship 2+ boards.**
- [ingestion-pipeline-overview.md](../ingestion-pipeline-overview.md) — context for Phase 1 (cron migration risk).
- [job-health-runbook.md](../job-health-runbook.md) — context for Phase 3 shadow-mode validation.
- [pricing-system.md](../pricing-system.md) — single-tier assumption that needs generalization.

---

## 0. TL;DR — Brutal Honest Read

You do not have a template. You have a production single-tenant job board with deep niche coupling in ~30% of the code, ~70% reusable engine, and a deploy-cost ceiling that breaks at board #2.

**Three blockers in priority order:**
1. **Vercel cron limit (64) — already at 55.** Board #2 cannot ship without solving this. Either migrate crons to Inngest, or move to Vercel Enterprise (~$1,250/mo from $20/mo).
2. **Relevance classifier at [lib/utils/job-filter.ts](../../lib/utils/job-filter.ts)** (483 lines, 46 positive + 154 negative keywords, 4-tier `classifyRelevance` function) is hand-tuned for PMHNP and **cannot be made config-driven**. Each niche needs its own filter module written by a domain expert.
3. **pSEO taxonomy** ([lib/pseo/category-tagger.ts](../../lib/pseo/category-tagger.ts), [lib/pseo/category-asset-registry.ts](../../lib/pseo/category-asset-registry.ts) 670 lines, 32 directories under [app/jobs/](../../app/jobs/)) is structural, not configurable. Each niche replaces the entire taxonomy + regenerates SEO assets + rewrites category FAQ data.

**Realistic timeline to "ship board #2 cleanly":** 15–20 wall-clock weeks with one senior engineer focused.

**Realistic per-board run cost floor:** ~$75–125/mo + Stripe fees + shared AI/aggregator quota — *only if you solve the cron problem first*.

**If you can't commit one senior engineer for the full window, stop here and use [fork-checklist.md](../fork-checklist.md) instead. A half-done template is worse than a clean fork.**

---

## 1. Codebase Reality Check (Verified 2026-05-22)

Numbers in the [README](../../README.md) understate the system. Actual:

| Surface | README claims | Actual | Source of truth |
|---|---|---|---|
| API routes | "33 route groups" | **~190 routes** | `app/api/**/route.ts` count |
| Cron endpoints | 8 | **29 endpoints, 55 schedule entries** | [vercel.json](../../vercel.json) |
| Prisma models | 18 | **42** | [prisma/schema.prisma](../../prisma/schema.prisma) |
| Aggregators | 10 | **13 + per-tenant sub-adapters** | [lib/aggregators/registry.ts](../../lib/aggregators/registry.ts) |
| Component files | "66+" | **100+ files, ~31.6k LOC** | `components/**/*.tsx` |
| Migrations | (not stated) | **46** | `prisma/migrations/` |

**Surfaces the README never mentions but the template must handle:**
- AI Gateway ([lib/ai/gateway.ts](../../lib/ai/gateway.ts)) — central LLM routing, cost tracking, circuit breaker, per-tenant rate limits
- Programmatic SEO engine ([lib/pseo/](../../lib/pseo/)) — category × city/state landing pages
- Vector search — `JobEmbedding` + `CandidateEmbedding` pgvector (1536-dim)
- Short-link attribution (`/r/[code]` + `ShortLinkClick`) with daily-salted IP hashing
- DSAR/audit infrastructure (`DataRequest`, `AuditLog`, `DocumentAccessLog`)
- Middleware ([middleware.ts](../../middleware.ts), 967 lines) doing 410-Gone routing, rate limiting, crawler allow-list, Supabase session refresh

**Update the README as part of Phase 3** — onboarding any engineer to this conversion against the current README will fail.

---

## 2. Architecture Decision (Locked)

Three options were considered. Decisions are final unless explicitly re-opened.

### ❌ Option A — Multi-tenant single deployment
*One codebase, one DB, board rows, subdomain routing.*

**Rejected because:**
- Adding `board_id` to 42 models across 46 migrations is a 4–6 month refactor with high risk to live pmhnphiring.com.
- Aggregator API quotas (Adzuna, JSearch RapidAPI 20k/mo, USAJobs) become a noisy-neighbor problem at the row level.
- Single Stripe account servicing multiple unrelated brands triggers Stripe's platform review and forces Stripe Connect.
- Single Supabase project = shared auth realm. Users of board A see board B exists.
- One bad migration takes down all boards.

### ❌ Option B — Fork-and-find-replace
*Clone the repo per niche, sed PMHNP → new niche, deploy.*

**Rejected for >2 boards because:**
- N repos diverge within 3 months. Bug fixes don't propagate.
- 32 hardcoded taxonomy folders, 670-line asset registry, 100+ files mentioning "psychiatric" / "nurse practitioner" mean find-replace produces a broken output, not a working board.
- Browser extension at [pmhnp-autofill-extension/](../../pmhnp-autofill-extension/) is hardcoded to one domain — N Chrome Store listings.

**Acceptable for board #2 only if** you treat that fork as throwaway and intentionally re-converge during Phase 3 of this plan. Use [fork-checklist.md](../fork-checklist.md) for that path.

### ✅ Option C — Engine repo + per-niche Board Pack repos (CHOSEN)
*One reusable engine repo (`jobboard-engine`). Each board = its own repo importing the engine + supplying a typed `BoardPack` config + per-niche modules + per-niche content. Separate Vercel / Supabase / Stripe per board.*

**Why:**
- Engine and niche cleanly separated. Bug fixes ship via `npm update @yourorg/jobboard-engine` to all boards.
- Each board keeps its own DB, Stripe, domain — matches how schema/payments/auth already work.
- Niche-specific code (relevance classifier, taxonomy, prompts) lives in board-owned TypeScript modules with a typed interface — not flaky JSON config.
- Cost stays predictable per board.
- Dogfooding pmhnphiring.com as the first consumer of the engine is the only way to know the abstraction is real.

---

## 3. Coupling Inventory — Evidence

Findings verified 2026-05-22 by parallel codebase audit. If anything in this section has changed by the time you execute Phase 3, re-verify.

### 3.1 Code coupling (the ~10% that's brutally tight)

| File | Lines | What's coupled | Difficulty to generalize |
|---|---|---|---|
| [lib/utils/job-filter.ts](../../lib/utils/job-filter.ts) | 483 | 46 PMHNP positive keywords (lines 13-46), 154 negative keywords (48-192), MENTAL_HEALTH_CONTEXT_TERMS (240-255), PSYCH_EMPLOYER_PATTERNS (263-270), 4-tier `classifyRelevance` (354-477) | **Extreme** — cannot be config-driven; per-pack TS module only |
| [lib/pseo/category-tagger.ts](../../lib/pseo/category-tagger.ts) | 260 | 18 hardcoded specialty slugs (lines 36-49), per-category keyword RULES (77-160+) | **Extreme** — structural |
| [lib/pseo/category-asset-registry.ts](../../lib/pseo/category-asset-registry.ts) | 670 | Static asset URLs, hero images, bento sections, explore cards per category | **Extreme** — regenerate per niche |
| [app/jobs/](../../app/jobs/) | 32 dirs | One directory per taxonomy slug | **Extreme** — collapse to one generic `[category]` route |
| [lib/state-practice-authority.ts](../../lib/state-practice-authority.ts) | ~300 | 50-state PMHNP practice authority data | **High** — delete from engine; PMHNP-pack only |
| [lib/llm-enrichment.ts](../../lib/llm-enrichment.ts) | 36-54 | `clinical_setting`, `patient_population`, `$40k-$500k PMHNP range`, "Telehealth" → "Remote" mapping in system prompt | **Medium** — extract to pack-supplied prompt |
| [lib/salary-normalizer.ts](../../lib/salary-normalizer.ts) | 29-42 | `PMHNP_SALARY_RANGES` constants ($80k-$350k, $50-$350/hr) | **Low** — config swap |
| [prisma/schema.prisma](../../prisma/schema.prisma) | 521-573, 808-875 | `npiNumber`, `deaNumber`, `licenseStates`, `CandidateLicense`, `CandidateCertification`, `ProgramDirectorLead`, `clinical_setting`, `patient_population` | **High** — add `customFields Json?` to engine; healthcare fields move to PMHNP pack extension schema |
| [components/jobs/LinkedInFilters.tsx](../../components/jobs/LinkedInFilters.tsx) | 665 | Hardcoded filter chips (Telehealth, Per Diem, New Grad, Locum Tenens, etc.) | **Low-Med** — pack-supplied |
| [pmhnp-autofill-extension/src/content/profiles/healthcare.ts](../../pmhnp-autofill-extension/src/content/profiles/healthcare.ts) | 10-53 | Field regex patterns (NPI, DEA, license, malpractice, CME, telehealth, board-certified, etc.) | **High** — separate extension per board |

**Niche-string frequency (case-insensitive grep):**
- `psychiatric`: ~100+ files
- `mental health`: ~80+ files
- `nurse practitioner`: ~50+ files
- `npiNumber` / `deaNumber` / `licenseState`: 50+ files
- `pmhnp`: hundreds of references across content + code

### 3.2 Content coupling (~20% that needs editorial work)

| Surface | Coupling level | Per-board action |
|---|---|---|
| [app/page.tsx](../../app/page.tsx) | **Rewrite** (Tier 4) | 12 hardcoded PMHNP FAQ schema entries, "PMHNP Jobs — Psychiatric NP Job Board" metadata |
| [app/for-employers/page.tsx](../../app/for-employers/page.tsx) | **Rewrite** (Tier 4) | "The #1 Job Board Built Exclusively for PMHNPs" + comparison rows |
| [app/for-job-seekers/page.tsx](../../app/for-job-seekers/page.tsx) | **Rewrite** (Tier 4) | "100% PMHNP-Only Jobs" + resource cards |
| [app/for-programs/page.tsx](../../app/for-programs/page.tsx) | **Rewrite** (Tier 4) | "Help Your PMHNP Students Land Their First Role" + program director value prop |
| [app/faq/page.tsx](../../app/faq/page.tsx) | **Editorial** (Tier 3) | 40+ hardcoded PMHNP Q&As across 5 categories |
| [app/pricing/page.tsx](../../app/pricing/page.tsx) | **Rewrite** (Tier 4) | "PMHNP Job Board" metadata + healthcare-employer comparison |
| [app/about/page.tsx](../../app/about/page.tsx) | **Editorial + Config** (Tier 2-3) | Live DB queries hardcode psychiatric job terms |
| [content/blog/](../../content/blog/) | **Editorial** (Tier 3) | All editorial; cannot be LLM-bulk-regenerated and rank |
| [components/CategoryFAQ.tsx](../../components/CategoryFAQ.tsx), [components/StateFAQ.tsx](../../components/StateFAQ.tsx) | Data-driven | FAQ data must come from `pack.faqs` |
| Email subject/body strings in [lib/email-templates-v2.ts](../../lib/email-templates-v2.ts) lines 77, 141-145 | **Pack-supplied** (Tier 2) | "PMHNP Hiring" preheader + brand refs |
| [public/](../../public/) brand assets (logos, OG images, videos) | **Config swap** (Tier 1) | Filenames include "pmhnp" |

**Tier legend:**
- **Tier 1 — Config swap:** ~1 hour per board (assets, env vars)
- **Tier 2 — Pack-supplied content:** ~1 week per board (FAQ JSON, brand object, copy strings)
- **Tier 3 — Editorial work:** ~1–2 weeks per board (blog posts, regulatory pages, taxonomy FAQs)
- **Tier 4 — Page rewrite:** ~2–4 weeks per board (marketing pages with specific value props per niche)

### 3.3 Infrastructure coupling (the deploy story)

| Concern | Single-tenant? | Per-board action |
|---|---|---|
| `DATABASE_URL` | Yes | Separate Supabase project per board |
| `NEXT_PUBLIC_SUPABASE_URL`, anon key, service role key | Yes | Per-board |
| `CRON_SECRET` | Yes | Generate per board; never share |
| `EMAIL_FROM` default in [lib/env.ts](../../lib/env.ts) hardcodes `noreply@pmhnphiring.com` | Yes | Remove default; require explicit value |
| `NEXT_PUBLIC_BASE_URL` fallback in [lib/email-service.ts:19](../../lib/email-service.ts) hardcodes `https://pmhnphiring.com` | Yes | Remove fallback; fail loud if unset |
| Supabase asset URLs (`sggccmqjzuimwlahocmy.supabase.co`) hardcoded in `.env.example` defaults | Yes | Remove from defaults |
| Stripe account | Yes | Separate account per board (or Stripe Connect, but adds platform-review burden) |
| `STRIPE_SECRET_KEY`, webhook secret, publishable key | Yes | Per-board |
| Pricing constants in [lib/config.ts](../../lib/config.ts) (lines 19-22: `postingPrice: 199`, `renewalPrice: 179`) + `type PricingTier = 'pro'` single tier | Yes | Pack-supplied pricing |
| Aggregator API keys (Adzuna, Jooble, JSearch, USAJobs) | Shared possible | **Recommend separate per board** for blast-radius isolation |
| OpenAI/Anthropic keys | Shared possible | Shared OK with per-pack spend cap enforced in AI gateway |
| Resend account + verified domain | Yes | Separate per board |
| Sentry DSN | Yes | Per-board project (or shared with pack tag) |
| Discord webhook (`DISCORD_WEBHOOK_URL`) | Yes | Per-board webhook OR single webhook with pack ID in payload |
| GA4 measurement ID | Yes | Per-board property |
| Google Search Console | Yes | Per-domain registration |
| Upstash Redis | Yes | Per-board namespace (cheaper than separate instance) |
| Inngest org | Shared possible | Separate environment per board |
| Chrome extension | Yes | Separate listing per board (Chrome Store review = 1–3 days) |
| `vercel.json` cron count | **Blocker at board #2** | Solve in Phase 1 |

### 3.4 Per-board cost floor (after Phase 1 cron fix)

| Vendor | $/mo per board | Notes |
|---|---|---|
| Supabase Pro | $25 | One project per board |
| Vercel Pro | $20 | One project per board (under same Vercel team) |
| Resend | $20 | Per verified domain |
| Inngest | $10–20 | Replaces Vercel crons |
| Stripe | $0 fixed | + 2.9% + $0.30 per charge |
| Sentry | $0–29 | Optional |
| Custom domain | $10 | DNS + SSL |
| **Floor** | **~$85–125/mo** | + shared OpenAI/Anthropic pool, + aggregator API costs |

**Variable costs that bite:**
- OpenAI per-board cost tracks ingestion volume × LLM-rescue rate. Cap per-pack in the AI gateway or you'll be surprised.
- Adzuna free tier (~250 calls/month) is useless past board #1. Budget paid plan per board.
- JSearch RapidAPI Ultra ($80/mo, 20k calls/mo) potentially shareable across 3–4 boards.
- Resend at >1k emails/day per board pushes to $90/mo.

---

## 4. Phased Execution Plan

Each phase has **goal · deliverables · acceptance criteria · effort · risk · rollback**. Do them in order. Do not parallelize Phase 1 with anything else.

---

### Phase 0 — Decision & Scaffolding

| | |
|---|---|
| **Goal** | Stand up engine + first board repos with stub interface |
| **Effort** | 1 week |
| **Risk** | Low |
| **Owner** | Lead engineer |

**Deliverables:**
- [ ] `jobboard-engine` repo created (private)
- [ ] `pmhnphiring-board` repo created (private)
- [ ] `BoardPack` TypeScript interface drafted in engine (strawman; will iterate)
- [ ] Decision doc committing to Option C, Phase 1 cron strategy, per-board billing model — committed to engine repo `docs/decisions/0001-template-architecture.md`
- [ ] CI configured for both repos (lint, type-check, test)

**Acceptance:**
- Engine repo is currently a thin wrapper re-exporting today's pmhnphiring code unchanged.
- PMHNP board repo's `npm run build` produces an artifact byte-identical to today's production build.

**Rollback:** Delete the new repos. Nothing in pmhnphiring.com production has changed.

---

### Phase 1 — Solve the Cron Problem (DO THIS BEFORE ANYTHING ELSE) 🚨

| | |
|---|---|
| **Goal** | Remove the Vercel 64-cron ceiling permanently |
| **Effort** | 1–2 weeks |
| **Risk** | **High** — ingestion is the heart of the product |
| **Owner** | Senior engineer with on-call rotation |

**Why this phase comes first:** If you spend 8 weeks on Phases 2–3 and then discover you can't actually deploy board #2 because of crons, you've wasted 8 weeks. This phase is a go/no-go gate.

**Pick one of two paths:**

**Path A — Consolidate inside Vercel** (cheaper, ages worse)
- Replace 25-chunk Workday + 8-chunk Greenhouse + 8-chunk JSearch with single orchestrator crons that fan out internally via `Promise.allSettled` batches under the 240s budget.
- Target: 55 → ~15 crons per board.
- Pros: no new vendor, no cost increase.
- Cons: re-introduces the ceiling at board #4 or #5; doesn't help observability.

**Path B — Migrate to Inngest** (recommended)
- [lib/inngest/](../../lib/inngest/) is already wired in. Migrate all 29 cron endpoints to Inngest functions.
- Vercel cron count drops to 0.
- Pros: unlimited schedules, per-tenant queues, native retries, observability, removes the ceiling forever.
- Cons: $10–20/mo per board; one-time migration risk.

**Execution checklist (Path B):**
- [ ] Inventory all 29 cron endpoints + their `vercel.json` schedules
- [ ] Map each to an Inngest function in `lib/inngest/functions/`
- [ ] **Shadow mode:** deploy Inngest functions running in parallel with `vercel.json` crons for 7 full days
- [ ] Compare outputs daily: ingestion counts, dead-link unpublishes, email sends, IndexNow pings, cron-run audit rows
- [ ] After 7 clean days of parity, remove `vercel.json` cron entries in a single PR
- [ ] Monitor for 72 hours post-cutover; have rollback PR drafted

**Acceptance:**
- 7 consecutive days of shadow-mode parity (≤1% variance in ingestion counts vs. baseline 14-day moving average)
- `vercel.json` cron count = 0
- Inngest dashboard shows all functions green
- Discord ingestion summaries continue to fire on schedule

**Rollback procedure:**
1. Revert the PR that removed `vercel.json` crons (`git revert <sha> && git push`)
2. Re-deploy pmhnphiring.com
3. Verify next scheduled cron fires within its window via [admin dashboard](../../app/admin/cron/)
4. Inngest functions can stay deployed but disable them via Inngest dashboard toggle to avoid duplicate runs
5. Document the failure mode in this runbook before re-attempting

**Recommendation: Path B (Inngest).** Path A buys time but the cost compounds; Path B removes the ceiling permanently.

---

### Phase 2 — Define the BoardPack Interface

| | |
|---|---|
| **Goal** | Strict TypeScript interface enumerating every per-niche extension point |
| **Effort** | 2 weeks |
| **Risk** | Medium — wrong interface costs you in every subsequent phase |
| **Owner** | Senior engineer + product input on what's pack vs engine |

**Deliverables — `engine/src/board-pack.ts`:**

```ts
export interface BoardPack {
  brand: BrandConfig;                  // name, domain, palette, OG defaults, social handles, support email
  relevance: RelevanceModule;          // classifyRelevance(rawJob): RelevanceResult
  enrichment: EnrichmentModule;        // prompt template, extractionSchema (Zod), fieldMerger
  salary: SalaryConfig;                // min/max W2 + hourly bounds per period
  aggregators: AggregatorPack;         // per-source search terms + ATS company allowlist + per-tenant subdomains
  taxonomy: TaxonomyPack;              // categories[], slug rules, asset registry function
  profileExtensions: ProfileFieldDef[]; // niche fields → customFields JSONB
  regulatory?: RegulatoryPack;         // optional per-state data (PMHNP has it; software-eng has none)
  content: ContentPack;                // marketing MDX paths, FAQ data, blog seed
  emails: EmailStringsPack;            // subject/body strings; chrome stays in engine
  extension?: ExtensionFieldMap;       // optional Chrome extension field map
  pricing: PricingConfig;              // tiers, prices, Stripe product IDs
  observability: ObservabilityConfig;  // Sentry DSN, GA4 ID, Discord webhook, per-pack AI spend cap
}
```

**Checklist:**
- [ ] Type-stub every field above with no implementation
- [ ] Walk every coupling from §3 and confirm it maps to exactly one interface field
- [ ] Document each field with `@example` JSDoc pointing to PMHNP's eventual implementation
- [ ] PMHNP's pack `implements BoardPack` and type-checks (even if stubbed)
- [ ] Engine compiles with a fake `MinimalPack` for testing

**Acceptance:**
- Every item in §3 maps to a field. If something doesn't fit, the interface is wrong — fix it before Phase 3.
- A second engineer can read the interface and explain what each field does without asking.

**Rollback:** Interface file is types-only. Deleting it has no runtime impact.

---

### Phase 3 — Extract Engine, Move PMHNP Specifics Into Pack

| | |
|---|---|
| **Goal** | pmhnphiring.com runs from engine + PMHNP pack, with no behavioral regression |
| **Effort** | 5–7 weeks |
| **Risk** | **High** — live revenue product at stake |
| **Owner** | Senior engineer + product/marketing review at sub-phase 3b |

Sub-phases 3a–3g are executed in order; **each merges to engine + PMHNP repo independently and ships to staging before the next starts**.

#### Sub-phase 3a — Brand & content config (1 week)
**Move out of engine:**
- "PMHNP Hiring", "pmhnphiring.com", `EMAIL_FROM` default, OG defaults from [lib/env.ts](../../lib/env.ts), [lib/email-service.ts](../../lib/email-service.ts), [app/layout.tsx](../../app/layout.tsx), [components/JobStructuredData.tsx](../../components/JobStructuredData.tsx), [middleware.ts](../../middleware.ts), [app/sub-processors/page.tsx](../../app/sub-processors/page.tsx).
- All boot-time reads come from `pack.brand`.

**Acceptance:** `grep -r pmhnphiring engine/` returns zero matches.

#### Sub-phase 3b — Marketing pages (1 week)
Replace [app/page.tsx](../../app/page.tsx), [app/for-employers/](../../app/for-employers/), [app/for-job-seekers/](../../app/for-job-seekers/), [app/about/](../../app/about/), [app/faq/](../../app/faq/), [app/pricing/](../../app/pricing/), [app/for-programs/](../../app/for-programs/) with generic shells that render `pack.content.*` MDX.

**Critical:** PMHNP's pack ships the existing copy **verbatim** — no rewrite during conversion. Prove parity first, optimize copy later.

**Acceptance:** Snapshot top 50 pages' rendered HTML before/after; ≥99% byte-identical.

#### Sub-phase 3c — Relevance & enrichment (1 week)
- Replace direct imports of `classifyRelevance` and the enrichment prompt with calls through `pack.relevance` and `pack.enrichment`.
- PMHNP's pack contains the existing 46 positive + 154 negative keyword arrays unchanged.
- LLM system prompt becomes a function in `pack.enrichment.systemPrompt`.

**Acceptance:** 7-day ingestion comparison — same job count ±2%, same accept/reject ratio ±1%.

#### Sub-phase 3d — Aggregators (1 week)
- Move [lib/aggregators/search-terms/](../../lib/aggregators/search-terms/) and per-source tenant lists into `pack.aggregators`.
- Engine keeps the adapter HTTP code (genuinely generic).
- [lib/aggregators/constants.ts](../../lib/aggregators/constants.ts) `STATES` and `TOP_500_CITIES` stay in engine (geography is niche-agnostic).
- `TOP_EMPLOYERS` (60 healthcare orgs) moves to pack.

**Acceptance:** Each aggregator's daily fetch count varies ≤5% from 14-day baseline.

#### Sub-phase 3e — Taxonomy & pSEO (2 weeks) — HARDEST PIECE
- **Delete the 32 hardcoded taxonomy folders.** Replace with generic routes:
  - `app/jobs/[category]/page.tsx`
  - `app/jobs/[category]/[state]/page.tsx`
  - `app/jobs/[category]/city/[slug]/page.tsx`
- All driven by `pack.taxonomy.categories`.
- Generalize [lib/pseo/category-asset-registry.ts](../../lib/pseo/category-asset-registry.ts) to a pack-supplied function.
- Middleware 410-Gone taxonomy validation in [middleware.ts](../../middleware.ts) reads from `pack.taxonomy.slugs`.

**Acceptance:**
- Sitemap output byte-identical to pre-conversion.
- All 32 old category URLs still resolve (verify via [app/sitemap.ts](../../app/sitemap.ts) snapshot + production crawl).
- Google Search Console impression count for category pages flat ±5% over 14 days post-cutover.

#### Sub-phase 3f — Schema generalization (1 week)
- Add `customFields Json?` to `UserProfile`, `Job`, `EmployerJob` in engine schema.
- Move into PMHNP-pack-only Prisma extension files (loaded via Prisma's multi-schema feature or generator merging):
  - `npiNumber`, `deaNumber`, `licenseStates`, `clinical_setting`, `patient_population` on `UserProfile` / `Job`
  - `CandidateLicense`, `CandidateCertification`, `ProgramDirectorLead` tables
- Engine schema gets the role-agnostic minimum.

**Acceptance:**
- `npx prisma migrate diff` shows zero pending changes against production DB after pack-merge.
- All existing pmhnphiring data queryable via merged schema.

#### Sub-phase 3g — Emails (1 week)
- Hoist every English string out of [lib/email-service.ts](../../lib/email-service.ts) and [lib/email-templates-v2.ts](../../lib/email-templates-v2.ts) into `pack.emails`.
- Layout/CSS/blocks (header, footer, button styles) stay in engine.
- "PMHNP Hiring", "Sathish", "psychiatric NP roles in [location]" all move to pack strings.

**Acceptance:** Send each email type (welcome, alert, job confirmation, expiry warning, employer notification) in staging; visual diff vs. production ≤1% pixel change.

#### Phase 3 acceptance criteria (rollup):
- [ ] pmhnphiring.com runs in production from engine repo + PMHNP pack
- [ ] Top 50 pages render ≥99% byte-identical HTML
- [ ] 7 days of ingestion parity (counts, accept/reject ratio, source distribution)
- [ ] Sitemap output byte-identical
- [ ] All emails visually identical
- [ ] No new Sentry errors in 72h post-cutover
- [ ] `grep -r pmhnphiring engine/` returns zero matches
- [ ] README updated to reflect new repo structure

**Rollback procedure:**
1. Keep the old monolith repo deployable as fallback for 4 weeks post-cutover
2. If issue detected: redirect pmhnphiring.com Vercel project back to old repo (DNS unchanged)
3. Document failure mode in this runbook
4. Patch in engine, re-run shadow comparison, re-attempt cutover

---

### Phase 4 — Bootstrap CLI / Generator

| | |
|---|---|
| **Goal** | `npx create-jobboard --pack ./my-niche-pack` produces a deployable repo |
| **Effort** | 1–2 weeks (parallelizable with Phase 5) |
| **Risk** | Low |
| **Owner** | Mid/senior engineer |

**Deliverables — a small CLI scaffolds:**
- [ ] `.env.example` with all required + optional vars annotated
- [ ] `vercel.json` (empty crons since Inngest handles them post-Phase 1)
- [ ] Prisma config merging engine + pack schemas
- [ ] README with first-deploy walkthrough
- [ ] GitHub workflow for `prisma migrate deploy` (mirroring [.github/workflows/migrate-prod.yml](../../.github/workflows/migrate-prod.yml))
- [ ] Pack stub with TODO comments for each `BoardPack` field
- [ ] Brand assets placeholder directory

**Acceptance:** A new engineer can scaffold a fresh board repo, fill in a stub pack, and see "hello world" rendered locally in <30 minutes.

---

### Phase 5 — Operational Hardening

| | |
|---|---|
| **Goal** | Day-2 ops for multiple boards |
| **Effort** | 2 weeks (parallelizable with Phase 4) |
| **Risk** | Medium |
| **Owner** | Senior engineer + DevOps if available |

**Deliverables:**
- [ ] Per-board observability: pack ID surfaced as Sentry tag, GA4 property, Discord webhook, AI cost tracking dimension
- [ ] Per-board secrets checklist (documented in pack README)
- [ ] Per-pack AI spend cap enforced in [lib/ai/gateway.ts](../../lib/ai/gateway.ts) (extend existing per-tenant rate limit logic)
- [ ] Aggregator key strategy: separate Adzuna/JSearch/Jooble keys per board (recommend); shared OpenAI/Anthropic with cap
- [ ] Migration linter: catches pack migrations that conflict with engine column names; runs in CI
- [ ] Cron job in each board for engine version drift check (alerts if engine semver is >2 minor versions behind latest)

**Acceptance:**
- Sentry filter by pack ID works end-to-end
- AI spend cap test: simulate 1.5× cap usage in staging, verify auto-pause + Discord alert
- Migration linter blocks a deliberately conflicting test migration in CI

---

### Phase 6 — Validate by Shipping Board #2

| | |
|---|---|
| **Goal** | Ship a real second board in a genuinely different vertical |
| **Effort** | 3–4 weeks (mostly domain/editorial work, not engineering) |
| **Risk** | Medium — reveals interface bugs |
| **Owner** | Lead engineer + niche domain expert + content writer |

**Pick a niche distant from PMHNP** to stress the abstraction. Good choices:
- Software engineering jobs (no licensing, no state authority data)
- Truck driving jobs (CDL licensing is structurally different from nursing)
- Lawyer/paralegal jobs (state bar admission is more like NP licensing but different schema)

Bad choice: another nursing role (e.g., FNP) — too similar to PMHNP; won't stress the interface.

**Pre-launch checklist:**
- [ ] New repo scaffolded via CLI from Phase 4
- [ ] Pack `BoardPack` interface fully implemented
- [ ] Niche-specific `classifyRelevance` written by domain expert (not an LLM)
- [ ] Niche-appropriate taxonomy (10–25 categories)
- [ ] 6–10 marketing MDX pages authored
- [ ] FAQ JSON with 20+ niche-specific Q&As
- [ ] Email strings translated/rewritten for niche
- [ ] Optional regulatory module (or explicit null)
- [ ] Separate Supabase project provisioned
- [ ] Separate Stripe account provisioned
- [ ] Separate Resend domain verified
- [ ] Custom domain DNS configured
- [ ] CRON_SECRET, EXTENSION_JWT_SECRET (if extension shipped), BLOG_API_KEY all new
- [ ] Per-pack AI spend cap configured
- [ ] Sentry, GA4, Discord webhook per-board configured
- [ ] First ingestion run dry-run shows ≥80% relevance pass on manual 100-job audit

**Acceptance:**
- Board #2 ships with first ingestion producing ≥1,000 relevant jobs within 14 days
- Manual review of 100 ingested jobs by domain expert: ≤5% false-positive rate
- 6 manually authored marketing MDX pages live
- Zero engine code changes required to ship

**🚨 If you have to modify the engine to ship board #2, the `BoardPack` interface is wrong.** Go back to Phase 2, fix it, regenerate PMHNP pack, then resume Phase 6.

**Rollback:** Board #2 is independent of pmhnphiring.com production. Take it down by un-deploying; no impact on board #1.

---

## 5. Cost & Effort Summary

| Phase | Wall-clock | Risk | One-line why |
|---|---|---|---|
| 0 — Scaffolding | 1 wk | Low | Pure setup |
| 1 — Cron migration | 1–2 wk | **High** | Heart-of-product change |
| 2 — Interface design | 2 wk | Med | Wrong interface = redo Phase 3 |
| 3 — Extract engine | 5–7 wk | **High** | Live revenue product at stake |
| 4 — Bootstrap CLI | 1–2 wk | Low | Glue work |
| 5 — Ops hardening | 2 wk | Med | Per-board observability is non-trivial |
| 6 — Board #2 | 3–4 wk | Med | Reveals interface bugs |
| **Total** | **15–20 wk** | | One senior engineer focused, plus you |

---

## 6. Pre-Mortem (Things That Will Go Wrong)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phase 3 cutover breaks pmhnphiring.com ingestion | Med | High (revenue + SEO) | 2-week staging mirror; shadow-mode crons (Phase 1 pattern reused); 4-week rollback window |
| `BoardPack` interface needs major redesign during Phase 6 | High | Med | Plan for it; treat first 3 boards as interface validation, don't lock the API until board #3 |
| Vercel cost surprise | Med | Med | Path B (Inngest) in Phase 1; don't let cron count regrow |
| AI cost runaway on a new board | Med | High | Hard per-pack spend cap in AI gateway, Discord alert at 80%, auto-kill at 100% |
| Schema drift between boards | High over time | Med | Engine owns core migration timeline; pack migrations must reference an engine schema version |
| Engineer gives up halfway, ships Option B fork | High | High | Don't start unless one engineer is committed for the full window. Half-done template is worse than clean fork. |
| Board #2 produces zero relevant jobs because `classifyRelevance` was hand-waved | High | High | Block board #2 launch on manual 100-job relevance audit by domain expert |
| Stripe forces Stripe Connect because of multi-brand single account suspicion | Med | High | One Stripe account per board from day 1; explicitly do not share |
| GSC penalizes for duplicated blog content across boards | Med | High | Pack content is editorial; never copy-paste blog posts between boards |
| Chrome Web Store rejects board #2 extension as duplicate of board #1 | Low | Low | Extension is optional; ship board #2 without it, add later if ROI proven |

---

## 7. What I'd Actually Do First (1-Week Spike)

Before committing to the full 15–20 weeks:

1. **Phase 1 spike (3 days):** Prototype Inngest migration for **one** cron (Workday 25-chunk ingestion). Measure parity. If Inngest can't replicate the 240s time-budget semantics cleanly, the whole plan changes — find out now.
2. **`BoardPack` strawman (2 days):** Write the interface as types-only, no implementation. Force enumeration of every extension point. Check against §3 of this runbook. If any coupling doesn't map to a field, the interface is wrong — find out now.
3. **Board #2 numeric success criteria (1 day):** Define what "shipped" means for the second board. Without numbers, you'll convince yourself a half-working board is done. Suggested floor:
   - 1,000 relevant jobs in DB within 14 days
   - ≤5% false-positive rate on 100-job sample by domain expert
   - 6 manually authored MDX pages live
   - Per-pack AI spend ≤ defined cap

---

## 8. Things That Look Reasonable But Are Wrong

Documented here so the next engineer doesn't burn a week rediscovering:

- **Don't make `classifyRelevance` config-driven via JSON.** The PMHNP classifier has tier logic, employer-name pattern matching, and context-gated bonuses. Compressing that into JSON gives you a worse classifier per niche, not a more reusable one. **Decision: per-pack TS function, ~200 lines per niche, written by a domain expert.**
- **Don't share one Supabase project across boards via row-level multi-tenancy.** Auth realm leak alone (employer of board A signs up and sees board B exists) is a non-starter. Adding `board_id` to 42 models is a quarter of work.
- **Don't try to LLM-generate marketing copy and FAQs at board launch.** Plausible-sounding generic copy ranks for nothing and converts at half the rate. Pack content is editorial work; budget 1–2 weeks of writing per new niche.
- **Don't maintain one Chrome extension that handles N boards.** Chrome Web Store extension permissions and `host_permissions` don't compose cleanly across unrelated domains. Ship a separate extension per board OR drop the extension from board #2 entirely.
- **Don't share blog content across boards.** Google treats it as syndicated thin content and tanks SEO across all of them.
- **Don't roll your own job scheduler to avoid Inngest.** The current 240s time-budget logic is already a soft scheduler; pushing further means rebuilding what Inngest gives you for $10/mo.
- **Don't try to support Vercel Pro at board #2 without Phase 1.** The 64-cron limit will block deploy. Vercel Enterprise ($1,250/mo) is the alternative cost; Inngest ($10–20/mo) is cheaper and better.

---

## 9. Glossary

- **Engine** — the reusable repo (`jobboard-engine`) containing niche-agnostic code: ingestion orchestrator, AI gateway, auth, payments machinery, email sending machinery, employer dashboard, candidate profile shell, cron framework, sitemap engine, middleware.
- **Board Pack** — a per-niche bundle implementing the `BoardPack` interface: relevance classifier, taxonomy, marketing content, FAQ data, email strings, brand identity, profile field extensions, optional regulatory data.
- **Board** — a deployed instance: one engine + one pack + per-board Vercel project + per-board Supabase + per-board Stripe + per-board Resend domain.
- **Niche** — the vertical a board serves (PMHNP, software engineering, truck driving, etc.).
- **Pack ID** — a stable string identifying the niche, used as a tag across observability tooling (Sentry, GA, Discord, AI spend ledger).

---

## 10. Change Log

| Date | Author | Change |
|---|---|---|
| 2026-05-22 | Codebase audit pass | Initial runbook drafted from end-to-end analysis + 3 coupling audits |

> When you make material changes to this runbook, add a row above and bump the "Last reviewed" date at the top.
