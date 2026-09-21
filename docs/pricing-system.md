# NP Hiring Pricing System — Architecture & Operations

**Last verified:** 2026-09-12
**Source of truth:** [lib/config.ts](../lib/config.ts) + [lib/pricing.ts](../lib/pricing.ts) + [lib/employer-plan.ts](../lib/employer-plan.ts) + [prisma/schema.prisma](../prisma/schema.prisma)
**Companion doc:** [pricing-audit.md](./pricing-audit.md) (historical change log + open items)

This document describes the live state of the pricing system after the 2026-09-12 re-price (launch promo → 2027 ladder → Employer plan). It's the ground-truth reference; the audit doc is the changelog of how we got here. The 2026-04-30 / 05-01 audit work (idempotency, JobCharge ledger, quotaDomain anchor) is unchanged and still described below.

---

## 1. Pricing model

**Launch promo through December 31, 2026, then a three-rung ladder. Every post gets the SAME features — there is no stripped "basic" tier.**

### 1a. Launch promo (through `config.promoEndsLabel` = December 31, 2026)

| Item | Value | Source |
|---|---|---|
| Promo end instant (exclusive) | `2027-01-01T05:00:00.000Z` (midnight America/New_York) | `config.promoEndsAt` / `config.isPromoActive(now?)` |
| Price of every post | $0, no card | `config.isPromoActive()` → `quoteForMode('promo')` |
| Listing duration | 60 days | `config.durationDays` |
| Abuse guard (never marketed) | max 10 concurrently live promo posts per signup domain | `config.promoMaxActivePostsPerDomain` |
| Renewable? | Yes, at the normal renewal price | renewal rules in §2d |
| Consumes the intro allowance? | **No** — even after a $179 renewal | `countPaidPostsForDomain` counts `paymentStatus='paid'` rows bought as a post (`'new'` JobCharge or pre-ledger); a renewed promo post carries only a `'renewal'` charge and is excluded |

Promo rows are written with `paymentStatus='promo'`, `pricingTier='pro'`.

### 1b. Ladder (from `config.ladderStartsLabel` = January 1, 2027)

| SKU | Price | Terms | `pricingTier` | `paymentStatus` |
|---|---|---|---|---|
| Intro post | $199 (`config.introPrice` / `stripeIntroPriceInCents` 19900) | 60 days; the FIRST **PAID** post per company domain | `'intro'` | `'paid'` |
| Featured post | $299 (`config.postingPrice` / `stripePriceInCents` 29900) | 60 days; every later paid post | `'pro'` | `'paid'` |
| Employer plan | $399 / month (`config.planPrice`) | `config.planSlots` = 5 active job slots, live while subscribed, swap freely; `config.planGraceDays` = 3 | `'plan'` | `'plan'` |
| Renewal | $179 (`config.renewalPrice` / `stripeRenewalPriceInCents` 17900) | +60 days on any promo / intro / featured post | unchanged | `'paid'` |

Every SKU includes exactly the same package: Featured badge, pinned above aggregated jobs, direct apply, screening questions, analytics, `config.limits.candidateUnlocksPerPosting` = 25 unlocks and `config.limits.inmailsPerPosting` = 25 InMails. `config.isFeatured` is always `true`; `config.getTierLimits()` returns the same limits for every tier.

### 1c. Helpers (the ONLY mapping code should use)

| Helper | Returns |
|---|---|
| `config.isPromoActive(now?)` | `now < promoEndsAt` |
| `config.priceCentsForTier(tier)` | 19900 / 29900 / 0 (plan is billed by Stripe Billing, never per-post Checkout) |
| `config.priceDollarsForTier(tier)` | 199 / 299 / 0 |
| `config.getTierLabel(tier)` | `'Intro'` / `'Pro'` / `'Plan'` (legacy/unknown → `'Pro'`) |
| `getNextPaidTier(quotaDomain)` ([lib/pricing.ts](../lib/pricing.ts)) | `'intro'` while the domain has zero `paid` rows, else `'pro'` |
| `resolvePostingMode({ quotaDomain, hasPlanSlot })` | `PricingQuote { mode, tier, price, priceCents, willBeFree, durationDays }` — order: promo → plan → intro → paid |
| `getPlanSlotStatus(userId)` ([lib/employer-plan.ts](../lib/employer-plan.ts)) | `{ plan, entitled, slots, used, remaining, canPost }` |

**Removed 2026-09-12:** `config.freePostsPerEmail`, `config.freeDurationDays`. There is no "free first post" and no shorter free duration any more; every reference was replaced by the promo / ladder copy. `config.legacyInvoiceFallbackCents` (19900) stays frozen for pre-ledger invoices only and is deliberately decoupled from the live ladder.

**Canonical marketing copy** (rendered verbatim from config tokens on /pricing, /for-employers, /faq, /terms, the wizard, and emails — tests pin the wording):

- `Free through ${config.promoEndsLabel}`
- `Every job post is free during our launch period: ${durationDays}-day listing, Featured badge, top placement, ${unlocks} candidate unlocks and ${inmails} InMails. No credit card required.`
- `From ${config.ladderStartsLabel}: your first post is $${introPrice}, every post after that is $${postingPrice}, or $${planPrice}/month for ${planSlots} active jobs.`
- `${planSlots} active job slots, live while you're subscribed. Swap jobs any time. Cancel any time.`
- `Renew any post for $${renewalPrice} (+${durationDays} days).`

