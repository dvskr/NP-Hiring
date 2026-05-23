# NP Hiring — Launch Runbook

> **What this is:** the single source of truth for the current state of `nphiring.com` and what's left to do before / during / after launch.
>
> **Status:** Code-complete. Awaiting infrastructure provisioning + asset uploads + RLS application.
>
> **Last updated:** 2026-05-23 · Commit `eec2507`
>
> **Companion docs:**
> - [BOARD_LAUNCH_PLAN.md](BOARD_LAUNCH_PLAN.md) — the strategic 10-phase plan we executed
> - [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) — granular Vercel deploy steps
> - [supabase/rls-policies.sql](supabase/rls-policies.sql) — ~50 RLS policies waiting to paste

---

## 0. Where We Are Right Now

Forked from `pmhnphiring.com` source. Rebranded + broadened to **NP Hiring** covering the full NP cohort (FNP, AGNP, PNP, NNP, WHNP, ACNP, PMHNP) plus APRN siblings (CRNA, CNM, CNS). ATS-only ingestion strategy — no aggregator scrapes. 335 NP jobs already in DB from one Lever + one Greenhouse smoke ingest.

| Metric | Value |
|---|---|
| GitHub | https://github.com/dvskr/NP-Hiring |
| Domain | nphiring.com (+ .net, .info, .store, .shop, .me defensive TLDs) |
| Supabase project | `ytpmrlpnpbdylujbtgij` (East US — North Virginia) |
| Commits | 16 |
| Type errors | 0 |
| Jobs in DB | 335 |
| Active ATS sources | 8 (Greenhouse, Lever, Workday, SmartRecruiters, Ashby, BambooHR, JazzHR, Workable) |
| Category slugs | 41 (NP/APRN/setting/job-type/experience/population) |
| Inngest scheduled crons | 53 |
| Vercel cron entries | 0 (migrated to Inngest — solves the 64-cron ceiling) |
| Tests passing imports | 82 / 82 |

---

## 1. What's Shipped (working, no further action)

### Ingestion pipeline
- 8 ATS adapters (greenhouse, lever, workday, smartrecruiters, ashby, bamboohr, jazzhr, workable)
- 4-tier deduplication (externalId → exactTitle → applyUrl → fuzzy Levenshtein)
- NP/APRN-broadened relevance classifier (word-boundary regex matching; ~80% precision at smoke)
- LLM enrichment rescue (gpt-4o-mini; salary bounds $60k–$400k)
- Dead-link health probes per source
- Auto-renewal on duplicate detection
- 240s time-budget per cron with graceful break
- Rejected-job audit log (`rejected_jobs` table)

### pSEO surface
| Route | Status |
|---|---|
| `/jobs` (main search) | ✅ Renders 335 jobs |
| `/jobs/c/<category>` (41 slugs) | ✅ Working — base category listing |
| `/jobs/c/<category>/<state>` (~2,000 URLs) | ✅ Working |
| `/jobs/c/<category>/city/<slug>` (~165k URLs) | ✅ Working |
| `/jobs/state/<state>` (51 states) | ✅ Working |
| `/jobs/city/<slug>` (~2,000 cities) | ✅ Working |
| `/jobs/metro/<slug>` | ✅ Working |
| Sitemap | ✅ Includes all 41 category URLs + state + city pages |
| 410-Gone for invalid legacy URLs | ✅ Working (protects pre-fork crawl) |
| ItemList JSON-LD on category pages | ✅ Emitted |
| JobPosting JSON-LD on detail pages | ✅ Emitted |

### Filters (jobs page)
- ✅ Search (keyword), Location, Salary range, Work mode (Remote/Hybrid/On-site)
- ✅ Job type (Full-Time/Part-Time/Contract/Per Diem/Other)
- ✅ Date posted (24h/3d/7d/30d)
- ✅ Experience (New Grad + structured years)
- ✅ **Specialty (10 NP/APRN chips: FNP, AGNP, PNP, WHNP, ACNP, PMHNP, CRNA, CNM, Telehealth, Travel)** — keys match canonical category slugs
- ✅ Filter counts API
- ✅ AI semantic search (`/api/jobs/search/semantic`) — degrades gracefully without OpenAI key

