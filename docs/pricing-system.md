# NP Hiring Pricing System — Architecture & Operations

**Last verified:** 2026-10-27 (the 2027 re-price, Phase 4: the retired Employer plan's dormant code deleted, with its config values, its `'plan'` tier, its Payment Link variable, its routes, jobs, emails and admin page; a subscription-mode Checkout Session is alerted for a refund, and the webhook needs 7 events: §1b to §1d, §2b, §2d to §2g, §3a to §3c, §4a to §4e, §5, §6, §8, §9a to §9d, §10 to §12 and the glossary); 2026-10-25 (the 2027 re-price, the fix pass of the pack's code and security reviews: the pack recorded in the state its payment is in, refund and dispute events for a pack not yet recorded retried, the pack checkout's account and session rules, the post-free screening questions inside the transaction, the new-post ledger write's retry, and the migration's lock timeout: §1b, §1c, §2a, §2c, §2h, §3a, §3b, §4f, §8, §9a to §9c, §10b, §12); 2026-10-25 (the 2027 re-price, Phase 3: the 5-post pack's pages, copy, emails, GA events and back office, and all sales final (owner decision 2026-10-25): §1b to §1d, §2h, §3a to §3c, §9c, §9d, §10 to §12); 2026-10-25 (the 2027 re-price, Phase 2 backend: the 5-post pack, built and kept dark, and the plan taken out of posting: §1b to §1d, §2a to §2d, §2g, the new §2h, §3a, §3b, §4a, §4f, §5 to §12 and the glossary); 2026-10-24 (the 2027 re-price, Phase 1: $249 first post and $349 after, a renewal priced by the post it renews, and the Employer plan retired from every surface: §1, §2d, §2g, §3, §5, §8 to §12); 2026-10-02 (the plan checkout and its account linking in §2e, the activation order in §2c, the schema blocks in §4, the open loopholes in §8, the checklist and monitors in §9 and the test map in §10, re-checked against the code; `tests/regressions/docs-pricing-system-matches-code.test.ts` now holds them to it); 2026-10-01 (the copy switch at the promo end: §1d, §2g and §3); 2026-09-27 (plan post lifecycle, renewal effects and the promo end instant)
**Source of truth:** [lib/config.ts](../lib/config.ts) + [lib/pricing.ts](../lib/pricing.ts) + [lib/renewal-price.ts](../lib/renewal-price.ts) + [lib/post-packs.ts](../lib/post-packs.ts) + [prisma/schema.prisma](../prisma/schema.prisma); the words every surface prints come from [lib/pricing-copy.ts](../lib/pricing-copy.ts) and the per-page builders in §3a
**Companion doc:** [pricing-audit.md](./archive/pricing-audit.md) (the April 2026 audit and its change log; archived and no longer maintained. Open items live in [PENDING_WORK.md](./PENDING_WORK.md))

This document describes the live state of the pricing system after the 2026-09-12 re-price (launch promo → 2027 ladder) and the 2026-10-24 re-price ($249 intro post, $349 every later post, a renewal of $199 or $249, and the Employer plan retired by the owner). Phase 2 (2026-10-25) built the backend of the one-time 5-post pack ($1,245 for 5 posts, §2h); Phase 3 (the same day) gave it its pages, copy, emails and back office, and made every sale final. Phase 4 (2026-10-27) deleted the retired Employer plan's dormant code (§2e). The sale is still closed until `config.promoEndsAt`: until then the pages state the pack dated from January 1, 2027 and offer no way to buy it. It's the ground-truth reference; the audit doc is the changelog of how we got here. The 2026-04-30 / 05-01 audit work (idempotency, JobCharge ledger, quotaDomain anchor) is unchanged and still described below.

---

## 1. Pricing model

**Launch promo through December 31, 2026, then a two-rung ladder. Every post gets the SAME features — there is no stripped "basic" tier.**

### 1a. Launch promo (through `config.promoEndsLabel` = December 31, 2026)

| Item | Value | Source |
|---|---|---|
| Promo end instant (exclusive) | `2027-01-01T10:00:00.000Z` (midnight Pacific/Honolulu, the last of the 50 states to leave December 31; 5 am ET). Copy prints "through December 31, 2026" with no zone, so the boundary is the LAST US midnight: 11:59 pm on December 31 is free in every US zone. It was 05:00Z (midnight ET) until 2026-09-27, which charged a Pacific employer posting at 9 pm on December 31 | `config.promoEndsAt` / `config.isPromoActive(now?)` |
| Price of every post | $0, no card | `config.isPromoActive()` → `quoteForMode('promo')` |
| Listing duration | 60 days | `config.durationDays` |
| Abuse guard (never marketed) | max 10 concurrently live promo posts per signup domain | `config.promoMaxActivePostsPerDomain` |
| Renewable? | Yes, at the base renewal price ($199), once `ENABLE_PAID_POSTING` is on (the renewal checkout 503s until then) | renewal rules in §2d |
| Consumes the intro allowance? | **No**, even after a $199 renewal | `countPaidPostsForDomain` counts `paymentStatus='paid'` rows bought as a post (`'new'` JobCharge or pre-ledger); a renewed promo post carries only a `'renewal'` charge and is excluded |

Promo rows are written with `paymentStatus='promo'`, `pricingTier='pro'`.

### 1b. Ladder (from `config.ladderStartsLabel` = January 1, 2027)

| SKU | Price | Terms | `pricingTier` | `paymentStatus` |
|---|---|---|---|---|
| Intro post | $249 (`config.introPrice` / `stripeIntroPriceInCents` 24900) | 60 days; the FIRST **PAID** post per company domain | `'intro'` | `'paid'` |
| Featured post | $349 (`config.postingPrice` / `stripePriceInCents` 34900) | 60 days; every later paid post | `'pro'` | `'paid'` |
| 5-post pack | $1,245 (`config.packPrice` / `stripePackPriceInCents` 124500) for `config.packPosts` = 5 posts, $249 a post | One time. Each credit publishes one 60-day post with the full package; the credits are usable for `config.packValidityMonths` = 12 months from purchase and belong to the buying account only. Sold only after the promo, while paid posting is on and the webhook is configured, and never to a free-email signup. A paid Stripe pack uses up the domain's intro price. All sales are final (/terms §8, §2h). Bought on /employer/post-pack, which /pricing and the dashboard usage card link once the sale opens | `'pack'` (the post) | `'pack'` (the post) |
| Renewal | $199 (`config.renewalPrice` / `stripeRenewalPriceInCents` 19900) for a promo, intro, pack or legacy post; $249 (`config.proRenewalPrice` / `stripeProRenewalPriceInCents` 24900) for a post bought at $349 (`pricingTier='pro'` with a `'new'` JobCharge). lib/renewal-price.ts decides which; `config.renewalPriceCentsFor(rung)` / `renewalPriceDollarsFor(rung)` map it | +60 days on a promo / pack / intro / featured post (never a plan post), capped at `config.renewalCapDays` = 365 days after the post was created; does NOT reset unlocks or InMails | unchanged (a pack post keeps `'pack'`) | `'paid'` |

**Employer plan: retired 2026-10-24 (owner decision); its code deleted 2026-10-27 (phase 4).** It was $399 / month for 5 active job slots and never went on sale. No page, email, FAQ, FAQPage JSON-LD, comparison page, calculator or checkout rail offers it. Production had no plan row, no plan post and no charge of any kind (checked read-only on 2026-10-26). Its config values (`planPrice`, `planSlots`, `planGraceDays`), the `'plan'` tier, its Payment Link variable and every plan route, handler, job, email and admin page are gone (§2e); the EmployerPlan model and its table stay, deprecated (§4b).

