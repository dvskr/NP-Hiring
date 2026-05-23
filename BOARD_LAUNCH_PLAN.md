# Board Launch Plan — End-to-End

> **What this is:** the complete playbook to turn this folder (a git clone of pmhnphiring.com) into a brand-new live job board in a different niche. PMHNP production is separate and untouched.
>
> **How to use this file:** work through phases 0 → 10 in order. Each phase has a checklist, commands, acceptance criteria, and time estimate. Tick boxes as you go. Delete this file when board #2 is live.
>
> **Estimated total time:** 4–6 weeks for an experienced engineer with content and a domain expert lined up.
>
> **Status:** Not started. Created 2026-05-23.

---

## Table of Contents

- [Phase 0 — Pre-flight Decisions (lock before touching anything)](#phase-0--pre-flight-decisions)
- [Phase 1 — Repo Reset](#phase-1--repo-reset)
- [Phase 2 — Delete PMHNP-Specific Files](#phase-2--delete-pmhnp-specific-files)
- [Phase 3 — Schema Reset](#phase-3--schema-reset)
- [Phase 4 — Strip PMHNP Code From Kept Files](#phase-4--strip-pmhnp-code-from-kept-files)
- [Phase 5 — Write Niche-Specific Modules](#phase-5--write-niche-specific-modules)
- [Phase 6 — Infrastructure Provisioning](#phase-6--infrastructure-provisioning)
- [Phase 7 — Migrate Crons to Inngest](#phase-7--migrate-crons-to-inngest)
- [Phase 8 — Marketing Pages + Content](#phase-8--marketing-pages--content)
- [Phase 9 — Smoke Test Ingestion](#phase-9--smoke-test-ingestion)
- [Phase 10 — Deploy + Validate](#phase-10--deploy--validate)
- [Appendix A — File Inventory](#appendix-a--file-inventory)
- [Appendix B — Risk Log](#appendix-b--risk-log)

---

## Phase 0 — Pre-flight Decisions

**Do not start Phase 1 until every box below is ticked.** Skipping these is how board #2 dies in week 3 with no relevance signal and no copy.

### 0.1 Lock the niche
- [ ] **Niche name** (e.g., "Senior Software Engineers", "Truck Drivers", "Paralegals"): __________________
- [ ] **Why this niche?** (market size, employer demand, your edge): __________________
- [ ] **Avoid pure adjacency to PMHNP** (no FNP/RN/clinical roles — too similar, won't stress what's reusable)

### 0.2 Lock the domain expert
This is the **single biggest blocker**. Without them, the relevance classifier produces garbage and the board ingests irrelevant jobs.
- [ ] **Domain expert name**: __________________
- [ ] **Commitment:** they will write the relevance classifier (~200–300 lines of TS) — confirmed Y/N
- [ ] **They will manually audit the first 100 ingested jobs** — confirmed Y/N

### 0.3 Lock brand + domain
- [ ] **Brand name** (board name shown in UI): __________________
- [ ] **Domain** (purchased): __________________
- [ ] **Twitter/X handle** (claimed): __________________
- [ ] **LinkedIn page** (claimed): __________________
- [ ] **Logo file** (placeholder OK; final later): __________________
- [ ] **Primary brand color** (hex): __________________

### 0.4 Lock infrastructure accounts
- [ ] **New Supabase project** (separate from pmhnp) — created Y/N
- [ ] **New Stripe account** (separate from pmhnp) — created Y/N
- [ ] **New Resend account** with verified sending domain — created Y/N
- [ ] **New Vercel project** — created Y/N
- [ ] **New Sentry project** (optional but recommended) — created Y/N
- [ ] **New Inngest project/environment** — created Y/N
- [ ] **New GitHub repo** for board #2 code — created Y/N

### 0.5 Lock aggregator API keys
Decide per-board vs shared. **Recommendation: separate keys per board** for blast-radius isolation.
- [ ] **Adzuna** — new app ID + key obtained
- [ ] **Jooble** — new API key obtained
- [ ] **JSearch (RapidAPI)** — new subscription OR confirmed shared with quota math
- [ ] **USAJobs** — new auth key (free, but each board needs its own)
- [ ] **Greenhouse / Lever / Workday etc.** — public ATS feeds, no per-board key

### 0.6 Acknowledge what this plan does NOT do
- [ ] I understand this is a **throwaway fork**, not a reusable engine. Bug fixes won't propagate to pmhnp or future boards.
- [ ] I accept that boards #3, #4, #5 will each need their own version of this work (with shared learnings via a playbook).
- [ ] I will revisit the "build a real multi-tenant platform" decision after 3 boards are live.

---

## Phase 1 — Repo Reset

**Goal:** Get this folder onto a fresh git history pointing at the new board's GitHub repo.

**Estimated time:** 30 minutes.

### 1.1 Verify this is the copy, not the real repo
```bash
git -C "c:/Users/sathish.kumar/PMHNP-Job-Board-Fork" remote -v
# If it says origin -> github.com/dvskr/PMHNP-Job-Board.git, this is the clone.
# Confirm you are NOT in the actual pmhnp working directory before proceeding.
```
- [ ] Confirmed this folder is the **copy** (not the production checkout).

### 1.2 Nuke git history
```bash
# Windows PowerShell
Remove-Item -Recurse -Force "c:\Users\sathish.kumar\PMHNP-Job-Board-Fork\.git"
```
- [ ] `.git/` directory removed.

### 1.3 Re-init git and point at new repo
```bash
cd "c:/Users/sathish.kumar/PMHNP-Job-Board-Fork"
git init
git remote add origin https://github.com/<your-org>/<board-2-repo>.git
git branch -M main
```
- [ ] Git initialized.
- [ ] Remote set to new board #2 repo.

### 1.4 Rename the folder (optional but recommended)
The folder is named `PMHNP-Job-Board-Fork`. Rename it to match board #2 so you don't get confused.
- [ ] Folder renamed to: `c:\Users\sathish.kumar\<new-board-name>`

### 1.5 First commit — baseline before any deletion
```bash
git add -A
git commit -m "baseline: cloned from pmhnp before strip"
git push -u origin main
```
- [ ] Baseline committed and pushed. (You can `git reset --hard` back to this if Phase 2 deletes too much.)

---

## Phase 2 — Delete PMHNP-Specific Files

**Goal:** Remove every file that's pure PMHNP/healthcare content. This is mechanical — no thinking required, just execution.

**Estimated time:** 1–2 hours.

After each section, run `npm run type-check` to catch broken imports. Expected to see errors after deletes — fix in Phase 4 (strip) and Phase 5 (replace).

### 2.1 Delete blog content (87 files)
```bash
rm -rf content/blog/*.mdx
```
- [ ] All 87 PMHNP-specific MDX blog posts deleted.
- [ ] Keep `content/blog/` directory itself (will refill in Phase 8).

### 2.2 Delete PMHNP scripts
The `scripts/` folder has ~125 files. ~110 are PMHNP-specific audits, backfills, and reconciliation scripts. **Easier to delete the whole folder and re-add the ~12 generic ones.**

```bash
# Save the ~12 generic scripts to preserve, then nuke
mkdir -p _preserve
mv scripts/check-schema.ts _preserve/
mv scripts/migrate-prod.ts _preserve/
mv scripts/mark-migrations-applied.ts _preserve/
mv scripts/run-ingestion.ts _preserve/
mv scripts/run-eval.ts _preserve/
mv scripts/run-recommendations.ts _preserve/
mv scripts/seed-test-candidates.ts _preserve/
mv scripts/set-admin.ts _preserve/
mv scripts/reset-unlocks-for-user.ts _preserve/
mv scripts/sync-prod-jobs-to-local.ts _preserve/
mv scripts/verify-jd-render.ts _preserve/
mv scripts/list-all-crons.ts _preserve/
mv scripts/tsconfig.json _preserve/ 2>/dev/null

rm -rf scripts
mkdir scripts
mv _preserve/* scripts/
rm -rf _preserve
```
- [ ] PMHNP audit/backfill/check scripts deleted.
- [ ] ~12 generic scripts preserved.

### 2.3 Delete PMHNP brand assets
```bash
rm -f public/pmhnp_logo.png
rm -f public/logo.png
rm -f public/logo-cropped.png
rm -rf public/videos          # all 20 PMHNP-branded videos
rm -rf public/resume          # personal PMHNP resume + healthcare ATS CSV
rm -f public/google4912b114c3b602cd.html  # PMHNP Google Search Console verification
```
- [ ] PMHNP brand assets removed.
- [ ] Review `public/illustrations/` — keep generic UI illustrations, delete healthcare-specific ones.

### 2.4 Delete docs (most are PMHNP-specific)
```bash
rm -rf docs
```
- [ ] Entire `docs/` folder deleted. (Generic templates like incident-response.md / dpia.md / compliance-audit.md can be re-imported later if needed.)

### 2.5 Delete autofill browser extension
The Chrome extension is PMHNP-specific (healthcare profile field regex). Board #2 doesn't need it; you can build one later if there's a real autofill use case.
```bash
rm -rf pmhnp-autofill-extension
rm -f .github/workflows/autofill-tests.yml
```
- [ ] Autofill extension folder deleted.
- [ ] Autofill GitHub workflow deleted.

### 2.6 Delete PMHNP-specific app routes
```bash
# All 32 hardcoded taxonomy directories
rm -rf app/jobs/addiction app/jobs/behavioral-health app/jobs/child-adolescent
rm -rf app/jobs/community-health app/jobs/correctional app/jobs/crisis
rm -rf app/jobs/geriatric app/jobs/lgbtq app/jobs/veterans app/jobs/va
rm -rf app/jobs/locum-tenens app/jobs/substance-abuse app/jobs/telehealth
rm -rf app/jobs/inpatient app/jobs/outpatient app/jobs/private-practice
rm -rf app/jobs/hospital app/jobs/remote app/jobs/travel
rm -rf app/jobs/per-diem app/jobs/full-time app/jobs/part-time
rm -rf app/jobs/contract app/jobs/1099 app/jobs/entry-level
rm -rf app/jobs/new-grad app/jobs/mid-career app/jobs/senior

# PMHNP-specific resource pages
rm -rf app/resources/1099-vs-w2
rm -rf app/resources/fpa-guide
rm -rf app/resources/private-practice-guide

# Salary guide is currently hardcoded PMHNP — rebuild later
rm -rf app/salary-guide

# Programs (PMHNP director outreach) — niche-specific feature
rm -rf app/for-programs

# Keep these but they'll be heavily rewritten in Phase 8:
# app/page.tsx, app/about, app/for-employers, app/for-job-seekers,
# app/faq, app/pricing
```
- [ ] 32 PMHNP taxonomy directories deleted.
- [ ] PMHNP-specific resource pages deleted.
- [ ] Salary guide pages deleted (will rebuild for niche).
- [ ] Programs page deleted.

### 2.7 Delete PMHNP test data and seed
```bash
rm -rf test-data/sample-pmhnp-resume.txt
# Keep prisma/seed.ts but rewrite in Phase 5
```
- [ ] PMHNP test resume deleted.

### 2.8 Delete fork-specific top-level files
```bash
rm -f README.md  # entire file is PMHNP marketing
```
- [ ] PMHNP README deleted. (Write a new minimal one at end of Phase 10.)

### 2.9 Commit
```bash
git add -A
git commit -m "phase 2: delete pmhnp-specific files (blog, scripts, assets, docs, taxonomy routes)"
```
- [ ] Phase 2 committed.

---

## Phase 3 — Schema Reset

**Goal:** Get a clean Prisma schema without healthcare-specific tables and columns, ready for board #2's fresh DB.

**Estimated time:** 2–4 hours.

### 3.1 Decision: nuke migrations or keep?
**Recommendation: nuke and start fresh.** The 46 existing migrations contain incremental changes that produce the current schema; a fresh DB doesn't need that history.

```bash
rm -rf prisma/migrations
```
- [ ] Old migrations deleted.

### 3.2 Strip healthcare-specific tables from schema.prisma
Open `prisma/schema.prisma` and delete these models entirely:

- [ ] `CandidateLicense` (healthcare licensing — not relevant unless niche needs it)
- [ ] `CandidateCertification` (if not relevant)
- [ ] `ProgramDirectorLead` (APNA grad program outreach — pmhnp-only)
- [ ] `EmployerCandidateAlert` if it has healthcare-specific fields

Keep but review:
- [ ] `UserProfile` — remove fields: `npiNumber`, `deaNumber`, `deaExpirationDate`, `licenseStates`, `specialties`, `sensitiveDataConsent` (re-add if niche needs)
- [ ] `Job` — remove fields: `clinical_setting`, `patient_population`
- [ ] `JobApplication` — review screening answer fields
- [ ] `CandidateWorkExperience` — remove `practiceSetting`, `supervisorName`, `supervisorContact` if not relevant

Add a generic JSONB field for niche extension:
```prisma
model UserProfile {
  // ... existing fields
  customFields Json? @default("{}")
}

model Job {
  // ... existing fields
  customFields Json? @default("{}")
}
```
- [ ] `customFields Json?` added to `UserProfile`.
- [ ] `customFields Json?` added to `Job`.
- [ ] `customFields Json?` added to `EmployerJob`.

### 3.3 Generate fresh init migration
```bash
# Make sure DATABASE_URL points to your NEW board #2 Supabase project
npx prisma migrate dev --name init
```
- [ ] Fresh migration generated in `prisma/migrations/0_init/`.
- [ ] Migration applies cleanly against new Supabase project.

### 3.4 Rewrite seed.ts
Open `prisma/seed.ts` and replace the 5 PMHNP job entries with 5 niche-appropriate sample jobs. This is mostly for local development.
- [ ] `prisma/seed.ts` rewritten with niche-appropriate jobs.
- [ ] `npx prisma db seed` runs without error.

### 3.5 Commit
```bash
git add -A
git commit -m "phase 3: schema reset — strip healthcare fields, add customFields JSON, fresh init migration"
```
- [ ] Phase 3 committed.

---

## Phase 4 — Strip PMHNP Code From Kept Files

**Goal:** Remove every hardcoded PMHNP string, brand reference, and healthcare assumption from files you're keeping.

**Estimated time:** 1–2 days.

For each file: open, find PMHNP-specific code, replace with placeholders (you'll fill in real niche logic in Phase 5).

### 4.1 Core niche logic files (will be fully rewritten in Phase 5)
Add `// TODO(phase-5): rewrite for <niche>` markers; replace content with stubs that return safe defaults:

- [ ] `lib/utils/job-filter.ts` — stub `classifyRelevance` to return `{ relevant: true, tier: 'pending' }` so ingestion doesn't crash
- [ ] `lib/llm-enrichment.ts` — stub the prompt; the LLM rescue can be disabled until Phase 5
- [ ] `lib/salary-normalizer.ts` — replace `PMHNP_SALARY_RANGES` with generic placeholders ($20k–$500k W2, $10–$300/hr); narrow in Phase 5
- [ ] `lib/aggregators/search-terms/adzuna.ts` — replace array with `[]` (no search terms = no ingestion until Phase 5)
- [ ] `lib/aggregators/search-terms/fantastic-jobs-db.ts` — same
- [ ] `lib/aggregators/search-terms/usajobs.ts` — same
- [ ] `lib/aggregators/constants.ts` — empty `TOP_EMPLOYERS = []`
- [ ] `lib/pseo/category-tagger.ts` — empty `CANONICAL_CATEGORY_SLUGS = []`
- [ ] `lib/pseo/category-asset-registry.ts` — empty `CATEGORY_ASSET_REGISTRY = {}`
- [ ] `lib/pseo/category-faq-data.ts` — empty FAQ map
- [ ] **DELETE** `lib/state-practice-authority.ts` entirely (only re-add if niche has state licensing)

### 4.2 Brand + config files
- [ ] `lib/env.ts` — remove `EMAIL_FROM`, `EMAIL_FROM_MARKETING`, `EMAIL_REPLY_TO`, `EMAIL_ASSETS_URL`, `SALARY_GUIDE_URL` defaults. Make them required env vars with no fallback.
- [ ] `lib/email-service.ts:19` — remove `https://pmhnphiring.com` fallback. Throw if `NEXT_PUBLIC_BASE_URL` is unset.
- [ ] `lib/email-service.ts` lines 45–57 — remove all hardcoded from-addresses. Read from env.
- [ ] `lib/email-templates-v2.ts:77,141-145` — remove "PMHNP Hiring" preheader and brand mentions. Use a `pack.brand.name` style variable read from env or config.
- [ ] `lib/config.ts:19-22` — remove hardcoded pricing (`postingPrice: 199`, etc.). Read from env or pack config. Decide if board #2 is free posting or paid (lock in Phase 0).
- [ ] `lib/config.ts:14` — change `type PricingTier = 'pro'` if board #2 has different tiers.
- [ ] `config/brand.ts` (if exists) — replace every value (name, domain, baseUrl, social URLs, support email).

### 4.3 App-level
- [ ] `app/layout.tsx` — replace root metadata (title, description, OG defaults, applicationName, Schema.org Organization name). Strip PMHNP keywords.
- [ ] `app/robots.ts` — review hardcoded paths and AUTH_REBLOCK_DATE logic; reset for new domain.
- [ ] `app/sitemap.ts` — verify it reads from DB, not hardcoded.
- [ ] `app/feed.xml/route.ts` and `app/blog/feed.xml/route.ts` — replace channel title/description.
- [ ] `app/page.tsx` — delete content; rewrite in Phase 8.
- [ ] `app/about/page.tsx` — delete content; rewrite in Phase 8.
- [ ] `app/for-employers/page.tsx` — delete content; rewrite in Phase 8.
- [ ] `app/for-job-seekers/page.tsx` — delete content; rewrite in Phase 8.
- [ ] `app/faq/page.tsx` — delete content; rewrite in Phase 8.
- [ ] `app/pricing/page.tsx` — delete content; rewrite in Phase 8.
- [ ] `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/security/page.tsx`, `app/sub-processors/page.tsx`, `app/do-not-sell/page.tsx`, `app/data-request/page.tsx` — replace "PMHNP Hiring" with new brand name. Otherwise keep generic compliance copy.

### 4.4 Middleware
- [ ] `middleware.ts` — remove hardcoded `CITY_ELIGIBLE_TAXONOMIES` PMHNP slugs. Make taxonomy validation read from a pack config.

### 4.5 Components
- [ ] `components/JobCard.tsx` — search for PMHNP/psychiatric strings, remove.
- [ ] `components/HomepageHero.tsx` — replace image alt text "Diverse community of PMHNP professionals".
- [ ] `components/jobs/LinkedInFilters.tsx` — remove hardcoded filter chips (Telehealth, Per Diem, Locum Tenens, New Grad). These come from pack/taxonomy in Phase 5.
- [ ] `components/CategoryFAQ.tsx`, `components/StateFAQ.tsx`, `components/CategoryHero.tsx` — read data from props, not hardcoded.
- [ ] `components/LicensureChecker.tsx` — **delete** if niche has no licensure.
- [ ] `components/Comparison.tsx` — delete or rewrite (hardcoded vs Indeed/LinkedIn comparison with PMHNP framing).
- [ ] `components/Testimonial.tsx` — delete or replace testimonials.
- [ ] `components/BrowseByState.tsx` — verify it reads from DB.
- [ ] `components/SalaryCalculator.tsx`, `components/SalaryComparisonWidget.tsx`, `components/SalaryInsights.tsx`, `components/SalaryGuideForm.tsx`, `components/SalaryGuideSection.tsx` — review for hardcoded salary ranges. Replace.

### 4.6 vercel.json
```bash
# Replace with minimal config — crons are moving to Inngest in Phase 7
cat > vercel.json << 'EOF'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "headers": []
}
EOF
```
- [ ] `vercel.json` cron entries removed.

### 4.7 package.json
- [ ] `package.json:2` — change `"name": "pmhnp-job-board"` to `"name": "<new-board-slug>"`

### 4.8 Type-check
```bash
npm run type-check
```
- [ ] All TypeScript errors from Phase 2 deletions resolved (or noted as Phase 5 work).

### 4.9 Commit
```bash
git add -A
git commit -m "phase 4: strip pmhnp code from kept files (stubs in place for phase 5)"
```
- [ ] Phase 4 committed.

---

## Phase 5 — Write Niche-Specific Modules

**Goal:** Replace the Phase 4 stubs with real niche logic. **This is the highest-value work and requires the domain expert from Phase 0.**

**Estimated time:** 1–2 weeks (mostly waiting on domain expert).

### 5.1 Relevance classifier (the most important file)
Open `lib/utils/job-filter.ts`. Write `classifyRelevance(job): { relevant, tier, reason }` for the new niche.

**Structure to follow (mirror the PMHNP shape):**
```ts
const POSITIVE_KEYWORDS = [
  // 30-60 strong positive titles/keywords for the niche
];

const NEGATIVE_KEYWORDS = [
  // 100-200 disqualifying keywords (other roles, wrong industries, etc.)
];

const CONTEXT_TERMS = [
  // 10-20 disambiguating terms
];

const EMPLOYER_PATTERNS = [
  // 5-10 employer name patterns that imply niche fit
];

export function classifyRelevance(job): RelevanceResult {
  // Tier 1: explicit title match → accept
  // Tier 2: ambiguous title + context match → accept
  // Tier 2.5: ambiguous title + employer pattern → accept
  // Tier 3: negative keyword present → reject
  // Tier 4: fallback → reject
}
```

- [ ] Domain expert has written `POSITIVE_KEYWORDS`, `NEGATIVE_KEYWORDS`, `CONTEXT_TERMS`, `EMPLOYER_PATTERNS`.
- [ ] `classifyRelevance` implemented with tier logic.
- [ ] Domain expert manually classifies 50 sample jobs; classifier agrees on ≥90% of them.

### 5.2 LLM enrichment prompt
Open `lib/llm-enrichment.ts`. Rewrite the system prompt for the niche.

- [ ] Prompt mentions the niche by name (e.g., "Senior Software Engineer roles").
- [ ] Extraction schema lists niche-appropriate fields (no `clinical_setting`/`patient_population`; instead maybe `tech_stack`, `seniority_level`, etc.).
- [ ] Salary guard rails (e.g., $40k–$500k/yr) match the niche's realistic range.
- [ ] Field merger only fills nulls; never overwrites existing values.

### 5.3 Salary normalizer bounds
Open `lib/salary-normalizer.ts`. Replace `PMHNP_SALARY_RANGES`:
- [ ] `min`, `max` (W2 annual) set for niche
- [ ] `contractorHourlyMin`, `contractorHourlyMax` set for niche
- [ ] LLM enrichment prompt salary range matches these

### 5.4 Aggregator search terms
For each file in `lib/aggregators/search-terms/`:
- [ ] `adzuna.ts` — 10–25 niche-specific search queries
- [ ] `fantastic-jobs-db.ts` — niche keywords for RapidAPI queries
- [ ] `usajobs.ts` — federal job titles relevant to the niche (or empty array if N/A)

### 5.5 Aggregator company allowlists
`lib/aggregators/constants.ts`:
- [ ] `TOP_EMPLOYERS` filled with 30–100 known employers in the niche

For each ATS adapter that has a tenant subdomain list (greenhouse, lever, workable, etc.):
- [ ] Tenant lists updated for niche-specific employers known to use that ATS

### 5.6 pSEO taxonomy
Open `lib/pseo/category-tagger.ts`:
- [ ] `CANONICAL_CATEGORY_SLUGS` lists 10–25 niche-appropriate categories (e.g., for software eng: `frontend`, `backend`, `fullstack`, `mobile`, `devops`, `ml`, `security`, `embedded`)
- [ ] `RULES` object has keyword matchers per category

Open `lib/pseo/category-asset-registry.ts`:
- [ ] `CATEGORY_ASSET_REGISTRY` has an entry per category (hero image URL, color scheme, blurb)

Open `lib/pseo/category-faq-data.ts`:
- [ ] FAQ entries for each category (3–5 Q&As each)

### 5.7 Create new app/jobs/[category]/ structure
Since you deleted the 32 hardcoded taxonomy folders, create a generic dynamic route:
- [ ] `app/jobs/[category]/page.tsx` — reads category from URL, validates against `CANONICAL_CATEGORY_SLUGS`, renders generic category template
- [ ] `app/jobs/[category]/[state]/page.tsx` — category × state matrix
- [ ] `app/jobs/[category]/city/[slug]/page.tsx` — category × city matrix

### 5.8 Email strings
Open `lib/email-templates-v2.ts` and `lib/email-service.ts`:
- [ ] Subject lines rewritten for niche
- [ ] Body copy mentions niche role correctly ("New PMHNP jobs" → "New <niche> jobs")
- [ ] Preheader text uses new brand name

### 5.9 Commit
```bash
git add -A
git commit -m "phase 5: niche-specific modules — relevance classifier, taxonomy, prompts, salary bounds"
```
- [ ] Phase 5 committed.

---

## Phase 6 — Infrastructure Provisioning

**Goal:** Stand up all the external services board #2 needs. Most of this was done in Phase 0; this section is checklist verification + env wiring.

**Estimated time:** 4–8 hours of mostly-automated provisioning.

### 6.1 Supabase
- [ ] New Supabase project created (region: pick closest to user base)
- [ ] Database password saved to password manager
- [ ] `DATABASE_URL` (pooler) copied to `.env.local`
- [ ] `DIRECT_DATABASE_URL` (port 5432 direct) copied for migrations
- [ ] `NEXT_PUBLIC_SUPABASE_URL` copied
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` copied
- [ ] `SUPABASE_SERVICE_ROLE_KEY` copied
- [ ] Storage buckets created: `email-assets` (public), `resumes` (private), `avatars` (public), `company-logos` (public)
- [ ] Auth → URL Configuration → redirect URLs set for both `localhost:3000` and production domain

### 6.2 Stripe
- [ ] New Stripe account created (separate from pmhnp)
- [ ] `STRIPE_SECRET_KEY` (test mode first) in `.env.local`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env.local`
- [ ] Webhook endpoint added: `https://<board-2-domain>/api/webhooks/stripe`
- [ ] Webhook signing secret copied to `STRIPE_WEBHOOK_SECRET`
- [ ] Product + price IDs created for new niche's pricing tiers
- [ ] If board #2 is free: set `ENABLE_PAID_POSTING=false`

### 6.3 Resend
- [ ] New Resend account created
- [ ] Sending domain added (e.g., `mail.<board-2-domain>`)
- [ ] DNS records added (SPF, DKIM, DMARC) — verified in Resend dashboard
- [ ] `RESEND_API_KEY` in `.env.local`
- [ ] Webhook configured for bounces/complaints: `https://<board-2-domain>/api/webhooks/resend`
- [ ] `RESEND_WEBHOOK_SECRET` saved

### 6.4 Upstash Redis (rate limiting)
- [ ] New Upstash Redis database created
- [ ] `UPSTASH_REDIS_REST_URL` in `.env.local`
- [ ] `UPSTASH_REDIS_REST_TOKEN` in `.env.local`

### 6.5 AI providers
- [ ] OpenAI API key in `.env.local` (can share with pmhnp; if shared, ensure per-tenant spend cap in `lib/ai/gateway.ts`)
- [ ] Anthropic API key if used
- [ ] Per-pack AI spend cap configured in `lib/ai/gateway.ts`

### 6.6 Aggregator API keys
- [ ] `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` (new account recommended)
- [ ] `JOOBLE_API_KEY` (new account recommended)
- [ ] `JSEARCH_API_KEY` (RapidAPI subscription)
- [ ] `USAJOBS_AUTH_KEY` + `USAJOBS_USER_AGENT`

### 6.7 Monitoring
- [ ] New Sentry project; `SENTRY_DSN` in `.env.local`
- [ ] New Discord webhook for ingestion notifications; `DISCORD_WEBHOOK_URL` in `.env.local`
- [ ] New GA4 property; `NEXT_PUBLIC_GA_MEASUREMENT_ID` in `.env.local`
- [ ] New Google Search Console property (will verify after deploy)

### 6.8 Security secrets
- [ ] `CRON_SECRET` — fresh 32+ char random string (do NOT reuse pmhnp's)
- [ ] `BLOG_API_KEY` — fresh random string
- [ ] `EXTENSION_JWT_SECRET` — only if extension shipped

### 6.9 Validate env locally
```bash
cp .env.local.example .env.local  # fill in all values from above
npm install
npm run type-check
npx prisma generate
npx prisma migrate deploy
npm run dev
```
- [ ] App boots on `localhost:3000`
- [ ] Homepage loads (will look broken until Phase 8)
- [ ] `/api/health` returns 200

### 6.10 Commit (env values NOT committed)
```bash
git add -A
git commit -m "phase 6: infrastructure provisioned, env wired"
```
- [ ] `.env.local` is in `.gitignore` (verify!)
- [ ] Phase 6 committed.

---

## Phase 7 — Migrate Crons to Inngest

**Goal:** Replace the 55-entry `vercel.json` cron strategy with Inngest. Solves the cron limit problem permanently.

**Estimated time:** 1 week.

The codebase already has `lib/inngest/` wired up. You're extending it, not building from scratch.

### 7.1 Inventory cron endpoints to migrate
Each of these in `app/api/cron/*/route.ts` needs an Inngest function equivalent:
- [ ] `ingest` (with source + chunk params)
- [ ] `send-alerts`
- [ ] `freshness-decay`
- [ ] `expiry-warnings`
- [ ] `check-dead-links`
- [ ] `cleanup-expired`
- [ ] `cleanup-descriptions`
- [ ] `index-urls`
- [ ] `index-pseo`
- [ ] `aggregate-pseo`
- [ ] `daily-report`
- [ ] `employer-report`
- [ ] `social-post`
- [ ] `instagram-post`
- [ ] `health-anomaly-check`
- [ ] `engagement-anomaly`
- [ ] `gsc-health-check`
- [ ] `embedding-drift-check`
- [ ] `purge-inactive-users`
- [ ] `purge-soft-deleted`
- [ ] `saved-job-reminder`
- [ ] `push-notifications`
- [ ] `candidate-alerts`
- [ ] (any others under `app/api/cron/`)

### 7.2 For each: create an Inngest function
Template:
```ts
// lib/inngest/functions/<name>.ts
import { inngest } from '../client';
import { handler } from '@/app/api/cron/<name>/route';

export const <name>Fn = inngest.createFunction(
  { id: 'cron-<name>' },
  { cron: 'TZ=UTC <schedule from vercel.json>' },
  async ({ event, step }) => {
    return step.run('execute', async () => {
      // Call the underlying logic. The route handler can be refactored
      // so its core lives in a lib/ function callable from both Vercel cron
      // and Inngest.
    });
  }
);
```
- [ ] All cron functions created in `lib/inngest/functions/`.
- [ ] All registered in `lib/inngest/client.ts`.
- [ ] Inngest dashboard shows them as deployed.

### 7.3 Refactor cron route handlers to share logic
For each cron, extract the actual work into a plain function in `lib/cron/<name>.ts`:
- [ ] Route handler becomes a thin wrapper around the lib function
- [ ] Inngest function calls the same lib function
- [ ] Both paths produce identical results

### 7.4 Run in shadow mode for 3 days
- [ ] Inngest functions deployed and active
- [ ] `vercel.json` still has cron entries (running in parallel)
- [ ] Compare outputs daily: cron-run audit rows from both should match

### 7.5 Cut over
After 3 days of clean shadow-mode parity:
```bash
# Remove vercel.json cron entries (already done in Phase 4.6)
# Just verify vercel.json has no crons
grep -c '"crons"' vercel.json  # should be 0
```
- [ ] `vercel.json` has zero cron entries.
- [ ] Inngest dashboard shows all functions running on schedule.

### 7.6 Commit
```bash
git add -A
git commit -m "phase 7: migrate all crons to inngest, remove vercel cron entries"
```
- [ ] Phase 7 committed.

---

## Phase 8 — Marketing Pages + Content

**Goal:** Write the niche-specific marketing copy. Engineering is minimal; this is mostly writing.

**Estimated time:** 1–2 weeks (mostly content writer / domain expert work).

### 8.1 Required pages (rewrite content; the engineering shell stays)
- [ ] `app/page.tsx` — homepage with hero, value props, CTAs
- [ ] `app/about/page.tsx` — about the board, your mission
- [ ] `app/for-employers/page.tsx` — why employers should post here, pricing, comparison
- [ ] `app/for-job-seekers/page.tsx` — why job seekers should use this board
- [ ] `app/faq/page.tsx` — 20–40 niche-specific Q&As
- [ ] `app/pricing/page.tsx` — pricing tiers
- [ ] `app/privacy/page.tsx` — swap brand name (otherwise generic)
- [ ] `app/terms/page.tsx` — swap brand name
- [ ] `app/security/page.tsx` — swap brand name
- [ ] `app/sub-processors/page.tsx` — verify list of vendors (mostly same: Supabase, Stripe, Resend, Sentry)
- [ ] `app/do-not-sell/page.tsx` — generic, swap brand name
- [ ] `app/data-request/page.tsx` — generic DSAR intake form, swap brand name

### 8.2 Blog seed content
- [ ] 5–10 niche-relevant blog posts authored as `.mdx` files in `content/blog/`
- [ ] Each post has frontmatter (title, slug, excerpt, category, publishDate, metaTitle, metaDescription)
- [ ] Posts cover: niche overview, salary/career info, employer types, common questions

### 8.3 Brand assets
- [ ] Final logo (replaces placeholder from Phase 0)
- [ ] Favicon (32×32, 16×16, ICO)
- [ ] Apple touch icon (180×180)
- [ ] OG default image (1200×630)
- [ ] Site manifest (`public/site.webmanifest`) updated with brand name + theme color

### 8.4 Commit
```bash
git add -A
git commit -m "phase 8: marketing pages + seed blog content + brand assets"
```
- [ ] Phase 8 committed.

---

## Phase 9 — Smoke Test Ingestion

**Goal:** Prove the niche-specific classifier and aggregators actually produce relevant jobs.

**Estimated time:** 2–3 days (including manual audit).

### 9.1 Run one aggregator manually
```bash
# Pick a fast source like Adzuna or Lever first
npm run ingest -- --source=adzuna --chunk=0 --dry-run
```
- [ ] Ingestion runs without crashing
- [ ] Discord summary shows fetched/added/rejected counts
- [ ] No errors in Sentry

### 9.2 Inspect first 100 ingested jobs
- [ ] `npx prisma studio` opens Supabase
- [ ] Browse `jobs` table — visually verify the first 100 rows are niche-relevant
- [ ] **Domain expert manually rates 100 jobs for false-positive rate** (target: ≤5%)
- [ ] If false-positive rate is high → tune `classifyRelevance` and re-run

### 9.3 Run all aggregators
```bash
for source in adzuna lever workday greenhouse jsearch ashby bamboohr usajobs; do
  npm run ingest -- --source=$source
done
```
- [ ] Each source ingests without errors
- [ ] Total job count after first full ingestion: ≥500 (lower = need more search terms)

### 9.4 Check LLM enrichment cost
- [ ] `AiCallLog` table shows enrichment calls
- [ ] Cost per 100 jobs reasonable (target: <$1)
- [ ] Per-pack AI spend cap enforced

### 9.5 Validate page rendering
- [ ] `/jobs` returns >0 results
- [ ] `/jobs/<some-category>` renders correctly
- [ ] Individual job page renders with sanitized description
- [ ] `/sitemap.xml` includes job URLs

### 9.6 Commit (no code changes typically, but tag the milestone)
```bash
git tag pre-launch
git push --tags
```
- [ ] Pre-launch tag pushed.

---

## Phase 10 — Deploy + Validate

**Goal:** Push to Vercel, point DNS, verify everything works in production.

**Estimated time:** 1–2 days.

### 10.1 Deploy to Vercel
- [ ] Connect Vercel project to GitHub repo
- [ ] Set all env vars from `.env.local` in Vercel dashboard (Production + Preview environments)
- [ ] First deploy succeeds
- [ ] Run prod migration via GitHub Actions (set `PROD_DIRECT_DATABASE_URL` repo secret to port-5432 direct URL, not pooler)

### 10.2 Domain + DNS
- [ ] Domain added to Vercel project
- [ ] DNS records configured (A or CNAME)
- [ ] SSL certificate issued
- [ ] HTTPS works
- [ ] `https://<board-2-domain>` loads homepage

### 10.3 Post-deploy checklist
- [ ] Homepage loads, no console errors
- [ ] `/api/health` returns 200
- [ ] `/sitemap.xml` generates
- [ ] `/robots.txt` correct
- [ ] `/feed.xml` returns RSS
- [ ] Sign-up flow works end-to-end
- [ ] Job posting flow works (test with Stripe test mode if paid)
- [ ] Stripe webhook fires on test checkout
- [ ] Resend confirmation email arrives
- [ ] Job alert subscription works (double opt-in email arrives)
- [ ] Mobile rendering acceptable
- [ ] Lighthouse score >85 (performance, accessibility, SEO)

### 10.4 Cron / Inngest validation
- [ ] Inngest dashboard shows next-scheduled times for all functions
- [ ] First scheduled ingestion fires on schedule
- [ ] Discord receives ingestion summary

### 10.5 SEO setup
- [ ] Google Search Console property verified
- [ ] Sitemap submitted to GSC
- [ ] Bing Webmaster Tools verified + sitemap submitted
- [ ] IndexNow key file in `public/`

### 10.6 Switch Stripe to live mode
- [ ] Stripe live keys replace test keys in Vercel env
- [ ] Live webhook endpoint configured + secret updated
- [ ] One real test transaction (refund yourself)

### 10.7 Final commit
```bash
git add -A
git commit -m "phase 10: production deploy, validated end-to-end"
git tag launch
git push --tags
```
- [ ] Launch tag pushed.
- [ ] Board #2 is live.

### 10.8 Write new minimal README
Replace the deleted PMHNP README with a 50–100 line README for board #2:
- [ ] What this board is
- [ ] Tech stack one-liner
- [ ] How to run locally (env vars, `npm install`, `npm run dev`)
- [ ] How to deploy (Vercel + Supabase + Inngest)
- [ ] Link to this `BOARD_LAUNCH_PLAN.md` for the launch history

---

## Appendix A — File Inventory

### What you deleted in Phase 2
- 87 PMHNP blog MDX files
- ~110 PMHNP-specific scripts (audits, backfills, checks)
- All PMHNP brand assets (5 logos, 20 videos, 1 personal resume, 1 healthcare CSV)
- Entire `docs/` folder (PMHNP-specific runbooks, audits, master-todo)
- `pmhnp-autofill-extension/` (12 files)
- 32 hardcoded taxonomy directories under `app/jobs/`
- 3 PMHNP-specific resource pages (`1099-vs-w2`, `fpa-guide`, `private-practice-guide`)
- `app/salary-guide/` + `[state]` subpages
- `app/for-programs/` (program director outreach)
- PMHNP test resume
- Old README

### What you kept and stripped in Phase 4
- All 13 aggregator HTTP adapters
- Ingestion service + monitor + orchestrator
- Deduplicator, normalizers, parsers
- AI gateway (with new prompts)
- Stripe machinery
- Auth + Supabase wrappers
- Email service (with new strings)
- Job alerts service
- Profile + employer dashboard machinery
- Middleware (with new taxonomy validation)
- 190 API routes (most niche-agnostic)
- 100+ UI components (most niche-agnostic)
- All hooks (useSavedJobs, useAppliedJobs, etc.)
- pSEO infrastructure (wiring, not categories)
- DSAR + audit + GDPR compliance machinery
- PWA + push notification infrastructure

### What you wrote new in Phase 5
- `lib/utils/job-filter.ts` — new niche relevance classifier (~200–300 lines)
- `lib/llm-enrichment.ts` — new system prompt + extraction schema
- `lib/salary-normalizer.ts` — new salary bounds (4 numbers)
- `lib/aggregators/search-terms/*.ts` — new niche search terms
- `lib/aggregators/constants.ts` — new `TOP_EMPLOYERS` list
- `lib/pseo/category-tagger.ts` — new categories + matchers
- `lib/pseo/category-asset-registry.ts` — new asset map
- `lib/pseo/category-faq-data.ts` — new FAQ data
- `app/jobs/[category]/page.tsx` — generic dynamic taxonomy route
- New marketing MDX content for 6 pages + 5–10 blog posts (Phase 8)

---

## Appendix B — Risk Log

| Risk | Likelihood | Mitigation |
|---|---|---|
| Domain expert never delivers the relevance classifier | High | Block Phase 5 on expert commitment. Don't proceed without it. |
| Relevance classifier produces too many false positives → board ingests irrelevant jobs → SEO penalty | Med | Manual 100-job audit in Phase 9.2 before going live. |
| LLM enrichment costs balloon | Med | Per-pack spend cap in `lib/ai/gateway.ts`. Discord alert at 80%. |
| Aggregator API quota shared with pmhnp → starvation | Med | Separate keys per board (Phase 0.5). Don't share Adzuna/JSearch/Jooble. |
| Stripe flags new account as duplicate/multi-brand | Low | One Stripe account per board; never share. |
| Inngest migration breaks ingestion during shadow window | Med | 3-day shadow period before cutover (Phase 7.4). Old vercel.json crons remain as fallback. |
| `.env.local` accidentally committed | Low but high impact | Verify `.gitignore` includes it (Phase 6.10). |
| Sentry / Resend / GA quotas not configured per-board, get aggregated with pmhnp | Med | Phase 6 explicitly creates new projects for each. |
| Forgot to update DNS / SSL before go-live | Low | Phase 10.2 checklist. |
| You start board #3 without writing down what you learned from board #2 | High | After launch, write a `LAUNCH_LEARNINGS.md` capturing what was reused, what was painful, what should become a shared utility. |

---

## What to do after this board ships

This is a **fork**, not a template. You're committed to maintaining N divergent codebases until you build a real engine. Specifically:

1. **After board #2 ships** — write `LAUNCH_LEARNINGS.md` capturing what was reused, what was painful, what should be a shared utility.
2. **After board #3 ships** — extract the obviously-shared infrastructure code (aggregator adapters, deduplicator, salary parser, Stripe handler) into a small private npm package `@yourorg/jobboard-core`. Boards #4, #5 import this package.
3. **After 5 boards are live** — revisit the multi-tenant platform decision. Concrete trigger: when bug fixes take more than 1 day to ship to all boards, or when ops burden exceeds 1 day/week.
4. **Never touch pmhnphiring.com** as part of this work. It stays on its own codebase.

---

**End of plan. Delete this file after Phase 10 completes.**