### Visuals
- ✅ Favicons, Apple touch icon, Android Chrome icons (all present)
- ✅ Site manifest (`NP Hiring` branding)
- ✅ Local UI illustrations (auth screens, empty states, dashboard stats)
- ✅ Push notification icons
- ⚪ Brand logo + 75+ Supabase-hosted assets — bucket empty (see §3.B)

### Admin (13 pages)
- ✅ Index, Analytics, Jobs CRUD, Users, Email broadcasts, Blog CRUD
- ✅ Cron management UI (with manual trigger)
- ✅ Health, SEO Health, DMARC, Settings, PD Campaign, Outreach
- ✅ All gated by `requireApiAdmin`
- ⚪ Becoming admin: `npx tsx scripts/set-admin.ts <email>` (one-time bootstrap)

### Employer dashboard
- ✅ Job postings management, Applicants view, Analytics, Saved Candidates, Messages
- ✅ Free posting flow (Stripe disabled via `ENABLE_PAID_POSTING=false`)
- ✅ Talent search — 19 NP/APRN specialty presets (was 11 PMHNP psych populations)
- ✅ Token-based access via `/employer/dashboard/[token]`

### Candidate dashboard
- ✅ `/dashboard`, `/saved`, `/my-applications`, `/messages`, `/settings`, `/email-preferences`
- ✅ All gracefully handle empty data states

### Email + Notifications
- ✅ 25 email type definitions, NP-broad copy throughout
- ✅ Resend webhook (bounces, complaints update suppression flags)
- ✅ Discord notifier (graceful no-op without webhook)
- ✅ Web push (graceful no-op without VAPID keys)
- 🟡 All sends silently fail until `RESEND_API_KEY` is set (see §3.A)

### Security
- ✅ Blog PATCH uses `timingSafeEqual`
- ✅ Extension JWT requires `EXTENSION_JWT_SECRET` (no NEXTAUTH_SECRET fallback)
- ✅ Inngest crons throw if `NEXT_PUBLIC_BASE_URL` unset (no localhost fallback in prod)
- ✅ All `/api/cron/*` use `verifyCronOrAdmin`
- ✅ Stripe webhook: signature verification + idempotency
- ✅ Resume virus scan via Cloudmersive (fail-closed default)
- ✅ Security headers: HSTS, X-Frame DENY, nonce-per-request CSP, Permissions-Policy
- ✅ `.env*` gitignored, no leaked secrets in git history
- 🔴 **RLS policies not yet applied** — `supabase/rls-policies.sql` waiting (see §3.A)

### Tests + CI
- ✅ 82 test files — all imports valid against current code
- ✅ 4 GitHub Actions workflows green (`ai-gates`, `seo-guard`, `shortlinks-tests`, `migrate-prod`)

---

## 2. What's Scraped (deferred / dead code, not blocking)

| Item | Why deferred |
|---|---|
| Category asset registry — empty stub | Pages render with neutral fallback. Phase 8 work (upload assets + register URLs). |
| Category FAQ data — empty stub | FAQPage JSON-LD skipped when empty. Phase 8 (editorial). |
| 6 orphan email types (`application_notification`, `status_update`, etc.) | Defined in `EmailType` union but no sender functions. Harmless. |
| `lib/pseo/setting-state-template.tsx` PMHNP-flavored copy | 780 lines that render but with stale category descriptions. Pages work; copy is stale. |
| `pseo_stats` table empty | Populates after first `aggregate-pseo` cron run (4× daily). |
| `city_snippets`, `category_city_snippets` tables | Unreferenced in current rendering path. LLM-generated narrative overrides — Phase 8. |
| `admin/blog` uses plain textarea | `react-quill-new` in deps but not wired. Functional, not pretty. |
| 510 `console.log` statements | No lint rule against them. Should migrate to structured logger post-launch. |
| 31 `as any` casts | Tech debt. `smartrecruiters.ts` JSON parses are risky — add Zod post-launch. |
| Stripe paid posting flow | `ENABLE_PAID_POSTING=false`. Re-enable when ready to charge. |
| `ProgramDirectorLead` table (APNA outreach) | Schema kept; repurposable for nursing-school directors later. |
| Browser autofill extension | Deleted in Phase 2. Optional add-back post-launch. |
| Blog content | `content/blog/` empty. `HomepageBlogSection` links to real pages (no 404s) but `/blog` says "No posts yet". |