Never claim audience numbers (subscribers, visitors, applicants) on any surface.

**Not in scope today** (deferred — see §11): bulk packs, boost SKU, tax, PO/invoice, per-org verification, plan self-serve slot upgrades.

---

## 2. End-to-end flows

Every flow below writes `EmployerJob.quotaDomain` (the immutable signup-domain snapshot) at row creation, and every post is published with `Job.isFeatured=false` — top placement and the Featured badge come from the EmployerJob relation (job-sort + JobCard are unchanged).

### 2a. Promo post (while `config.isPromoActive()`)

```
Employer signs up → /post-job → /post-job/preview → POST /api/jobs/post-free
  ├─ Auth required (must be role='employer')
  ├─ isFreeEmailDomain(signup domain) → 400 (gmail/yahoo/etc; lib/pricing.ts FREE_EMAIL_DOMAINS)
  ├─ Serializable txn:
  │    ├─ countActivePromoPostsForDomain(quotaDomain) < config.promoMaxActivePostsPerDomain
  │    │    └─ else 403 { error, promoCapReached: true }
  │    ├─ Job.create (isPublished=true, expiresAt=now+config.durationDays)
  │    ├─ Job.update (slug)
  │    └─ EmployerJob.create (quotaDomain, paymentStatus='promo', pricingTier='pro', userId)
  ├─ sendConfirmationEmail(..., config.durationDays, 'promo')  ← "free during our launch promo"
  ├─ Cleanup JobDrafts · pingAllSearchEngines (prod only)
  └─ 200 { ..., mode: 'promo' } → frontend redirects to /success?mode=promo (?free=true still works)
```

### 2b. Plan post (promo over, employer holds an entitled plan with a free slot)

```
POST /api/jobs/post-free (same path — "post without a charge")
  ├─ getPlanSlotStatus(userId).canPost
  │    └─ re-checked INSIDE the txn → 403 { error, planSlotsFull: true } if full
  ├─ Job.create (isPublished=true, expiresAt=now+config.durationDays)
  ├─ EmployerJob.create (quotaDomain, paymentStatus='plan', pricingTier='plan', userId)
  ├─ sendConfirmationEmail(..., config.durationDays, 'plan')  ← "posted under your Employer plan"
  └─ 200 { ..., mode: 'plan' } → /success?mode=plan
```

If neither promo nor plan applies, post-free answers `403 { error, requiresPayment: true, mode: 'intro'|'paid', tier, price, priceCents }` and the wizard redirects to checkout exactly as before.

### 2c. Intro / Featured checkout (from `config.ladderStartsLabel`)

```
GET /api/employer/free-quota-status  (path unchanged — the wizard already calls it)
  └─ { eligible, reason?, mode, tier, willBeFree, price, priceCents, durationDays, paidDurationDays,
       promoActive, promoEndsAt, promoEndsLabel, ladderStartsLabel, plan?: {slots, used, remaining},
       remaining, limit }
     Gate in the wizard is unchanged: nextPostRequiresPayment = eligible && !willBeFree.

Frontend → /post-job/checkout → POST /api/create-checkout
  ├─ Lazy Stripe client (503 if STRIPE_SECRET_KEY missing / ENABLE_PAID_POSTING=false)
  ├─ tier = getNextPaidTier(quotaDomain)          ← 'intro' until the domain has ONE 'paid' row
  ├─ Atomic txn: Job.create (isPublished=false) · slug · EmployerJob.create (paymentStatus='pending', pricingTier=tier, quotaDomain)
  ├─ Stripe Checkout Session: unit_amount = config.priceCentsForTier(tier),
  │    name `${config.getTierLabel(tier)} job post — ${title}`, metadata.pricing = tier
  ├─ Retry / re-session path prices from config.priceCentsForTier(employerJob.pricingTier)
  └─ 200 { url, tier, price } → Stripe-hosted checkout

Stripe → POST /api/webhooks/stripe (checkout.session.completed, mode='payment')
  ├─ Verify signature · ProcessedStripeEvent idempotency (INSERT-then-process; UNIQUE → 200 deduped)
  ├─ activate-paid-job: paidTier = session.metadata.pricing ('intro'|'pro', default 'pro')
  │    ├─ Job.update (isPublished=true, isVerifiedEmployer=true)
  │    ├─ EmployerJob.update (paymentStatus='paid', pricingTier=paidTier)
  │    ├─ JobCharge.create (amountCents = session.amount_total ?? config.priceCentsForTier(paidTier), type='new')
  │    ├─ sendConfirmationEmail · Cleanup JobDrafts · pingAllSearchEngines · trackServerPurchase
  └─ 200

Stripe redirect → /success?session_id=cs_... → GET /api/verify-checkout-session (unchanged; 202 retry on webhook lag)
```

The intro allowance = zero rows with `quotaDomain = domain AND paymentStatus = 'paid'` that were bought **as a post** (`lib/pricing.ts#paidPostWhere`: a `'new'` JobCharge, or no charge at all for legacy paid rows). Promo, plan, legacy free and abandoned `pending` rows never consume it — and neither does a promo post that was later renewed (the renewal webhook flips it to `'paid'`, but its only charge is `type='renewal'`; a renewal is not a post).

