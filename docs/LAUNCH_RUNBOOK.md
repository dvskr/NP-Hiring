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
   - `ENABLE_PAID_POSTING=false` — fine for launch: every employer post is free
     through December 31, 2026 (`config.promoEndsLabel`, no flag, no Stripe
     needed). Enforced in code: checkout APIs return 503
     (`code: PAID_POSTING_DISABLED`) until you flip it — which MUST happen
     before January 1, 2027 (§8)
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

## 8. Stripe live mode and paid posting (deadline: before January 1, 2027)

**Not a launch blocker; a hard date.** The launch promo (every post free through
December 31, 2026, `config.isPromoActive()`) needs nothing from Stripe and has no
flag. It ends at 2027-01-01 10:00 UTC (`config.promoEndsAt`, midnight Hawaii time),
and from that instant the ladder starts on its own: $199 for a company's first paid
post, $299 for every later post, or the Employer plan at $399 per month (see
[pricing-system.md](pricing-system.md)). Everything below must be live in production
before then, or employers hit a 503 on their first paid post.

**Optional earlier date: about 2026-11-21.** Promo posts get their expiry warning
5 days before their 60 days end, so the first warnings go out around then. The $179
renewal is offered only while paid posting is on and Stripe is configured; until
then the email offers a free repost instead. Turning paid posting on during the
promo is safe: per-post checkout still answers 409 `PROMO_ACTIVE`, plan sales stay
closed until the promo ends, and only renewals become purchasable.

### 8a. Stripe Dashboard (live mode)

- [ ] Activate the account. Set the statement descriptor (NPHIRING), public details,
      branding and customer emails.
- [ ] Product "Employer plan" with a recurring Price of $399 per month, lookup key
      `np_hiring_employer_plan_monthly`, metadata `sku=employer-plan`.
- [ ] A Payment Link for that Price (subscription mode):
      subscription metadata `sku=employer-plan`; "Limit customers to one subscription"
      on; billing address and tax ID collection required; no free trial; promotion
      codes off; after payment, redirect to `https://nphiring.com/employer/dashboard`.
      The webhook fulfils a subscription only when the price lookup key, the price
      SKU or the subscription SKU matches (`isEmployerPlanSubscription` in
      `app/api/webhooks/stripe/plan-checkout.ts`); set all three. Anything else is
      alerted and granted nothing.
- [ ] Webhook endpoint `https://nphiring.com/api/webhooks/stripe` with **all 11**
      events below (the list in `.env.example`; `processEvent` in
      `app/api/webhooks/stripe/route.ts` handles every one except
      `customer.subscription.created`, a deliberate no-op). Copy its signing secret.

| Event | What the site does with it |
|---|---|
| `checkout.session.completed` | Publishes a paid post, applies a renewal, or starts a plan |
| `checkout.session.async_payment_succeeded` | Same, once a delayed payment settles |
| `checkout.session.async_payment_failed` | Alerts; a pending plan is closed |
| `invoice.paid` | Refreshes invoice PDF links |
| `invoice.payment_failed` | Plan dunning email |
| `charge.refunded` | Ledger update; a full refund takes the post down |
| `charge.dispute.created` | Takes the post down on a chargeback |
| `charge.dispute.closed` | Restores the post on a won dispute |
| `customer.subscription.created` | No-op (the checkout session creates the plan row) |
| `customer.subscription.updated` | Plan status and paid-through date |
| `customer.subscription.deleted` | Plan cancelled; posts stay live to the period end |

- [ ] Settings, Payment methods: choose what per-post Checkout offers. Sessions do not
      pin cards, and delayed methods are safe because fulfilment waits for payment.
- [ ] Customer Portal: save the live-mode settings (cancel at period end, update
      payment method, invoice history). The dashboard's "Manage billing"
      (`app/api/employer/billing-portal/route.ts`) opens the default configuration.
- [ ] Billing, failed payments: when all retries fail, **cancel the subscription**,
      so a lapsed plan ends instead of sitting past due.
- [ ] Stripe Tax: open owner decision (`docs/PENDING_WORK.md` B113).

### 8b. Vercel Production environment

| Variable | Value | Why |
|---|---|---|
| `ENABLE_PAID_POSTING` | `true` | The flag is real: `isFeatureEnabled('paidPosting')`. Until it is `true`, checkout answers 503 `PAID_POSTING_DISABLED`; with the flag but no key, 503 `STRIPE_NOT_CONFIGURED` |
| `STRIPE_SECRET_KEY` | live secret key (or a restricted live key) | All Stripe calls |
| `STRIPE_WEBHOOK_SECRET` | the live endpoint's signing secret | Test and live endpoints have different secrets; a wrong one rejects every event |
| `STRIPE_PLAN_PAYMENT_LINK` | the live `https://buy.stripe.com/` link | Anything else disables the plan button (`lib/employer-plan-link.ts`); unset falls back to a contact mailto |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | live publishable key | No page reads it today, but `npm run fork:preflight` fails without it while the flag is on |
| `NEXT_PUBLIC_BASE_URL` | `https://nphiring.com` | Checkout return URLs and email links |

Keep these set: `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` (the daily `plan-lapse`
job and the payment and plan reconciliation run on Inngest; sync it as in section 6
step 4), `DISCORD_WEBHOOK_URL` (payment webhook alerts, including "refund required"),
`SENTRY_DSN`.

Redeploy after any change: Vercel applies env changes only to new deployments, and
`NEXT_PUBLIC_` values are baked in at build, so turn the build cache off for that
redeploy. **After 2027-01-01, no test-mode key may remain in Production**, and no
`https://buy.stripe.com/test_` link: it passes the link format check but sells
nothing real.

### 8c. Verify

- [ ] `https://nphiring.com/api/create-checkout/availability` returns `{"available":true}`.
- [ ] Stripe, Webhooks: the endpoint lists the 11 events and a test event returns 200.
- [ ] After the promo ends, a signed-in employer sees the plan's subscribe button on
      /pricing, and a plan purchase appears attached in `/admin/employer-plans`.

Also deferred: browser autofill extension (per-board build and Chrome listing),
re-curating the AI eval fixtures before enabling AI features broadly, and a
`scripts/` deep-clean.

---

**The one-line launch gate:** `npm run fork:preflight` exits **0** and the smoke tests pass.
Everything else is polish.