---

## 3. What You Must Do

### 3.A Critical — must do BEFORE first deploy

| # | Action | Time | Why critical |
|---|---|---|---|
| 1 | **Paste [supabase/rls-policies.sql](supabase/rls-policies.sql)** in Supabase Dashboard → SQL Editor → Run | 2 min | Without RLS, the anon key (which ships to every browser) can read every user's PII, every employer's data, every message, every saved candidate. Single biggest security gap. |
| 2 | **Sign up Resend** → add `nphiring.com` domain → add SPF/DKIM/DMARC DNS records → wait for verification | 15 min | All transactional emails (welcome, alerts, confirmations) silently fail without this. |
| 3 | **Sign up Inngest** → create env `Production` for app `np-hiring` → copy Event Key + Signing Key | 5 min | All 53 scheduled crons (ingestion, alerts, indexing, expiry) register but never fire without keys. |
| 4 | **Configure Supabase Auth redirect URLs**: Dashboard → Authentication → URL Configuration → add `https://nphiring.com/*` and `https://www.nphiring.com/*` | 2 min | OAuth (Google sign-in) callback URL must match or auth flow 400s. |
| 5 | **Generate `CRON_SECRET`**: `openssl rand -hex 32` | 30 sec | Protects every `/api/cron/*` endpoint. ≥16 chars required. |
| 6 | **Add Vercel env vars** (full list in [DEPLOY_CHECKLIST.md §10.2](DEPLOY_CHECKLIST.md)) | 20 min | See §6 below for the canonical critical list. |
| 7 | **Add GitHub Actions secret** `PROD_DIRECT_DATABASE_URL` (same value as Vercel `DIRECT_URL` — port 5432 direct, NOT pooler) | 1 min | The `migrate-prod.yml` workflow runs `prisma migrate deploy` against this. |

### 3.B Should do for usable launch

| # | Action | Time | Why |
|---|---|---|---|
| 8 | **Bootstrap admin user**: `npx tsx scripts/set-admin.ts your-email@example.com` | 1 min | No admin-signup UI; this is the only way to access `/admin/*` pages. Run AFTER your first signup so the UserProfile row exists. |
| 9 | **Upload minimum brand assets** to new Supabase `site-assets` bucket | 30 min | URLs already point at `ytpmrlpnpbdylujbtgij.supabase.co/site-assets/...` but bucket is empty. Pages render with broken-icons until uploaded. **Minimum set:** logo (1), homepage hero (1), 4 OG share images, 6 about-page dioramas, 8 step-flow images, 11 employer icons, 10 job-seeker icons. ~40 files. |
| 10 | **Set `OPENAI_API_KEY`** | 1 min | Enables LLM job-description enrichment (raises ingest acceptance rate ~5%), recommendation engine, semantic search. Set per-pack spend cap in `lib/ai/gateway.ts` before going live. |
| 11 | **DNS:** Add A record `@` → `76.76.21.21`, CNAME `www` → `cname.vercel-dns.com` in GoDaddy | 5 min |  Wait 5–30 min for propagation. Vercel auto-issues SSL. |
| 12 | **Post-deploy: Sync Inngest endpoint** at https://app.inngest.com → `https://nphiring.com/api/inngest` → confirm dashboard shows 6+ function groups synced | 2 min | Without sync, scheduled crons don't fire. |