### 2d. Renewal ($179, +60 days)

```
Employer dashboard / jobs/edit/[token] → renewal modal
  ├─ paymentStatus 'promo' | 'paid'   → "Renew $179" CTA → POST /api/create-renewal-checkout
  ├─ paymentStatus 'plan'             → "Plan slot" badge, no Renew (409 server-side:
  │                                      plan posts stay live while the plan is active; post again from a plan slot)
  ├─ paymentStatus 'pending'/'refunded' → 409
  └─ legacy 'free'                    → today's "can't be renewed" modal (unchanged message)

Webhook (type='renewal'): expiresAt = MAX(existingExpiresAt, now) + config.durationDays,
  EmployerJob.paymentStatus='paid', JobCharge(type='renewal', 17900), sendRenewalConfirmationEmail.
```

### 2e. Employer plan lifecycle (Stripe Billing subscription)

```
/pricing plan card → href = process.env.STRIPE_PLAN_PAYMENT_LINK (Stripe Payment Link, subscription)
                     or mailto:brand.email.support when the link is not configured
   Dashboard plan widget reads GET /api/employer/plan →
     { plan: {status, slots, currentPeriodEnd, source} | null, entitled, slots, used, remaining,
       price: config.planPrice, paymentLinkUrl }

Stripe → webhook checkout.session.completed with session.mode === 'subscription'  (FIRST branch)
  ├─ email = session.customer_details?.email ?? session.customer_email
  ├─ stripe.subscriptions.retrieve(session.subscription) → current_period_end
  ├─ userProfile.findFirst({ email (insensitive), role: 'employer' })
  ├─ upsertPlan({ userId: profile?.supabaseId ?? null, email, status:'active', currentPeriodEnd,
  │              stripeCustomerId, stripeSubscriptionId, source:'stripe' })
  ├─ resumePlanPosts(userId) if attached · sendPlanActivatedEmail(email, { slots, currentPeriodEnd })
  ├─ no profile matched → logger.warn + alertWebhookFailure('plan checkout matched no employer')
  │                        → admin attaches it at /admin/employer-plans
  └─ 200 — does NOT fall through to job activation

Stripe → customer.subscription.updated / .deleted
  ├─ status map: active|trialing → 'active'; past_due|unpaid → 'past_due'; canceled|incomplete_expired → 'cancelled'
  ├─ upsertPlan keyed on stripeSubscriptionId, currentPeriodEnd updated
  ├─ → 'active'    : resumePlanPosts (newest first, within remaining slots, only posts whose 60 days have not elapsed)
  └─ → 'cancelled' : pausePlanPosts + sendPlanPausedEmail(email, { reason, pausedCount })

Entitlement: isPlanEntitled(plan, now) = status in ('active','past_due') AND currentPeriodEnd + config.planGraceDays > now.
Posts stay live through the end of the paid period (+ grace, which covers Stripe Smart Retries).

Admin: GET/POST /api/admin/employer-plans (list; create/attach { email, userId?, slots?, currentPeriodEnd, status? } → upsertPlan(source:'admin')),
       PATCH /api/admin/employer-plans/[id] ({ status?, slots?, currentPeriodEnd?, userId? }); page /admin/employer-plans.
```

### 2f. Plan-lapse job (Inngest, daily `TZ=UTC 0 7 * * *`)

```
lib/inngest/functions/plan-lapse.ts (registered in app/api/inngest/route.ts — NOT a Vercel cron; vercel.json is at the 40-entry limit)
  └─ for each plan NOT entitled (status 'cancelled', or currentPeriodEnd + grace < now) that still has live 'plan' posts:
       pausePlanPosts(userId) → Job.isPublished=false on those rows · sendPlanPausedEmail
```

### 2g. Expiry (no money flow, but visible UX)

```
Cron → sendExpiryWarningEmail (~7 days before expiresAt)
  └─ Email shows: $179 renewal CTA + "renewing early doesn't lose days" + "candidates you've unlocked stay accessible"
     (plan posts: no renewal CTA — they stay live while the plan is active)

Posting reaches expiresAt: excluded from getEmployerActivePostings; no NEW unlocks / InMails;
previously-unlocked candidates stay accessible (hasFullAccess via existingView); replies stay free.
```

---

## 3. Architecture map

### 3a. Source-of-truth files

| Concern | File |
|---|---|
| Pricing values + helper functions | [lib/config.ts](../lib/config.ts) |
| Posting-mode resolution, intro allowance, free-email list | [lib/pricing.ts](../lib/pricing.ts) |
| Employer plan entitlement, slots, pause/resume | [lib/employer-plan.ts](../lib/employer-plan.ts) |
| Quota / unlock / InMail gates | [lib/tier-limits.ts](../lib/tier-limits.ts) |
| Email-change policy (helper, not yet wired) | [lib/auth/email-change-policy.ts](../lib/auth/email-change-policy.ts) |
| Email templates | [lib/email-service.ts](../lib/email-service.ts) (uses [lib/email-templates-v2.ts](../lib/email-templates-v2.ts)) |
| Client-side analytics events | [lib/analytics.ts](../lib/analytics.ts) |
| Server-side purchase events | [lib/analytics-server.ts](../lib/analytics-server.ts) |

### 3b. API routes (pricing-related)

