# NP Hiring — Launch Runbook (nphiring.com)

> Single source of truth for taking this board live, end to end.
> Board #2 of the job-board template · repo `dvskr/NP-Hiring` · Supabase `ytpmrlpnpbdylujbtgij`.
> Every step has a gate — do not skip gates. Owner is YOU unless marked (Claude).
>
> Companion docs: [pilot-fork-runbook.md](pilot-fork-runbook.md) (generic fork procedure) ·
> [fork-checklist.md](fork-checklist.md) · README §quickstart.

---

## 0. Current state (updated 2026-07-06)

| Area | State |
|---|---|
| Code | Complete. 42-category NP taxonomy live end-to-end (registry → routes → classifier → DB tags); relevance/salary/copy/stats/credentials packs NP; all niche-identity copy token-driven; Deep Berry re-theme applied (204 files, zero surviving teal) |
| Tests | Full suite green (~1,259); tsc clean; both ratchets active |
| Database | Live on template migrations + RLS; ~981 jobs ingested and NP-tagged (16/19 new categories populated) |
| Preflight | `npm run fork:preflight` → 2 known FAILs remain: prod `NEXT_PUBLIC_BASE_URL` (env, §2) and empty blog (§4) |
| Not done | Everything below |

---

## 1. SECURITY FIRST — rotate every exposed credential  ⏱ 30 min

These credentials were shared in a chat session and MUST be treated as exposed.
Rotate BEFORE going live; update `.env` locally and Vercel after §2:

- [ ] Supabase **database password** (Dashboard → Settings → Database) → regenerates `DATABASE_URL`/`DIRECT_URL`
- [ ] Supabase **anon + service_role keys** (Settings → API → roll both JWTs)
- [ ] **Resend API key** + webhook signing secret (revoke old, issue new)
- [ ] **Inngest** event key + signing key (regenerate in app settings)
- [ ] **CRON_SECRET** → `openssl rand -hex 32`
- [ ] Set new values in local `.env`; keep old keys revoked, not just replaced

**Gate:** `npx prisma migrate status` → "up to date" with the NEW connection string.

## 2. Infrastructure provisioning  ⏱ ~1.5 h

1. [ ] **Vercel**: New Project → import `dvskr/NP-Hiring` → Framework Next.js.
   Env vars (Production + Preview) — the canonical list is `.env.example`; the ones that gate launch:
   - `NEXT_PUBLIC_BASE_URL=https://nphiring.com` ← clears preflight FAIL #1
   - `DATABASE_URL` (transaction pooler **:6543**, `?pgbouncer=true`) · `DIRECT_URL` (**:5432**)
   - `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (rotated)
   - `CRON_SECRET` (rotated) · `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET` (rotated)
   - `EMAIL_FROM` / `EMAIL_FROM_MARKETING` / `EMAIL_REPLY_TO` (@nphiring.com forms)
   - `OPENAI_API_KEY` (enables enrichment/semantic search; set spend cap first)
   - `ENABLE_PAID_POSTING=false` — enforced in code: checkout APIs return 503
     (`code: PAID_POSTING_DISABLED`) and /post-job shows a "paid posting coming
     soon" state to employers whose free post is used, until you flip it (§8)
2. [ ] **DNS** (registrar): `A @ → 76.76.21.21` · `CNAME www → cname.vercel-dns.com`
3. [ ] **Resend**: add domain nphiring.com → publish SPF/DKIM/DMARC records → verified ✅
   (all transactional mail silently fails until this is green)
4. [ ] **Supabase Auth** → URL Configuration → Site URL `https://nphiring.com`, redirect URLs
   `https://nphiring.com/*` and `https://www.nphiring.com/*` (Google OAuth 400s without)
5. [ ] **GitHub repo secret** `PROD_DIRECT_DATABASE_URL` = rotated :5432 URL (auto-migrations on merge)
6. [ ] **Vercel domain**: add nphiring.com + www → SSL issues automatically

**Gate:** `curl -I https://nphiring.com` → 200 after first deploy (§6).

## 3. Assets  ⏱ ~half a day (design time dominates)

- [ ] **Logo**: replace `public/pmhnp_logo.png` (same filename — OG routes and emails fetch it),
      plus favicon set + `public/icon-192x192.png` etc. + `site.webmanifest` icons — Deep Berry brand
- [ ] **Supabase `site-assets` bucket** (public): the pages hotlink ~40 files —
      homepage hero, 4 OG share images, 6 about-page dioramas, 8 step-flow images,
      11 employer icons, 10 job-seeker icons (paths already point at
      `ytpmrlpnpbdylujbtgij.supabase.co/storage/v1/object/public/site-assets/...`)
- [ ] **`email-assets` bucket**: logo + hero + step icons used by email templates
- [ ] **`resources` bucket**: `NP_Salary_Guide.pdf` (the lead-magnet download)
- [ ] State/category page imagery can lag launch (components fall back gracefully) — track as fast-follow

**Gate:** homepage + one category page render with no broken images in prod preview.