### 3.C Post-launch (do within first week)

| # | Action |
|---|---|
| 13 | Seed 5–10 NP-focused blog posts as `.mdx` files in `content/blog/`. Homepage section links to real pages now (no dead links) but `/blog` shows "No posts yet". |
| 14 | Google Search Console: add property `https://nphiring.com`, verify, submit sitemap |
| 15 | Bing Webmaster Tools: same + grab `BING_WEBMASTER_API_KEY` for IndexNow |
| 16 | Generate `INDEXNOW_API_KEY`, save key file at `public/<key>.txt`, set env |
| 17 | Set `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` for error tracking |
| 18 | Set Discord `DISCORD_WEBHOOK_URL` for ingestion run summaries |
| 19 | Set GA4 `NEXT_PUBLIC_GA_MEASUREMENT_ID` |
| 20 | Stripe live keys + `ENABLE_PAID_POSTING=true` when ready to charge |
| 21 | Rewrite remaining PMHNP-flavored marketing copy on `/for-employers`, `/for-job-seekers`, `/faq` (functional today but psych-leaning) |
| 22 | Add Upstash Redis for rate limiting under load |

---

## 4. Deploy Procedure

The granular step-by-step is in [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md). High-level:

```
1. Complete §3.A items 1–7 above
2. Vercel: New Project → import github.com/dvskr/NP-Hiring
3. Vercel: paste all env vars (Production + Preview)
4. Click Deploy — first build runs `prisma migrate deploy && prisma generate && next build`
5. Add domain `nphiring.com` in Vercel project Settings → Domains
6. Wait for DNS + SSL (5–30 min)
7. Sync Inngest endpoint
8. Add Resend webhook endpoint
9. Run smoke tests (§5 below)
10. Hit /admin to bootstrap admin user
```

Expected total wall-clock: **~2 hours** if all infra accounts already created.

---

## 5. Post-Deploy Smoke Tests

Run these from your local machine after the deploy completes:

```powershell
$base = "https://nphiring.com"
$cron = "<your CRON_SECRET>"

# Health
curl $base/api/health
# Expected: 200, JSON with database status: up

# SEO
curl -I $base/sitemap.xml
curl -I $base/robots.txt
curl -I $base/feed.xml

# Critical pages
curl -I $base/
curl -I $base/jobs
curl -I $base/jobs/c/family-practice
curl -I $base/jobs/c/anesthesia/california
curl -I $base/about
curl -I $base/for-employers
curl -I $base/for-job-seekers

# Cron-protected endpoint (requires CRON_SECRET)
curl -H "Authorization: Bearer $cron" "$base/api/cron/freshness-decay"
# Expected: 200

# Smoke ingestion via Inngest manual trigger (Inngest dashboard → invoke)
# Watch Discord channel + Inngest run log

# First signup smoke test (browser)
# 1. Visit https://nphiring.com/signup
# 2. Create account
# 3. Confirm email arrives in <30s (via Resend)
# 4. Click confirm → land on /dashboard
# 5. Then run: `npx tsx scripts/set-admin.ts <your-email>` locally pointing at prod DB
# 6. Sign back in → /admin should be accessible
```

---

## 6. Canonical Env Var List (paste into Vercel)

### Required (deploy fails / silently breaks without these)