Every SKU includes exactly the same package: Featured badge, pinned above aggregated jobs, applications straight to the employer (Easy Apply or the employer's own application link), screening questions, analytics, `config.limits.candidateUnlocksPerPosting` = 25 unlocks and `config.limits.inmailsPerPosting` = 25 InMails. `config.isFeatured` is always `true`; `config.getTierLimits()` returns the same limits for every tier. The 25 / 25 are per posting for its whole life: unlocks are counted by `ProfileView.employerJobId`, InMails by conversations on the job since `EmployerJob.createdAt` (lib/tier-limits.ts), and a renewal changes neither, so no surface may say a renewal "refreshes" them.

**Which renewal price a post pays.** `pricingTier` and `paymentStatus` cannot decide it: promo rows are written `('promo','pro')`, and the renewal webhook rewrites a renewed promo post to `('paid','pro')`, exactly what a post bought at $349 reads as. The ledger tells them apart: only a post bought through Checkout has a JobCharge of type `'new'` (`NEW_POST_CHARGE_SELECT` in lib/pricing.ts loads it). So `renewalRungFor` answers `'pro'` ($249) only for `pricingTier='pro'` with a `'new'` charge, and `'base'` ($199) for every other renewable row: promo posts (renewed or not), pack posts (`pricingTier='pack'`, renewed or not: a renewal keeps the tier, `asRenewalTier` in lib/pricing.ts), intro posts, legacy paid rows with no charge and the legacy `free_renewed` / `free_upgraded` rows. The `'new'` charge write is no longer best effort: a failure other than a duplicate is rethrown once the activation's later steps have run (the intro race detector, the confirmation email, the draft cleanup, the GA purchase and the search ping, which the retry would never run), the webhook answers 500, and Stripe's retry, which finds the post already claimed, backfills the charge (`resolveLostClaim` in activate-paid-job.ts). A backfill that fails throws too (`ensureJobChargeRecorded`), so Stripe keeps retrying instead of acknowledging a payment with no ledger row. A row loaded without its charges is never guessed at: `renewalRungForRow` throws, and the renewal checkout answers a logged 500 before any Stripe call.

**A legacy plan post** (`paymentStatus='plan'`; none in production). A plan post ran `config.durationDays` like every post and was never renewed. Nothing can create one any more, and one that existed would be refused a renewal (`/api/create-renewal-checkout` answers 409) and a republish (toggle-publish answers 402), could still be paused or archived, would be offered a repost by the expiry emails like a legacy free post (§2g), and would still lock its domain against an email change.

### 1c. Helpers (the ONLY mapping code should use)

| Helper | Returns |
|---|---|
| `config.isPromoActive(now?)` | `now < promoEndsAt` |
| `config.priceCentsForTier(tier)` | 24900 / 34900 for `'intro'` / `'pro'`; 0 for `'pack'` (the post was paid for with its pack); 34900 for anything else, a legacy `'plan'` value included, so an unknown value never under-charges |
| `config.priceDollarsForTier(tier)` | 249 / 349 / 0, and 349 for anything else |
| `config.formatDollars(amount)` | A dollar amount as copy prints it: `$1,245` (thousands grouped, cents only when there are any); `config.formatPrice` prints `$1245` |
| `config.renewalPriceCentsFor(rung)` | 19900 for `'base'`, 24900 for `'pro'` (the only mapping from a renewal rung to a Stripe amount) |
| `config.renewalPriceDollarsFor(rung)` | 199 / 249 |
| `renewalRungFor({ pricingTier, hasNewPostCharge })`, `renewalRungForRow(row)` ([lib/renewal-price.ts](../lib/renewal-price.ts), client-safe) | `'pro'` only for `pricingTier='pro'` with a `'new'` JobCharge, else `'base'`; `renewalRungForRow` reads a row loaded with `NEW_POST_CHARGE_SELECT` ([lib/pricing.ts](../lib/pricing.ts)); `asRenewalRung(value)` narrows `metadata.renewalRung` (anything but `'pro'` is `'base'`) |
| `config.getTierLabel(tier)` | `'Intro'` / `'Pro'` / `'Pack'` (legacy/unknown, a legacy `'plan'` included → `'Pro'`) |
| `getNextPaidTier(quotaDomain)` ([lib/pricing.ts](../lib/pricing.ts)) | `'intro'` while the domain has zero `paid` rows bought as a post and no paid Stripe pack (`paidPackWhere` in lib/post-packs.ts), else `'pro'` |
| `resolvePostingMode({ quotaDomain, hasPackCredit, now?, db? })` | `PricingQuote { mode, tier, price, priceCents, willBeFree, durationDays }`, order: promo → pack → intro → paid. The caller reads `hasPackCredit` from `getPackCreditStatus`; the promo wins over a credit, which stays unspent. The plan mode went in phase 2 |
| `asRenewalTier(value)` ([lib/pricing.ts](../lib/pricing.ts)) | The tier a renewal carries and writes back: `'intro'` and `'pack'` stay, anything else is `'pro'` (`asPaidTier`, for a new post, still narrows to `'intro'` / `'pro'`) |
| `getPackCreditStatus(userId, now?, db?)` ([lib/post-packs.ts](../lib/post-packs.ts), server only) | `{ usable, remaining, used, total, expiresAt }` over the account's current packs (`currentPackWhere`: `'paid'` and unexpired, a used-up pack included, so a page can say "5 of 5 posts used"): `remaining` summed, `total` = sold less revoked, `used` = total less remaining, `usable` while a credit is left, `expiresAt` of the pack spent from next (the one that expires first), or with every pack used up, of the last to expire |
| `packUseByLabel(expiresAt)`, `packDateLabel(date)` ([lib/pricing-copy.ts](../lib/pricing-copy.ts), client-safe) | The pack's dates as every pack surface prints them, in Pacific/Honolulu: the "Use by" date is the day before the expiry's date there, the last day the credits last for the whole day in every US zone, so it never names a day they miss. `packUseByValue(expiresAt)` is that date as `YYYY-MM-DD`, and `packExpiresAtForUseBy(useBy)` its inverse (the end of that day in Hawaii), which /admin/post-packs sets a new date with |
| `toPostPackView(row, now)`, `packCreditsLine(view)`, `packStatusLine(view)`, `packInvoiceHref(view)` ([lib/post-pack-view.ts](../lib/post-pack-view.ts), client-safe) | One pack as the employer's pages show it: its state (`active` / `used` / `expired` / `refunded` / `disputed`), "3 of 5 posts left" or "5 of 5 posts used" ("No posts used" when every credit was revoked unspent), "Use by <date>" / "Expired <date>" / "Refunded" / "Disputed", and Stripe's hosted invoice link (https only) |
| `planPackChange(pack, change, now)` ([lib/post-pack-admin.ts](../lib/post-pack-admin.ts), client-safe) | The write an admin change makes to one paid pack (revoke unused posts, a later use-by date, restore one spent post), as a compare-and-set on what it read, or the reason it is refused (§2h) |
| `packExpiresAt(purchasedAt)` ([lib/post-packs.ts](../lib/post-packs.ts)) | `config.packValidityMonths` calendar months later in UTC, same time of day, clamped to the month's last day; a pack's `purchasedAt` is its Checkout Session's creation, whichever path records it and however late |
| `packSaleClosedReason(now?)`, `isPackSaleOpen(now?)` ([lib/post-pack-sale.ts](../lib/post-pack-sale.ts)) | The one copy of the pack sale's gate: `'PAID_POSTING_DISABLED'` (the flag off), `'STRIPE_NOT_CONFIGURED'` (the key or `STRIPE_WEBHOOK_SECRET` missing), `'PROMO_ACTIVE'`, checked in that order, else null; `isPackSaleOpen` is true while it is null, and /api/create-pack-checkout answers with the reason. An environment that will not parse reads as closed (`'STRIPE_NOT_CONFIGURED'`) and is logged |

**Removed 2026-09-12:** `config.freePostsPerEmail`, `config.freeDurationDays`. There is no "free first post" and no shorter free duration any more; every reference was replaced by the promo / ladder copy. `config.legacyInvoiceFallbackCents` (19900) stays frozen for pre-ledger invoices only and is deliberately decoupled from the live ladder.

**Canonical marketing copy** (built only from config tokens; tests pin the wording on the surfaces that print them; /terms states the same terms in its own legal wording). The first three are the promo phase's sentences, from [lib/pricing-copy.ts](../lib/pricing-copy.ts): `PROMO_HEADLINE`, `PROMO_SUB`, and `ladderLine(now)` while the promo runs. From `config.promoEndsAt` the phase-aware surfaces print the ladder-phase sentences listed after these instead (§1d). The renewal sentences hold in both phases: `RENEWAL_LINE` (both renewal prices) is in [lib/pricing-copy.ts](../lib/pricing-copy.ts), shared by /pricing, /for-employers, /faq and the cost-per-hire calculator, and [app/pricing/pricing-page-copy.ts](../app/pricing/pricing-page-copy.ts) exports `RENEWAL_EFFECT_LINE` and `RENEWAL_CAP_LINE`:

- `Free through ${config.promoEndsLabel}`
- `Every job post is free during our launch period: ${durationDays}-day listing, Featured badge, top placement, ${unlocks} candidate unlocks and ${inmails} InMails. No credit card required.`
- `From ${config.ladderStartsLabel}: your first post is $${introPrice}, every post after that is $${postingPrice}, or buy ${packPosts} posts for ${formatDollars(packPrice)}.`
- `Renewals add ${durationDays} days: $${renewalPrice} for a promo, intro or pack post, $${proRenewalPrice} for a $${postingPrice} post.` (`RENEWAL_LINE`: the dearer price is named by the post price it renews, because every post is Featured and "featured post" no longer tells the two apart. A surface about one post, the dashboard and edit page modals, the expiry emails, the renewal confirmation and the Stripe line item, prints that post's own price instead)
- `A renewal adds ${durationDays} days to the post: to its current end date while it is still live, or from the day you renew once it has ended. It does not add unlocks or InMails: a post has ${unlocks} unlocks and ${inmails} InMails in total, however many times it is renewed.`
- `Renewals can extend a post to at most ${renewalCapDays} days after it was first posted.`
- `${durationDays}-Day Listing` cards (`listingRun` in the two page builders): /pricing prints `Every post runs ${durationDays} days with no daily budget and no bidding` (`, promo posts included.` while the promo runs); /for-employers prints `Every job runs ${durationDays} days with no daily budget and no bidding.` (and `Promo posts get the same run and the same features.` while the promo runs)

**Ladder-phase copy** (from `config.promoEndsAt`, all in [lib/pricing-copy.ts](../lib/pricing-copy.ts); none of it offers free posting or names a start date):

- `LADDER_HEADLINE`: `Simple per-post pricing` (the /pricing H1, the /for-employers hero and the email headline)
- `LADDER_PRICES`, which `ladderLine(now)` returns from the switch: `Your first post is $${introPrice}, every post after that is $${postingPrice}, or buy ${packPosts} posts for ${formatDollars(packPrice)}.`
- `FULL_PACKAGE`, where `PROMO_SUB` stood: `Every post gets the full package: ${durationDays}-day listing, Featured badge, top placement, ${unlocks} candidate unlocks and ${inmails} InMails.`
- `LADDER_FROM_LINE`, for CTA cards and descriptions: `Posts start at $${introPrice}, with all features included.`
- The /pricing ladder section's eyebrow and heading: `Per post` over `What a post costs` (they read "Per post or by the month" over "Three ways to post" while the plan was on sale; register D17)

**5-post pack copy** (Phase 3, owner decisions 2026-10-24 and 2026-10-25; in [lib/pricing-copy.ts](../lib/pricing-copy.ts) unless named; no line names a saving: "save $500" is never printed, and `PACK_COMPARISON` is the one comparison the owner allowed):

- `packPriceLine(now)`: `From ${config.ladderStartsLabel}, a ${packPosts}-post pack is ${formatDollars(packPrice)}.` while the promo runs, `A ${packPosts}-post pack is ${formatDollars(packPrice)}.` after (the /pricing pack card while the promo runs, and /employer/post-pack in place of its Buy button)
- `PACK_OFFER`: `${packPosts} posts for ${formatDollars(packPrice)}, ${formatDollars(packPrice / packPosts)} a post`
- `PACK_COMPARISON`: `Bought one at a time at $${postingPrice}, five posts cost ${formatDollars(postingPrice * packPosts)}.`
- `PACK_FAQ_QUESTION` and `packFaqAnswer(now)`, on /pricing, /faq and /for-employers and in their FAQPage JSON-LD: `How does the ${packPosts}-post pack work?`, answered with `packPriceLine(now)`, the $249 a post within 12 months, `PACK_COMPARISON`, the full package and the $199 renewal, the buying account, and the intro price a pack uses up
- `REFUND_ANSWER`, the refund answer on /pricing, /faq and /for-employers (all sales final, owner decision 2026-10-25): `All sales are final. Job posts, renewals and ${packPosts}-post packs are not refundable, and neither are pack posts left unused when the pack expires or a posting we remove for breaking our Terms. We refund only where the law requires it, and we correct a billing error, such as a charge made twice for the same post. Promo posts involve no payment.` /terms §8 says the same in its legal wording, and the checkout trust rail's Refunds panel in short
- The no-charge caption of a pack post on the preview and checkout pages (register D19): `Included in your post pack.`; the post's confirmation email: `Posted with your ${packPosts}-post pack. N posts left, to use by <date>.` (`Posted with the last post in your ${packPosts}-post pack.` for the last one); /success: `Your job is live. Posted with your ${packPosts}-post pack.`

Retired 2026-10-24 with the Employer plan (owner decision): the plan sentences `PLAN_TERMS`, `PLAN_POSTS_LINE`, `PLAN_CANCEL_LINE` and `planPriceLine(now)`, the /pricing plan card and its subscribe CTA, the plan FAQ on /pricing, /faq and /for-employers (and in their FAQPage JSON-LD), the plan clause of the ladder sentence, the listing cards and the comparison table, the plan sections of /terms §6 to §8, the plan line of the checkout trust rail and the /post-job metadata, the dashboard usage strip's subscribe pitch, and the calculator's plan mode. The single renewal sentence `Renew a promo, intro or featured post for $${renewalPrice} (+${durationDays} days).` went at the same time: a renewal has two prices now.

Retired 2026-09-27 because the code never did them: "live while you're subscribed", "plan posts stay live while your plan is active, so they don't need renewing", the listing cards' "plan posts stay up while your plan is active" and "Every post runs its full 60 days" (a plan post comes down early when its plan lapses), "Renew any post", and "renewing ... refreshes its 25 unlocks and 25 InMails". The renewal "boosts the listing back to the top of search results" claim was also dropped: the renewal webhook sets `Job.isFeatured=true`, which sorts the post above un-renewed employer posts on the default `best` order only, once, and not on `newest` / `salary` or semantic search, so "back to the top" overstated it.

Never claim audience numbers (subscribers, visitors, applicants) on any surface.

**Not in scope today** (deferred, see §11): boost SKU, tax, PO/invoice, per-org verification. The one-time 5-post pack that replaces the plan (owner decisions D36 to D42 in [PENDING_WORK.md](./PENDING_WORK.md)) is built (§2h): its pages print the copy above, dated from January 1, 2027 while the promo runs, and the sale opens with the ladder.

### 1d. What happens at 2027-01-01T10:00:00Z (`config.promoEndsAt`)

There is no flag to flip and no deploy. Every phase-dependent decision calls `config.isPromoActive(now)` when the page renders, the email is sent or the request is handled, never at module load: a module-scope string is evaluated once per server instance (and once at build for a static page), so it would keep offering free posting after the promo.

**Switches on its own:**

- **Posting.** `POST /api/jobs/post-free` stops writing `'promo'` rows: an employer with a usable 5-post pack credit posts as `'pack'` (§2h), and everyone else gets `403 requiresPayment`, which sends the wizard to checkout. (The plan mode is gone from posting since 2026-10-25, and the plan code since 2026-10-27, so nothing posts as `'plan'`.) `/api/create-checkout` stops answering `409 PROMO_ACTIVE`, and answers `409 PACK_CREDIT_AVAILABLE` for a new post while a pack credit is left. `GET /api/employer/free-quota-status` quotes `pack`, `intro` or `paid`. The pack sale opens (`isPackSaleOpen(now)`, lib/post-pack-sale.ts), once paid posting is available and `STRIPE_WEBHOOK_SECRET` is set: /employer/post-pack offers its Buy button (to an employer account with a company email), the /pricing pack card drops its date and links there (the support email while the sale is closed), and the dashboard usage card offers `Buy ${packPosts} posts · ${formatDollars(packPrice)}`. No plan sale opens: the plan's code, its routes and its Payment Link variable are deleted, and a Checkout Session in subscription mode that still reaches the webhook is alerted for a refund (§2e).
- **Copy, on every phase-aware surface** (§3c says how each decides). ISR pages decide on each render and regenerate at most once per window (`revalidate = 3600`; 60 seconds on the homepage). The window is not a hard bound, because regeneration is stale-while-revalidate: a render cached before the switch is served until its window runs out, the first request after that is still answered with that render and only triggers the regeneration, and every later request gets the ladder. A page that is rarely requested therefore shows its promo render to one more visitor or crawler, however long after the switch. Nothing purges these pages at the instant (no `revalidatePath` call; §11). Metadata follows the page: /pricing, /for-employers, the comparison pages and the /post-job layout build theirs in `generateMetadata`. Client pages decide on each render in the browser, and those that show a fetched quote drop a `'promo'` quote fetched before the switch (`currentQuote`, lib/next-post-quote.ts). Emails decide at send time, the admin outreach page per request. The ladder-phase sentences (§1c) replace the promo ones.
- **The comparison table** (`employerComparisonRows(now)`, /pricing and /for-employers): the "Free Posting Through ..." row drops, and the flat-pricing row states the prices without a date. The comparison pages (lib/compare-data.ts) state our ladder as the current price; competitor prices stay dated to their review.
- **The cost-per-hire calculator:** `flatFeeModeOptions('ladder')` offers per post and the 5-post pack (no promo mode and no start date; the plan mode was retired with the plan; while the promo runs the pack mode is offered as `5-post pack, from January 1, 2027`), `defaultInputs('ladder')` opens on per post, a calculator that was already open with the promo selected falls back to per post (`offeredFlatFeeMode`), and the method notes, the FAQ (with its FAQPage JSON-LD) and the post-a-role card state the ladder.
- **The outreach `freeOffer` template:** /admin/outreach stops listing it (`availableOutreachTemplates(now)`), `renderTemplate` refuses it (`OutreachTemplateUnavailableError`), and `POST /api/outreach` answers `409 { success: false, error }` with that reason, which the admin page shows. `initial` and `followUp` state the ladder price.
- **Expiry emails** stop offering a free repost (§2g), and a renewal savings claim becomes possible where a renewal can be bought (lib/renewal-offer.ts).
- **Sitemap lastmod:** every page in `PROMO_SWITCH_PATHS` (app/api/sitemaps/lastmod.ts: /pricing, /for-employers, /faq, the employer resources hub, hiring guide, job description guide, template library and template pages, /tools/salary-benchmark, /tools/cost-per-hire-calculator and the three comparison pages) is dated no earlier than the switch once it has passed, and so is the homepage (`withPromoSwitch`: its employer band's CTA switched). The sitemap index dates its primary child from the same dates. Before the instant no date moves. The date moves at the instant itself, so a crawl it prompts can reach a page that has not regenerated yet and receive the promo render (the copy bullet above).

**Does not happen on its own** (owner steps: docs/LAUNCH_RUNBOOK.md §8, checklist in §9b):

- **Stripe live mode:** the live account and the live webhook. There is no plan Product, Price, Payment Link or Customer Portal to set up: the plan is retired.
- **`ENABLE_PAID_POSTING=true` with a live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.** Until the flag is `'true'`, `/api/create-checkout` and `/api/create-renewal-checkout` answer 503 `PAID_POSTING_DISABLED`. With the flag on but `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` missing, both routes answer 503 `STRIPE_NOT_CONFIGURED` and `/api/create-checkout/availability` reports `{ available: false, code: 'STRIPE_NOT_CONFIGURED' }`: the webhook answers 503 without either and could not record the payment. Set the key and the webhook secret before the flag, or in the same deploy: until both are set, no checkout opens. Until checkout is available, nobody can buy a post or a pack once the promo has ended; only a pack credit already on an account would still post, and since no pack is sold during the promo, that could only be one an admin granted.
- **The retired plan's Payment Link variable** is gone from the code (2026-10-27): nothing reads it, so it does not matter whether it is set. A plan Payment Link left active in Stripe should be deactivated there; a session from one is alerted, never fulfilled (§2e).
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
  │    ├─ EmployerJob.create (quotaDomain, paymentStatus='promo', pricingTier='pro', userId)
  │    ├─ JobScreeningQuestion.createMany (a platform-apply post's questions, up to 5): a failed write rolls
  │    │    the post back with it, so a resubmit never leaves a post or spends a pack credit twice
  │    └─ a serialization conflict (Prisma P2034) → 409 { error, retry: true }, nothing written
  │  (a 5-post pack credit is not read while the promo runs, and stays unspent)
  ├─ sendConfirmationEmail(..., config.durationDays, 'promo')  ← "free during our launch promo"
  ├─ Cleanup JobDrafts · pingSearchEnginesForJobPage (prod only; Google only when the page carries a JobPosting)
  └─ 200 { ..., mode: 'promo' } → frontend redirects to /success?mode=promo (?free=true still works)
```

### 2b. Plan post: removed from posting (2026-10-25)

Phase 2 of the re-price took the plan mode out of `POST /api/jobs/post-free`, `resolvePostingMode` and `GET /api/employer/free-quota-status`: no new `'plan'` row is written. Phase 4 (2026-10-27) deleted the rest of the plan code, so a `'plan'` row (production had none) is handled as a legacy row: toggle-publish answers 402 to a republish, the renewal checkout 409 (§2d), and the expiry emails offer a repost (§2g). The no-charge path a post can take after the promo is a 5-post pack credit (§2h).

If neither the promo nor a pack credit applies, post-free answers `403 { error, requiresPayment: true, mode: 'intro'|'paid', tier, price, priceCents }` and the wizard redirects to checkout exactly as before.

### 2c. Intro / Featured checkout (from `config.ladderStartsLabel`)

```
GET /api/employer/free-quota-status  (path unchanged — the wizard already calls it)
  └─ { eligible, reason?, mode, tier, willBeFree, price, priceCents, durationDays, paidDurationDays,
       promoActive, promoEndsAt, promoEndsLabel, ladderStartsLabel, pack?: {remaining, total, expiresAt},
       remaining, limit }
     pack is there while the account holds a usable credit (read in every phase); in mode 'pack',
     remaining / limit are the credits left / held. Gate in the wizard is unchanged:
     nextPostRequiresPayment = eligible && !willBeFree.

Frontend → /post-job/checkout → POST /api/create-checkout
  ├─ Lazy Stripe client (503 if STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET missing / ENABLE_PAID_POSTING=false)
  ├─ config.isPromoActive() → 409 PROMO_ACTIVE, before the body is read, so the resume path
  │    is covered too: nothing is sold per post while every post is free
  ├─ a new post while the account holds a usable 5-post pack credit → 409 PACK_CREDIT_AVAILABLE
  │    (the post goes through post-free with the credit; the resume path stays open)
  ├─ tier = getNextPaidTier(quotaDomain)          ← 'intro' until the domain has ONE 'paid' row
  │                                                 bought as a post, or one paid Stripe pack
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
  │    ├─ JobCharge.create (amountCents = session.amount_total ?? config.priceCentsForTier(paidTier), type='new');
  │    │    a failure other than a duplicate is held until the steps below have run, then rethrown: 500, Stripe
  │    │    retries, and the retry (claim lost) backfills the charge; a failed backfill answers 500 again
  │    ├─ sendConfirmationEmail · Cleanup JobDrafts · trackServerPurchase · pingSearchEnginesForJobPage
  └─ 200

Stripe redirect → /success?session_id=cs_... → GET /api/verify-checkout-session (unchanged; 202 retry on webhook lag)
```

The intro allowance = zero rows with `quotaDomain = domain AND paymentStatus = 'paid'` that were bought **as a post** (`lib/pricing.ts#paidPostWhere`: a `'new'` JobCharge, or no charge at all for legacy paid rows), and no paid 5-post pack bought through Stripe at the domain (`lib/post-packs.ts#paidPackWhere`: `status='paid'`, `source='stripe'`; owner decision: the pack is the company's paid purchase, so the single posts after it are $349). Promo, pack, plan, legacy free and abandoned `pending` rows never consume it, nor do a refunded, disputed or admin-granted pack, nor a promo or pack post that was later renewed (the renewal webhook flips it to `'paid'`, but its only charge is `type='renewal'`; a renewal is not a post).

### 2d. Renewal ($199 or $249, +60 days)

```
Employer dashboard / jobs/edit/[token] → renewal modal
  ├─ paymentStatus 'promo' | 'pack' | 'paid' → the row's own price ($199, or $249 for a post bought at $349; a pack
  │                                      post pays $199: the dashboard page and the edit API send renewalPrice per row)
  │                                      → POST /api/create-renewal-checkout
  ├─ paymentStatus 'plan' (legacy)    → "Plan slot" badge, no Renew (409 server-side: plan posts were never
  │                                      renewed, and the plan is retired; the employer posts the role again)
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

The price, decided after every refusal above from the stored row (loaded with NEW_POST_CHARGE_SELECT):
  renewalRung = renewalRungForRow(employerJob)   ← 'pro' only for pricingTier='pro' with a 'new' JobCharge (§1b);
                                                   a row loaded without its charges throws: a logged 500, no Stripe call
  unit_amount = config.renewalPriceCentsFor(renewalRung)   ← 24900 ($249) for 'pro', 19900 ($199) for 'base'
  metadata.renewalRung = renewalRung; metadata.tier = asRenewalTier(pricingTier) ('intro', 'pack' or 'pro'), which
  the webhook writes back, so a pack post stays 'pack'; the idempotency key's parameter fingerprint includes the
  amount, so a post whose price changes inside a window gets a session of its own

Webhook (type='renewal', app/api/webhooks/stripe/apply-renewal.ts):
  expiresAt = min(MAX(existingExpiresAt, now) + config.durationDays, Job.createdAt + config.renewalCapDays)
  (lib/expires-at.ts#renewalExpiresAt), Job.isPublished=true, Job.isFeatured=true,
  EmployerJob.paymentStatus='paid' + expiryWarningSentAt=null,
  JobCharge(type='renewal', amountCents = what Stripe charged: session.amount_total, or for a session reported
  without one the price of metadata.renewalRung; a session from before rungs existed carries none and cost the
  base price), and sendRenewalConfirmationEmail prints that same amount. Nothing resets the post's unlock or
  InMail counts.
  Archived after the checkout opened: inside the transaction the extension is written first (that write takes the
  job row's lock), then archivedAt is read, and isPublished is set only for a post that is not archived. An archived
  post is ledgered, set 'paid' and extended as usual but stays unpublished and archived: no "live again" email
  (Stripe's receipt still goes out), no search engine ping, a logger.warn naming it, and leftArchived on the result.
  Last, the post's other open renewal sessions are expired, and another paid one is alerted for a refund.
```

A payment never republishes an archived post. Besides the renewal above, the new-post activation (§2c, `app/api/webhooks/stripe/activate-paid-job.ts`) puts the archived check in the WHERE of its publish (`job.update` where `{ id, archivedAt: null }`, Prisma P2025 when archived): a pending post archived while its checkout was open is claimed (`'paid'`) and ledgered as usual, keeps `isPublished` false (only `isVerifiedEmployer` is set), gets no "your listing is live" email and no ping, and is logged with `logger.warn`. The chargeback-won path in `route.ts` already skipped archived rows. Either way the employer restores the post and then republishes it.

While `ENABLE_PAID_POSTING` is not `'true'` (production today), `/api/create-renewal-checkout` answers 503 `PAID_POSTING_DISABLED` like every paid route, so no post, promo included, can be renewed until paid posting is switched on.

### 2e. Employer plan: retired, its code deleted

**Retired 2026-10-24 (owner decision); its code deleted 2026-10-27 (phase 4 of the 2027 re-price).** The plan was a $399 monthly Stripe Billing subscription for 5 active job slots, sold through a Payment Link and attached to the employer only by the account reference on the checkout. It never went on sale, and production had no `employer_plans` row and no `'plan'` post when the code went (checked read-only on 2026-10-26).

Deleted: the plan, subscribe and Customer Portal routes; the plan checkout and subscription handlers, with the dunning notice on `invoice.payment_failed`; the daily plan-lapse job and plan reconciliation sweep (§2f); the admin plan page, its API and its sidebar link; the four plan emails and their EmailTypes, the plan expiry copy and the plan confirmation mode; `config.planPrice`, `planSlots` and `planGraceDays`; the `'plan'` PricingTier; and the Payment Link variable in lib/env.ts, `.env.example` and the fork preflight. Kept: the EmployerPlan model and the `employer_plans` table with its RLS, deprecated and unused (§4b), and these guards for any old row or session:

```
Stripe → webhook checkout.session.completed or checkout.session.async_payment_succeeded with
         session.mode === 'subscription'  (a plan Payment Link left active in Stripe)
  ├─ checked FIRST, before the 5-post pack branch and the per-post paths, whatever the session's metadata says
  ├─ alertWebhookFailure('Employer plan retired: refund it in Stripe', { eventId, sessionId, subscriptionId,
  │    paymentStatus, amountCents }) whether or not the payment has settled: refund it, cancel the subscription
  ├─ nothing is granted or written, and nothing is read back from Stripe
  └─ 200 { received: true, plan: 'retired' }; the dedupe row is kept, so Stripe does not retry
checkout.session.async_payment_failed in subscription mode → the generic "nothing fulfilled" alert, 200
invoice.paid of a subscription that no post or pack carries (its first charge, or a renewal nobody cancelled)
  └─ the same alert with { eventId, invoiceId, subscriptionId, amountCents }, nothing written,
     200 { received: true, plan: 'retired' }: raised again at every charge until the subscription is cancelled
customer.subscription.created / .updated / .deleted and invoice.payment_failed → acknowledged and ignored
  (an endpoint can drop them, §9b)
A legacy 'plan' row → renewal 409 (§2d), and a renewal paid for one anyway is ledgered, not applied, with the
  refund alert (apply-renewal.ts) · republish 402 (§2g) · the repost offers in the expiry emails (§2g)
```

The guard is keyed on the session's mode, not on the plan: nothing else sells a subscription, so every subscription checkout and every paid subscription invoice on this Stripe account is treated as the retired plan's. A new subscription product would need its own branch ahead of it.

### 2f. Plan-lapse job and plan reconciliation: deleted

Retired 2026-10-24 with the plan, they ran every day and found nothing to do (production had no plan row). Both daily Inngest functions were unregistered from app/api/inngest/route.ts and deleted on 2026-10-27, which also ended the reconciliation sweep's daily listing of Stripe subscriptions. Inngest drops them from its function list at the next sync of https://nphiring.com/api/inngest ([LAUNCH_RUNBOOK.md §6](./LAUNCH_RUNBOOK.md) step 4); until then it may still call them on their old schedules and record the runs as failed, which does no harm.

### 2g. Expiry (no money flow, but visible UX)

```
Cron /api/cron/expiry-warnings → sendExpiryWarningEmail (from 5 days before expiresAt)
  └─ The offer is decided per row, at send time, by lib/email-service.ts#expiryWarningCopy and
     lib/renewal-offer.ts#resolveRenewalOffer (client-safe, so the dashboard and the edit page
     share the rule; lib/pricing.ts re-exports it, and the cron reads the employer's own
     next-post price from lib/pricing.ts#nextNewPostPrice):
       renew        : a promo, pack or paid row AND getPaidPostingStatus().available. The
                      email names the row's own renewal price ($199, or $249 for a post bought
                      at $349: the cron loads each row with NEW_POST_CHARGE_SELECT). An offer
                      that can be bought must carry that price (renewalPrice is required by
                      the types, and resolveRenewalOffer throws without it), so no row is
                      ever quoted a guessed one. A saving is named only after the promo,
                      measured from that price against the employer's own next new-post
                      price ($249 intro, $349, or $0 with a usable 5-post pack credit), or
                      "vs. the $349 post price" when that is unknown, and never when renewal
                      is not cheaper (a $249 renewal saves nothing against a $249 intro post).
       promo_repost : no renewal on sale during the promo, so the email says every post is
                      free through config.promoEndsLabel.
       paid_repost  : no renewal on sale for this row after the promo (the legacy free and
                      plan rows) while paid posting is available, so the email offers a fresh
                      post at today's ladder price (ladderLine(now)).
       none         : nothing on sale after the promo (paid posting off), so there is no offer.
  └─ The "your listing has expired" email the same cron sends (postExpiryOffer) makes the
     same choice: a renewal when one can be bought, a free repost while the promo runs, a
     paid repost at ladderLine(now) while paid posting is available, otherwise no offer.
     (The plan offer, "post again into the freed slot", went with the plan code on 2026-10-27.)

Employer republish (toggle-publish): 'paid', 'free', 'promo' and 'pack' come back directly;
every other status gets 402, a legacy 'plan' row included (no plan can entitle it since
the plan code was deleted). Archive and edit-token soft delete set isManuallyUnpublished,
as a pause does, so fp-recovery never revives them.

Posting reaches expiresAt: excluded from getEmployerActivePostings; no NEW unlocks / InMails;
previously-unlocked candidates stay accessible (hasFullAccess via existingView); replies stay free.
```

### 2h. 5-post pack (built 2026-10-25; sold from the ladder's start)

$1,245 once (`config.packPrice`, `stripePackPriceInCents` 124500) for `config.packPosts` = 5 credits, $249 a post. A credit publishes one ordinary post with the full package for `config.durationDays`; the credits are usable for `config.packValidityMonths` = 12 months from purchase (`packExpiresAt` of the Checkout Session's creation) and only by the buying account. All sales are final (owner decision 2026-10-25, /terms §8): a refund the owner issues by hand in Stripe, or a chargeback, is still honoured (below). No email reminds the buyer before the credits expire (owner decision). The sale is closed until `config.promoEndsAt`; until then every page states the pack dated from January 1, 2027 and none offers a way to buy it.

```
Page: /employer/post-pack (app/employer/post-pack/page.tsx; requireEmployer, noindex, rendered per request)
  ├─ the offer from config and lib/pricing-copy.ts; the account's packs (posts left or used, the use-by
  │    date or the state, bought, amount, Stripe's hosted invoice); "All sales are final (Terms §8)"
  ├─ while the promo runs: packPriceLine(now), dated, and no way to buy · sale open: the Buy button
  │    (BuyPackButton: GA begin_checkout value 1245, type 'pack', then POST /api/create-pack-checkout) for
  │    an employer account with a company email, else the reason · sale closed: the support email
  └─ ?session_id=cs_… (Checkout's return; anything else is ignored) → PackCheckoutReturn, which asks
       /api/verify-pack-session, retries a paid answer with no pack yet, and refreshes the page once ready
  The same packs are listed by GET /api/employer/post-packs (the dashboard usage card and Settings, Billing).

Buy: POST /api/create-pack-checkout (app/api/create-pack-checkout/route.ts)
  ├─ 503 PAID_POSTING_DISABLED · 503 STRIPE_NOT_CONFIGURED (the key or STRIPE_WEBHOOK_SECRET missing) ·
  │    409 PROMO_ACTIVE: packSaleClosedReason (lib/post-pack-sale.ts, the gate's one copy), before anything
  │    else is read
  ├─ 401 signed out · 403 an email Supabase has not confirmed · 403 not an employer account · 400 a
  │    free-email signup (post-free refuses its posts)
  ├─ the request body is never read: the price, the posts and the buyer are the server's
  ├─ the account's open pack sessions from earlier windows are expired first (each window's sessions carry
  │    its own expires_at; this window's is the one a double click replays, so it stays open). One that
  │    cannot be closed (it may have just taken money) → 503 PREVIOUS_PACK_CHECKOUT_OPEN, a listing that
  │    fails → 503 PACK_CHECK_UNAVAILABLE, both with Retry-After 60 and nothing minted. Two browsers of one
  │    account inside one window still get a session each
  ├─ Stripe Checkout Session, mode 'payment': unit_amount config.stripePackPriceInCents, customer_email and
  │    client_reference_id = the account, invoice_creation, metadata { type: 'post_pack', sku: 'post-pack-5',
  │    userId, quotaDomain, posts }, payment_intent_data.metadata { type: 'post_pack', userId } (how a refund
  │    or dispute is known for a pack's before its pack is recorded), the GA ids of a consenting visitor;
  │    expires_at inside the hour from the renewal checkout's window helpers, so a double click in one
  │    ten-minute window replays one session (idempotency key post-pack-v1-<account>-<window>-<digest>)
  └─ 200 { sessionId, url }; success_url /employer/post-pack?session_id=…

Record: app/api/webhooks/stripe/post-pack-checkout.ts#fulfilPostPackCheckout, run by three callers:
  the webhook (checkout.session.completed or async_payment_succeeded with metadata.type 'post_pack', routed
  before the "Missing job ID" 400), GET /api/verify-pack-session (self-heal) and the daily payment
  reconciliation sweep (lib/inngest/functions/payment-reconciliation.ts, arm 6)
  ├─ payment_status must be 'paid': unpaid is deferred to async_payment_succeeded; 'no_payment_required' is
  │    alerted and nothing is written
  ├─ a session already recorded is 'already_fulfilled' and runs no side effect
  ├─ the payment is read first: stripe.paymentIntents.retrieve(intent, { expand: ['latest_charge'] }). A
  │    charge refunded in full records the pack 'refunded' (creditsRemaining 0, creditsRevoked = the posts,
  │    the refund on the row), a disputed one 'disputed' (frozen, its credits counted), and any amount
  │    refunded is written on the row; a full refund wins over a dispute. A failed read records nothing and
  │    throws, so the caller's retry reads it again. (The refund or dispute event, arriving first, found no
  │    pack and was answered 500 for Stripe to retry: below)
  ├─ the alerts that need a human go out before the write, so a crash after it cannot lose them (a retry
  │    may repeat one): bought while the sale was closed when the buyer opened Checkout, by an account that
  │    is not an employer, or with no account reference ('... refund it in Stripe'); charged an amount or a
  │    currency other than config.stripePackPriceInCents and 'usd' (recorded as charged, with the posts and
  │    the year config sells); paid with no payment intent (no refund or dispute could find the pack); the
  │    payment already refunded in full or disputed
  ├─ EmployerPostPack.create keyed on the unique stripeSessionId (a P2002 from a path that got there first
  │    is 'already_fulfilled'): creditsTotal = config.packPosts, amountCents = session.amount_total (what
  │    Stripe charged), purchasedAt = the session's creation, expiresAt = packExpiresAt(purchasedAt),
  │    quotaDomain from metadata, the status and counters from the payment, the invoice fields
  ├─ only a pack recorded 'paid': sendPostPackPurchasedEmail to an employer buyer (claimed through
  │    EmailSend, released on a failed send) and trackServerPurchase (item post-pack-5, 'Job Posting Pack',
  │    priced as charged)
  └─ the money is always recorded, whatever was alerted
  invoice.paid with no matching JobCharge → refreshPackInvoice (the pack's invoice links)
  A failure answers 500 and rolls the dedupe row back, so Stripe retries.

Verify: GET /api/verify-pack-session?session_id=cs_… (401 signed out, 403 another account's session)
  → { status: 'paid' | 'processing' | 'unpaid', pack: { creditsTotal, creditsRemaining, expiresAt } | null }
  With the pack on the books, sendPurchasedEmailIfUnsent sends the purchase email a failed send left
  unsent (a replayed webhook finds the pack recorded and runs no side effect); the EmailSend claim keeps it
  to one email, and a claim already taken skips it before anything else is read

Post: POST /api/jobs/post-free, after the promo
  ├─ getPackCreditStatus(userId).usable → resolvePostingMode quotes mode 'pack' (promo → pack → intro → paid)
  ├─ inside the Serializable transaction, before the post is written: spendPackCredit, a conditional
  │    decrement on the account's pack that expires first (updateMany where id, userId, status 'paid',
  │    expiresAt > now, creditsRemaining > 0); nothing matched → 409 { error, packCreditUnavailable: true };
  │    a serialization conflict → 409 { error, retry: true }; nothing is written in either case
  ├─ EmployerJob.create (quotaDomain, paymentStatus='pack', pricingTier='pack', postPackId, userId), and the
  │    screening questions, in the same transaction: any write that fails rolls the spent credit back too
  ├─ 200 { ..., mode: 'pack', pack: { remaining, used, total, expiresAt } }, read inside the same transaction
  └─ the confirmation email: "Posted with your 5-post pack. N posts left, to use by <date>." · /success?mode=pack
  A pack post is never invoiced or receipted on its own (400: the pack's invoice covers it; the dashboard
  row reads "Pack post" with no invoice link, Settings, Billing labels it "Pack post" and lists the pack's
  own invoice above), comes back directly through toggle-publish, renews at $199 keeping pricingTier
  'pack', and locks its domain against an email change like a paid post. The checkout page answers a 409
  PACK_CREDIT_AVAILABLE from /api/create-checkout by showing the post as one from the pack and sending the
  employer back to the preview, which publishes it with the credit; nothing is sold.

Refund and chargeback: app/api/webhooks/stripe/post-pack-refunds.ts, when no JobCharge matches the payment
  ├─ charge.refunded in full → status 'refunded', the unused credits moved to creditsRevoked (a compare-and-set
  │    on the counter, so a credit spent at the same moment is never lost), and the pack's standing posts
  │    ('pack' rows) → 'refunded' and unpublished; a renewed pack post has its own payment and stays up
  ├─ charge.refunded in part → the amount recorded on the pack and alerted; credits and posts unchanged
  ├─ charge.dispute.created → the pack frozen ('disputed': never usable, credits kept counted), its standing
  │    posts → 'disputed' and unpublished
  ├─ charge.dispute.closed, won, or warning_closed (an inquiry that never became a chargeback) → 'paid'
  │    again unless a refund came first; the posts the dispute took down (no charge of their own) back to
  │    'pack', republished while inside their run, not archived, not paused
  ├─ charge.dispute.closed, lost → the unused credits revoked for good, from a frozen pack or from one still
  │    'paid' (a dispute.created that never froze it), refundReason 'dispute_lost', its standing posts
  │    → 'disputed' and unpublished; any other close (prevented, under_review) changes nothing
  └─ no pack matches, and the payment intent is a pack's (metadata.type 'post_pack', isUnrecordedPackPayment):
       the pack is not recorded yet, so the event answers 500 and rolls its dedupe row back; Stripe's retry,
       once the checkout is fulfilled (recorded refunded or disputed when the charge already is), finds it.
       Any other unmatched payment is acknowledged as before; a Stripe error answers 500
  Every one alerts staff (alertWebhookFailure). Each step reads the state it changes, so a redelivery
  changes nothing twice; taking the posts down and putting them back write the listing first, matched on
  the status the rows still hold, and flip the status last, so a redelivery finishes whichever write
  failed; an error answers 500 and Stripe retries.

By hand: /admin/post-packs → PATCH /api/admin/post-packs/:id (requireApiAdminActor, verifyCsrf, a strict
  zod body read through lib/request-body.ts), on a 'paid' pack only (refunded and disputed packs are the
  webhook's), each a compare-and-set on what lib/post-pack-admin.ts#planPackChange read (409 when a post
  spent a credit in between), each audit logged as post_pack.<action> with the counters before and after
  ├─ revoke { credits? }: unused posts to creditsRevoked, all by default (a partial refund issued in Stripe,
  │    which the webhook only alerts on); never more than are left, and never given back
  ├─ extend { useBy: 'YYYY-MM-DD' }: expiresAt = packExpiresAtForUseBy(useBy), the end of that day in Hawaii,
  │    so the pack reads "Use by" that date; later than the current one, in the future, within 3 years;
  │    revives an expired pack
  └─ restore: one post the pack spent back to creditsRemaining (a post removed in error); never a revoked one
```

---

## 3. Architecture map

### 3a. Source-of-truth files

| Concern | File |
|---|---|
| Pricing values + helper functions, and the promo clock every phase-dependent surface reads (`config.isPromoActive(now)`, `config.promoEndsAt`) | [lib/config.ts](../lib/config.ts) |
| Posting-mode resolution (promo → pack → intro → paid), the intro allowance (paid posts and paid Stripe packs), free-email list, the employer's own next-post price (`nextNewPostPrice`), the tier a renewal keeps (`asRenewalTier`), and `NEW_POST_CHARGE_SELECT` (the query fragment that loads a row's `'new'` JobCharge for the renewal price) | [lib/pricing.ts](../lib/pricing.ts) |
| The 5-post pack's credits (§2h, server only): what an account can spend (`getPackCreditStatus`), the spend inside post-free's transaction (`spendPackCredit`, `PackCreditUnavailableError`), the expiry (`packExpiresAt`), the intro rule's count (`paidPackWhere`, `countPaidPacksForDomain`), and the refund and dispute steps (`revokeUnusedPackCredits`, `freezePack`, `unfreezePack`, `takeDownPackPosts`, `restorePackPosts`) | [lib/post-packs.ts](../lib/post-packs.ts) |
| Whether the pack can be sold now, and if not why (`packSaleClosedReason(now)`, `isPackSaleOpen(now)`: the gate's one copy), who it is sold to (`PackBuyer`), and the identifiers its checkout, webhook, sweep and GA event share (`POST_PACK_CHECKOUT_TYPE` = `'post_pack'`, `POST_PACK_SKU` = `'post-pack-5'`) | [lib/post-pack-sale.ts](../lib/post-pack-sale.ts) |
| One pack as the employer's pages show it (`POST_PACK_VIEW_SELECT`, `toPostPackView`, `packCreditsLine`, `packStatusLine`, `packInvoiceHref`, `MAX_PACKS_LISTED`). Client-safe; GET /api/employer/post-packs, /employer/post-pack, the dashboard usage card and Settings, Billing print it | [lib/post-pack-view.ts](../lib/post-pack-view.ts) |
| The pack back office: the admin view (`ADMIN_PACK_SELECT`, `toAdminPackView`) and the three changes (`planPackChange`: revoke, extend, restore; §2h). Client-safe; /admin/post-packs and its two routes | [lib/post-pack-admin.ts](../lib/post-pack-admin.ts) |
| Which renewal price a post pays (`renewalRungFor`, `renewalRungForRow`, `asRenewalRung`; §1b). Client-safe (imports only lib/config) | [lib/renewal-price.ts](../lib/renewal-price.ts) |
| Renewal offer rule: the price the offer names (the row's own, passed as `renewalPrice`) and whether a renewal may be pitched as a saving, in which words (`renewalSavings`, `resolveRenewalOffer`, `renewalSavingsLabel`, `renewalSavingsLine`). Client-safe (imports only lib/config), so the dashboard and the edit page apply the same rule as the emails and the cron; lib/pricing.ts re-exports the first three and their types | [lib/renewal-offer.ts](../lib/renewal-offer.ts) |
| Whether a next-post quote the browser already holds is still true (`currentQuote(quote, now)`: a `'promo'` quote reads as no quote once the promo has ended). Client-safe; used by /post-job/preview, /post-job/checkout and the dashboard usage widget | [lib/next-post-quote.ts](../lib/next-post-quote.ts) |
| Quota / unlock / InMail gates | [lib/tier-limits.ts](../lib/tier-limits.ts) |
| Email-change policy (helper, not yet wired; a `'pack'` post and a paid pack lock the domain like a paid post) | [lib/auth/email-change-policy.ts](../lib/auth/email-change-policy.ts) |
| Email templates (pricing sentences from lib/pricing-copy.ts, chosen at send time) | [lib/email-service.ts](../lib/email-service.ts) (uses [lib/email-templates-v2.ts](../lib/email-templates-v2.ts)) |
| Client-side analytics events | [lib/analytics.ts](../lib/analytics.ts) |
| Server-side purchase events (a new post, a renewal, or a pack: item `post-pack-5`, 'Job Posting Pack') | [lib/analytics-server.ts](../lib/analytics-server.ts) |

**The date-driven copy switch.** Every sentence that states a price or the promo is chosen from `config.isPromoActive(now)` when it is rendered, sent or requested, never at module load (§1d). These modules hold the words; each page calls its builder with `now` on every render (a Next.js page may export only Next's own names, so a page's builder sits in a sibling file):

| Module | Exports | Used by |
|---|---|---|
| [lib/pricing-copy.ts](../lib/pricing-copy.ts) (client-safe: imports only lib/config) | `PROMO_HEADLINE`, `PROMO_SUB` (promo only); `LADDER_PRICES`, `LADDER_HEADLINE`, `FULL_PACKAGE`, `LADDER_FROM_LINE` (ladder only); `RENEWAL_LINE` (both phases: both renewal prices); `ladderLine(now)` (dated while the promo runs, plain after); the 5-post pack's `packPriceLine(now)`, `PACK_OFFER`, `PACK_COMPARISON`, `PACK_FAQ_QUESTION`, `packFaqAnswer(now)` and its dates (`packDateLabel`, `packUseByLabel`, `packUseByValue`, `packExpiresAtForUseBy`); `REFUND_ANSWER` (both phases: all sales final) | the six page builders below (lib/compare-data.ts and lib/employer-comparison.ts phrase their own sentences from config), `RENEWAL_LINE` on /pricing, /faq and /for-employers and as the calculator's `RENEWAL_SCOPE_NOTE`, the emails, the expiry cron, lib/outreach-service.ts, and the inline promo branches on /testimonials, /tools/salary-benchmark, /for-employers/resources/how-to-hire and the /post-job layout metadata; the pack and refund sentences on /pricing, /faq and /for-employers (and in their FAQPage JSON-LD) and on /employer/post-pack, and the pack dates on every pack surface |
| [app/pricing/pricing-page-copy.ts](../app/pricing/pricing-page-copy.ts) | `pricingPageCopy(now)`: hero, `promoActive` (the $0 promo card renders only while true), `packageSection` (the feature grid's heading once that card is gone; null while the promo runs), listing card, ladder heading, CTA card, leading FAQ entries, metadata. Also the both-phase canonical constants `FEATURES_LINE`, `RENEWAL_EFFECT_LINE`, `RENEWAL_CAP_LINE` | /pricing |
| [app/for-employers/for-employers-copy.ts](../app/for-employers/for-employers-copy.ts) | `forEmployersCopy(now)`: receipt hero, CTAs, pricing card, bento copy, leading FAQ entries, metadata, and the `promoActive` flag the page hands EmployerHowItWorks | /for-employers |
| [app/faq/faq-employer-copy.ts](../app/faq/faq-employer-copy.ts) | `employerPricingFaqs(now)`: cost, features, intro price | /faq |
| [app/post-job/_lib/post-job-pricing-copy.ts](../app/post-job/_lib/post-job-pricing-copy.ts) (client-safe) | `postJobPricingCopy(now)`: the subtitle and the Step 5 package lines | the /post-job wizard |
| [app/for-employers/resources/post-job-cta.ts](../app/for-employers/resources/post-job-cta.ts) | `postJobCta(now)`: `offer`, `price`, `button` | the employer resources hub, the template library and every template page; the job description guide, which states no price, prints `button` alone |
| [app/tools/cost-per-hire-calculator/cost-per-hire-copy.ts](../app/tools/cost-per-hire-calculator/cost-per-hire-copy.ts) | `costPerHireAssumptions(phase)`, `costPerHireFaqs(phase)`, `postRoleBlurb(phase)`, for `phase = pricingPhase(now)` from [components/tools/cost-per-hire-model.ts](../components/tools/cost-per-hire-model.ts), which also exports `flatFeeModeOptions(phase)`, `defaultInputs(phase)`, `offeredFlatFeeMode(selected, phase)` and `perPostRenewalPrices(flat)` (the result line's renewal prices) | /tools/cost-per-hire-calculator and its client calculator |
| [lib/compare-data.ts](../lib/compare-data.ts) | `competitorProfiles(now)`, `getCompetitorProfile(slug, now)`: our price statements come from the private `ourPriceCopy(now)`; competitor claims stay dated to `COMPARE_REVIEW_DATE` | the three comparison pages and the /compare hub (which prints no price) |
| [lib/employer-comparison.ts](../lib/employer-comparison.ts) | `employerComparisonRows(now)`: the "Free Posting Through ..." row only while the promo runs, and the flat-pricing note dated only while it runs | /pricing, /for-employers |
| [lib/outreach-service.ts](../lib/outreach-service.ts) | `availableOutreachTemplates(now)`, `renderTemplate(name, vars, now)`, `OUTREACH_TEMPLATE_NAMES`, `OutreachTemplateUnavailableError` (freeOffer after the promo) | /admin/outreach, POST /api/outreach |
| [app/api/sitemaps/lastmod.ts](../app/api/sitemaps/lastmod.ts) | `PROMO_SWITCH_PATHS`, `promoSwitchDate(now)`, `withPromoSwitch(date, now)`, `pageContentDate(path, now)` | app/sitemap.ts and the sitemap index |

### 3b. API routes (pricing-related)

| Route | Method | Purpose |
|---|---|---|
| `/api/employer/free-quota-status` | GET | Quote for the employer's NEXT post (mode/tier/price + promo fields, and `pack` { remaining, used, total, expiresAt } while the account holds a current pack, a used-up one included) |
| `/api/employer/post-packs` | GET | The signed-in employer's own packs, newest first and bounded (`PostPackView`s with Stripe's hosted invoice), `credit` (the current packs summed, or null), the `offer` from config and `saleOpen`; read only, 401 / 403 before a pack is read. The dashboard usage card and Settings, Billing read it |
| `/api/jobs/post-free` | POST | Post without a charge: promo → pack credit (spent inside the transaction) → 403 requiresPayment; atomic; sets quotaDomain; 409 `packCreditUnavailable` for a credit spent first, 409 `retry` on a serialization conflict |
| `/api/create-checkout` | POST | Intro / Featured post → Stripe Checkout (tier from `getNextPaidTier`); 503 while `ENABLE_PAID_POSTING` is off or Stripe is unconfigured, 409 `PROMO_ACTIVE` while the promo runs, 409 `PACK_CREDIT_AVAILABLE` for a new post while a pack credit is left |
| `/api/create-pack-checkout` | POST | 5-post pack → Stripe Checkout at `config.stripePackPriceInCents`, sold to the signed-in account (§2h); 503 while paid posting is off or the Stripe key or webhook secret is missing, 409 `PROMO_ACTIVE` while the promo runs, 403 for an account that is not an employer or whose email is not confirmed, 400 for a free-email signup; the account's open pack sessions from earlier windows are expired first (503 with Retry-After when one cannot be). The Buy button on /employer/post-pack posts to it |
| `/api/create-renewal-checkout` | POST | Renewal → Stripe Checkout at the row's own price (`config.renewalPriceCentsFor(renewalRungForRow(row))`: $199, or $249 for a post bought at $349; a pack post pays $199; §2d) (blocks pending / expired / refunded / disputed / legacy plan / legacy free / archived posts, and a renewal payment already in flight; one payable renewal session per post) |
| `/api/verify-checkout-session` | GET | Server-side Stripe verification for `/success` page |
| `/api/verify-renewal-session` | GET | Server-side verification for `/employer/renewal-success` |
| `/api/verify-pack-session` | GET | Server-side verification of a pack checkout for its own account (401 / 403 otherwise); self-heals a paid session with no pack row, and sends the purchase email a failed send left unsent |
| `/api/webhooks/stripe` | POST | Stripe → publish job, write JobCharge, record a 5-post pack and apply its refunds and disputes, emails, purchase event; a subscription-mode session (the retired plan) is alerted for a refund and acknowledged (§2e) |
| `/api/outreach` | GET/POST | Admin only (`requireApiAdmin`): employer leads and the cold-outreach templates. `render-template` validates the name against `OUTREACH_TEMPLATE_NAMES` (400) and answers 409 `{ success: false, error }` with the service's reason for a template that is not on offer (`freeOffer` once the promo has ended) |
| `/api/admin/post-packs` | GET | Admin only (`requireApiAdmin`): every pack, newest first, bounded, as `AdminPackView`s (the account, the source, the Stripe payment) |
| `/api/admin/post-packs/[id]` | PATCH | Admin only (`requireApiAdminActor`, `verifyCsrf`, a strict zod body): revoke unused posts, a later use-by date, or restore one spent post, on a paid pack, as a compare-and-set (409 when it matched nothing), audit logged (§2h) |
| `/api/employer/invoice` | GET | PDF invoice from JobCharge ledger (audit #2); 400 for a pack post, whose pack's own Stripe invoice covers it (so does `/api/employer/receipt`) |
| `/api/employer/usage` | GET | Per-posting credit usage for dashboard |
| `/api/jobs/update` | POST/DELETE | Job edit / unpublish (contactEmail edits allowed — quotaDomain anchor handles it) |

### 3c. UI surfaces (pricing-related)

Unless a row says otherwise, a server page below that states the promo decides the phase on each render and re-renders hourly (`revalidate = 3600`), and a client page decides it on each render in the browser (§1d).

| Surface | Reads from |
|---|---|
| [/pricing](../app/pricing/page.tsx) | `pricingPageCopy(now)` and `employerComparisonRows(now)`, per render and in `generateMetadata`; the $0 promo card renders only while the promo runs, and it carries the feature grid's heading and the page's first button, so once it is gone the hero carries the post-a-job button and the grid gets its own H2 (`packageSection`); three ladder cards (intro, featured, and the 5-post pack: `$1,245 for 5 posts`, `$249 a post, to use within 12 months`, its note `packNote`, dated by `packPriceLine(now)` while the promo runs with no button, then a link to /employer/post-pack while `isPackSaleOpen(now)` and the support email while the sale is closed) and no plan card, CTA or plan FAQ since 2026-10-24; the pack FAQ (`packFaqAnswer(now)`) and the refund answer (`REFUND_ANSWER`) in its FAQ and FAQPage JSON-LD |
| [/ (homepage)](../app/page.tsx) | the "How employers hire" band (components/EmployerHowItWorks.tsx) gets `promoActive` from the server render, so its CTA hydrates with the label the HTML carries (revalidate 60) |
| [/post-job](../app/post-job/page.tsx) | `postJobPricingCopy()` on each render; `/api/employer/free-quota-status` quote (`price`/`tier`); `config.*` for feature pills; metadata from the layout's `generateMetadata` |
| [/post-job/preview](../app/post-job/preview/page.tsx) | banner by mode: promo / pack (`From your 5-post pack, live for 60 days`, the pack posts left after this one, the caption `Included in your post pack.`) / intro $249 / $349, from the quote through `currentQuote` (a promo quote fetched before the switch reads as no quote: neutral copy); the paid caption ends `All sales are final (Terms §8).` |
| [/post-job/checkout](../app/post-job/checkout/page.tsx) | order summary from the quote, through `currentQuote`; a 409 `PACK_CREDIT_AVAILABLE` from /api/create-checkout shows the post as one from the pack and links back to the preview (§2h); the trust rail ([checkout/layout.tsx](../app/post-job/checkout/layout.tsx)) states the ladder from `config.*`, pitches no plan, and its Refunds panel says all sales are final |
| [/for-employers](../app/for-employers/page.tsx) | `forEmployersCopy(now)` and `employerComparisonRows(now)` (shared with /pricing), per render and in `generateMetadata`; hands `promoActive` to EmployerHowItWorks |
| [/faq](../app/faq/page.tsx) | `employerPricingFaqs(now)`, which also feed the FAQPage JSON-LD; the static metadata names no price |
| [/terms](../app/terms/page.tsx) | `config.*`; static, and does not switch: it states the launch promotion and the schedule from `config.ladderStartsLabel` with their dates; §6 and §7 state the 5-post pack's terms (5 credits for $1,245, 12 months, the buying account only, the intro price it uses up, sold from the ladder's start to company email accounts), and §8 says all sales are final, with only a refund the law requires and a billing error excepted |
| [/testimonials](../app/testimonials/page.tsx) | CTA from an inline `config.isPromoActive(now)` branch and `LADDER_PRICES` (the page 404s until a consented testimonial is featured) |
| [for-employers/resources](../app/for-employers/resources/page.tsx), the template library and every template page | `postJobCta(now)`; the hiring guide (how-to-hire) uses an inline `config.isPromoActive(now)` branch and `LADDER_PRICES`; the [job description guide](../app/for-employers/resources/job-description-guide/page.tsx) states no price and takes only its button label from `postJobCta(now).button` ("Post a Job: Free" while the promo runs, "Post a Job" after) |
| [/tools/salary-benchmark](../app/tools/salary-benchmark/page.tsx) | post-a-role card from an inline `config.isPromoActive(now)` branch and `LADDER_PRICES` |
| [/tools/cost-per-hire-calculator](../app/tools/cost-per-hire-calculator/page.tsx) | `FLAT_FEE_PRICING` in [components/tools/cost-per-hire-model.ts](../components/tools/cost-per-hire-model.ts) models promo / per-post / 5-post pack (the plan mode went with the plan) and prices each renewal by the post it renews: the intro post's, a promo post's and a pack post's at $199, a later post's at $249 (`perPostRenewalPrices` states the split). The pack mode buys a pack for every 5 roles and posts the rest at $349, or from one more pack when that costs less (`packMix`); because a pack uses up the domain's intro price, with the intro price applied it also prices the first post at $249 bought before any pack, plus the same mix for the other roles, and keeps whichever posting spend is lower (`PACK_SCOPE_NOTE` says so on the page); the page decides `pricingPhase(now)`, builds its notes, FAQ (and FAQPage JSON-LD) and post-a-role card from ./cost-per-hire-copy.ts, and hands the phase to the client calculator, which offers `flatFeeModeOptions(phase)`, opens on `defaultInputs(phase)` and prices only a way to buy the phase still offers (`offeredFlatFeeMode`) |
| [/compare/*](../lib/compare-data.ts) | `getCompetitorProfile(slug, now)` per render and in `generateMetadata`; `OUR_FACTS` holds the config tokens. The /compare hub is static and prints no price |
| [/employer/dashboard](../app/employer/dashboard/page.tsx) | `paymentStatus` branches Renew (a legacy plan row keeps its "Plan slot" badge and gets no Renew, lib/employer-dashboard-rules.ts); promo branches from `config.isPromoActive()`; the page sends each row's own `renewalPrice` (lib/renewal-price.ts), which the renewal modal prints; savings line from `renewalSavingsLine` (lib/renewal-offer.ts), measured from that price against the employer's next-post price; usage widget quote through `currentQuote` (the widget reads no plan status and pitches no plan since 2026-10-24); a pack post's row carries a "Pack post" badge and no invoice link; the usage card reads the account's packs from GET /api/employer/post-packs: "3 of 5 posts left" over "Use by <date>", "5 of 5 posts used" over the next post's price once they are spent, and `Buy 5 posts · $1,245` (to /employer/post-pack) while the sale is open |
| [/jobs/edit/[token]](../app/jobs/edit/%5Btoken%5D/page.tsx) | `config.*` + renewal modal branches on `paymentStatus`; promo branches from `config.isPromoActive()`; the edit API returns the row's own `renewalPrice`; savings line from `renewalSavingsLine`, measured from that price against the standard post price (the page does not know the quota domain) |
| [/success](../app/success/page.tsx) | `?mode=promo` / `?mode=pack` (`Your job is live. Posted with your 5-post pack.`, GA `submit_free_post` with `posting_mode` 'pack') / `?free=true` (promo) / `?session_id` verification |
| [/employer/post-pack](../app/employer/post-pack/page.tsx) | the pack's own page (§2h): the offer, the Buy button while `isPackSaleOpen(now)`, the return from Checkout, and the account's packs with Stripe's invoices; force-dynamic, noindex |
| [/employer/settings](../app/employer/settings/EmployerSettingsClient.tsx), Billing | the account's packs from GET /api/employer/post-packs above the post rows ([PackPurchases.tsx](../app/employer/settings/PackPurchases.tsx): `5-post pack`, the posts left or used, the use-by date or the state, bought, amount, Stripe's hosted invoice, "Pending" until the webhook stores it); a pack post's row reads "Pack post" with no invoice of its own; a failed pack load says so |
| [/admin/post-packs](../app/admin/post-packs/page.tsx) | every pack (GET /api/admin/post-packs) with its account, posts, use-by date and payment, and the three changes on a paid pack (revoke unused posts after a confirm, a later use-by date, restore one spent post) through PATCH /api/admin/post-packs/:id; linked from the admin sidebar as Post Packs |
| [/admin/outreach](../app/admin/outreach/page.tsx) | force-dynamic server page: lists `availableOutreachTemplates(now)` (freeOffer only while the promo runs) and hands the list to the client UI, which shows a refused render's reason (409 from `/api/outreach`) as a toast |
| Employer emails ([lib/email-service.ts](../lib/email-service.ts)) | the welcome email's pricing card from `pricingCopyForNow(now)` (`PROMO_HEADLINE` + `PROMO_SUB`, or `LADDER_HEADLINE` + `ladderLine(now)`), its one caller since the plan emails were deleted; the expiry offers in §2g; the pack purchase email (`sendPostPackPurchasedEmail`: `Your 5-Post Pack Is Ready`, the 5 posts and the date to use them by from `packUseByLabel`, the full package, the buying account, the invoice link, no price) and a pack post's confirmation (§1c); all decided at send time |

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
  paymentStatus   String    // 'promo' | 'pack' | 'pending' | 'paid' | 'plan' | 'refunded' | 'disputed' | 'expired'
                            // ('pack': published with a 5-post pack credit; 'disputed': a chargeback is open or was lost;
                            // 'expired': an abandoned checkout the sweep retired; 'plan': legacy, the retired Employer plan)
                            // | legacy 'free' / 'free_renewed' / 'free_upgraded' (existing rows only; never written again)
  pricingTier     String    @default("pro")  // 'intro' | 'pro' | 'pack'; promo + legacy rows carry 'pro', a legacy plan row 'plan'
  userId          String?   // Supabase auth id; nullable on account deletion
  quotaDomain     String?   // ★ Immutable signup-domain snapshot — set ONLY at row creation, on EVERY path
  stripeCheckoutSessionId String?  // the latest Checkout Session for the post; the resume path retires it before minting another
  postPackId      String?   // the pack whose credit published the post ('pack' rows only); FK ON DELETE SET NULL
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
- `quotaDomain` is written exactly once, at creation, by every creating path (promo, pack, checkout; the deleted plan path did too). No update path may write it.
- `postPackId` is written only on a `'pack'` row, at creation, with the credit that row spent; nothing moves it.
- Intro allowance = `COUNT WHERE quotaDomain = domain AND paymentStatus = 'paid' AND (has a 'new' JobCharge OR has no JobCharge)` = 0, AND no `employer_post_packs` row with that `quota_domain`, `status = 'paid'` and `source = 'stripe'`. Nothing else consumes it — a renewal-only `'paid'` row (a renewed promo or pack post) does not.
- Promo cap = `COUNT WHERE quotaDomain = domain AND paymentStatus = 'promo' AND job live` < `config.promoMaxActivePostsPerDomain`.

### 4b. EmployerPlan (deprecated: the plan was retired on 2026-10-24 and its code deleted on 2026-10-27; migration `20260912000000_add_employer_plans`)

The model, the `employer_plans` table and its RLS stay, unused: no code reads or writes them since 2026-10-27, and the schema comment marks the model deprecated. Production had no row on 2026-10-26; the table is dropped only in a separate, deliberate migration, if ever (§11).

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
  lastStripeEventAt    DateTime?           // the deleted subscription handlers' ordering stamp
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  @@index([email])
  @@index([status, currentPeriodEnd])
  @@map("employer_plans")
}
```

The entitlement rule, the slot count and the grace window that read these columns went with the plan code.

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

Two-phase claim. The webhook inserts the row as `'processing'` BEFORE it handles the event and marks it `'done'` once the handler answers below 500. On a UNIQUE violation it returns 200 + `deduped=true`, with one exception: a row still `'processing'` whose claim is older than the reclaim window (the route's `maxDuration` plus 30 seconds) belongs to a delivery that died mid-flight, and Stripe's retry takes it over. Every 500 path deletes the row first, so the retry replays the event.

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
  amountCents           Int       // what Stripe charged: 24900 (intro) | 34900 (pro) | 19900 or 24900 (renewal) at list price
  currency              String    @default("usd")
  type                  String    // 'new' | 'renewal'
  createdAt             DateTime  @default(now())
  refundedAt            DateTime?
  refundedAmountCents   Int?      // partial refunds add up here; a lost dispute is recorded here too
  refundReason          String?   // Stripe's reason, or 'dispute_lost'
}
```

One row per per-post Stripe checkout. Invoices are generated from this ledger so the amount matches what Stripe billed; a paid post from before the ledger has no row, and its invoice falls back to `config.legacyInvoiceFallbackCents` (19900, frozen: it equals the base renewal price by coincidence and is never reused for it). A row of type `'new'` is also how the renewal price tells a post bought at $349 from a renewed promo post (§1b). The retired plan's subscriptions were never in this ledger.

### 4e. Other relevant fields

- `Job.expiresAt DateTime?` — drives "active posting" definition
- `Job.isFeatured Boolean @default(false)` — every post writes `false`; placement + badge come from the EmployerJob relation. Exception: the renewal webhook writes `true` (`config.isFeaturedTier` is always true), which sorts a renewed post above un-renewed employer posts on the `best` order; lib/utils/job-sort.ts still documents the flag as unused
- `Job.isPublished Boolean @default(false)` — true immediately for promo and pack posts (and was for plan posts); flipped by the webhook for paid

### 4f. EmployerPostPack (the 5-post pack; migration `20261025000000_add_employer_post_packs`)

```prisma
model EmployerPostPack {
  id                    String    @id @default(uuid())
  userId                String?   // loose Supabase auth id (no FK, the employer_plans precedent); the credits belong to this account only
  email                 String
  quotaDomain           String?   // signup-domain snapshot at purchase: the intro rule counts a paid Stripe pack here
  status                String    // 'paid' | 'refunded' | 'disputed'; no default: every create sets it
  source                String    // 'stripe' | 'admin'; no default either
  creditsTotal          Int
  creditsRemaining      Int
  creditsRevoked        Int       @default(0)
  amountCents           Int       // what Stripe charged: 124500 at list price
  currency              String    @default("usd")
  purchasedAt           DateTime  @default(now())   // the fulfilment writes the Checkout Session's creation
  expiresAt             DateTime  // packExpiresAt(purchasedAt): 12 calendar months, UTC, clamped to the month's last day
  stripeSessionId       String?   @unique   // the key every fulfilment path creates the pack by
  stripePaymentIntentId String?   @unique   // how a refund or a dispute finds the pack
  stripeInvoiceId       String?
  invoicePdfUrl         String?   // refreshed by invoice.paid when no JobCharge matches the invoice
  hostedInvoiceUrl      String?
  invoiceNumber         String?
  refundedAt            DateTime?
  refundedAmountCents   Int?      // Stripe's cumulative refunded amount, or the amount of a lost dispute
  refundReason          String?   // Stripe's reason, or 'dispute_lost'
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  posts                 EmployerJob[]
  @@index([userId, status, expiresAt])
  @@index([quotaDomain, status])
  @@index([stripeInvoiceId])
  @@map("employer_post_packs")
}
```

A credit is usable while `status = 'paid'`, `expiresAt > now` and `creditsRemaining > 0`. Used = `creditsTotal − creditsRemaining − creditsRevoked`: a counter, not a count of posts, so a hard-deleted post never hands a credit back. The migration adds what Prisma cannot express, `CHECK (credits_remaining >= 0 AND credits_revoked >= 0 AND credits_remaining + credits_revoked <= credits_total)`, the last line of defence behind the conditional decrement (§2h), and enables row level security with no policies (service role only, like `employer_plans`). `status` and `source` carry no default, in the schema or the SQL: the one create site (the fulfilment, §2h) sets both, so a write that forgot one fails instead of recording a pack as paid. The migration's first statement is `SET LOCAL lock_timeout = '5s'`: a deploy that would queue behind a long transaction on `employer_jobs` (the foreign key locks it) fails and is retried instead of stalling the writes behind it, and `SET LOCAL` ends with the migration's transaction, where a session-level `SET` would outlive it on a pooled connection. `tests/regressions/post-pack-migration.test.ts` pins the SQL: additive only, the lock timeout, the CHECK, the RLS, no default on the status and the source, the unique session key and the `ON DELETE SET NULL` link.

---

## 5. Feature inventory

### 5a. Employer features (what they get)

| Feature | When they have it |
|---|---|
| Post a job free (promo) | Every post while `config.isPromoActive()`, up to the abuse cap |
| Post a job at the intro price, $249 | First paid post per company domain (from Jan 1, 2027) |
| Post a job at the featured price, $349 | Every later paid post |
| Buy a 5-post pack, $1,245 ($249 a post) | After the promo, while paid posting is on, for an employer account with a company signup email; built 2026-10-25 and not yet linked from any page |
| Post a job with a pack credit | A credit left on a `'paid'` pack of the account that has not expired (12 months from purchase) |
| 60-day listing | Every post |
| Featured badge + top placement | Every post |
| 25 candidate unlocks / 25 InMails | Per active posting, every tier |
| Reply to existing conversations | Always free |
| View previously-unlocked candidates' contact info | After the posting expires, while the candidate's profile stays visible and open to offers (audit #21; the candidate route only returns such profiles) |
| Renew posting at $199, or $249 for a post bought at $349 | promo + pack + paid posts (a pack post at $199), +60 days capped at `config.renewalCapDays` after creation, no new unlocks / InMails; legacy plan posts are never renewed; legacy free posts must repost |
| Edit posting | Anytime |
| Analytics (per-job + time-series) | Active posting required (audit #M2 gate) |
| Invoice PDF | Per JobCharge; a pack post has none (the pack's own Stripe invoice covers it) |

### 5b. System features (what we built)

| Feature | Implementation |
|---|---|
| Webhook idempotency | `ProcessedStripeEvent` + INSERT-then-process (every event) |
| Per-charge invoice ledger | `JobCharge` writes on every per-post webhook payment |
| 5-post pack credits | `EmployerPostPack` rows, spent by a conditional decrement inside post-free's transaction (`lib/post-packs.ts`), with the migration's credit CHECK behind it; recorded once per Checkout Session by the webhook, the verify route or the sweep |
| Renewal priced by the post it renews | `lib/renewal-price.ts` + `NEW_POST_CHARGE_SELECT` (lib/pricing.ts) + `config.renewalPriceCentsFor` |
| Server-side purchase tracking | GA4 Measurement Protocol (`lib/analytics-server.ts`) |
| Client-side funnel events | `view_post_job_page`, `begin_checkout`, `submit_free_post`, `free_post_limit_hit` (now: the next post needs payment, with the rung quoted) |
| Atomic post creation | `prisma.$transaction({ isolationLevel: 'Serializable' })` on every path |
| Lazy Stripe client | All checkout routes — graceful 503 if keys missing |
| Stripe session verification | `/api/verify-checkout-session` + `/api/verify-renewal-session` + `/api/verify-pack-session` |
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

Gates: Layer 2 fields on **list** endpoints. A paused post (`isPublished=false`) is not active.

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
| Pack post creation | `spendPackCredit` inside the `/api/jobs/post-free` txn (a conditional decrement) | one credit per post, while the pack is `'paid'` and unexpired |
| Intro price | `getNextPaidTier(quotaDomain)` | one `'paid'` row bought as a post, or one paid Stripe pack, per `quotaDomain`, lifetime |

---

## 7. Closed loopholes

| # | Loophole | Closed by |
|---|---|---|
| #1 | `/success` page didn't verify Stripe — fake URL = fake success message | Server-side `verify-checkout-session` route + retry on webhook lag |
| #2 | Invoice always showed $199 (even for $179 renewals) | `JobCharge` ledger; invoice reads actual amount from charge row |
| #3 | Webhook had no idempotency — Stripe retries = duplicate emails + state writes | `ProcessedStripeEvent` table + INSERT-then-process |
| #6 | Free-post gate had race condition (parallel submissions both passed) | Serializable transaction + re-check inside (the promo cap, and the pack credit's conditional decrement, today) |
| #7 | Job + slug + EmployerJob inserts not atomic — partial failure = orphan rows | All wrapped in `prisma.$transaction` |
| #8 | Renewal webhook silently half-completed when EmployerJob missing | Returns 500 loudly with logging |
| #11 | Renewal flow accepted free / pending posts → snuck past free quota | 409 block; UI also branches via popup (#24); plan rows now 409 too |
| #12 | Hardcoded prices in 7+ surfaces would lie if config changed | All config-driven via `config.*` references (re-audited 2026-09-12) |
| #13 | `canUnlockCandidate` counted views from expired postings against current cap | Filter to active postings + legacy null only |
| #15 | Dead upgrade routes + page lingering from old tier model | All deleted |
| #17 | `PricingTier = 'starter' \| 'growth' \| 'premium'` was a fiction | Narrowed to `'pro'` (2026-04-30); widened to `'intro' \| 'pro' \| 'plan'` for the real ladder (2026-09-12), and to `'pack'` for the 5-post pack (2026-10-25); `'plan'` dropped with the plan code (2026-10-27) |
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
| **Concurrent first checkouts** | Two people at one domain open their first paid checkout at the same moment; both sessions are priced `'intro'` because neither is `'paid'` yet, so the $100 discount is granted twice | Counting in-flight `'pending'` intro rows would make an honest employer who abandons a $249 checkout see $349 on retry, worse than a rare $100 leak | `activate-paid-job.ts#detectIntroDoubleCharge` logs a Sentry-forwarded error when an intro activation finds another paid post, or a paid Stripe pack (an intro checkout opened before the pack was bought), at the domain. No refund is due: the domain paid $100 less than the ladder asks, not more, as the log line says. docs/PENDING_WORK.md D3 decides whether to block a second open intro checkout or accept the leak |

### Loopholes considered and confirmed NOT loopholes

| Scenario | Why it's safe |
|---|---|
| Account self-deletion + soft-delete | `EmployerJob.userId` becomes null on delete, but `quotaDomain` and `paymentStatus` persist. Counts unaffected. |
| Unpublish own job (`DELETE /api/jobs/update`) | Sets `isPublished=false`. Row stays; `'paid'` count unaffected (promo cap counts live rows only, which is the intended behaviour). |
| Edit job content (title/description/salary) | Doesn't touch `quotaDomain`, `paymentStatus`, or `userId`. |
| Edit `contactEmail` after posting | Count anchored on `quotaDomain` not `contactEmail`. |
| Attempt to mutate `paymentStatus` directly | No customer-facing path writes this field. The webhook and `post-free` are the only writers. |
| A plan Payment Link left active in Stripe, bought after the plan code was deleted | The subscription-mode session is never fulfilled: the webhook alerts "Employer plan retired: refund it in Stripe" and acknowledges it (§2e), and nothing is granted. |
| A renewed promo post reads `('paid','pro')`, exactly like a post bought at $349, so it could be charged the $249 renewal | The renewal price comes from the ledger, not the tier: only a `'new'` JobCharge makes a post pay $249 (§1b), and a renewed promo post has only `'renewal'` charges, so it keeps paying $199. A failed `'new'` write is retried by Stripe now (§1b) rather than lost. |
| Two posts at once on a pack's last credit | Each post spends its credit by a conditional decrement inside its own Serializable transaction: one wins, the other answers 409 (`packCreditUnavailable`, or `retry` on a serialization conflict) and writes nothing. The migration's CHECK refuses a negative count even if a writer skipped the guard. |
| A pack refunded or charged back after its posts went up | A full refund revokes the unused credits and takes the pack's standing posts down, and a dispute does the same until it is decided (§2h). Only a pack post renewed since, which has its own payment, stays up. |
| A pack refunded or charged back before it was recorded (its checkout fulfilled late: the webhook retried, the verify page or the sweep) | The refund or dispute event finds no pack, sees the payment intent's `post_pack` tag and answers 500, so Stripe retries it; the fulfilment reads the payment first and records the pack refunded (its credits revoked) or disputed (frozen), so no credit of a reversed payment is ever spendable (§2h). |
| A pack bought on one account and spent by a colleague at the same company | Credits belong to the buying account (`userId`): post-free spends only the signed-in account's own packs, and the quote reads no other account's. |

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
| `20260912000000_add_employer_plans` | Added `employer_plans` table (Employer plan). The table stays, deprecated and unused, since the plan code was deleted on 2026-10-27; no migration drops it (§4b, §11) |
| `20260913000000_stripe_integration_hardening` | `employer_jobs.stripe_checkout_session_id`, `processed_stripe_events.status/claimed_at` (two-phase webhook dedupe), `employer_plans.last_stripe_event_at` (the deleted plan handlers' out-of-order event guard) |
| `20260913000001_employer_plans_rls` | Row level security on `employer_plans` with no policies: service role only, like `job_charges` and `processed_stripe_events`. Kept with the table |
| `20261025000000_add_employer_post_packs` | Added the `employer_post_packs` table (the 5-post pack, §4f) with its credit CHECK and row level security, and the nullable `employer_jobs.post_pack_id` with its index and an `ON DELETE SET NULL` foreign key. Additive, no backfill: the code before it never reads either. It waits at most 5 seconds for a lock (`SET LOCAL lock_timeout`, its first statement), so a deploy stuck behind a long transaction fails and is retried |

Applied via the deploy build (`prisma migrate deploy`) — never run migrations by hand against production from a dev shell.

### 9b. Production Stripe checklist

The promo needs NOTHING from Stripe. Everything below must be live **before January 1, 2027** (see [LAUNCH_RUNBOOK.md §8](./LAUNCH_RUNBOOK.md)):

- [ ] `ENABLE_PAID_POSTING=true` + `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` in Vercel. Set the key and the webhook secret before the flag, or in the same deploy: the webhook answers 503 until both are set, and no checkout opens until then (§1d)
- [ ] (Optional, recommended) Restricted live key in place of the standard secret key. `STRIPE_SECRET_KEY` takes either, and a restricted key can do only what it is given, so a leaked key cannot refund, pay out, or change products and prices (it can still create and expire checkout sessions, and read the buyer emails and addresses that sessions, payment intents and invoices carry). Every Stripe call in the code needs exactly these permissions:
  - Checkout Sessions: Write (create and expire a session; Write includes the retrieve and list calls)
  - Payment Intents: Read (the resume, verify and reconciliation paths retrieve a session with its `payment_intent` expanded; the 5-post pack's fulfilment reads its payment intent, and the refund and dispute handlers read the intent of a payment nothing matches, for its `post_pack` tag)
  - Charges: Read (the pack's fulfilment expands the payment intent's `latest_charge`, to see a refund or a dispute that came first)
  - Invoices: Read (retrieve, for invoice and receipt links)
  - Nothing for the webhook: `webhooks.constructEvent` checks the signature locally against `STRIPE_WEBHOOK_SECRET`.
  - No Subscriptions and no Customer portal permission: nothing calls either since the retired plan's code was deleted (2026-10-27), so a key made earlier with them can lose them.
  Create the key in a sandbox first, run one per post checkout, one renewal at each renewal price and one 5-post pack, then read the key's request logs (API keys, the key's menu, View request logs) for any 403 and add what it names. Stripe's guide: https://docs.stripe.com/keys/restricted-api-keys
- [ ] Webhook endpoint `https://nphiring.com/api/webhooks/stripe` registered; event filter includes the 7 events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.paid`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` (the list in `.env.example`; `processEvent` in app/api/webhooks/stripe/route.ts handles every one). The retired plan's four events are no longer needed: an endpoint that still sends them gets a 200 and nothing happens, so drop them from it
- [ ] Dashboard → Settings → Payment methods: choose the methods offered on per-post Checkout (the sessions no longer pin `card`; delayed methods are safe — fulfilment waits for `payment_status: 'paid'`)
- [ ] Stripe Tax decision (head office address, registrations, product tax code) — open owner decision, see docs/PENDING_WORK.md B113
- [ ] Stripe Dashboard → Settings → Public details / Branding / Customer emails as before
- [ ] (Optional) `GA_MEASUREMENT_ID` + `GA_API_SECRET` for server-side `purchase` events

Nothing for the retired Employer plan: no plan Product, Price or Payment Link, and no Customer Portal configuration (§1b).

### 9c. Things to monitor

| Signal | What it means |
|---|---|
| `processed_stripe_events` count vs Stripe Dashboard event count | Big divergence = webhook drops |
| `job_charges` rows where `amount_cents ∉ {19900, 24900, 34900}` | Coupon used or manual price override — sanity check |
| `job_charges` renewal rows at 24900 on a post with no `'new'` charge | Should never happen: the $249 renewal is only for a post bought at $349 (§1b, §2d). A row like this means the price rule broke |
| Discord alert "Employer plan retired: refund it in Stripe" | A Checkout Session in subscription mode, or a paid invoice of a subscription, reached the webhook: a plan Payment Link is still active in Stripe and someone used it, or a subscription one started is still charging (§2e). Nothing was granted. Refund the payment, cancel the subscription and deactivate the link |
| `employer_plans` rows of any kind | Should stay empty: no code writes the deprecated table since 2026-10-27, and production had no row on 2026-10-26 |
| Sentry error "Intro price charged twice for one domain" | Two concurrent first checkouts both got the $249 rung, or an intro checkout opened before the domain bought a pack was paid after it (§8): the domain paid $100 less than the ladder asks. Nothing is refunded; docs/PENDING_WORK.md D3 decides what to do about it |
| `employer_post_packs` rows with no `user_id`, or a Discord alert that ends "refund it in Stripe" | A pack paid for with no account reference, by an account that is not an employer, or while pack sales were closed (§2h). The money is recorded; refund it in Stripe, and the refund revokes the pack |
| `employer_post_packs` rows where `amount_cents` is not 124500 | Coupon used or manual price override — sanity check |
| Payment reconciliation alert lines "5-post pack recovered" | A paid pack whose webhook never landed, recorded by the daily sweep: webhook delivery may be broken |
| Discord alert "... for a 5-post pack payment arrived before its pack was recorded: Stripe will retry" | A refund or dispute of a pack whose checkout is not fulfilled yet (§2h): the event is answered 500 until the pack exists. Repeated alerts mean the checkout is still not recorded: check the webhook's deliveries, or wait for the daily sweep |
| Discord alert "5-post pack refunded in full before it was recorded" or "disputed before it was recorded" | A pack recorded late, its payment already reversed: recorded refunded (no credit to spend) or frozen until the dispute closes. Nothing to do but follow the dispute |
| Discord alert "5-post pack charged an unexpected amount or currency" | A pack paid at other than `config.stripePackPriceInCents` in `usd` (a coupon, a manual price): recorded as charged, with the posts and the year config sells. Check that the charge was meant |
| Discord alert "5-post pack paid with no payment intent" | No refund or dispute of it can find the pack: handle any by hand in /admin/post-packs |
| `audit_logs` rows with action `post_pack.revoke`, `post_pack.extend` or `post_pack.restore` | An admin changed a pack by hand in /admin/post-packs (§2h): the admin, the pack, and the counters and expiry before and after. Each should match a support case or a partial refund issued in Stripe |
| 5xx error rate on `/api/webhooks/stripe` | Should be ~0 with idempotency |
| post-free 403 rate (`promoCapReached` / `requiresPayment`) and 409 rate (`packCreditUnavailable` / `retry`) | Abuse signal during the promo; demand signal for the ladder after; a steady 409 rate means parallel posts on one account |
| `processed_stripe_events` table size after 12+ months | Will grow unbounded; plan partition or quarterly cleanup |

### 9d. Operational rules cheat-sheet

- Promo: every post free through 2026-12-31 in every US zone (ends 2027-01-01T10:00Z, midnight Pacific/Honolulu); `config.isPromoActive()` is the only switch — no flag to flip. What switches on its own at that instant, and what stays an owner step (Stripe live mode, `ENABLE_PAID_POSTING`), is in §1d.
- Ladder: intro $249 = first `'paid'` row bought as a post per `quotaDomain`, unless the domain has bought a pack; featured $349 after; renewal $199 on promo, pack, intro and legacy rows and $249 on a post bought at $349 (lib/renewal-price.ts). The Employer plan is retired.
- 5-post pack: $1,245 for 5 credits, usable for 12 months by the buying account only, sold only after the promo and never to a free-email signup. All sales are final (/terms §8: only a refund the law requires and a billing error are excepted); a refund issued by hand in Stripe, or a chargeback, revokes or freezes what is left and takes the pack's standing posts down (§2h). A partial refund changes nothing on its own: revoke the posts it paid back in /admin/post-packs.
- Renewal extends from `MAX(existingExpiresAt, now)` — early renewers don't lose days — up to `config.renewalCapDays` after creation; it never resets unlocks or InMails.
- The Employer plan is retired and its code deleted. A legacy plan post (none in production) is never renewed (409) or republished (402); a subscription-mode Checkout Session is alerted for a refund and acknowledged (§2e).
- Legacy `'free'` posts cannot be renewed (unchanged message). Pending, expired, refunded and disputed posts cannot be renewed, and neither can an archived post until it is restored.
- Webhook idempotency keyed on `event.id`. Stripe retries are safe.
- Server-side `purchase` event fires from the webhook (the only authoritative payment-completion signal).
- Copy rule: every price and date on every surface is a config token; the canonical sentences in §1c are quoted verbatim; no audience-size claims anywhere. Which promo-dependent sentence a surface prints is decided when it renders or sends (lib/pricing-copy.ts or the page's builder, §3a), never at module load, and a server page that prints one re-renders at least hourly; /terms instead states both dated schedules and does not switch.

---

## 10. Test coverage

### 10a. Unit tests (Vitest)

[tests/lib/tier-limits.test.ts](../tests/lib/tier-limits.test.ts) — unlock / InMail gates (unchanged).

Regression suites pin the marketing copy (`tests/regressions/p2-trust-surfaces-point-of-sale.test.ts`, `p0-faq-pricing-funnel-stats-heroes-schema.test.ts`, `p9-claims-promises-review5.test.ts`, `p3-tools-round-2-registry.test.ts`, `pricing-copy-matches-code.test.ts`) and are updated alongside any pricing change. Their typed-price guards are built from `lib/config`, so a hand-written figure of any price config holds fails them, whatever the prices are.

The promo-end switch (§1d) is pinned by these suites, which run every clock-dependent case at fixed instants on both sides of `config.promoEndsAt`: [tests/lib/pricing-copy.test.ts](../tests/lib/pricing-copy.test.ts) (the shared sentences); `tests/regressions/pricing-pages-phase-switch.test.ts` (/pricing, /for-employers, /faq, their metadata and FAQPage JSON-LD, and the EmployerHowItWorks flag); `promo-switch-periphery.test.ts` (the employer resources pages, /testimonials, the salary benchmark, the cost-per-hire calculator, the comparison pages and the /post-job metadata); `employer-app-promo-phase.test.ts` and [tests/lib/next-post-quote.test.ts](../tests/lib/next-post-quote.test.ts) (the wizard, the preview, the dashboard usage strip and the candidate profile card, and that no employer surface decides the phase at module load); `checkout-page-server-quote.test.ts` (the checkout banner, rendered in both phases); `email-pricing-copy-phase.test.ts` (the welcome email); `expiry-warning-renewal-offer.test.ts` and [tests/api/cron-expiry-warnings-renewal-offer.test.ts](../tests/api/cron-expiry-warnings-renewal-offer.test.ts) (the expiry offers, §2g); [tests/lib/outreach-service.test.ts](../tests/lib/outreach-service.test.ts), `admin-outreach-template-phase.test.ts` and [tests/api/outreach-render-template.test.ts](../tests/api/outreach-render-template.test.ts) (the outreach templates, the admin list and the route's 409); `promo-switch-loose-ends.test.ts` (the homepage's server-decided flag and the email ladder headline); and the "2.1:" cases of `sitemap-content-lastmod.test.ts` (the lastmod switch).

Those suites prove the surfaces they import. `tests/regressions/promo-copy-static-guard.test.ts` covers the ones nobody listed (the job description guide kept a hard-coded "Post a Job: Free" on a static page until 2026-10-02): it reads every source under app/, components/ and lib/ through the TypeScript AST and fails when promo copy sits outside the promo branch of a condition that reads the promo clock or a promo row. Promo copy is visible text that offers free posting or names the promo, a `$0` price, `config.promoEndsLabel` or `config.ladderStartsLabel` printed under any object, and any use of a promo-only declaration. A declaration that holds only promo copy is listed in the guard's `PROMO_ONLY_UNITS`, and every use of its name is then held to the same rule; a statement that stays true after the promo (/terms, history, an operator alert) is listed in `TRUE_IN_BOTH_PHASES` with its reason. It proves where the copy sits, not that the page re-renders: a new server page that prints promo copy also needs `revalidate = 3600`, an entry in `PROMO_SWITCH_PATHS` and a render in both phases in one of the suites above.

`tests/regressions/promo-clock-pages-rerender.test.ts` enforces the first two of those for every page the sitemap dates. It reads the calls in each page: a page that calls `config.isPromoActive`, or a function of a module that reads the clock (lib/pricing-copy.ts, a page's builder, lib/compare-data.ts), has to export a `revalidate` of at most an hour and be in `PROMO_SWITCH_PATHS`, and a page listed there has to follow the clock. A page that calls a function of such a module and prints nothing that switches goes in its `NOT_PHASE_DEPENDENT` with the reason: today the /compare hub, which builds the comparison profiles to list them and prints only fields that are the same in both phases.

The 5-post pack's pages and copy (Phase 3) are pinned at fixed instants on both sides of the switch, with the sale gate mocked open and closed: `tests/regressions/pricing-pack-surfaces.test.ts` (the /pricing card, its CTA and FAQ, /faq, /for-employers, the comparison note and pages, the refund answers and /terms §6 to §8), `employer-post-pack-page.test.ts` and `pack-checkout-return.test.ts` (/employer/post-pack and the return from Checkout), `employer-app-promo-phase.test.ts` (the preview and the usage card in pack mode), `employer-dashboard-pack-post.test.ts`, `employer-settings-pack-billing.test.ts`, `success-page-pack-mode.test.ts`, `cost-per-hire-pack-mode-widget.test.ts` and `admin-post-packs-page.test.ts`, with [tests/lib/post-pack-view.test.ts](../tests/lib/post-pack-view.test.ts), [tests/lib/confirmation-email-pack.test.ts](../tests/lib/confirmation-email-pack.test.ts) and [tests/lib/analytics-pack-funnel.test.ts](../tests/lib/analytics-pack-funnel.test.ts) (the GA `begin_checkout` and `submit_free_post` events).

Two more suites cover what neither kind sees. `promo-switch-static-metadata.test.ts`: a module-scope `metadata` export cannot follow the clock, so on the periphery pages it may not offer free posting or name a promo date (the template library's link preview said "free to browse, customize, and post"). `cost-per-hire-mounted-across-switch.test.ts`: a calculator that was already open with the promo selected when the phase became the ladder shows and prices the per-post ladder.

### 10b. Money-path coverage, and what is still missing

Every path that takes money or grants a paid entitlement has a Vitest suite. All of them run against the mocked Prisma client of tests/setup.ts and a stubbed Stripe client:

| Path | Suites |
|---|---|
| `POST /api/jobs/post-free`: the promo cap re-counted and the pack credit spent inside the transaction (every write asserted on its own transaction client, none on the global one), the screening questions written in it, a failed write rolling the spent credit back, 409 for a credit spent first or a serialization conflict; the intro rule counting paid packs; paid modes handed to checkout | `tests/api/post-free-modes.test.ts`, `tests/lib/pricing.test.ts` |
| `POST /api/create-checkout`: intro then pro, the resume path, delayed payments, 409 `PROMO_ACTIVE`, 409 `PACK_CREDIT_AVAILABLE` | `tests/api/create-checkout-tier.test.ts` |
| The 5-post pack (§2h): the credits, their spend order and expiry, the account id every query needs, the sale gate and config, the purchase route (the confirmed email, the earlier sessions expired, the tagged payment intent), the webhook's fulfilment (idempotency, the payment gate, the payment read first and a pack recorded refunded or disputed by each of the three callers, the alerts sent before the write, money recorded and alerted when it should not have been taken, the email and its retry, the GA event, invoice.paid), the verify route's ownership and self-heal, refunds and disputes (an event for a pack not recorded yet retried, a lost dispute on a paid pack, an inquiry closed, a failed write finished by the redelivery), the quote (a used-up pack's totals included), the invoice / receipt / billing branches for a pack post, the account's own pack list, the purchase email, the admin changes (revoke, extend, restore: the admin gate, CSRF, the strict body, the compare-and-set, the audit entry, and the CHECK kept), and the migration's SQL | `tests/lib/post-packs.test.ts`, `tests/lib/post-pack-sale.test.ts`, `tests/lib/config-pricing.test.ts`, `tests/api/create-pack-checkout.test.ts`, `tests/api/webhooks-stripe-post-pack.test.ts`, `tests/api/post-pack-late-fulfilment.test.ts`, `tests/api/webhooks-stripe-post-pack-refund-dispute.test.ts`, `tests/api/verify-pack-session.test.ts`, `tests/api/employer-free-quota-status-pack.test.ts`, `tests/api/employer-billing-pack-posts.test.ts`, `tests/api/employer-post-packs.test.ts`, `tests/lib/post-pack-purchased-email.test.ts`, `tests/lib/post-pack-admin.test.ts`, `tests/api/admin-post-packs.test.ts`, `tests/regressions/post-pack-migration.test.ts`, `tests/regressions/ga-measurement-protocol.test.ts` |
| `POST /api/create-renewal-checkout`: the status and archive refusals; the renewal cap (409 `RENEWAL_CAP_REACHED` before any Stripe call for a post at or past `config.renewalCapDays`, and Checkout quoting the days a renewal near the cap really adds); the price by the post it renews ($249 only for a post bought at $349, $199 for every other renewable row) and `metadata.renewalRung`; one payable session per post; a reused idempotency key that replays a session this route had already expired, and the parameter fingerprint in that key | `tests/api/create-renewal-checkout-status.test.ts`, `tests/api/create-renewal-checkout-cap.test.ts`, `tests/api/create-renewal-checkout-tiered-price.test.ts`, `tests/api/create-renewal-checkout-single-payable.test.ts`, `tests/api/create-renewal-checkout-replayed-session.test.ts`, `tests/lib/renewal-checkout-sessions.test.ts` |
| Which renewal price a post pays (§1b), a row loaded without its charges refused rather than guessed, and the row price the dashboard, the edit API and the expiry offers hand on | `tests/lib/renewal-price.test.ts`, `tests/lib/renewal-offer.test.ts`, `tests/api/employer-dashboard-renewal-price.test.ts`, `tests/api/jobs-edit-token-renewal-price.test.ts` |
| The webhook: idempotency and the two-phase claim, the `payment_status` gate, a second payment for one post, the `JobCharge` ledger (a failed `'new'` write rethrown after the activation's later steps ran, and backfilled on Stripe's retry; a failed backfill answered 500 too), the intro race detector (paid packs included, and its log line) | `tests/api/webhooks-stripe-c2.test.ts`, `tests/api/activate-paid-job-intro-race.test.ts` |
| Renewals applied: the amount on the ledger, in the GA purchase event and in the confirmation email (what Stripe charged, else the price of `metadata.renewalRung`, else the base price for an older session), archived posts, sibling sessions, a payment that lands at or past the renewal cap (recorded on the ledger and alerted for a refund with its payment intent, while the expiry, the status and `isPublished` stay untouched and no confirmation email is sent) or just short of it (applied with the days that are left, the shortfall logged), the verify page's self-heal and cookie binding | `tests/api/apply-renewal-amount.test.ts`, `tests/api/webhooks-stripe-archived-post.test.ts`, `tests/api/apply-renewal-sibling-sessions.test.ts`, `tests/api/apply-renewal-cap.test.ts`, `tests/api/verify-renewal-session-self-heal.test.ts`, `tests/api/verify-renewal-session-sec3.test.ts` |
| Refunds and disputes (a pack's, and the JobCharge ledger matched first) | `tests/api/webhooks-stripe-refund-dispute.test.ts`, `tests/api/webhooks-stripe-post-pack-refund-dispute.test.ts` |
| The retired Employer plan's guards (its code and its own suites were deleted on 2026-10-27): a subscription-mode Checkout Session alerted for a refund and acknowledged with nothing granted, written or read back, before the pack and per-post paths; the plan's subscription and dunning events ignored; no source calling the Subscriptions or Customer Portal API; a legacy plan row refused a renewal (409) and a republish (402), and offered a repost by the expiry emails | `tests/api/webhooks-stripe-subscription-retired.test.ts`, `tests/api/create-renewal-checkout-status.test.ts`, `tests/api/employer-toggle-publish.test.ts`, `tests/regressions/expiry-warning-renewal-offer.test.ts`, `tests/api/cron-expiry-warnings-renewal-offer.test.ts` |
| The daily sweeps: payment reconciliation, and what it reports: an alert that says a recovered post was left archived (so nobody reads it as live), a renewal arm that looks back as far as the create route refuses on (`RENEWAL_SETTLEMENT_LOOKBACK_MS`), and a 5-post pack arm that records a paid pack whose webhook was lost | `tests/inngest/payment-reconciliation-guards.test.ts`, `tests/inngest/payment-reconciliation-renewals.test.ts`, `tests/inngest/payment-reconciliation-left-archived.test.ts`, `tests/inngest/payment-reconciliation-post-packs.test.ts` |
| `evaluateEmailChange` (§8, #27), a `'pack'` post and a paid pack included | `tests/lib/email-change-policy.test.ts` |

`tests/regressions/docs-pricing-system-matches-code.test.ts` checks this document against the code: the links and paths it gives, the status map, the response shape and the schema blocks it prints, and this table against the suites on disk.

Still missing: nothing runs against a real database or Stripe test mode. The Serializable transactions, the conditional writes (the `'pending'` claim, the pack credit's decrement and its revocation, the admin's pack changes), the migration's credit CHECK and lock timeout, and Stripe's own behaviour are asserted against mocks (or, for the migration, the SQL text) only, and the Playwright journeys stop at the checkout gate and never pay. In particular, two posts racing for a pack's last credit, and post-free's rollback of a credit spent for a post whose writes failed, are proven against a fake transaction client (it commits only when the callback resolves) and not against Postgres: a real concurrency test needs a throwaway database. Both wait for a non-production database (docs/PENDING_WORK.md 1.8).

---

## 11. Future-state items (intentionally deferred)

| ID | Item | When to revisit |
|---|---|---|
| #14 | Stripe Product / Price catalog (proper Price IDs) instead of ad-hoc `unit_amount` | When adding Stripe Tax or coupons |
| Plan table removal | The Employer plan was retired on 2026-10-24 and its dormant code deleted on 2026-10-27 (phase 4: §2e). Left: the deprecated EmployerPlan model, the `employer_plans` table and its RLS, which nothing reads or writes. Drop them only in a separate, deliberate migration, after a read-only check that the table is still empty (`select count(*) from employer_plans;`) | Only on an owner decision; never in a pricing release |
| 5-post pack | One-time, $1,245 for 5 posts ($249 a post), used within 12 months, credits on the buying account (register D36 to D42). Replaces the plan. Built on 2026-10-25: the backend (Phase 2) and its pages, copy, emails, GA events and back office (Phase 3, §2h); the sale opens on its own at `config.promoEndsAt` once paid posting is live. Left: a paid test purchase in Stripe test mode before the switch, which waits for a non-production database (docs/PENDING_WORK.md 1.8) | Before 2027-01-01 |
| Promo switch purge | The pages that switch at the promo end regenerate stale-while-revalidate, so each can serve its cached promo render to one more request after its window (§1d). A cron that calls `revalidatePath` on its first run after `config.promoEndsAt` (`revalidatePublicPaths` in app/api/admin/_lib/public-revalidation.ts) for every path in `PROMO_SWITCH_PATHS` with each template page, plus `/`, `/testimonials` and `/post-job`, would make the next request to each render the ladder | Before 2027-01-01 |
| Promo end-of-life | Retire `'promo'` writes after 2027-01-01 and remove the promo branches (the wizard's, the promo halves of lib/pricing-copy.ts and the §3a builders, the outreach `freeOffer` template). A page taken out of `PROMO_SWITCH_PATHS` then needs a `PAGE_CONTENT_DATES` entry no earlier than the switch, or its sitemap lastmod falls back to its older copy date | 60 days after the promo ends (last promo posts have expired) |
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
   promo                  pack                       intro / paid
     ↓                      ↓                          ↓
POST /api/jobs/post-free  POST /api/jobs/post-free   POST /api/create-checkout (tier = getNextPaidTier)
  promo cap check           spendPackCredit in txn     Stripe Checkout (unit_amount = priceCentsForTier)
  paymentStatus='promo'     paymentStatus='pack'         ↓ pay
  isPublished=true          isPublished=true           webhook → JobCharge, paymentStatus='paid', pricingTier=tier
     ↓                      ↓                          ↓
/success?mode=promo       200 { mode:'pack', pack }  /success?session_id=… → verify-checkout-session
```

### Renew a job
```
employer dashboard "Renew" button
  ↓
promo / pack / paid → modal: the post's own price ($199, or $249 for a post bought at $349; a pack post $199)
                      → /api/create-renewal-checkout (unit_amount = config.renewalPriceCentsFor(renewalRung))
                      → Stripe → webhook (type='renewal')
                        expiresAt = MAX(existing, now) + 60d · JobCharge = what Stripe charged · email with that amount
legacy plan post?   → "Plan slot" badge, no Renew (409: the plan is retired; post the role again)
legacy free post?   → popup: "can't renew, post new" → /post-job
```

### Buy a 5-post pack

Built 2026-10-25; the sale is closed until `config.promoEndsAt`, and until then the pages state the pack dated and offer no way to buy it (§2h).

```
/pricing pack card · dashboard usage card → /employer/post-pack (Buy, while isPackSaleOpen)
  ↓ GA begin_checkout (1245, 'pack')
POST /api/create-pack-checkout → (earlier open pack sessions expired) → Stripe Checkout ($1,245 =
  config.stripePackPriceInCents, metadata.type='post_pack', the payment intent tagged 'post_pack')
  ↓ pay → /employer/post-pack?session_id=… → /api/verify-pack-session → "Your 5-post pack is ready"
webhook checkout.session.completed → fulfilPostPackCheckout → the payment read first → EmployerPostPack
  (5 credits, 12 months from the session; refunded or frozen when the charge already is)
  → purchase email · GA purchase (post-pack-5), a paid pack only    (also run by /api/verify-pack-session and the daily sweep)
  ↓ each post
POST /api/jobs/post-free → spendPackCredit in txn → paymentStatus='pack', pricingTier='pack', postPackId
  ↓ full refund / dispute          (before the pack is recorded: 500, Stripe retries until it is)
unused credits revoked / frozen, standing pack posts taken down    (a won dispute, or a closed inquiry, puts them back)
  ↓ by hand (a partial refund, a support case)
/admin/post-packs → PATCH /api/admin/post-packs/:id: revoke · extend · restore, audit logged
```

### Employer plan

Retired 2026-10-24 (owner decision); its code was deleted on 2026-10-27, so no plan flow is left to draw. What remains is the guard in §2e:

```
a plan Payment Link left active in Stripe → Stripe subscription checkout
  ↓ checkout.session.completed / async_payment_succeeded (mode=subscription)
webhook → alert "Employer plan retired: refund it in Stripe" → 200 { received: true, plan: 'retired' }, nothing granted
  ↓ invoice.paid of that subscription, at its first charge and at every renewal
webhook → the same alert → 200, nothing written
  → a human refunds the payment, cancels the subscription and deactivates the link
```

---

## Appendix: glossary

| Term | Meaning in this codebase |
|---|---|
| **Active posting** | `Job.isPublished=true AND (expiresAt IS NULL OR expiresAt > now)` AND linked via EmployerJob to a userId |
| **Posting mode** | What the employer's NEXT post will be: `'promo' \| 'pack' \| 'intro' \| 'paid'` (`PostingMode` in lib/config.ts, resolved in that order by lib/pricing.ts; the plan mode went on 2026-10-25) |
| **quotaDomain** | Immutable per-row snapshot of the signup email's domain at posting time. Anchor for the intro allowance and the promo cap. |
| **Intro allowance** | The domain has zero `paymentStatus='paid'` rows that were bought as a post (a `'new'` JobCharge, or none at all for a pre-ledger row) and no paid 5-post pack bought through Stripe → next paid post is `'intro'` at $249. |
| **Pack credit** | One post a 5-post pack pays for. Usable while the pack is `'paid'`, `expiresAt > now` and `creditsRemaining > 0`, by the buying account only; spent by a conditional decrement inside post-free's transaction; revoked for good (`creditsRevoked`) on a full refund, a lost dispute or an admin's revoke; one spent on a post an admin can give back (/admin/post-packs). |
| **Renewal rung** | Which renewal price a post pays (lib/renewal-price.ts): `'pro'` ($249) only for `pricingTier='pro'` with a `'new'` JobCharge, `'base'` ($199) for every other renewable row, a pack post included. |
| **hasFullAccess** | Per-candidate gate: `isAdmin OR existingView OR hasActiveFeaturedPost(employerId)`. Lifetime once granted. |
| **hasActivePosting** | Employer-level gate: at least one currently-active posting exists. State, not plan. |
| **`paymentStatus`** | `'promo'` / `'pack'` / `'pending'` / `'paid'` / `'refunded'` / `'disputed'` / `'expired'` / legacy `'free'`, `'free_renewed'`, `'free_upgraded'`, `'plan'` (the retired Employer plan; never written again). Drives invoice eligibility, renewal eligibility, the intro allowance and the promo cap. |
| **`pricingTier`** | `'intro' \| 'pro' \| 'pack'` — the ladder rung a row was sold at. Promo and legacy rows carry `'pro'`, a legacy plan row `'plan'` (no longer a rung); a pack post keeps `'pack'`, renewed or not. |
| **JobCharge** | One row per per-post Stripe checkout (new or renewal). Source of truth for invoices, and the `'new'` row is what sets a post's renewal rung. The retired plan was billed outside it, by Stripe Billing. |
| **ProcessedStripeEvent** | Idempotency log with a two-phase claim (§4c). Insert-then-process; UNIQUE violation = already-handled, unless the earlier delivery died mid-flight and its claim has gone stale. |