## 4. Content  ⏱ 2–5 days (the real cost)

- [ ] **Blog seed: 5–10 NP posts** as Supabase blog rows (admin → Blog, or `POST /api/blog`) —
      clears preflight FAIL #2. Priorities: NP salary guide 2026, how-to-become-an-NP,
      FNP vs AGNP comparison, new-grad NP first job, remote/telehealth NP guide. (Claude can draft — say "go blog")
- [ ] **Category-page copy polish**: the 42 pages are live with solid NP copy; spots marked
      `TODO(content)` deserve an editorial read (salary phrasing, benefits bullets)
- [ ] **np-license-{state} series** (51 posts): NOT a launch blocker —
      `LICENSE_GUIDE_SERIES_PUBLISHED=false` gates all internal links until you flip it in
      `config/niche/content-map.ts` after the series ships
- [ ] `lib/stats-sources.ts`: verify the BLS NP figures marked `TODO(verify)` and bump `asOf`
- [ ] **DPIA reissue** (`docs/dpia.md`): NP Hiring data categories — compliance doc, pre-launch

**Gate:** `npm run fork:preflight` → **exit 0** (no FAILs). This is the single launch gate.

## 5. SEO & discovery  ⏱ ~1 h + propagation time

- [ ] Google Search Console: add property, verify (DNS TXT), submit `https://nphiring.com/api/sitemaps/index` + `/sitemap.xml`
- [ ] Bing Webmaster: property + API key → `BING_WEBMASTER_API_KEY`, `BING_WEBMASTER_VERIFICATION`
- [ ] IndexNow: generate key → serve at `/{key}.txt` → set **BOTH** `INDEXNOW_API_KEY` and `INDEXNOW_KEY`
- [ ] Google Indexing API service account → `GOOGLE_INDEXING_CREDENTIALS` (stringified JSON), `GSC_SITE_URL`
- [ ] Claim @nphiring on X/Facebook/Instagram/LinkedIn/YouTube (brand.ts already links them)

## 6. Deploy procedure

```
1. §1 + §2 complete (rotated keys in Vercel)
2. Vercel → Deploy (build runs: prisma migrate deploy && prisma generate && next build)
3. Domain attaches → SSL → https://nphiring.com live
4. Inngest → sync endpoint https://nphiring.com/api/inngest (if using Inngest; otherwise
   verify Vercel Cron picked up the 58 vercel.json entries: Dashboard → Cron Jobs)
5. Resend → add webhook endpoint https://nphiring.com/api/webhooks/resend
6. Sign up on the site → npx tsx scripts/set-admin.ts <your-email> → /admin loads
```

### Smoke tests (run all; expect 200s)
```powershell
curl https://nphiring.com/api/health          # database: up
curl -I https://nphiring.com/sitemap.xml
curl -I https://nphiring.com/robots.txt
curl -I https://nphiring.com/jobs
curl -I https://nphiring.com/jobs/family-practice
curl -I https://nphiring.com/api/og           # berry-branded OG image
```
Plus by hand: search + filter on /jobs · job detail + apply click · signup/login (email + Google)
· job alert subscribe → confirm email arrives · post-job free flow · /admin dashboards.

### Rollback
Vercel → Deployments → previous → "Promote to Production" (instant). DB migrations are
idempotent/additive — no down-migrations needed for rollback; never run seed in prod.

## 7. Week-1 operations (enterprise hygiene)

| Daily | Weekly |
|---|---|
| GSC coverage + "Crawled, not indexed" trend | `rejected_jobs` funnel review → relevance-pack tuning (this is where filter quality is EARNED) |
| Vercel cron logs: ingestion wave summaries | Dead-link report + source presence dashboard (/admin/health) |
| Resend deliverability (bounces/complaints < 1%) | Category coverage: home-health / orthopedic / CNS still 0 jobs? Consider tenant additions |
| Sentry new-error triage (set `SENTRY_DSN`) | Baseline ratchets: debt counts should only fall |

Also in week 1: `DISCORD_WEBHOOK_URL` (ingestion alerts), `NEXT_PUBLIC_GA_MEASUREMENT_ID`,
Upstash Redis (`UPSTASH_REDIS_REST_URL/TOKEN`) for cross-instance rate limiting,
VAPID keypair for web push (`npx web-push generate-vapid-keys`).

## 8. Deferred by design (not launch blockers)

Stripe paid posting — set `ENABLE_PAID_POSTING=true` **and** the three Stripe keys
(+ descriptor NPHIRING) when ready; the flag is real (`isFeatureEnabled('paidPosting')`):
until both are set, checkout 503s (`PAID_POSTING_DISABLED` / `STRIPE_NOT_CONFIGURED`)
and the /post-job funnel shows "paid posting coming soon" instead of the form ·
browser autofill extension (per-board build + Chrome listing) · np-license blog series ·
AI eval fixtures re-curation before enabling AI features broadly · scripts/ deep-clean.

---

**The one-line launch gate:** `npm run fork:preflight` exits **0** and the smoke tests pass.
Everything else is polish.