```env
# Database — REQUIRED at both build and runtime
DATABASE_URL=postgresql://...@aws-0-us-east-1.pooler.supabase.com:6543/postgres  # pooler
DIRECT_URL=postgresql://postgres:...@db.ytpmrlpnpbdylujbtgij.supabase.co:5432/postgres  # direct

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://ytpmrlpnpbdylujbtgij.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# App
NEXT_PUBLIC_BASE_URL=https://nphiring.com
NODE_ENV=production
CRON_SECRET=<32+ char hex from openssl rand -hex 32>

# Inngest — REQUIRED for crons
INNGEST_EVENT_KEY=<from app.inngest.com>
INNGEST_SIGNING_KEY=<from app.inngest.com>

# Email — REQUIRED for any send
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
EMAIL_FROM=NP Hiring <noreply@nphiring.com>
EMAIL_FROM_MARKETING=NP Hiring <alerts@nphiring.com>
EMAIL_REPLY_TO=support@nphiring.com
```

### Recommended (features work fully)

```env
# AI
OPENAI_API_KEY=sk-...

# Rate limiting (recommended pre-launch)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Monitoring
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ORG=<org>
SENTRY_PROJECT=<project>
SENTRY_AUTH_TOKEN=<for source map upload>
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX

# Storage / brand assets
EMAIL_ASSETS_URL=https://ytpmrlpnpbdylujbtgij.supabase.co/storage/v1/object/public/email-assets
SALARY_GUIDE_URL=https://ytpmrlpnpbdylujbtgij.supabase.co/storage/v1/object/public/resources/NP_Salary_Guide_2026.pdf
```

### Optional (feature-gated)

```env
# Stripe (only if paid posting enabled)
ENABLE_PAID_POSTING=false
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# SEO indexing (post-launch)
INDEXNOW_API_KEY=<8-128 char hex>
BING_WEBMASTER_API_KEY=<from Bing Webmaster>
BING_WEBMASTER_VERIFICATION=<HTML meta tag value>
GOOGLE_INDEXING_CREDENTIALS=<service account JSON, stringified>

# Web push (if shipping push notifications)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<generated>
VAPID_PRIVATE_KEY=<generated>

# Blog API (only if you'll POST to /api/blog from a script)
BLOG_API_KEY=<random>

# Browser extension (only if shipping)
EXTENSION_JWT_SECRET=<random>
```

---

## 7. Risk Log (pre-mortem)

| Risk | Severity | Mitigation |
|---|---|---|
| RLS not applied → anon can read all user PII | **CRITICAL** | §3.A item 1 — must do before first user signup |
| `RESEND_API_KEY` empty → all email sends silently fail | High | Set in env. Test welcome email after first deploy. |
| `INNGEST_EVENT_KEY` + `SIGNING_KEY` missing → no crons fire | High | Set in env + sync endpoint post-deploy |
| 75+ image URLs 404 in prod | Medium (visual) | Upload minimum brand asset set (§3.B item 9) |
| Supabase OAuth callback URL not configured → sign-up 400s | High | §3.A item 4 — quick fix |
| First Prisma migration fails | Low | Already tested via `db push`; baseline migration in `prisma/migrations/0_baseline/` |
| Inngest first sync fails | Low | Re-sync from dashboard; functions register at build time |
| Stripe webhook 500s | N/A | Stripe disabled until `ENABLE_PAID_POSTING=true` |
| Per-tenant AI cost runaway on OpenAI | Med | Set `OPENAI_API_KEY` only when ready; add hard spend cap in `lib/ai/gateway.ts` |
| Search engines index thin/empty pages | Med | Sitemap only includes states/cities with jobs. Empty category pages get `noindex,follow`. |
| Smoke test reveals filter false positives | Med | Word-boundary fix already deployed; iterate post-launch |
| Auth-page deindex window already expired (was 2026-05-19) | Med | Check GSC; if `/login` `/signup` `/messages` etc. show "Indexed though blocked", re-add to `FULL_DISALLOW` in `app/robots.ts` |
| GitHub Actions `PROD_DIRECT_DATABASE_URL` missing | High | §3.A item 7 — migrations can't apply |
| Forgot to add `nphiring.com` to Vercel project domains | Low | DNS won't route until added; Vercel default `<project>.vercel.app` works as fallback for testing |

---

## 8. Post-Launch 24-Hour Watchlist