| Route | Method | Purpose |
|---|---|---|
| `/api/employer/free-quota-status` | GET | Quote for the employer's NEXT post (mode/tier/price + promo + plan fields) |
| `/api/jobs/post-free` | POST | Post without a charge: promo → plan → 403 requiresPayment; atomic; sets quotaDomain |
| `/api/create-checkout` | POST | Intro / Featured post → Stripe Checkout (tier from `getNextPaidTier`) |
| `/api/create-renewal-checkout` | POST | Renewal → Stripe Checkout (blocks pending / refunded / plan / legacy free) |
| `/api/verify-checkout-session` | GET | Server-side Stripe verification for `/success` page |
| `/api/verify-renewal-session` | GET | Server-side verification for `/employer/renewal-success` |
| `/api/webhooks/stripe` | POST | Stripe → publish job, write JobCharge, plan subscription lifecycle, emails, purchase event |
| `/api/employer/plan` | GET | Plan status + slots + payment-link URL for the dashboard widget |
| `/api/admin/employer-plans`, `/api/admin/employer-plans/[id]` | GET/POST/PATCH | Admin list / grant / attach / edit plans |
| `/api/employer/invoice` | GET | PDF invoice from JobCharge ledger (audit #2) |
| `/api/employer/usage` | GET | Per-posting credit usage for dashboard |
| `/api/jobs/update` | POST/DELETE | Job edit / unpublish (contactEmail edits allowed — quotaDomain anchor handles it) |

### 3c. UI surfaces (pricing-related)

| Surface | Reads from |
|---|---|
| [/pricing](../app/pricing/page.tsx) | promo hero + 3-card ladder + FAQ, all `config.*`; plan CTA = `STRIPE_PLAN_PAYMENT_LINK` or support mailto |
| [/post-job](../app/post-job/page.tsx) | `/api/employer/free-quota-status` quote (`price`/`tier`), `config.*` for feature pills |
| [/post-job/preview](../app/post-job/preview/page.tsx) | banner by mode: promo / plan slot N of M / intro $199 / $299 |
| [/post-job/checkout](../app/post-job/checkout/page.tsx) | order summary from the quote |
| [/for-employers](../app/for-employers/page.tsx) | `config.*` receipt hero + [lib/employer-comparison.ts](../lib/employer-comparison.ts) (shared with /pricing) |
| [/faq](../app/faq/page.tsx), [/terms](../app/terms/page.tsx), [/testimonials](../app/testimonials/page.tsx), for-employers/resources/* | `config.*` |
| [/tools/cost-per-hire-calculator](../app/tools/cost-per-hire-calculator/page.tsx) | `FLAT_FEE_PRICING` in [components/tools/cost-per-hire-model.ts](../components/tools/cost-per-hire-model.ts) models promo / per-post / plan |
| [/compare/*](../lib/compare-data.ts) | `OUR_FACTS` (promo + ladder tokens) |
| [/employer/dashboard](../app/employer/dashboard/page.tsx) | `paymentStatus` branches Renew vs "Plan slot"; plan widget from `/api/employer/plan` |
| [/jobs/edit/[token]](../app/jobs/edit/%5Btoken%5D/page.tsx) | `config.*` + renewal modal branches on `paymentStatus` |
| [/success](../app/success/page.tsx) | `?mode=promo` / `?mode=plan` / `?free=true` (promo) / `?session_id` verification |
| [/admin/employer-plans](../app/admin/employer-plans/page.tsx) | list + grant form + attach-by-email |

---

## 4. Database schema (pricing-related fields)

### 4a. EmployerJob

```prisma
model EmployerJob {
  id              String    @id @default(uuid())
  contactEmail    String    // Form-submitted contact (mutable; no quota implication)
  jobId           String    @unique
  editToken       String    @unique
  dashboardToken  String    @unique @default(cuid())
  paymentStatus   String    // 'promo' | 'pending' | 'paid' | 'plan' | 'refunded' | 'expired'
                            // | legacy 'free' / 'free_renewed' / 'free_upgraded' (existing rows only; never written again)
  pricingTier     String    @default("pro")  // 'intro' | 'pro' | 'plan'; promo + legacy rows carry 'pro'
  userId          String?   // Supabase auth id; nullable on account deletion
  quotaDomain     String?   // ★ Immutable signup-domain snapshot — set ONLY at row creation, on EVERY path
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  ...
  @@index([userId])
  @@index([editToken])
  @@index([contactEmail])
  @@index([dashboardToken])
  @@index([quotaDomain, paymentStatus])  // intro allowance + promo cap counts
}
```

**Key invariants:**
- `quotaDomain` is written exactly once, at creation, by every creating path (promo, plan, checkout). No update path may write it.
- Intro allowance = `COUNT WHERE quotaDomain = domain AND paymentStatus = 'paid' AND (has a 'new' JobCharge OR has no JobCharge)` = 0. Nothing else consumes it — a renewal-only `'paid'` row (renewed promo post) does not.
- Promo cap = `COUNT WHERE quotaDomain = domain AND paymentStatus = 'promo' AND job live` < `config.promoMaxActivePostsPerDomain`.

### 4b. EmployerPlan (NEW — migration `20260912000000_add_employer_plans`)

```prisma
model EmployerPlan {
  id                   String    @id @default(uuid())
  userId               String?   @unique   // loose Supabase auth id; null until an admin attaches an unmatched Stripe checkout
  email                String
  status               String              // 'active' | 'past_due' | 'cancelled'
  slots                Int       @default(5)
  priceCents           Int       @default(39900)
  currentPeriodEnd     DateTime
  stripeCustomerId     String?
  stripeSubscriptionId String?   @unique
  source               String              // 'stripe' | 'admin'
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  @@map("employer_plans")
}
```

Entitled = `status IN ('active','past_due') AND currentPeriodEnd + config.planGraceDays > now`. `slots` is per plan (admin-adjustable); `used` = live `'plan'` posts for the user; `canPost = entitled && used < slots`.

### 4c. ProcessedStripeEvent (idempotency)

```prisma
model ProcessedStripeEvent {
  id          String   @id @default(uuid())
  eventId     String   @unique  // ← idempotency key (Stripe event.id)
  eventType   String
  processedAt DateTime @default(now())
}
```

Webhook inserts BEFORE processing; on UNIQUE violation, returns 200 + `deduped=true`. The subscription handlers use the same table and the same cleanupDedupe pattern.

### 4d. JobCharge (per-charge invoice ledger)

```prisma
model JobCharge {
  id              String   @id @default(uuid())
  employerJobId   String
  stripeSessionId String   @unique
  amountCents     Int      // 19900 (intro) | 29900 (pro) | 17900 (renewal); pre-ledger fallback = config.legacyInvoiceFallbackCents
  currency        String   @default("usd")
  type            String   // 'new' | 'renewal'
  createdAt       DateTime @default(now())
}
```

One row per per-post Stripe checkout. Invoices are generated from this ledger so the amount matches what Stripe billed. Plan subscriptions are NOT in this ledger — Stripe Billing issues their receipts.

### 4e. Other relevant fields

- `Job.expiresAt DateTime?` — drives "active posting" definition; plan posts are additionally paused (`isPublished=false`) by the lapse job
- `Job.isFeatured Boolean @default(false)` — every post writes `false`; placement + badge come from the EmployerJob relation
- `Job.isPublished Boolean @default(false)` — true immediately for promo/plan; flipped by the webhook for paid

---

## 5. Feature inventory

### 5a. Employer features (what they get)

| Feature | When they have it |
|---|---|
| Post a job free (promo) | Every post while `config.isPromoActive()`, up to the abuse cap |
| Post a job from a plan slot | Entitled Employer plan with a free slot (from Jan 1, 2027) |
| Post a job — intro $199 | First paid post per company domain (from Jan 1, 2027) |
| Post a job — featured $299 | Every later paid post |
| 60-day listing | Every post |
| Featured badge + top placement | Every post |
| 25 candidate unlocks / 25 InMails | Per active posting, every tier |
| Reply to existing conversations | Always free |
| View previously-unlocked candidates' contact info | Lifetime (audit #21) |
| Renew posting at $179 | promo + paid posts; plan posts stay live while the plan is active; legacy free posts must repost |
| Edit posting | Anytime |
| Analytics (per-job + time-series) | Active posting required (audit #M2 gate) |
| Invoice PDF | Per JobCharge; plan receipts come from Stripe |

### 5b. System features (what we built)

| Feature | Implementation |
|---|---|
| Webhook idempotency | `ProcessedStripeEvent` + INSERT-then-process (payments AND subscriptions) |
| Per-charge invoice ledger | `JobCharge` writes on every per-post webhook payment |
| Plan entitlement + pause/resume | `lib/employer-plan.ts` + `plan-lapse` Inngest cron |
| Server-side purchase tracking | GA4 Measurement Protocol (`lib/analytics-server.ts`) |
| Client-side funnel events | `view_post_job_page`, `begin_checkout`, `submit_free_post`, `free_post_limit_hit` (now: promo cap / plan slots full) |
| Atomic post creation | `prisma.$transaction({ isolationLevel: 'Serializable' })` on every path |
| Lazy Stripe client | All checkout routes — graceful 503 if keys missing |
| Stripe session verification | `/api/verify-checkout-session` + `/api/verify-renewal-session` |
| Quota anchor | Immutable `EmployerJob.quotaDomain` field |

---

## 6. Gates & entitlements

There are **three distinct gates** in the system, each answering a different question:

### 6a. `isAdmin` — admin-only fields

```ts
const isAdmin = profile.role === 'admin'
```

Gates: candidate `bio`, `preferredJobType`, full last name, CSV export of analytics.

### 6b. `hasActivePosting` — list-level metadata visibility

```ts
const hasActivePosting = isAdmin
  ? true
  : (await getEmployerActivePostings(user.id)).length > 0
```

Gates: Layer 2 fields on **list** endpoints. A paused plan post (`isPublished=false`) is not active.

### 6c. `hasFullAccess` — per-candidate detail visibility

```ts
const hasFullAccess =
  isAdmin || !!existingView || await hasActiveFeaturedPost(user.id)
```

Lifetime once unlocked (audit #21).

### 6d. Quota gates (consumption)

| Gate | Function | Limit |
|---|---|---|
| Unlock new candidate | `canUnlockCandidate(userId, tier)` | 25 per active posting |
| Start new conversation (InMail) | `canSendInMail(senderId, employerId, tier)` | 25 per active posting |
| Promo post creation | `countActivePromoPostsForDomain` inside `/api/jobs/post-free` txn | `config.promoMaxActivePostsPerDomain` live per `quotaDomain` |
| Plan post creation | `getPlanSlotStatus(userId).canPost`, re-checked inside the txn | `plan.slots` live `'plan'` posts |
| Intro price | `getNextPaidTier(quotaDomain)` | one `'paid'` row per `quotaDomain`, lifetime |

---

## 7. Closed loopholes

| # | Loophole | Closed by |
|---|---|---|
| #1 | `/success` page didn't verify Stripe — fake URL = fake success message | Server-side `verify-checkout-session` route + retry on webhook lag |
| #2 | Invoice always showed $199 (even for $179 renewals) | `JobCharge` ledger; invoice reads actual amount from charge row |
| #3 | Webhook had no idempotency — Stripe retries = duplicate emails + state writes | `ProcessedStripeEvent` table + INSERT-then-process |
| #6 | Free-post gate had race condition (parallel submissions both passed) | Serializable transaction + re-check inside (promo cap + plan slots today) |
| #7 | Job + slug + EmployerJob inserts not atomic — partial failure = orphan rows | All wrapped in `prisma.$transaction` |
| #8 | Renewal webhook silently half-completed when EmployerJob missing | Returns 500 loudly with logging |
| #11 | Renewal flow accepted free / pending posts → snuck past free quota | 409 block; UI also branches via popup (#24); plan rows now 409 too |
| #12 | Hardcoded prices in 7+ surfaces would lie if config changed | All config-driven via `config.*` references (re-audited 2026-09-12) |
| #13 | `canUnlockCandidate` counted views from expired postings against current cap | Filter to active postings + legacy null only |
| #15 | Dead upgrade routes + page lingering from old tier model | All deleted |
| #17 | `PricingTier = 'starter' \| 'growth' \| 'premium'` was a fiction | Narrowed to `'pro'` (2026-04-30); widened to `'intro' \| 'pro' \| 'plan'` for the real ladder (2026-09-12) |
| #21 | Layer 4 strip — already-unlocked candidates lost metadata after expiry | All unlock-only fields gate on `hasFullAccess`, not `tier` |
| #22 | Early renewals lost the days remaining on the original posting | Webhook now extends from MAX(existingExpiresAt, now) |
| #23 | Editable `contactEmail` shifted the freebie count | Quota anchored on immutable `quotaDomain`, not contactEmail |
| #24 | Free-post renewal showed silent 409 with no UX explanation | Branched modal with friendly popup + CTA to repost |
| #26 | Form-submitted `contactEmail` was the freebie count anchor — rotation = infinite freebies | Quota anchored on signup-derived `quotaDomain` (immutable per-row) |
| — | Promo could be farmed for unlimited live posts | `config.promoMaxActivePostsPerDomain` cap inside the Serializable txn |

---

## 8. Known open loopholes (deferred — not closed)

| # | Loophole | Why deferred | Mitigation in place |
|---|---|---|---|
| **Shell domains** | Buy cheap domains, sign up with each, get an intro-priced post per domain (and a promo cap per domain) | Domain registration is free-form; no public registry distinguishes "real company" from "registered yesterday" | Free email providers blocked; intro is a $100 discount, not a free post; promo cap per domain. Per-org verification is the real fix |
| **#25 Admin hard-delete** | `/api/admin/jobs/[id]` cascade-deletes EmployerJob → intro allowance count drops | Internal-only attack vector; admins are trusted; audit logs mitigate | Audit #25 tracks soft-delete remediation |
| **#27 Email-domain change** | Authenticated user changes their email domain → future intro allowance attributes to new domain | No user-facing email-change endpoint exists today | `evaluateEmailChange` helper at [lib/auth/email-change-policy.ts](../lib/auth/email-change-policy.ts); whoever adds the endpoint MUST call it |
| **Unmatched plan checkout** | Stripe Payment Link buyer uses an email that matches no employer profile | Payment Links cannot carry our user id | Webhook alerts (`alertWebhookFailure`) and the admin attaches the plan by email at /admin/employer-plans |
| **Concurrent first checkouts** | Two people at one domain open their first paid checkout at the same moment; both sessions are priced `'intro'` because neither is `'paid'` yet, so the $100 discount is granted twice | Counting in-flight `'pending'` intro rows would make an honest employer who abandons a $199 checkout see $299 on retry — worse than a rare $100 leak | `activate-paid-job.ts#detectIntroDoubleCharge` logs a Sentry-forwarded error when an intro activation finds another paid post at the domain; refund the difference by hand |

### Loopholes considered and confirmed NOT loopholes

| Scenario | Why it's safe |
|---|---|
| Account self-deletion + soft-delete | `EmployerJob.userId` becomes null on delete, but `quotaDomain` and `paymentStatus` persist. Counts unaffected. |
| Unpublish own job (`DELETE /api/jobs/update`) | Sets `isPublished=false`. Row stays; `'paid'` count unaffected (promo cap counts live rows only, which is the intended behaviour). |
| Edit job content (title/description/salary) | Doesn't touch `quotaDomain`, `paymentStatus`, or `userId`. |
| Edit `contactEmail` after posting | Count anchored on `quotaDomain` not `contactEmail`. |
| Attempt to mutate `paymentStatus` directly | No customer-facing path writes this field. Webhook, `post-free` and the lapse job are the only writers. |
| Cancel the plan right after posting 5 jobs | Posts stay live only through `currentPeriodEnd + planGraceDays`; the lapse job pauses them. |

---

## 9. Operational runbook

### 9a. Production migrations

| Migration | What it did |
|---|---|
| `20260430_normalize_pricing_tier_to_pro` | Backfilled all `pricing_tier` legacy values → 'pro'; changed column default |
| `20260430_add_processed_stripe_events` | Added idempotency table |
| `20260430_add_job_charges` | Added per-charge invoice ledger |
| `20260501_add_quota_domain` | Added immutable quota anchor field; backfilled from contact_email |
| `20260912000000_add_employer_plans` | Added `employer_plans` table (Employer plan) |
| `20260913000000_stripe_integration_hardening` | `employer_jobs.stripe_checkout_session_id`, `processed_stripe_events.status/claimed_at` (two-phase webhook dedupe), `employer_plans.last_stripe_event_at` (out-of-order event guard) |

Applied via the deploy build (`prisma migrate deploy`) — never run migrations by hand against production from a dev shell.

### 9b. Production Stripe checklist

The promo needs NOTHING from Stripe. Everything below must be live **before January 1, 2027** (see [LAUNCH_RUNBOOK.md §8](./LAUNCH_RUNBOOK.md)):

- [ ] `ENABLE_PAID_POSTING=true` + `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` in Vercel
- [ ] Webhook endpoint `https://nphiring.com/api/webhooks/stripe` registered; event filter includes `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` (tmp/stripe-bootstrap.js `EVENTS`)
- [ ] Stripe Payment Link for the Employer plan (recurring, $399/month, billing address + tax ID required, **limit customers to one subscription** on) → `STRIPE_PLAN_PAYMENT_LINK` (must be a `https://buy.stripe.com/` URL)
- [ ] Dashboard → Settings → Payment methods: choose the methods offered on per-post Checkout (the sessions no longer pin `card`; delayed methods are safe — fulfilment waits for `payment_status: 'paid'`)
- [ ] Customer Portal configuration created in LIVE mode (cancel at period end, payment method update, invoice history) — the dashboard's "Manage billing" opens it
- [ ] Stripe Tax decision (head office address, registrations, product tax code) — open owner decision, see docs/PENDING_WORK.md B113
- [ ] Stripe Dashboard → Settings → Public details / Branding / Customer emails as before
- [ ] (Optional) `GA_MEASUREMENT_ID` + `GA_API_SECRET` for server-side `purchase` events

### 9c. Things to monitor

| Signal | What it means |
|---|---|
| `processed_stripe_events` count vs Stripe Dashboard event count | Big divergence = webhook drops |
| `job_charges` rows where `amount_cents ∉ {19900, 29900, 17900}` | Coupon used or manual price override — sanity check |
| `employer_plans` rows with `user_id IS NULL` | Plan checkouts that matched no employer — attach them in /admin/employer-plans |
| Sentry error "Intro price charged twice for one domain" | Two concurrent first checkouts both got the $199 rung (§8) — refund $100 on the later one |
| 5xx error rate on `/api/webhooks/stripe` | Should be ~0 with idempotency |
| post-free 403 rate (`promoCapReached` / `planSlotsFull` / `requiresPayment`) | Abuse signal during the promo; demand signal for the ladder after |
| `plan-lapse` Inngest run log | Paused-post counts; a spike means Stripe retries are failing |
| `processed_stripe_events` table size after 12+ months | Will grow unbounded; plan partition or quarterly cleanup |

### 9d. Operational rules cheat-sheet

- Promo: every post free through 2026-12-31 (America/New_York); `config.isPromoActive()` is the only switch — no flag to flip.
- Ladder: intro $199 = first `'paid'` row per `quotaDomain`; featured $299 after; renewal $179 on promo/paid rows; plan $399/month for 5 slots.
- Renewal extends from `MAX(existingExpiresAt, now)` — early renewers don't lose days.
- Plan posts are never renewed individually; they stay live while entitled and are paused by the lapse job (grace = `config.planGraceDays`).
- Legacy `'free'` posts cannot be renewed (unchanged message). Pending / refunded posts cannot be renewed.
- Webhook idempotency keyed on `event.id`. Stripe retries are safe, for subscriptions too.
- Server-side `purchase` event fires from the webhook (the only authoritative payment-completion signal).
- Copy rule: every price and date on every surface is a config token; the canonical sentences in §1c are quoted verbatim; no audience-size claims anywhere.

---

## 10. Test coverage

### 10a. Unit tests (Vitest)

[tests/lib/tier-limits.test.ts](../tests/lib/tier-limits.test.ts) — unlock / InMail gates (unchanged).

Regression suites pin the marketing copy (`tests/regressions/p2-trust-surfaces-point-of-sale.test.ts`, `p0-faq-pricing-funnel-stats-heroes-schema.test.ts`, `p9-claims-promises-review5.test.ts`, `p3-tools-round-2-registry.test.ts`) and are updated alongside any pricing change.

### 10b. Coverage gaps (deferred per audit #20)

- No integration tests for `/api/jobs/post-free` (promo cap, plan slot re-check inside the txn)
- No tests for `/api/create-checkout` (intro → pro tier flip) or `/api/create-renewal-checkout`
- No tests for webhook idempotency / subscription handlers / `JobCharge` ledger writes
- No tests for `plan-lapse` pause/resume ordering
- No tests for `evaluateEmailChange` policy

---

## 11. Future-state items (intentionally deferred)

| ID | Item | When to revisit |
|---|---|---|
| #14 | Stripe Product / Price catalog (proper Price IDs) instead of ad-hoc `unit_amount` + a Payment Link | When adding Stripe Tax, coupons, or a second plan size |
| Plan self-serve | Customer Portal SHIPPED (POST /api/employer/billing-portal → dashboard "Manage billing": cancel at period end, card update, invoices). Still deferred: in-app slot upgrade and a server-created subscription Checkout Session replacing the Payment Link | After the first month of real plan subscribers |
| Plan overflow | Buying extra slots or a second plan from the dashboard | When a plan holder asks for slot 6 (today: contact support / admin bumps `slots`) |
| Promo end-of-life | Retire `'promo'` writes after 2027-01-01 and remove the wizard's promo branches | 60 days after the promo ends (last promo posts have expired) |
| P2 | Self-serve bulk packs | Only if the plan does not absorb the multi-role demand |
| P4 | Boost / Spotlight upsell SKU | Adds an upsell vector beyond the ladder |
| P5 | Stripe Tax + PO/invoice path for enterprise | Blocker for hospital systems / large staffing firms |
| Per-org verification | NPI lookup / DNS TXT / manual review | Closes the shell-domain attack; needed at scale |
| Email-change endpoint | UI + endpoint that calls `evaluateEmailChange` | When user demand surfaces; helper is ready |
| Audit #20 | Webhook + checkout + plan integration tests | Before the next major refactor |
| Audit #25 | Soft-delete for admin job-delete | When you want to harden internal-only loopholes |

---

## 12. Quick-reference flow diagrams

### Post a job
```
GET /api/employer/free-quota-status → mode
   promo                  plan                    intro / paid
     ↓                      ↓                          ↓
POST /api/jobs/post-free  POST /api/jobs/post-free   POST /api/create-checkout (tier = getNextPaidTier)
  promo cap check           slot re-check in txn        Stripe Checkout (unit_amount = priceCentsForTier)
  paymentStatus='promo'     paymentStatus='plan'         ↓ pay
  isPublished=true          isPublished=true           webhook → JobCharge, paymentStatus='paid', pricingTier=tier
     ↓                      ↓                          ↓
/success?mode=promo       /success?mode=plan         /success?session_id=… → verify-checkout-session
```

### Renew a job
```
employer dashboard "Renew" button
  ↓
promo / paid post?  → modal: "Renew $179" → /api/create-renewal-checkout → Stripe → webhook (type='renewal')
                                              expiresAt = MAX(existing, now) + 60d · JobCharge 17900 · email
plan post?          → "Plan slot" badge, no Renew (stays live while the plan is active)
legacy free post?   → popup: "can't renew, post new" → /post-job
```

### Employer plan
```
/pricing → STRIPE_PLAN_PAYMENT_LINK → Stripe subscription checkout
  ↓ checkout.session.completed (mode=subscription)
upsertPlan(active, currentPeriodEnd) → resumePlanPosts → sendPlanActivatedEmail
  ↓ monthly: customer.subscription.updated (active → keep; past_due → grace)
  ↓ cancel / fail: customer.subscription.deleted → pausePlanPosts + sendPlanPausedEmail
daily plan-lapse cron catches anything the webhook missed
```

---

## Appendix: glossary

| Term | Meaning in this codebase |
|---|---|
| **Active posting** | `Job.isPublished=true AND (expiresAt IS NULL OR expiresAt > now)` AND linked via EmployerJob to a userId |
| **Posting mode** | What the employer's NEXT post will be: `'promo' \| 'plan' \| 'intro' \| 'paid'` (lib/pricing.ts) |
| **quotaDomain** | Immutable per-row snapshot of the signup email's domain at posting time. Anchor for the intro allowance and the promo cap. |
| **Intro allowance** | The domain has zero `paymentStatus='paid'` rows → next paid post is `'intro'` at $199. |
| **Entitled plan** | `status IN ('active','past_due') AND currentPeriodEnd + planGraceDays > now`. |
| **hasFullAccess** | Per-candidate gate: `isAdmin OR existingView OR hasActiveFeaturedPost(employerId)`. Lifetime once granted. |
| **hasActivePosting** | Employer-level gate: at least one currently-active posting exists. State, not plan. |
| **`paymentStatus`** | `'promo'` / `'pending'` / `'paid'` / `'plan'` / `'refunded'` / `'expired'` / legacy `'free'`, `'free_renewed'`, `'free_upgraded'`. Drives invoice eligibility, renewal eligibility, the intro allowance and the promo cap. |
| **`pricingTier`** | `'intro' \| 'pro' \| 'plan'` — the ladder rung a row was sold at. Promo and legacy rows carry `'pro'`. |
| **JobCharge** | One row per per-post Stripe checkout (new or renewal). Source of truth for invoices. Plan receipts come from Stripe. |
| **ProcessedStripeEvent** | Idempotency log. Insert-then-process; UNIQUE violation = already-handled. |
