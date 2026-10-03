# NP Hiring Pricing System — Architecture & Operations

**Last verified:** 2026-10-02 (the plan checkout and its account linking in §2e, the activation order in §2c, the schema blocks in §4, the open loopholes in §8, the checklist and monitors in §9 and the test map in §10, re-checked against the code; `tests/regressions/docs-pricing-system-matches-code.test.ts` now holds them to it); 2026-10-01 (the copy switch at the promo end: §1d, §2g and §3); 2026-09-27 (plan post lifecycle, renewal effects and the promo end instant)
**Source of truth:** [lib/config.ts](../lib/config.ts) + [lib/pricing.ts](../lib/pricing.ts) + [lib/employer-plan.ts](../lib/employer-plan.ts) + [prisma/schema.prisma](../prisma/schema.prisma); the words every surface prints come from [lib/pricing-copy.ts](../lib/pricing-copy.ts) and the per-page builders in §3a
**Companion doc:** [pricing-audit.md](./archive/pricing-audit.md) (the April 2026 audit and its change log; archived and no longer maintained. Open items live in [PENDING_WORK.md](./PENDING_WORK.md))

This document describes the live state of the pricing system after the 2026-09-12 re-price (launch promo → 2027 ladder → Employer plan). It's the ground-truth reference; the audit doc is the changelog of how we got here. The 2026-04-30 / 05-01 audit work (idempotency, JobCharge ledger, quotaDomain anchor) is unchanged and still described below.

---

## 1. Pricing model

**Launch promo through December 31, 2026, then a three-rung ladder. Every post gets the SAME features — there is no stripped "basic" tier.**

### 1a. Launch promo (through `config.promoEndsLabel` = December 31, 2026)

| Item | Value | Source |
|---|---|---|
| Promo end instant (exclusive) | `2027-01-01T10:00:00.000Z` (midnight Pacific/Honolulu, the last of the 50 states to leave December 31; 5 am ET). Copy prints "through December 31, 2026" with no zone, so the boundary is the LAST US midnight: 11:59 pm on December 31 is free in every US zone. It was 05:00Z (midnight ET) until 2026-09-27, which charged a Pacific employer posting at 9 pm on December 31 | `config.promoEndsAt` / `config.isPromoActive(now?)` |
| Price of every post | $0, no card | `config.isPromoActive()` → `quoteForMode('promo')` |
| Listing duration | 60 days | `config.durationDays` |
| Abuse guard (never marketed) | max 10 concurrently live promo posts per signup domain | `config.promoMaxActivePostsPerDomain` |
| Renewable? | Yes, at the normal renewal price, once `ENABLE_PAID_POSTING` is on (the renewal checkout 503s until then) | renewal rules in §2d |
| Consumes the intro allowance? | **No** — even after a $179 renewal | `countPaidPostsForDomain` counts `paymentStatus='paid'` rows bought as a post (`'new'` JobCharge or pre-ledger); a renewed promo post carries only a `'renewal'` charge and is excluded |

Promo rows are written with `paymentStatus='promo'`, `pricingTier='pro'`.

### 1b. Ladder (from `config.ladderStartsLabel` = January 1, 2027)

| SKU | Price | Terms | `pricingTier` | `paymentStatus` |
|---|---|---|---|---|
| Intro post | $199 (`config.introPrice` / `stripeIntroPriceInCents` 19900) | 60 days; the FIRST **PAID** post per company domain | `'intro'` | `'paid'` |
| Featured post | $299 (`config.postingPrice` / `stripePriceInCents` 29900) | 60 days; every later paid post | `'pro'` | `'paid'` |
| Employer plan | $399 / month (`config.planPrice`) | `config.planSlots` = 5 active job slots while entitled; each plan post runs 60 days and is never renewed; a slot frees when its post expires or is closed, and the employer posts into it again at no extra charge; `config.planGraceDays` = 3 | `'plan'` | `'plan'` |
| Renewal | $179 (`config.renewalPrice` / `stripeRenewalPriceInCents` 17900) | +60 days on a promo / intro / featured post (never a plan post), capped at `config.renewalCapDays` = 365 days after the post was created; does NOT reset unlocks or InMails | unchanged | `'paid'` |