Monitor these for the first 24 hours after `https://nphiring.com` goes live:

| Signal | Where to check | Action if alert |
|---|---|---|
| Sentry errors | https://sentry.io → project → Issues | >10 in 1h: open most recent 5 traces |
| Inngest function execution | https://app.inngest.com → app → Runs | Any failure: open run log, manual retry |
| Vercel function timeouts | https://vercel.com → project → Functions | Functions >10s: check logs, consider increasing `maxDuration` |
| Supabase connection pool | Supabase dashboard → Database → Connections | >40/50 used: scale up, reduce pool consumers |
| First user signup | Manual test via incognito | Confirmation email must arrive in <30s |
| Manual cron trigger | `curl -H "Authorization: Bearer $CRON" $base/api/cron/freshness-decay` | Non-200: check route exists + secret matches |
| Mobile rendering | Browse from phone | No horizontal scroll; bottom nav clickable |
| Lighthouse | https://pagespeed.web.dev/?url=https://nphiring.com | Performance >85, SEO >95 target |
| Ingestion run | Inngest dashboard + Discord (if webhook set) | First Greenhouse run should complete + add jobs |
| DB size | Supabase dashboard → Database → Storage | Should be <10MB pre-launch; monitor growth |

None of these are unrecoverable without rollback. Env-var edits, Inngest resync, and Supabase scaling are all minutes-not-hours fixes.

---

## 9. Post-Launch Iteration Order (recommended)

**Week 1:** stabilize
- Bootstrap admin (§3.B item 8)
- Upload minimum brand assets (§3.B item 9)
- Set OpenAI key + enable LLM enrichment (§3.B item 10)
- Watch the 24-hour signals
- Manual review of first 100 ingested NP jobs for false-positive rate

**Week 2:** iterate on content
- Seed 5–10 blog posts (§3.C item 13)
- Rewrite stale marketing copy on for-employers / for-job-seekers / faq pages
- Configure GSC + Bing Webmaster + IndexNow (§3.C items 14–16)
- Set up Sentry + Discord webhook + GA4 (§3.C items 17–19)
- Decide on Stripe activation timeline (§3.C item 20)

**Week 3–4:** scale and tune
- Expand ATS tenant lists to add more NP-broad employers (current lists are PMHNP-curated; need primary-care groups, hospital systems, telehealth platforms)
- Tune relevance classifier based on observed false positives
- Build the NP gold-standard test suite for the relevance classifier
- Replace `as any` JSON parses in `smartrecruiters.ts` with Zod
- Migrate `console.log` statements to structured logger
- Add Upstash Redis if seeing rate-limit-related issues

**Month 2+:** growth
- AI enrichment cost optimization (caching, prompt versioning)
- Per-pack AI spend caps if multi-board future planned
- Stripe live mode + paid posting tiers
- Push notifications + browser extension (if user demand)

---

## 10. Quick Reference

### Files to know
- [BOARD_LAUNCH_PLAN.md](BOARD_LAUNCH_PLAN.md) — strategic plan
- [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) — Vercel-specific deploy steps
- [supabase/rls-policies.sql](supabase/rls-policies.sql) — paste in SQL Editor before launch
- [config/brand.ts](config/brand.ts) — brand source of truth
- [lib/utils/job-filter.ts](lib/utils/job-filter.ts) — NP relevance classifier (~400 lines)
- [lib/pseo/category-tagger.ts](lib/pseo/category-tagger.ts) — taxonomy slugs + tagging rules
- [lib/aggregators/registry.ts](lib/aggregators/registry.ts) — 8 ATS sources
- [lib/inngest/functions/scheduled-crons.ts](lib/inngest/functions/scheduled-crons.ts) — 53 cron schedules
- [scripts/smoke-test.ts](scripts/smoke-test.ts) — one-source ingestion smoke
- [scripts/set-admin.ts](scripts/set-admin.ts) — bootstrap admin user