Every SKU includes exactly the same package: Featured badge, pinned above aggregated jobs, applications straight to the employer (Easy Apply or the employer's own application link), screening questions, analytics, `config.limits.candidateUnlocksPerPosting` = 25 unlocks and `config.limits.inmailsPerPosting` = 25 InMails. `config.isFeatured` is always `true`; `config.getTierLimits()` returns the same limits for every tier. The 25 / 25 are per posting for its whole life: unlocks are counted by `ProfileView.employerJobId`, InMails by conversations on the job since `EmployerJob.createdAt` (lib/tier-limits.ts), and a renewal changes neither, so no surface may say a renewal "refreshes" them.

**Plan post lifecycle (what the copy may promise).** A plan post is NOT live "for as long as the plan is active". `POST /api/jobs/post-free` writes the same `expiresAt = now + config.durationDays` for plan posts as for promo posts; nothing extends a plan post; `/api/create-renewal-checkout` answers 409 for `paymentStatus='plan'`; and `pausePlanPosts` unpublishes live plan posts when the plan lapses. So the true statement is: while subscribed you have `planSlots` active job slots; each plan post runs `durationDays`; when one ends, is closed or is swapped out, its slot is free and the employer can post again into it at no extra charge; plan posts come down if the plan ends; a cancel keeps them up through the paid period (never past their own 60 days). Cancel is self-serve through the Stripe Customer Portal (`POST /api/employer/billing-portal`, "Manage billing"). "Swap jobs any time" means close (pause or archive) one plan post and post another into the freed slot.

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

**Canonical marketing copy** (built only from config tokens; tests pin the wording on the surfaces that print them; /terms states the same terms in its own legal wording). The first three are the promo phase's sentences, from [lib/pricing-copy.ts](../lib/pricing-copy.ts): `PROMO_HEADLINE`, `PROMO_SUB`, and `ladderLine(now)` while the promo runs. From `config.promoEndsAt` the phase-aware surfaces print the ladder-phase sentences listed after these instead (§1d). The plan and renewal sentences hold in both phases; [app/pricing/pricing-page-copy.ts](../app/pricing/pricing-page-copy.ts) exports them as `PLAN_TERMS`, `PLAN_POSTS_LINE`, `PLAN_CANCEL_LINE`, `RENEWAL_LINE`, `RENEWAL_EFFECT_LINE` and `RENEWAL_CAP_LINE`:

- `Free through ${config.promoEndsLabel}`
- `Every job post is free during our launch period: ${durationDays}-day listing, Featured badge, top placement, ${unlocks} candidate unlocks and ${inmails} InMails. No credit card required.`
- `From ${config.ladderStartsLabel}: your first post is $${introPrice}, every post after that is $${postingPrice}, or $${planPrice}/month for ${planSlots} active jobs.`
- `${planSlots} active job slots while you're subscribed. Swap jobs any time. Cancel any time.`
- `Each plan post runs ${durationDays} days. When one ends, or you close it to swap in another role, its slot opens up and you can post into it again at no extra charge. Plan posts come down if the plan ends.`
- `If you cancel, your plan posts stay up through the end of the period you paid for, or until their ${durationDays} days run out if that comes first.`
- `Renew a promo, intro or featured post for $${renewalPrice} (+${durationDays} days).`
- `A renewal adds ${durationDays} days to the post: to its current end date while it is still live, or from the day you renew once it has ended. It does not add unlocks or InMails: a post has ${unlocks} unlocks and ${inmails} InMails in total, however many times it is renewed.`
- `Renewals can extend a post to at most ${renewalCapDays} days after it was first posted.`
- `${durationDays}-Day Listing` cards (`listingRun` in the two page builders): /pricing prints `Every post runs ${durationDays} days with no daily budget and no bidding ... Plan posts run the same ${durationDays} days and come down sooner only if the plan ends.`; /for-employers opens it `Every job runs ${durationDays} days with no daily budget and no bidding.` and closes on the same plan clause

**Ladder-phase copy** (from `config.promoEndsAt`, all in [lib/pricing-copy.ts](../lib/pricing-copy.ts); none of it offers free posting or names a start date):

- `LADDER_HEADLINE`: `Simple per-post pricing` (the /pricing H1, the /for-employers hero and the email headline)
- `LADDER_PRICES`, which `ladderLine(now)` returns from the switch: `Your first post is $${introPrice}, every post after that is $${postingPrice}, or $${planPrice}/month for ${planSlots} active jobs.`
- `FULL_PACKAGE`, where `PROMO_SUB` stood: `Every post gets the full package: ${durationDays}-day listing, Featured badge, top placement, ${unlocks} candidate unlocks and ${inmails} InMails.`
- `LADDER_FROM_LINE`, for CTA cards and descriptions: `Posts start at $${introPrice}, with all features included.`
- `planPriceLine(now)`: `The Employer plan is $${planPrice}/month.` (while the promo runs: `From ${ladderStartsLabel}, the Employer plan is $${planPrice}/month.`)

Retired 2026-09-27 because the code never did them: "live while you're subscribed", "plan posts stay live while your plan is active, so they don't need renewing", the listing cards' "plan posts stay up while your plan is active" and "Every post runs its full 60 days" (a plan post comes down early when its plan lapses), "Renew any post", and "renewing ... refreshes its 25 unlocks and 25 InMails". The renewal "boosts the listing back to the top of search results" claim was also dropped: the renewal webhook sets `Job.isFeatured=true`, which sorts the post above un-renewed employer posts on the default `best` order only, once, and not on `newest` / `salary` or semantic search, so "back to the top" overstated it.

Never claim audience numbers (subscribers, visitors, applicants) on any surface.

**Not in scope today** (deferred — see §11): bulk packs, boost SKU, tax, PO/invoice, per-org verification, plan self-serve slot upgrades.

### 1d. What happens at 2027-01-01T10:00:00Z (`config.promoEndsAt`)

There is no flag to flip and no deploy. Every phase-dependent decision calls `config.isPromoActive(now)` when the page renders, the email is sent or the request is handled, never at module load: a module-scope string is evaluated once per server instance (and once at build for a static page), so it would keep offering free posting after the promo.

**Switches on its own:**

- **Posting.** `POST /api/jobs/post-free` stops writing `'promo'` rows: an employer with an entitled plan and a free slot still posts as `'plan'`, everyone else gets `403 requiresPayment`. `/api/create-checkout` stops answering `409 PROMO_ACTIVE`. `GET /api/employer/free-quota-status` quotes `plan`, `intro` or `paid`. Plan sales open only where `isPlanSaleOpen(now)` (lib/employer-plan-link.ts) also finds `ENABLE_PAID_POSTING` on and a valid `STRIPE_PLAN_PAYMENT_LINK`.
- **Copy, on every phase-aware surface** (§3c says how each decides). ISR pages decide on each render and regenerate at most once per window (`revalidate = 3600`; 60 seconds on the homepage). The window is not a hard bound, because regeneration is stale-while-revalidate: a render cached before the switch is served until its window runs out, the first request after that is still answered with that render and only triggers the regeneration, and every later request gets the ladder. A page that is rarely requested therefore shows its promo render to one more visitor or crawler, however long after the switch. Nothing purges these pages at the instant (no `revalidatePath` call; §11). Metadata follows the page: /pricing, /for-employers, the comparison pages and the /post-job layout build theirs in `generateMetadata`. Client pages decide on each render in the browser, and those that show a fetched quote drop a `'promo'` quote fetched before the switch (`currentQuote`, lib/next-post-quote.ts). Emails decide at send time, the admin outreach page per request. The ladder-phase sentences (§1c) replace the promo ones.
- **The comparison table** (`employerComparisonRows(now)`, /pricing and /for-employers): the "Free Posting Through ..." row drops, and the flat-pricing row states the prices without a date. The comparison pages (lib/compare-data.ts) state our ladder as the current price; competitor prices stay dated to their review.
- **The cost-per-hire calculator:** `flatFeeModeOptions('ladder')` offers per post and the Employer plan only (no promo mode, no start dates), `defaultInputs('ladder')` opens on per post, a calculator that was already open with the promo selected falls back to per post (`offeredFlatFeeMode`), and the method notes, the FAQ (with its FAQPage JSON-LD) and the post-a-role card state the ladder.
- **The outreach `freeOffer` template:** /admin/outreach stops listing it (`availableOutreachTemplates(now)`), `renderTemplate` refuses it (`OutreachTemplateUnavailableError`), and `POST /api/outreach` answers `409 { success: false, error }` with that reason, which the admin page shows. `initial` and `followUp` state the ladder price.
- **Expiry emails** stop offering a free repost (§2g), and a renewal savings claim becomes possible where a renewal can be bought (lib/renewal-offer.ts).
- **Sitemap lastmod:** every page in `PROMO_SWITCH_PATHS` (app/api/sitemaps/lastmod.ts: /pricing, /for-employers, /faq, the employer resources hub, hiring guide, job description guide, template library and template pages, /tools/salary-benchmark, /tools/cost-per-hire-calculator and the three comparison pages) is dated no earlier than the switch once it has passed, and so is the homepage (`withPromoSwitch`: its employer band's CTA switched). The sitemap index dates its primary child from the same dates. Before the instant no date moves. The date moves at the instant itself, so a crawl it prompts can reach a page that has not regenerated yet and receive the promo render (the copy bullet above).

**Does not happen on its own** (owner steps: docs/LAUNCH_RUNBOOK.md §8, checklist in §9b):

- **Stripe live mode:** the live account, the plan's Price and Payment Link, the live webhook and the Customer Portal.
- **`ENABLE_PAID_POSTING=true` with a live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.** Until the flag is `'true'`, `/api/create-checkout` and `/api/create-renewal-checkout` answer 503 `PAID_POSTING_DISABLED` and plan sales stay closed (the /pricing plan card routes to a support mailto). With the flag on but no key, both routes answer 503 `STRIPE_NOT_CONFIGURED`, but plan sales open as soon as `STRIPE_PLAN_PAYMENT_LINK` is valid: `isPlanSaleOpen` reads the flag, the link and the promo clock, never the key. In that state the webhook answers 503 until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are both set, so Stripe takes a plan payment that no plan row records until they are (the daily plan reconciliation needs the key too). Set the key and the webhook secret before the flag, or in the same deploy; docs/PENDING_WORK.md 2.16 tracks closing the gap in code. Until checkout is available, an employer without an entitled plan (an admin can grant one) cannot post at all.
- **`STRIPE_PLAN_PAYMENT_LINK`:** unset, or not a `https://buy.stripe.com/` link, keeps plan sales closed.
- **/terms** is static and changes only with a deploy. It states the launch promotion and the schedule from `config.ladderStartsLabel` with their dates, which stay true afterwards.
- **Promo posts already live** keep running their 60 days (§1a). Retiring the promo code paths is a later cleanup (§11).

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
  ├─ Cleanup JobDrafts · pingSearchEnginesForJobPage (prod only; Google only when the page carries a JobPosting)
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
  ├─ config.isPromoActive() → 409 PROMO_ACTIVE, before the body is read, so the resume path
  │    is covered too: nothing is sold per post while every post is free
  ├─ tier = getNextPaidTier(quotaDomain)          ← 'intro' until the domain has ONE 'paid' row
  ├─ Atomic txn: Job.create (isPublished=false) · slug · EmployerJob.create (paymentStatus='pending', pricingTier=tier, quotaDomain)
  ├─ Stripe Checkout Session: unit_amount = config.priceCentsForTier(tier),
  │    name `${config.getTierLabel(tier)} job post — ${title}`, metadata.pricing = tier
  ├─ Retry / re-session path prices from config.priceCentsForTier(employerJob.pricingTier)
  └─ 200 { url, tier, price } → Stripe-hosted checkout

Stripe → POST /api/webhooks/stripe (checkout.session.completed or checkout.session.async_payment_succeeded, mode='payment')
  ├─ Verify signature · ProcessedStripeEvent idempotency (INSERT-then-process; UNIQUE → 200 deduped; §4c)
  ├─ payment_status must be 'paid': a delayed method that is still settling is deferred to async_payment_succeeded
  ├─ activate-paid-job: paidTier = session.metadata.pricing ('intro'|'pro', default 'pro')
  │    ├─ EmployerJob.update where paymentStatus='pending' (the claim: 'paid', pricingTier=paidTier). Exactly one of
  │    │    the webhook, the verify page and the daily sweep wins it, and only the winner runs the steps below
  │    ├─ Job.update (isPublished=true, isVerifiedEmployer=true), unless the post was archived while
  │    │    its checkout was open (see the note under §2d)
  │    ├─ JobCharge.create (amountCents = session.amount_total ?? config.priceCentsForTier(paidTier), type='new')
  │    ├─ sendConfirmationEmail · Cleanup JobDrafts · trackServerPurchase · pingSearchEnginesForJobPage
  └─ 200

Stripe redirect → /success?session_id=cs_... → GET /api/verify-checkout-session (unchanged; 202 retry on webhook lag)
```

The intro allowance = zero rows with `quotaDomain = domain AND paymentStatus = 'paid'` that were bought **as a post** (`lib/pricing.ts#paidPostWhere`: a `'new'` JobCharge, or no charge at all for legacy paid rows). Promo, plan, legacy free and abandoned `pending` rows never consume it — and neither does a promo post that was later renewed (the renewal webhook flips it to `'paid'`, but its only charge is `type='renewal'`; a renewal is not a post).

### 2d. Renewal ($179, +60 days)

```
Employer dashboard / jobs/edit/[token] → renewal modal
  ├─ paymentStatus 'promo' | 'paid'   → "Renew $179" CTA → POST /api/create-renewal-checkout
  ├─ paymentStatus 'plan'             → "Plan slot" badge, no Renew (409 server-side:
  │                                      a plan post runs 60 days and is never renewed; post again from a plan slot)
  ├─ paymentStatus 'pending'/'expired'/'refunded'/'disputed' → 409 (apply-renewal also refuses
  │                                      'pending' and 'expired', so an abandoned checkout is never renewed live)
  ├─ legacy 'free'                    → today's "can't be renewed" modal (unchanged message)
  └─ archived post (a status that may renew) → 409 { archived: true }: restore it from the Archived tab first
                                         (a renewal republishes, and toggle-publish refuses to republish an archived post)

One payable renewal per post (backlog 2.5, lib/renewal-checkout-sessions.ts), checked before a session is handed out:
  ├─ a renewal payment for the post in flight → 409 RENEWAL_PAYMENT_PROCESSING, nothing listed open, expired or created:
  │    a paid renewal session with no JobCharge row yet (the webhook has not applied it), or a completed session whose
  │    delayed payment (ACH and similar) is still settling (payment_status 'unpaid', PaymentIntent 'processing' or
  │    'requires_action'). Completed renewal sessions are read back RENEWAL_SETTLEMENT_LOOKBACK_MS (three weeks:
  │    microdeposit verification, then settlement) through the same capped scan as the open ones
  ├─ every other OPEN renewal session for the post is expired; each session carries an expires_at inside the hour
  └─ either check cannot be confirmed (Stripe or the ledger unreachable) → 503 + Retry-After, nothing handed out

Webhook (type='renewal', app/api/webhooks/stripe/apply-renewal.ts):
  expiresAt = min(MAX(existingExpiresAt, now) + config.durationDays, Job.createdAt + config.renewalCapDays)
  (lib/expires-at.ts#renewalExpiresAt), Job.isPublished=true, Job.isFeatured=true,
  EmployerJob.paymentStatus='paid' + expiryWarningSentAt=null, JobCharge(type='renewal', 17900),
  sendRenewalConfirmationEmail. Nothing resets the post's unlock or InMail counts.
  Archived after the checkout opened: inside the transaction the extension is written first (that write takes the
  job row's lock), then archivedAt is read, and isPublished is set only for a post that is not archived. An archived
  post is ledgered, set 'paid' and extended as usual but stays unpublished and archived: no "live again" email
  (Stripe's receipt still goes out), no search engine ping, a logger.warn naming it, and leftArchived on the result.
  Last, the post's other open renewal sessions are expired, and another paid one is alerted for a refund.
```

A payment never republishes an archived post. Besides the renewal above, the new-post activation (§2c, `app/api/webhooks/stripe/activate-paid-job.ts`) puts the archived check in the WHERE of its publish (`job.update` where `{ id, archivedAt: null }`, Prisma P2025 when archived): a pending post archived while its checkout was open is claimed (`'paid'`) and ledgered as usual, keeps `isPublished` false (only `isVerifiedEmployer` is set), gets no "your listing is live" email and no ping, and is logged with `logger.warn`. The chargeback-won path in `route.ts` already skipped archived rows. Either way the employer restores the post and then republishes it.

While `ENABLE_PAID_POSTING` is not `'true'` (production today), `/api/create-renewal-checkout` answers 503 `PAID_POSTING_DISABLED` like every paid route, so no post, promo included, can be renewed until paid posting is switched on.

### 2e. Employer plan lifecycle (Stripe Billing subscription)

```
/pricing plan card → /api/employer/plan/subscribe while isPlanSaleOpen() (lib/employer-plan-link.ts: a valid
                     https://buy.stripe.com/ link, ENABLE_PAID_POSTING on, the promo over), else mailto:brand.email.support
   GET /api/employer/plan/subscribe → plan sales closed: /pricing · signed out: /login, then back here · not an
     employer: /pricing · already on an entitled or pending plan: /employer/dashboard?plan=manage · otherwise the
     Stripe Payment Link (subscription) with client_reference_id = the account id, and prefilled_email.
     The raw link is never printed on a page
   Dashboard plan widget reads GET /api/employer/plan →
     { plan: {status, slots, currentPeriodEnd, source, canManageBilling} | null, entitled, slots, used, remaining,
       price: config.planPrice, paymentLinkUrl }
     (paymentLinkUrl is the same account-bound link, null while plan sales are closed)

Stripe → webhook checkout.session.completed or checkout.session.async_payment_succeeded with
         session.mode === 'subscription'  (FIRST branch; app/api/webhooks/stripe/plan-checkout.ts)
  ├─ email = session.customer_details?.email ?? session.customer_email: stored on the row, never used to attach
  │    (the buyer types it, so it proves nothing). No email or no subscription id → alerted, nothing written
  ├─ stripe.subscriptions.retrieve(session.subscription): must be the Employer plan price (lookup key or SKU),
  │    else alerted and nothing granted
  ├─ status = mapStripeSubscriptionStatus(subscription.status), or 'pending' while the session is unpaid
  ├─ userId = the employer named by session.client_reference_id or metadata.userId, else null
  ├─ bought while plan sales are closed (paid posting off, or the promo running) → alerted for a refund; the row
  │    is still written, so nothing is lost
  ├─ upsertPlan({ userId, email, status, currentPeriodEnd, priceCents, stripeCustomerId, stripeSubscriptionId,
  │              source:'stripe' }). An employer whose row already tracks another live subscription keeps it:
  │    the new subscription is stored detached (userId null) and alerted, for a human to cancel or refund one
  ├─ 'pending' → nothing resumed or emailed; async_payment_succeeded, or the subscription turning active, promotes it
  ├─ no account reference → stored unattached · sendPlanLinkPendingEmail (when active) · logger.warn +
  │    alertWebhookFailure('plan checkout matched no employer', saying whether the email matches an employer
  │    account) → admin attaches it at /admin/employer-plans
  ├─ attached and entitled → resumePlanPosts(userId) · sendPlanActivatedEmail(email, { slots, currentPeriodEnd })
  │    when 'active'
  └─ 200 — does NOT fall through to job activation

Stripe → customer.subscription.updated / .deleted   (plan-subscription.ts#applySubscriptionEvent)
  ├─ ordering: the payload is NOT applied. stripe.subscriptions.retrieve(id) is, stamped with the time the read was
  │    SENT (lastStripeEventAt): event.created is whole seconds, so two events from one second cannot be ordered by it,
  │    and the last event processed now applies the freshest state whatever the arrival order. The stamp is taken
  │    before the request, never when the answer arrives: answers do not come back in the order Stripe evaluated the
  │    reads, and a stamp taken on arrival would give a slow answer carrying the older state the newer stamp. A send
  │    time is a lower bound on when Stripe evaluated the read, so the delivery for the latest change, which reads
  │    after that change, out-stamps every read that saw an older state. The reconciliation sweep
  │    (lib/inngest/functions/plan-reconciliation.ts) stamps its replay the same way, and a replay that comes back
  │    'stale' (a webhook wrote first) is not reported as drift. A read older than
  │    the row's lastStripeEventAt is ignored (two deliveries processed at once): checked on the row as read, and
  │    again in the WHERE of the write, since a fresher write can land between the two: upsertPlan(..., { rejectStale:
  │    true }) updates with updateMany where lastStripeEventAt IS NULL OR <= the read's stamp. A write that matches no
  │    row (StalePlanWriteError) answers 'stale', with nothing sent, resumed or paused. Every other upsertPlan caller
  │    (plan checkout, admin) still writes unconditionally.
  ├─ read fails (network, rate limit, Stripe error) → 500, the dedupe row is dropped, Stripe retries
  ├─ Stripe no longer has the subscription (resource_missing) → .deleted applies the payload's cancellation under the
  │    stamp of the read that found it gone (never event.created, which a read from later in the same second would
  │    outrank); .updated is alerted (alertWebhookFailure) and acknowledged with nothing written
  ├─ status map: active|trialing → 'active'; past_due|unpaid|paused → 'past_due'; canceled|incomplete_expired → 'cancelled'; incomplete → 'pending'; any other status → 'past_due'
  ├─ upsertPlan keyed on stripeSubscriptionId, currentPeriodEnd updated
  ├─ → 'active'    : resumePlanPosts (newest first, within remaining slots, only posts whose 60 days have not elapsed, not archived, and not paused, archived or soft deleted by the employer or an admin: isManuallyUnpublished = false)
  └─ → 'cancelled' : still inside the paid period → sendPlanPausedEmail(email, { liveUntil }) and posts stay up
                     (the lapse job pauses them at currentPeriodEnd); nothing left to honour → pausePlanPosts + email.
                     Already cancelled (every event re-reads, so later events reach it too, and so does the redelivery
                     of a cancellation whose side effects failed after its row write): the paid-through date it was
                     anchored to never moves later and there is no second notice. Once nothing paid is left, plan
                     posts still live are paused (pausePlanPosts takes down only what is live), with an email only
                     when that took posts down

Entitlement: isPlanEntitled(plan, now) = status in ('active','past_due') AND currentPeriodEnd + config.planGraceDays > now,
  or status 'cancelled' AND currentPeriodEnd > now (a cancel keeps the paid-through period, no grace).
  'pending' (the first payment has not settled) is never entitled.
Plan posts stay live while entitled AND inside their own 60 days, whichever ends first; nothing extends them.

Admin: GET/POST /api/admin/employer-plans (list; create/attach { email, userId?, slots?, currentPeriodEnd, status? } → upsertPlan(source:'admin')),
       PATCH /api/admin/employer-plans/[id] ({ status?, slots?, currentPeriodEnd?, userId? }); page /admin/employer-plans.
```

### 2f. Plan-lapse job (Inngest, daily `TZ=UTC 0 7 * * *`)

```
lib/inngest/functions/plan-lapse.ts (registered in app/api/inngest/route.ts — NOT a Vercel cron; vercel.json is at the 40-entry limit)
  └─ for each attached plan that no longer entitles posting (findLapsedPlans: 'cancelled' once currentPeriodEnd has passed,
     'active' or 'past_due' once currentPeriodEnd + grace has passed, 'pending' always) and still has live 'plan' posts:
       pausePlanPosts(userId) → Job.isPublished=false on those rows · sendPlanPausedEmail
```

### 2g. Expiry (no money flow, but visible UX)

```
Cron /api/cron/expiry-warnings → sendExpiryWarningEmail (from 5 days before expiresAt)
  └─ The offer is decided per row, at send time, by lib/email-service.ts#expiryWarningCopy and
     lib/renewal-offer.ts#resolveRenewalOffer (client-safe, so the dashboard and the edit page
     share the rule; lib/pricing.ts re-exports it, and the cron reads the employer's own
     next-post price from lib/pricing.ts#nextNewPostPrice):
       renew        : a promo or paid row AND getPaidPostingStatus().available. A saving is
                      named only after the promo, against the employer's own next new-post
                      price ($199 intro, $299, or $0 with a free plan slot), or "vs. the $299
                      post price" when that is unknown, and never when renewal is not cheaper.
       promo_repost : no renewal on sale during the promo, so the email says every post is
                      free through config.promoEndsLabel.
       paid_repost  : no renewal on sale for this row after the promo (the legacy free rows)
                      while paid posting is available, so the email offers a fresh post at
                      today's ladder price (ladderLine(now)).
       none         : nothing on sale after the promo (paid posting off), so there is no offer.
       plan         : no renewal CTA; each plan post runs 60 days, then is posted again into
                      the freed slot at no extra charge.
  └─ The "your listing has expired" email the same cron sends (postExpiryOffer) makes the
     same choice: a renewal when one can be bought, the freed slot for a plan post, a free
     repost while the promo runs, a paid repost at ladderLine(now) while paid posting is
     available, otherwise no offer.

Employer republish (toggle-publish): 'paid', 'free' and 'promo' come back directly;
'plan' only through republishPlanPost (plan entitled and a free slot, checked in one
Serializable transaction with the write: 403 planInactive, 409 planSlotsFull, 409 retry
on a serialization conflict). Archive and edit-token soft delete set
isManuallyUnpublished, as a pause does, so resumePlanPosts never revives them.

Posting reaches expiresAt: excluded from getEmployerActivePostings; no NEW unlocks / InMails;
previously-unlocked candidates stay accessible (hasFullAccess via existingView); replies stay free.
```

---

## 3. Architecture map

### 3a. Source-of-truth files

| Concern | File |
|---|---|
| Pricing values + helper functions, and the promo clock every phase-dependent surface reads (`config.isPromoActive(now)`, `config.promoEndsAt`) | [lib/config.ts](../lib/config.ts) |
| Posting-mode resolution, intro allowance, free-email list, the employer's own next-post price (`nextNewPostPrice`) | [lib/pricing.ts](../lib/pricing.ts) |
| Renewal offer rule: whether a renewal may be pitched as a saving, and in which words (`renewalSavings`, `resolveRenewalOffer`, `renewalSavingsLabel`, `renewalSavingsLine`). Client-safe (imports only lib/config), so the dashboard and the edit page apply the same rule as the emails and the cron; lib/pricing.ts re-exports the first three and their types | [lib/renewal-offer.ts](../lib/renewal-offer.ts) |
| Whether a next-post quote the browser already holds is still true (`currentQuote(quote, now)`: a `'promo'` quote reads as no quote once the promo has ended). Client-safe; used by /post-job/preview, /post-job/checkout and the dashboard usage widget | [lib/next-post-quote.ts](../lib/next-post-quote.ts) |
| Employer plan entitlement, slots, pause/resume | [lib/employer-plan.ts](../lib/employer-plan.ts) |
| Whether the plan can be sold now (`isPlanSaleOpen(now)`: a valid Payment Link, `ENABLE_PAID_POSTING` on, promo over) and the buyer's link | [lib/employer-plan-link.ts](../lib/employer-plan-link.ts) |
| Quota / unlock / InMail gates | [lib/tier-limits.ts](../lib/tier-limits.ts) |
| Email-change policy (helper, not yet wired) | [lib/auth/email-change-policy.ts](../lib/auth/email-change-policy.ts) |
| Email templates (pricing sentences from lib/pricing-copy.ts, chosen at send time) | [lib/email-service.ts](../lib/email-service.ts) (uses [lib/email-templates-v2.ts](../lib/email-templates-v2.ts)) |
| Client-side analytics events | [lib/analytics.ts](../lib/analytics.ts) |
| Server-side purchase events | [lib/analytics-server.ts](../lib/analytics-server.ts) |

**The date-driven copy switch.** Every sentence that states a price or the promo is chosen from `config.isPromoActive(now)` when it is rendered, sent or requested, never at module load (§1d). These modules hold the words; each page calls its builder with `now` on every render (a Next.js page may export only Next's own names, so a page's builder sits in a sibling file):

| Module | Exports | Used by |
|---|---|---|
| [lib/pricing-copy.ts](../lib/pricing-copy.ts) (client-safe: imports only lib/config) | `PROMO_HEADLINE`, `PROMO_SUB` (promo only); `LADDER_PRICES`, `LADDER_HEADLINE`, `FULL_PACKAGE`, `LADDER_FROM_LINE` (ladder only); `ladderLine(now)`, `planPriceLine(now)` (dated while the promo runs, plain after) | the six page builders below (lib/compare-data.ts and lib/employer-comparison.ts phrase their own sentences from config), the emails, the expiry cron, lib/outreach-service.ts, and the inline promo branches on /testimonials, /tools/salary-benchmark, /for-employers/resources/how-to-hire and the /post-job layout metadata |
| [app/pricing/pricing-page-copy.ts](../app/pricing/pricing-page-copy.ts) | `pricingPageCopy(now)`: hero, `promoActive` (the $0 promo card renders only while true), `packageSection` (the feature grid's heading once that card is gone; null while the promo runs), listing card, ladder heading, CTA card, leading FAQ entries, metadata. Also the both-phase canonical constants `PLAN_TERMS`, `PLAN_POSTS_LINE`, `PLAN_CANCEL_LINE`, `FEATURES_LINE`, `RENEWAL_LINE`, `RENEWAL_EFFECT_LINE`, `RENEWAL_CAP_LINE` | /pricing |
| [app/for-employers/for-employers-copy.ts](../app/for-employers/for-employers-copy.ts) | `forEmployersCopy(now)`: receipt hero, CTAs, pricing card, bento copy, leading FAQ entries, metadata, and the `promoActive` flag the page hands EmployerHowItWorks | /for-employers |
| [app/faq/faq-employer-copy.ts](../app/faq/faq-employer-copy.ts) | `employerPricingFaqs(now)`: cost, features, intro price, Employer plan | /faq |
| [app/post-job/_lib/post-job-pricing-copy.ts](../app/post-job/_lib/post-job-pricing-copy.ts) (client-safe) | `postJobPricingCopy(now)`: the subtitle and the Step 5 package lines | the /post-job wizard |
| [app/for-employers/resources/post-job-cta.ts](../app/for-employers/resources/post-job-cta.ts) | `postJobCta(now)`: `offer`, `price`, `button` | the employer resources hub, the template library and every template page; the job description guide, which states no price, prints `button` alone |
| [app/tools/cost-per-hire-calculator/cost-per-hire-copy.ts](../app/tools/cost-per-hire-calculator/cost-per-hire-copy.ts) | `costPerHireAssumptions(phase)`, `costPerHireFaqs(phase)`, `postRoleBlurb(phase)`, for `phase = pricingPhase(now)` from [components/tools/cost-per-hire-model.ts](../components/tools/cost-per-hire-model.ts), which also exports `flatFeeModeOptions(phase)`, `defaultInputs(phase)` and `offeredFlatFeeMode(selected, phase)` | /tools/cost-per-hire-calculator and its client calculator |
| [lib/compare-data.ts](../lib/compare-data.ts) | `competitorProfiles(now)`, `getCompetitorProfile(slug, now)`: our price statements come from the private `ourPriceCopy(now)`; competitor claims stay dated to `COMPARE_REVIEW_DATE` | the three comparison pages and the /compare hub (which prints no price) |
| [lib/employer-comparison.ts](../lib/employer-comparison.ts) | `employerComparisonRows(now)`: the "Free Posting Through ..." row only while the promo runs, and the flat-pricing note dated only while it runs | /pricing, /for-employers |
| [lib/outreach-service.ts](../lib/outreach-service.ts) | `availableOutreachTemplates(now)`, `renderTemplate(name, vars, now)`, `OUTREACH_TEMPLATE_NAMES`, `OutreachTemplateUnavailableError` (freeOffer after the promo) | /admin/outreach, POST /api/outreach |
| [app/api/sitemaps/lastmod.ts](../app/api/sitemaps/lastmod.ts) | `PROMO_SWITCH_PATHS`, `promoSwitchDate(now)`, `withPromoSwitch(date, now)`, `pageContentDate(path, now)` | app/sitemap.ts and the sitemap index |

### 3b. API routes (pricing-related)

| Route | Method | Purpose |
|---|---|---|
| `/api/employer/free-quota-status` | GET | Quote for the employer's NEXT post (mode/tier/price + promo + plan fields) |
| `/api/jobs/post-free` | POST | Post without a charge: promo → plan → 403 requiresPayment; atomic; sets quotaDomain |
| `/api/create-checkout` | POST | Intro / Featured post → Stripe Checkout (tier from `getNextPaidTier`); 503 while `ENABLE_PAID_POSTING` is off or Stripe is unconfigured, 409 `PROMO_ACTIVE` while the promo runs |
| `/api/create-renewal-checkout` | POST | Renewal → Stripe Checkout (blocks pending / expired / refunded / disputed / plan / legacy free / archived posts, and a renewal payment already in flight; one payable renewal session per post) |
| `/api/verify-checkout-session` | GET | Server-side Stripe verification for `/success` page |
| `/api/verify-renewal-session` | GET | Server-side verification for `/employer/renewal-success` |
| `/api/webhooks/stripe` | POST | Stripe → publish job, write JobCharge, plan subscription lifecycle, emails, purchase event |
| `/api/employer/plan` | GET | Plan status + slots + payment-link URL for the dashboard widget |
| `/api/employer/plan/subscribe` | GET | The /pricing plan CTA: redirects a signed-in employer without a plan to their Stripe Payment Link (with `client_reference_id`, the only key the webhook attaches a plan by) while `isPlanSaleOpen()`; otherwise back to /pricing, to /login, or to the dashboard for an employer who already has an entitled or pending plan |
| `/api/employer/billing-portal` | POST | Opens a Stripe Customer Portal session for the employer's own plan (the dashboard's "Manage billing"): cancel at period end, card update, invoices |
| `/api/outreach` | GET/POST | Admin only (`requireApiAdmin`): employer leads and the cold-outreach templates. `render-template` validates the name against `OUTREACH_TEMPLATE_NAMES` (400) and answers 409 `{ success: false, error }` with the service's reason for a template that is not on offer (`freeOffer` once the promo has ended) |
| `/api/admin/employer-plans`, `/api/admin/employer-plans/[id]` | GET/POST/PATCH | Admin list / grant / attach / edit plans |
| `/api/employer/invoice` | GET | PDF invoice from JobCharge ledger (audit #2) |
| `/api/employer/usage` | GET | Per-posting credit usage for dashboard |
| `/api/jobs/update` | POST/DELETE | Job edit / unpublish (contactEmail edits allowed — quotaDomain anchor handles it) |

### 3c. UI surfaces (pricing-related)

Unless a row says otherwise, a server page below that states the promo decides the phase on each render and re-renders hourly (`revalidate = 3600`), and a client page decides it on each render in the browser (§1d).

| Surface | Reads from |
|---|---|
| [/pricing](../app/pricing/page.tsx) | `pricingPageCopy(now)` and `employerComparisonRows(now)`, per render and in `generateMetadata`; the $0 promo card renders only while the promo runs, and it carries the feature grid's heading and the page's first button, so once it is gone the hero carries the post-a-job button and the grid gets its own H2 (`packageSection`); plan CTA = `/api/employer/plan/subscribe` while `isPlanSaleOpen()`, else a support mailto |
| [/ (homepage)](../app/page.tsx) | the "How employers hire" band (components/EmployerHowItWorks.tsx) gets `promoActive` from the server render, so its CTA hydrates with the label the HTML carries (revalidate 60) |
| [/post-job](../app/post-job/page.tsx) | `postJobPricingCopy()` on each render; `/api/employer/free-quota-status` quote (`price`/`tier`); `config.*` for feature pills; metadata from the layout's `generateMetadata` |
| [/post-job/preview](../app/post-job/preview/page.tsx) | banner by mode: promo / plan slot N of M / intro $199 / $299, from the quote through `currentQuote` (a promo quote fetched before the switch reads as no quote: neutral copy) |
| [/post-job/checkout](../app/post-job/checkout/page.tsx) | order summary from the quote, through `currentQuote` |
| [/for-employers](../app/for-employers/page.tsx) | `forEmployersCopy(now)` and `employerComparisonRows(now)` (shared with /pricing), per render and in `generateMetadata`; hands `promoActive` to EmployerHowItWorks |
| [/faq](../app/faq/page.tsx) | `employerPricingFaqs(now)`, which also feed the FAQPage JSON-LD; the static metadata names no price |
| [/terms](../app/terms/page.tsx) | `config.*`; static, and does not switch: it states the launch promotion and the schedule from `config.ladderStartsLabel` with their dates |
| [/testimonials](../app/testimonials/page.tsx) | CTA from an inline `config.isPromoActive(now)` branch and `LADDER_PRICES` (the page 404s until a consented testimonial is featured) |
| [for-employers/resources](../app/for-employers/resources/page.tsx), the template library and every template page | `postJobCta(now)`; the hiring guide (how-to-hire) uses an inline `config.isPromoActive(now)` branch and `LADDER_PRICES`; the [job description guide](../app/for-employers/resources/job-description-guide/page.tsx) states no price and takes only its button label from `postJobCta(now).button` ("Post a Job: Free" while the promo runs, "Post a Job" after) |
| [/tools/salary-benchmark](../app/tools/salary-benchmark/page.tsx) | post-a-role card from an inline `config.isPromoActive(now)` branch and `LADDER_PRICES` |
| [/tools/cost-per-hire-calculator](../app/tools/cost-per-hire-calculator/page.tsx) | `FLAT_FEE_PRICING` in [components/tools/cost-per-hire-model.ts](../components/tools/cost-per-hire-model.ts) models promo / per-post / plan; the page decides `pricingPhase(now)`, builds its notes, FAQ (and FAQPage JSON-LD) and post-a-role card from ./cost-per-hire-copy.ts, and hands the phase to the client calculator, which offers `flatFeeModeOptions(phase)`, opens on `defaultInputs(phase)` and prices only a way to buy the phase still offers (`offeredFlatFeeMode`) |
| [/compare/*](../lib/compare-data.ts) | `getCompetitorProfile(slug, now)` per render and in `generateMetadata`; `OUR_FACTS` holds the config tokens. The /compare hub is static and prints no price |
| [/employer/dashboard](../app/employer/dashboard/page.tsx) | `paymentStatus` branches Renew vs "Plan slot"; promo branches from `config.isPromoActive()`; savings line from `renewalSavingsLine` (lib/renewal-offer.ts) against the employer's next-post price; plan widget from `/api/employer/plan`; usage widget quote through `currentQuote` |
| [/jobs/edit/[token]](../app/jobs/edit/%5Btoken%5D/page.tsx) | `config.*` + renewal modal branches on `paymentStatus`; promo branches from `config.isPromoActive()`; savings line from `renewalSavingsLine` against the standard post price (the page does not know the quota domain) |
| [/success](../app/success/page.tsx) | `?mode=promo` / `?mode=plan` / `?free=true` (promo) / `?session_id` verification |
| [/admin/employer-plans](../app/admin/employer-plans/page.tsx) | list + grant form + attach-by-email |
| [/admin/outreach](../app/admin/outreach/page.tsx) | force-dynamic server page: lists `availableOutreachTemplates(now)` (freeOffer only while the promo runs) and hands the list to the client UI, which shows a refused render's reason (409 from `/api/outreach`) as a toast |
| Employer emails ([lib/email-service.ts](../lib/email-service.ts)) | the welcome email's pricing card from `pricingCopyForNow(now)` (`PROMO_HEADLINE` + `PROMO_SUB`, or `LADDER_HEADLINE` + `ladderLine(now)`); the plan-paused email prints that copy's label and body only, with no headline; the expiry offers in §2g; all decided at send time |

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
  paymentStatus   String    // 'promo' | 'pending' | 'paid' | 'plan' | 'refunded' | 'disputed' | 'expired'
                            // ('disputed': a chargeback is open or was lost; 'expired': an abandoned checkout the sweep retired)
                            // | legacy 'free' / 'free_renewed' / 'free_upgraded' (existing rows only; never written again)
  pricingTier     String    @default("pro")  // 'intro' | 'pro' | 'plan'; promo + legacy rows carry 'pro'
  userId          String?   // Supabase auth id; nullable on account deletion
  quotaDomain     String?   // ★ Immutable signup-domain snapshot — set ONLY at row creation, on EVERY path
  stripeCheckoutSessionId String?  // the latest Checkout Session for the post; the resume path retires it before minting another
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
  userId               String?   @unique   // loose Supabase auth id; null while the plan is unattached (a checkout with no account reference, or a detached duplicate)
  email                String
  status               String    @default("active")   // 'active' | 'past_due' | 'cancelled' | 'pending'
  slots                Int       @default(5)
  priceCents           Int       @default(39900)
  currentPeriodEnd     DateTime
  stripeCustomerId     String?
  stripeSubscriptionId String?   @unique
  source               String    @default("stripe")   // 'stripe' | 'admin'
  lastStripeEventAt    DateTime?           // stamp of the newest subscription state applied to the row; an older one is ignored (§2e)
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  @@index([email])
  @@index([status, currentPeriodEnd])
  @@map("employer_plans")
}
```

Entitled = `status IN ('active','past_due') AND currentPeriodEnd + config.planGraceDays > now`, or `status = 'cancelled' AND currentPeriodEnd > now` (a cancel keeps the paid-through period, with no grace). `'pending'` (the first payment has not settled) is never entitled. `slots` is per plan (admin-adjustable); `used` = live `'plan'` posts for the user; `canPost = entitled && used < slots`.

### 4c. ProcessedStripeEvent (idempotency)

```prisma
model ProcessedStripeEvent {
  id          String   @id @default(uuid())
  eventId     String   @unique  // ← idempotency key (Stripe event.id)
  eventType   String
  processedAt DateTime @default(now())
  status      String   @default("done")  // 'processing' while a delivery is being handled, 'done' once it has answered
  claimedAt   DateTime @default(now())   // when the delivery that holds the row claimed it
  @@index([eventType])
}
```

Two-phase claim. The webhook inserts the row as `'processing'` BEFORE it handles the event and marks it `'done'` once the handler answers below 500. On a UNIQUE violation it returns 200 + `deduped=true`, with one exception: a row still `'processing'` whose claim is older than the reclaim window (the route's `maxDuration` plus 30 seconds) belongs to a delivery that died mid-flight, and Stripe's retry takes it over. Every 500 path deletes the row first, so the retry replays the event. The subscription handlers use the same table and the same cleanupDedupe pattern.

### 4d. JobCharge (per-charge invoice ledger)

```prisma
model JobCharge {
  id                    String    @id @default(uuid())
  employerJobId         String?   // nullable, FK with ON DELETE SET NULL: the ledger outlives a deleted post (B112)
  stripeSessionId       String    @unique
  stripePaymentIntentId String?   @unique   // matches charge.refunded and charge.dispute.* events back to the row
  stripeInvoiceId       String?
  invoicePdfUrl         String?   // refreshed by invoice.paid, once Stripe has issued the paid PDF
  hostedInvoiceUrl      String?
  invoiceNumber         String?
  amountCents           Int       // what Stripe charged: 19900 (intro) | 29900 (pro) | 17900 (renewal) at list price
  currency              String    @default("usd")
  type                  String    // 'new' | 'renewal'
  createdAt             DateTime  @default(now())
  refundedAt            DateTime?
  refundedAmountCents   Int?      // partial refunds add up here; a lost dispute is recorded here too
  refundReason          String?   // Stripe's reason, or 'dispute_lost'
}
```

One row per per-post Stripe checkout. Invoices are generated from this ledger so the amount matches what Stripe billed; a paid post from before the ledger has no row, and its invoice falls back to `config.legacyInvoiceFallbackCents`. Plan subscriptions are NOT in this ledger — Stripe Billing issues their receipts.

### 4e. Other relevant fields

- `Job.expiresAt DateTime?` — drives "active posting" definition; plan posts are additionally paused (`isPublished=false`) by the lapse job
- `Job.isFeatured Boolean @default(false)` — every post writes `false`; placement + badge come from the EmployerJob relation. Exception: the renewal webhook writes `true` (`config.isFeaturedTier` is always true), which sorts a renewed post above un-renewed employer posts on the `best` order; lib/utils/job-sort.ts still documents the flag as unused
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
| View previously-unlocked candidates' contact info | After the posting expires, while the candidate's profile stays visible and open to offers (audit #21; the candidate route only returns such profiles) |
| Renew posting at $179 | promo + paid posts, +60 days capped at `config.renewalCapDays` after creation, no new unlocks / InMails; plan posts are never renewed (nothing reposts them; the employer posts again into a freed slot); legacy free posts must repost |
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
| **Unattached plan checkout** | A plan bought without the account reference: the raw Payment Link opened outside `/api/employer/plan/subscribe` and the dashboard widget, so the session carries no `client_reference_id` | The checkout email is typed by the buyer and proves nothing, so an email match never attaches a plan (attaching by email would hand a paid plan to whoever's address was typed) | The plan is stored unattached, the buyer gets `sendPlanLinkPendingEmail`, the webhook alerts (`alertWebhookFailure`, saying whether the email matches an employer account), and the admin attaches it at /admin/employer-plans |
| **Concurrent first checkouts** | Two people at one domain open their first paid checkout at the same moment; both sessions are priced `'intro'` because neither is `'paid'` yet, so the $100 discount is granted twice | Counting in-flight `'pending'` intro rows would make an honest employer who abandons a $199 checkout see $299 on retry — worse than a rare $100 leak | `activate-paid-job.ts#detectIntroDoubleCharge` logs a Sentry-forwarded error when an intro activation finds another paid post at the domain. No refund is due: the domain paid $100 less than the ladder asks, not more (the log line's "refund the difference" points the wrong way). docs/PENDING_WORK.md D3 decides whether to block a second open intro checkout or accept the leak |

### Loopholes considered and confirmed NOT loopholes

| Scenario | Why it's safe |
|---|---|
| Account self-deletion + soft-delete | `EmployerJob.userId` becomes null on delete, but `quotaDomain` and `paymentStatus` persist. Counts unaffected. |
| Unpublish own job (`DELETE /api/jobs/update`) | Sets `isPublished=false`. Row stays; `'paid'` count unaffected (promo cap counts live rows only, which is the intended behaviour). |
| Edit job content (title/description/salary) | Doesn't touch `quotaDomain`, `paymentStatus`, or `userId`. |
| Edit `contactEmail` after posting | Count anchored on `quotaDomain` not `contactEmail`. |
| Attempt to mutate `paymentStatus` directly | No customer-facing path writes this field. Webhook, `post-free` and the lapse job are the only writers. |
| Cancel the plan right after posting 5 jobs | A cancelled plan is entitled only through `currentPeriodEnd` (no grace), and each post only through its own 60 days; the lapse job pauses them. |

---

## 9. Operational runbook

### 9a. Production migrations

| Migration | What it did |
|---|---|
| `20260429990000_repair_pricing_tier_bootstrap` | Fresh-database ordering repair: creates `employer_jobs.pricing_tier` when it is missing, so the next migration can run; a no-op in production |
| `20260430_normalize_pricing_tier_to_pro` | Backfilled all `pricing_tier` legacy values → 'pro'; changed column default |
| `20260430_add_processed_stripe_events` | Added idempotency table |
| `20260430_add_job_charges` | Added per-charge invoice ledger |
| `20260501_add_quota_domain` | Added immutable quota anchor field; backfilled from contact_email |
| `20260501_add_invoice_fields_to_job_charges` | `job_charges.stripe_invoice_id`, `invoice_pdf_url`, `hosted_invoice_url`, `invoice_number` |
| `20260501_add_refund_fields_to_job_charges` | `job_charges.stripe_payment_intent_id` (unique; how a refund or dispute finds its charge), `refunded_at`, `refunded_amount_cents`, `refund_reason` |
| `20260718000001_add_job_charges_employer_job_fk` | `job_charges.employer_job_id` made nullable with a foreign key, ON DELETE SET NULL: the ledger survives a deleted post (B112) |
| `20260912000000_add_employer_plans` | Added `employer_plans` table (Employer plan) |
| `20260913000000_stripe_integration_hardening` | `employer_jobs.stripe_checkout_session_id`, `processed_stripe_events.status/claimed_at` (two-phase webhook dedupe), `employer_plans.last_stripe_event_at` (out-of-order event guard) |
| `20260913000001_employer_plans_rls` | Row level security on `employer_plans` with no policies: service role only, like `job_charges` and `processed_stripe_events` |

Applied via the deploy build (`prisma migrate deploy`) — never run migrations by hand against production from a dev shell.

### 9b. Production Stripe checklist

The promo needs NOTHING from Stripe. Everything below must be live **before January 1, 2027** (see [LAUNCH_RUNBOOK.md §8](./LAUNCH_RUNBOOK.md)):

- [ ] `ENABLE_PAID_POSTING=true` + `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` in Vercel. Set the key and the webhook secret before the flag, or in the same deploy: with the Payment Link set, the flag alone opens plan sales once the promo is over (§1d)
- [ ] Webhook endpoint `https://nphiring.com/api/webhooks/stripe` registered; event filter includes `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` (the list in `.env.example`; `processEvent` in app/api/webhooks/stripe/route.ts handles every one except `customer.subscription.created`, a deliberate no-op)
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
| `employer_plans` rows with `user_id IS NULL` | Plan checkouts that carried no account reference (attach them in /admin/employer-plans), and second subscriptions stored detached beside an employer's live plan (cancel or refund one) |
| Sentry error "Intro price charged twice for one domain" | Two concurrent first checkouts both got the $199 rung (§8): the domain paid $100 less than the ladder asks. Nothing is refunded; docs/PENDING_WORK.md D3 decides what to do about it |
| 5xx error rate on `/api/webhooks/stripe` | Should be ~0 with idempotency |
| post-free 403 rate (`promoCapReached` / `planSlotsFull` / `requiresPayment`) | Abuse signal during the promo; demand signal for the ladder after |
| `plan-lapse` Inngest run log | Paused-post counts; a spike means Stripe retries are failing |
| `processed_stripe_events` table size after 12+ months | Will grow unbounded; plan partition or quarterly cleanup |

### 9d. Operational rules cheat-sheet

- Promo: every post free through 2026-12-31 in every US zone (ends 2027-01-01T10:00Z, midnight Pacific/Honolulu); `config.isPromoActive()` is the only switch — no flag to flip. What switches on its own at that instant, and what stays an owner step (Stripe live mode, `ENABLE_PAID_POSTING`), is in §1d.
- Ladder: intro $199 = first `'paid'` row per `quotaDomain`; featured $299 after; renewal $179 on promo/paid rows; plan $399/month for 5 slots.
- Renewal extends from `MAX(existingExpiresAt, now)` — early renewers don't lose days — up to `config.renewalCapDays` after creation; it never resets unlocks or InMails.
- Plan posts are never renewed; each runs 60 days, frees its slot when it ends or is closed, and is paused by the lapse job when the plan lapses (grace = `config.planGraceDays` for past_due, none for cancelled).
- Legacy `'free'` posts cannot be renewed (unchanged message). Pending, expired, refunded and disputed posts cannot be renewed, and neither can an archived post until it is restored.
- Webhook idempotency keyed on `event.id`. Stripe retries are safe, for subscriptions too.
- Server-side `purchase` event fires from the webhook (the only authoritative payment-completion signal).
- Copy rule: every price and date on every surface is a config token; the canonical sentences in §1c are quoted verbatim; no audience-size claims anywhere. Which promo-dependent sentence a surface prints is decided when it renders or sends (lib/pricing-copy.ts or the page's builder, §3a), never at module load, and a server page that prints one re-renders at least hourly; /terms instead states both dated schedules and does not switch.

---

## 10. Test coverage

### 10a. Unit tests (Vitest)

[tests/lib/tier-limits.test.ts](../tests/lib/tier-limits.test.ts) — unlock / InMail gates (unchanged).

Regression suites pin the marketing copy (`tests/regressions/p2-trust-surfaces-point-of-sale.test.ts`, `p0-faq-pricing-funnel-stats-heroes-schema.test.ts`, `p9-claims-promises-review5.test.ts`, `p3-tools-round-2-registry.test.ts`) and are updated alongside any pricing change.

The promo-end switch (§1d) is pinned by these suites, which run every clock-dependent case at fixed instants on both sides of `config.promoEndsAt`: [tests/lib/pricing-copy.test.ts](../tests/lib/pricing-copy.test.ts) (the shared sentences); `tests/regressions/pricing-pages-phase-switch.test.ts` (/pricing, /for-employers, /faq, their metadata and FAQPage JSON-LD, and the EmployerHowItWorks flag); `promo-switch-periphery.test.ts` (the employer resources pages, /testimonials, the salary benchmark, the cost-per-hire calculator, the comparison pages and the /post-job metadata); `employer-app-promo-phase.test.ts` and [tests/lib/next-post-quote.test.ts](../tests/lib/next-post-quote.test.ts) (the wizard, the preview, the dashboard usage strip and the candidate profile card, and that no employer surface decides the phase at module load); `checkout-page-server-quote.test.ts` (the checkout banner, rendered in both phases); `email-pricing-copy-phase.test.ts` (the welcome and plan-paused emails); `expiry-warning-renewal-offer.test.ts` and [tests/api/cron-expiry-warnings-renewal-offer.test.ts](../tests/api/cron-expiry-warnings-renewal-offer.test.ts) (the expiry offers, §2g); [tests/lib/outreach-service.test.ts](../tests/lib/outreach-service.test.ts), `admin-outreach-template-phase.test.ts` and [tests/api/outreach-render-template.test.ts](../tests/api/outreach-render-template.test.ts) (the outreach templates, the admin list and the route's 409); `promo-switch-loose-ends.test.ts` (the homepage's server-decided flag and the email ladder headline); and the "2.1:" cases of `sitemap-content-lastmod.test.ts` (the lastmod switch).

Those suites prove the surfaces they import. `tests/regressions/promo-copy-static-guard.test.ts` covers the ones nobody listed (the job description guide kept a hard-coded "Post a Job: Free" on a static page until 2026-10-02): it reads every source under app/, components/ and lib/ through the TypeScript AST and fails when promo copy sits outside the promo branch of a condition that reads the promo clock or a promo row. Promo copy is visible text that offers free posting or names the promo, a `$0` price, `config.promoEndsLabel` or `config.ladderStartsLabel` printed under any object, and any use of a promo-only declaration. A declaration that holds only promo copy is listed in the guard's `PROMO_ONLY_UNITS`, and every use of its name is then held to the same rule; a statement that stays true after the promo (/terms, history, an operator alert) is listed in `TRUE_IN_BOTH_PHASES` with its reason. It proves where the copy sits, not that the page re-renders: a new server page that prints promo copy also needs `revalidate = 3600`, an entry in `PROMO_SWITCH_PATHS` and a render in both phases in one of the suites above.

`tests/regressions/promo-clock-pages-rerender.test.ts` enforces the first two of those for every page the sitemap dates. It reads the calls in each page: a page that calls `config.isPromoActive`, or a function of a module that reads the clock (lib/pricing-copy.ts, a page's builder, lib/compare-data.ts), has to export a `revalidate` of at most an hour and be in `PROMO_SWITCH_PATHS`, and a page listed there has to follow the clock. A page that only calls a phase-neutral function of such a module goes in its `NOT_PHASE_DEPENDENT` with the reason (none today).

Two more suites cover what neither kind sees. `promo-switch-static-metadata.test.ts`: a module-scope `metadata` export cannot follow the clock, so on the periphery pages it may not offer free posting or name a promo date (the template library's link preview said "free to browse, customize, and post"). `cost-per-hire-mounted-across-switch.test.ts`: a calculator that was already open with the promo selected when the phase became the ladder shows and prices the per-post ladder.

### 10b. Money-path coverage, and what is still missing

Every path that takes money or grants a paid entitlement has a Vitest suite. All of them run against the mocked Prisma client of tests/setup.ts and a stubbed Stripe client:

| Path | Suites |
|---|---|
| `POST /api/jobs/post-free`: the promo cap and the plan slot, both re-counted inside the transaction; paid modes handed to checkout | `tests/api/post-free-modes.test.ts`, `tests/lib/pricing.test.ts` |
| `POST /api/create-checkout`: intro then pro, the resume path, delayed payments, 409 `PROMO_ACTIVE` | `tests/api/create-checkout-tier.test.ts` |
| `POST /api/create-renewal-checkout`: the status and archive refusals; the renewal cap (409 `RENEWAL_CAP_REACHED` before any Stripe call for a post at or past `config.renewalCapDays`, and Checkout quoting the days a renewal near the cap really adds); one payable session per post; a reused idempotency key that replays a session this route had already expired, and the parameter fingerprint in that key | `tests/api/create-renewal-checkout-status.test.ts`, `tests/api/create-renewal-checkout-cap.test.ts`, `tests/api/create-renewal-checkout-single-payable.test.ts`, `tests/api/create-renewal-checkout-replayed-session.test.ts`, `tests/lib/renewal-checkout-sessions.test.ts` |
| The webhook: idempotency and the two-phase claim, the `payment_status` gate, a second payment for one post, the `JobCharge` ledger, the intro race detector | `tests/api/webhooks-stripe-c2.test.ts`, `tests/api/activate-paid-job-intro-race.test.ts` |
| Renewals applied: archived posts, sibling sessions, a payment that lands at or past the renewal cap (recorded on the ledger and alerted for a refund with its payment intent, while the expiry, the status and `isPublished` stay untouched and no confirmation email is sent) or just short of it (applied with the days that are left, the shortfall logged), the verify page's self-heal and cookie binding | `tests/api/webhooks-stripe-archived-post.test.ts`, `tests/api/apply-renewal-sibling-sessions.test.ts`, `tests/api/apply-renewal-cap.test.ts`, `tests/api/verify-renewal-session-self-heal.test.ts`, `tests/api/verify-renewal-session-sec3.test.ts` |
| Refunds and disputes | `tests/api/webhooks-stripe-refund-dispute.test.ts` |
| Plan checkout, subscription events, entitlement, slots, the buyer's link and the admin grant | `tests/api/webhooks-stripe-subscription.test.ts`, `tests/api/webhooks-stripe-subscription-live-read.test.ts`, `tests/lib/employer-plan.test.ts`, `tests/lib/employer-plan-stale-write.test.ts`, `tests/lib/employer-plan-link.test.ts`, `tests/api/employer-plan-billing.test.ts`, `tests/api/admin-employer-plans-grant.test.ts` |
| The daily sweeps: plan lapse, plan reconciliation, payment reconciliation, and what the payment sweep reports: an alert that says a recovered post was left archived (so nobody reads it as live) and a renewal arm that looks back as far as the create route refuses on (`RENEWAL_SETTLEMENT_LOOKBACK_MS`) | `tests/inngest/plan-lapse.test.ts`, `tests/inngest/plan-reconciliation.test.ts`, `tests/inngest/payment-reconciliation-guards.test.ts`, `tests/inngest/payment-reconciliation-renewals.test.ts`, `tests/inngest/payment-reconciliation-left-archived.test.ts` |
| `evaluateEmailChange` (§8, #27) | `tests/lib/email-change-policy.test.ts` |

`tests/regressions/docs-pricing-system-matches-code.test.ts` checks this document against the code: the links and paths it gives, the status map, the response shape and the schema blocks it prints, and this table against the suites on disk.

Still missing: nothing runs against a real database or Stripe test mode. The Serializable transactions, the conditional writes (the `'pending'` claim, the `lastStripeEventAt` compare-and-set) and Stripe's own behaviour are asserted against mocks only, and the Playwright journeys stop at the checkout gate and never pay. Both wait for a non-production database (docs/PENDING_WORK.md 1.8).

---

## 11. Future-state items (intentionally deferred)

| ID | Item | When to revisit |
|---|---|---|
| #14 | Stripe Product / Price catalog (proper Price IDs) instead of ad-hoc `unit_amount` + a Payment Link | When adding Stripe Tax, coupons, or a second plan size |
| Plan self-serve | Customer Portal SHIPPED (POST /api/employer/billing-portal → dashboard "Manage billing": cancel at period end, card update, invoices). Still deferred: in-app slot upgrade and a server-created subscription Checkout Session replacing the Payment Link | After the first month of real plan subscribers |
| Plan overflow | Buying extra slots or a second plan from the dashboard | When a plan holder asks for slot 6 (today: contact support / admin bumps `slots`) |
| Promo switch purge | The pages that switch at the promo end regenerate stale-while-revalidate, so each can serve its cached promo render to one more request after its window (§1d). A cron that calls `revalidatePath` on its first run after `config.promoEndsAt` (`revalidatePublicPaths` in app/api/admin/_lib/public-revalidation.ts) for every path in `PROMO_SWITCH_PATHS` with each template page, plus `/`, `/testimonials` and `/post-job`, would make the next request to each render the ladder | Before 2027-01-01 |
| Promo end-of-life | Retire `'promo'` writes after 2027-01-01 and remove the promo branches (the wizard's, the promo halves of lib/pricing-copy.ts and the §3a builders, the outreach `freeOffer` template). A page taken out of `PROMO_SWITCH_PATHS` then needs a `PAGE_CONTENT_DATES` entry no earlier than the switch, or its sitemap lastmod falls back to its older copy date | 60 days after the promo ends (last promo posts have expired) |
| P2 | Self-serve bulk packs | Only if the plan does not absorb the multi-role demand |
| P4 | Boost / Spotlight upsell SKU | Adds an upsell vector beyond the ladder |
| P5 | Stripe Tax + PO/invoice path for enterprise | Blocker for hospital systems / large staffing firms |
| Per-org verification | NPI lookup / DNS TXT / manual review | Closes the shell-domain attack; needed at scale |
| Email-change endpoint | UI + endpoint that calls `evaluateEmailChange` | When user demand surfaces; helper is ready |
| Audit #20 | Paid-path tests against a real database and Stripe test mode, and a Playwright journey that pays. The mocked suites exist (§10b) | Once docs/PENDING_WORK.md 1.8 provides a non-production database |
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
plan post?          → "Plan slot" badge, no Renew (runs 60 days; post again into the freed slot)
legacy free post?   → popup: "can't renew, post new" → /post-job
```

### Employer plan
```
/pricing → /api/employer/plan/subscribe (while isPlanSaleOpen(); otherwise the card is a support mailto)
         → the Stripe Payment Link + client_reference_id → Stripe subscription checkout
  ↓ checkout.session.completed (mode=subscription)
upsertPlan(status from the subscription, currentPeriodEnd), attached only by the account reference
  → resumePlanPosts → sendPlanActivatedEmail      (no reference: stored unattached, alerted, an admin attaches it)
  ↓ monthly: customer.subscription.updated (the live subscription is re-read: active → keep; past_due → grace)
  ↓ cancel / fail: customer.subscription.deleted → sendPlanPausedEmail; posts stay up through the paid period,
                   then pausePlanPosts
daily plan-lapse job pauses whatever is still live once entitlement has ended
```

---

## Appendix: glossary

| Term | Meaning in this codebase |
|---|---|
| **Active posting** | `Job.isPublished=true AND (expiresAt IS NULL OR expiresAt > now)` AND linked via EmployerJob to a userId |
| **Posting mode** | What the employer's NEXT post will be: `'promo' \| 'plan' \| 'intro' \| 'paid'` (lib/pricing.ts) |
| **quotaDomain** | Immutable per-row snapshot of the signup email's domain at posting time. Anchor for the intro allowance and the promo cap. |
| **Intro allowance** | The domain has zero `paymentStatus='paid'` rows that were bought as a post (a `'new'` JobCharge, or none at all for a pre-ledger row) → next paid post is `'intro'` at $199. |
| **Entitled plan** | `status IN ('active','past_due') AND currentPeriodEnd + planGraceDays > now`, or `status = 'cancelled' AND currentPeriodEnd > now` (no grace). `'pending'` is never entitled. |
| **hasFullAccess** | Per-candidate gate: `isAdmin OR existingView OR hasActiveFeaturedPost(employerId)`. Lifetime once granted. |
| **hasActivePosting** | Employer-level gate: at least one currently-active posting exists. State, not plan. |
| **`paymentStatus`** | `'promo'` / `'pending'` / `'paid'` / `'plan'` / `'refunded'` / `'disputed'` / `'expired'` / legacy `'free'`, `'free_renewed'`, `'free_upgraded'`. Drives invoice eligibility, renewal eligibility, the intro allowance and the promo cap. |
| **`pricingTier`** | `'intro' \| 'pro' \| 'plan'` — the ladder rung a row was sold at. Promo and legacy rows carry `'pro'`. |
| **JobCharge** | One row per per-post Stripe checkout (new or renewal). Source of truth for invoices. Plan receipts come from Stripe. |
| **ProcessedStripeEvent** | Idempotency log with a two-phase claim (§4c). Insert-then-process; UNIQUE violation = already-handled, unless the earlier delivery died mid-flight and its claim has gone stale. |