### Scripts to run
| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Prod build (runs `prisma migrate deploy && prisma generate && next build`) |
| `npm run type-check` | TypeScript validation |
| `npm test` | Vitest unit + integration |
| `npm run test:e2e` | Playwright E2E |
| `npx tsx scripts/smoke-test.ts [source]` | Run one ATS source ingest |
| `npx tsx scripts/audit-smoke.ts` | Print DB totals + tag distribution |
| `npx tsx scripts/set-admin.ts <email>` | Promote user to admin role |
| `npx prisma studio` | Browse DB locally |
| `npx prisma migrate dev --name <change>` | Create new migration |
| `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` | Local Inngest dev server |

### URLs after deploy
| URL | Purpose |
|---|---|
| https://nphiring.com | Homepage |
| https://nphiring.com/jobs | Job search |
| https://nphiring.com/jobs/c/family-practice | Category landing (sample) |
| https://nphiring.com/jobs/c/anesthesia/california | Category × state |
| https://nphiring.com/api/health | Liveness check |
| https://nphiring.com/api/inngest | Inngest sync endpoint |
| https://nphiring.com/api/webhooks/stripe | Stripe webhook target |
| https://nphiring.com/api/webhooks/resend | Resend webhook target |
| https://nphiring.com/admin | Admin dashboard (role=admin gated) |
| https://nphiring.com/employer/dashboard | Employer dashboard |
| https://nphiring.com/sitemap.xml | Sitemap |
| https://nphiring.com/robots.txt | Robots |
| https://nphiring.com/feed.xml | RSS |
| https://nphiring.com/llms.txt | AI crawler info |

### Dashboards
| Service | URL |
|---|---|
| Supabase | https://supabase.com/dashboard/project/ytpmrlpnpbdylujbtgij |
| Inngest | https://app.inngest.com (app: `np-hiring`) |
| Resend | https://resend.com/domains |
| Vercel | https://vercel.com (project: NP-Hiring) |
| GitHub | https://github.com/dvskr/NP-Hiring |
| Stripe | https://dashboard.stripe.com |
| Sentry | https://sentry.io |
| Google Search Console | https://search.google.com/search-console |
| Bing Webmaster | https://www.bing.com/webmasters |

---

## 11. Change Log

| Date | What | Commit |
|---|---|---|
| 2026-05-22 | Phase 0–5: repo reset, fork-stripping, schema applied, baseline routes | b3ddab0..cff75b6 |
| 2026-05-23 | Phase 7: Inngest cron migration, Phase 8 partial marketing | 77b53b5, ab8c2cf |
| 2026-05-23 | ATS-only: removed adzuna/fantastic-jobs-db/usajobs/doccafe/healthcareercenter | 62cd56b |
| 2026-05-23 | Smoke test scripts, Phase 8 deep marketing rewrite | 0f7607e, 104f4bd |
| 2026-05-23 | Route conflict fix `/jobs/c/[category]` + DEPLOY_CHECKLIST.md | c6cd1b4 |
| 2026-05-23 | 5-agent audit findings: brand strings, sitemap URLs, security fixes, RLS SQL | a73da57 |
| 2026-05-23 | 7-agent audit follow-up: sitemap realigned, email NP-broad copy, NP/APRN specialty filter chips, employer specialty presets | eec2507 |

> Update the table above as you ship further changes. Update "Last updated" at the top.

---

## 12. When to Delete This Runbook

This file should disappear once:
- [ ] §3.A items 1–7 complete (RLS, Resend, Inngest, Supabase auth, CRON_SECRET, Vercel envs, GitHub secret)
- [ ] `https://nphiring.com` is live and serving the 335 ingested jobs
- [ ] First admin user is bootstrapped
- [ ] First scheduled cron has fired successfully
- [ ] First user has signed up and received a confirmation email

After that, this runbook is just history. Move it to `docs/runbooks/np-hiring-launch-2026-05.md` for archival or delete entirely — the codebase is self-documenting.
