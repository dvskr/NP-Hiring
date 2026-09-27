# Pending Work

> The single list of everything still open, checked against the code on 2026-09-27 (main at `4212caf`;
> everything shipped is live). Shipped work is at the end.
>
> **Who acts:** **OWNER** only you can do it. **DECISION** you decide, then Claude implements.
> **CLAUDE** engineering that needs no decision from you.

## Dates that matter

| When | What happens | What must be done by then |
|---|---|---|
| About 2026-11-06 | Quarterly re-check of the /compare claims is due (dated 2026-08-06) | CLAUDE, section 6 |
| About 2026-11-11 | Quarterly NLC roster and scope-of-practice review is due (last 2026-08-11) | CLAUDE, section 6 |
| About 2026-11-21 | First expiry warning emails for promo posts (sent 5 days before a 60-day post ends) | Only if the $179 renewal should be on sale by then: Stripe live and paid posting on (1.1, 1.2). Otherwise the email offers a free repost, which is fine |
| Before 2027-01-01 10:00 UTC | The promo ends (midnight Hawaii time, `config.promoEndsAt`) and the paid ladder starts on its own | Stripe live (1.1), paid posting on (1.2), ladder copy shipped (2.1), pricing decisions made (3.1) |
| About 2027-03-01 | Promo posts made on 2026-12-31 reach their 60 days | CLAUDE may retire the promo code paths (`docs/pricing-system.md` section 11) |
| 2030-07-01 | New York's NP Modernization Act sunset date | Re-check New York before then (section 6) |

## 1. Owner setup (OWNER)

**1.1 Stripe live mode.** Activate the account and set the statement descriptor. Create the $399 per month
Price (lookup key `np_hiring_employer_plan_monthly`, metadata `sku=employer-plan`), the subscription Payment
Link, the live webhook with all 11 events, and the Customer Portal settings. Set failed-payment retries to
cancel the subscription.
- Why: nothing can be sold without it. Hard deadline 2027-01-01, or about 2026-11-21 if renewals should sell for the first expiry warnings.
- Where: Stripe Dashboard, live mode. Step list with exact values: `docs/LAUNCH_RUNBOOK.md` section 8a.

**1.2 Vercel Production env for paid posting.** Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PLAN_PAYMENT_LINK`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `ENABLE_PAID_POSTING=true` and
`NEXT_PUBLIC_BASE_URL=https://nphiring.com`. Keep `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`,
`DISCORD_WEBHOOK_URL` and `SENTRY_DSN` set.
- Why: without the flag and the key, checkout answers 503. Turning the flag on during the promo only opens renewals; new posts stay free and plan sales stay closed. After 2027-01-01, no test-mode key and no `https://buy.stripe.com/test_` link may stay in Production.
- Where: Vercel, then redeploy. Table: `docs/LAUNCH_RUNBOOK.md` section 8b.

**1.3 Google Analytics.** Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` and redeploy with the build cache off.
Optional: `GA_API_SECRET` (plus `GA_MEASUREMENT_ID` if it differs) for server-side purchase events.
- Why: the site has never had analytics. The id is baked in at build time, so an env change alone does nothing.
- Where: Vercel.

**1.4 Search Console and Google indexing.** Add the indexing service account as an Owner of the property,
submit `https://nphiring.com/api/sitemaps/index` and `https://nphiring.com/sitemap.xml` by hand, then set
`GOOGLE_INDEXING_CREDENTIALS`. Optional: `GSC_SERVICE_ACCOUNT_KEY` plus `GSC_SITE_URL` for the health check cron.
- Why: gets new jobs indexed and expired jobs removed; the code blockers are shipped. Nothing in the repo submits a sitemap (`lib/gsc-client.ts` only reads). Aggregated job expiries ran about 27 a day over the last 14 days, with peaks of 61 and 65, against the 60 a day expired-job lane; a peak carries over and the de-index cursor sends the oldest first. The key also arms the historical de-index cron, so read its note in `.env.example` first.
- Where: Search Console, then Vercel. Owner runbook: https://claude.ai/artifact/ABK3nw8P3AWsucYpPwddG6

**1.5 Bing and IndexNow.** Set `BING_WEBMASTER_VERIFICATION` (the meta tag; `app/layout.tsx` reads it, so
redeploy) and `INDEXNOW_KEY` (one key is enough; `INDEXNOW_API_KEY` is only the fallback name in
`lib/indexnow.ts`). Optional: `BING_WEBMASTER_API_KEY`.
- Why: Bing sees nothing today, with no verification tag and no IndexNow key.
- Where: Bing Webmaster Tools, then Vercel.

**1.6 Hero art for 12 categories.** urgent-care, emergency, neonatal, women-health, oncology, cardiology,
dermatology, orthopedic, aesthetics, pain-management, anesthesia, midwifery. Each is a watercolor NP scene on
a flat pastel ground or an isometric clay diorama, with no text, badges, logos, credentials or psychiatric
iconography. For aesthetics: no close-up needles and no before-and-after.
- Why: these category pages still show the old sage art.
- Where: the list lives in the header of `lib/pseo/category-asset-registry.ts`.

**1.7 Re-render undersized art.** The 13 images in `PENDING_RERENDER` (contact and terms heroes, 3 employer
bentos, 3 job-seeker bentos and the CTA card, 4 job-seeker scenes at 400x300) and the 6 salary-guide factor
icons (location, experience, setting, employment, specialty, negotiate in `public/images/salary-guide/`; the
sources are 96px, and they need at least 144px, ideally 1024px). The script rebuilds their 48 to 96px size
files. Optional, from the August wishlist: per-benefit and explore-card icon sets, homepage hero art, an
/about employer scene.
- Why: they render soft on high-density screens.
- Where: drop files over the same names, then run `node scripts/regen-image-ladders.mjs`.

**1.8 A non-production database** (a Supabase branch or a second project).
- Why: the only database is production, so Playwright journeys that write data can never run safely, and `npm run dev` and `npm run build` both run `prisma migrate deploy` against whatever `.env` names.
- Where: Supabase, then a `.env.test` copied from `.env.test.example` (see `tests/e2e/README.md`).

**1.9 Named NP reviewer.** A real, credentialed NP who agrees to review content.
- Why: turns "Reviewed by the editorial team" into a named byline with Person schema on every post.
- Where: `config/brand.ts`, `editorial.reviewer` (now `null`).

**1.10 Stripe Tax (B113).** Decide registrations, head office address and product tax code, then enable it.
- Why: checkout collects tax IDs but calculates no tax (`automatic_tax` is not set).
- Where: Stripe Dashboard; then CLAUDE wires it into checkout.

**1.11 Supabase point-in-time recovery plus one restore drill (B111).**
- Why: production is the only copy of the data.
- Where: Supabase Dashboard.

## 2. Engineering (CLAUDE)

**2.1 Ladder copy before 2027-01-01.** /pricing, /for-employers and /faq print "Free through December 31, 2026"
as fixed text from `config.promoEndsLabel`. None of them checks `config.isPromoActive()`, so they keep
serving promo copy after the promo ends, however often they revalidate. 30 other files use the label, including the terms,
the emails, `lib/compare-data.ts` and `lib/employer-comparison.ts`. Ship switched copy (or a date-driven
switch) and deploy it before the date.

**2.2 Two pages still need blog rows.** `blog_posts` has 0 rows. /blog, post pages, related posts and the
sitemap serve the 19 `content/blog/*.mdx` posts and the 51 license guides from code, so nothing 404s and no
sync is needed there. Two pages read the table directly and show nothing: /resources (article grid, "Articles"
count, "Before you apply" band) and /for-programs (program guide card). Point `app/resources/page.tsx` and
`app/for-programs/page.tsx` at `lib/blog.ts`, and delete the stale "sync or 404" note in
`config/niche/content-map.ts`. `scripts/sync-blog-to-db.ts` then becomes optional.

**2.3 Repair garbled city slugs.** `PseoStats` and the snippet tables still hold slugs such as
`la-caada-flintridge-ca`, and those pages sit out of the sitemap. `scripts/repair-city-slug-diacritics-db.ts`
(run `--check` first) writes to production, so it needs your OK.

**2.4 Same-second subscription events.** Two Stripe subscription events stamped in the same second apply in
arrival order, because the guard in `app/api/webhooks/stripe/plan-subscription.ts` only drops strictly older
events. The daily reconciliation corrects it; re-reading the subscription on each event would close it.

**2.5 Two paid renewals for one post.** The renewal idempotency key rolls every 10 minutes and older open
sessions are not expired, so two renewal checkouts can both be paid (`app/api/create-renewal-checkout/route.ts`).

**2.6 One client-safe renewal-offer rule.** `components/employer/EmployerDashboardClient.tsx` and
`app/jobs/edit/[token]/page.tsx` copy the `lib/pricing.ts` rule because that file imports Prisma. Move the pure
rule into a client-safe module.

**2.7 Unit test for the archive route.** `app/api/employer/jobs/[jobId]/archive/route.ts` has only a static
source check.

**2.8 Stripe SDK and a restricted key.** Upgrade `stripe` from ^20 to ^22 and retest the webhook suites. List
the exact API permissions the code uses, so you can create a restricted live key instead of the full secret key.

**2.9 Worktree housekeeping.** `.worktrees/copy` (content/professional-english, merged) belongs to a peer
session; remove it when that session ends. The main checkout (`C:\Users\sathish.kumar\np-hiring`) is on
`design/sticker-cards` at main's commit; switch it to `main` once `.worktrees/main` is removed. Use the safe
junction removal steps.

**2.10 Small leftovers.** /scope-of-practice has no header or footer link (optional). The
`app/api/og/city/route.tsx` doc comment carries a `$120K-$165K` example pinned by an exception in
`tests/regressions/p2-data-accuracy-stats-and-guides.test.ts`; remove both together. Three files still say
the NLC member set is wrong and must not be used, although it was fixed and verified on 2026-08-11:
`components/tools/MultiStatePlanner.tsx`, `app/tools/licensure-checker/page.tsx` and
`app/resources/fpa-guide/page.tsx`. Update the comments; those pages may now use the verified set
(`lib/metro-data.ts` already does).

## 3. Decisions (DECISION)

Reply with the id (for example "D2: keep Hawaii") and Claude implements it.

### 3.1 Pricing and billing (before plans go on sale on 2027-01-01)

| # | Question | Today | Where |
|---|---|---|---|
| D1 | Plan posts: 60 days each, or live for the whole subscription? | 60 days each, then the slot frees; code and copy agree. Your original wording ("for the whole subscription") needs a code change | `lib/config.ts`, `lib/employer-plan.ts` |
| D2 | Promo end instant | 2027-01-01 10:00 UTC (midnight Hawaii), so "free through December 31" holds in every US zone. Alternative: midnight Eastern with "11:59 pm ET" printed | `lib/config.ts` |
| D3 | Intro price taken more than once | A company can open several $199 checkouts before its first paid post and pay each. `detectIntroDoubleCharge` tells staff to "refund the difference", the wrong direction: the company paid $100 less, not more. Block a second open intro checkout per domain, or accept it? The alert wording gets fixed either way | `app/api/webhooks/stripe/activate-paid-job.ts` |
| D4 | Plan money edge cases | A refund or chargeback on a plan payment is only logged; the plan stays active. A plan bought while plan sales are closed is granted, with a "refund required" alert. A full refund of a renewal takes the whole post down, even inside its original free window. Plan purchases send no GA purchase event. Which should change? | `app/api/webhooks/stripe/route.ts`, `app/api/webhooks/stripe/plan-checkout.ts` |

### 3.2 Moderation and takedowns

| # | Question | Today | Where |
|---|---|---|---|
| D5 | After enough reports take a job down, may the employer put it back up? | 3 distinct reports unpublish a job (only `isPublished` changes). The employer can republish it from the dashboard, because the republish route checks payment status, not why the post came down. A reported plan post also comes back at the next plan renewal. Setting `isManuallyUnpublished` would stop that revival (and pin reported aggregator jobs against ingest renewal) but would not stop the employer's own republish; that needs the takedown marker in D6 | `app/api/jobs/report/route.ts` |
| D6 | Admin takedown vs employer pause | Both write the same fields, so an employer can unpause a post an admin took down. Telling them apart needs a schema change, for example an `unpublishedBy` column | `app/api/admin/jobs/_lib/job-input.ts` |
| D7 | Should republishing a paused promo post count against the promo cap? | It does not re-check `config.promoMaxActivePostsPerDomain` (10 live promo posts per domain) | `app/api/employer/jobs/[jobId]/toggle-publish/route.ts` |

### 3.3 Data and growth calls

| # | Question | Today | Where |
|---|---|---|---|
| D8 | Turn on semantic search? | `ai.search.semantic` is off; UI, endpoint and eval suites exist. Run the evals, review the cost, then decide | `lib/ai/feature-flags.ts` |
| D9 | Classify companies (direct employer or staffing) | All 168 are unclassified. Badges and the /jobs filter appear as you classify; start with the largest job counts | `/admin/companies` |

### 3.4 Copy approvals

| # | Question | Today | Where |
|---|---|---|---|
| D10 | Stripe line-item names | Checkout and renewal item names and descriptions contain an em dash and spaced hyphens. Waiting on your approval of new wording | `app/api/create-checkout/route.ts`, `app/api/create-renewal-checkout/route.ts` |
| D11 | Renewal wording | While renewals cannot be bought the dashboard says "Renewal is not available yet": keep "yet"? The edit page names savings against the $299 post price, which overstates it for a company whose next post is the $199 intro. After the promo, if paid posting is still off, renewal offers are withheld and no free repost is offered | `components/employer/EmployerDashboardClient.tsx`, `app/jobs/edit/[token]/page.tsx` |

### 3.5 Audit-era items (enterprise audit)

- **B93** Make the AI quality gates (`.github/workflows/ai-gates.yml`) a required check, or leave them advisory.
- **B40** `GscSnapshot` coverage columns: Search Console has no API for that data. Drop them or fill them from a manual export.
- **B74** Broadcast `scheduledFor` is stored and shown in /admin/email, but nothing sends at that time. Wire it or remove it.
- **B22** Where the employer CSV export lives (applicants tab and analytics today).
- **B1** Each new InMail thread uses one of the posting's 25 InMails and replies are free. Change only if you meant per candidate.
- B113 (Stripe Tax) and B111 (point-in-time recovery) are owner setup, 1.10 and 1.11.

### 3.6 Product bets (decided, revisit only on the trigger)

- **Employer reviews:** don't, until employer volume is real, with takedown terms and a named moderator.
- **Schools directory:** blocked on a licensed or hand-verified accredited-program dataset (4.2).
- **Preceptor marketplace:** don't. At most a self-declared checkbox on /post-job once employer posts are material.
- **Full city-slug rename:** don't now; ride along at the next `cities.ts` regeneration.

### 3.7 Deferred taxonomy verticals (recorded 2026-08-11)

Eight NP verticals from the 2026-07 content-gap synthesis section 7 were deferred: endocrinology/diabetes,
sleep-medicine, utilization-review, informatics, education-faculty, wound-care, iv-infusion,
functional-medicine. The synthesis was never committed; this entry is its in-repo record.

Rationale: **add after checking live inventory coverage.** A new slug launches with zero rows carrying it
in `Job.categoryTags`, so a vertical without real inventory ships as a permanently noindexed empty shell.
Check live job counts for each vertical's keywords first. Adding one is a full tier build, and the drift
tests fail until every side agrees:

1. **Registry:** the slug in `CATEGORY_AXES` in `lib/pseo/taxonomy-registry.ts` (plus
   `STATE_ELIGIBLE_CATEGORY_SLUGS` and a `SETTING_CONFIGS` entry in `lib/pseo/setting-state-config.ts`
   if promoted to the state tier).
2. **Folders:** `app/jobs/<slug>/` with `page.tsx` and `city/[slug]/` (and `[state]/` if state
   eligible); `tests/seo/jobs-segments-drift.test.ts` enforces registry and folder parity.
3. **Tagger:** rules in `lib/pseo/category-tagger.ts`, then the deploy step
   `npx tsx scripts/backfill-category-tags.ts --force --apply`.
4. **Art:** an entry in `lib/pseo/category-asset-registry.ts`.
5. **FAQ:** content in `lib/pseo/category-faq-data.ts` (or a documented null).

## 4. Data procurement (OWNER)

| # | Dataset | Unblocks |
|---|---|---|
| 4.1 | HRSA "Designated HPSA, Primary Care" quarterly file, keyed by city and state | All-NP shortage signals on pSEO pages (today only behavioral-health HPSA). Spec in `lib/pseo/city-data/types.ts` |
| 4.2 | Accredited NP program dataset (CCNE and ACEN status with an as-of date) | The schools directory, only if 3.6 changes. Needs re-verification every quarter |
| 4.3 | CEU course inventory from provider partnerships or licensed feeds | A CEU directory. Never scrape and assert credit values |

## 5. Business investments (OWNER)

- **Association partnerships:** a business development motion; the free `/for-programs` widget is the opening.
- **Career fairs and virtual events:** an operations business, not a feature.
- **Native mobile app:** measure PWA and web push engagement first.
- **Community salary survey:** wait until the alert and newsletter base supports honest per-specialty samples.
- **Walkthrough videos:** `lib/video-seo.ts` stays empty until real videos are recorded.

## 6. Recurring maintenance

| Cadence | Who | What | Where |
|---|---|---|---|
| Weekly | OWNER | Approval queues: testimonials and company claims (0 pending today). Public surfaces show nothing until you approve | `/admin/testimonials`, `/admin/company-claims` |
| Weekly, once plans sell | OWNER | Plan purchases that matched no account; link them by hand | `/admin/employer-plans` |
| Quarterly | CLAUDE | Re-verify the NLC roster against NCSBN; bump `NLC_ROSTER_VERIFIED_AT` (2026-08-11) | `lib/blog-license-guides.ts` |
| Quarterly | CLAUDE | Re-verify practice authority and scope of practice against AANP and each state's source; bump `SOP_LAST_REVIEWED` (2026-08-11), and `LICENSE_GUIDE_REVIEWED_AT` (2026-09-25) when the guides change. Every licensing statement must match that state's `details` string. New York's NP Modernization Act is a sunset provision, now running to 2030-07-01. `STAT_SOURCES.fullPracticeStates` records the AANP map vintage (`asOf`); bump it when AANP revises the map | `lib/state-practice-authority.ts`, `components/ScopeOfPracticeData.ts`, `lib/stats-sources.ts` |
| Quarterly, or on a competitor change | CLAUDE | Re-verify /compare claims; bump `COMPARE_REVIEW_DATE` (2026-08-06) | `lib/compare-data.ts` |
| On each BLS OEWS release | CLAUDE | Refresh the salary vintage (drift tests enforce consumers) | `lib/stats-sources.ts` |
| Annual | CLAUDE | Issue the next data report edition | `lib/reports/editions.ts` |
| On a real content review | CLAUDE | Bump per-surface `LAST_REVIEWED` literals; never automate them to render time | salary guide, resource guides |

## Closed since the last version (2026-08-16)

- E2E runtime fixes: committed in `ba4cf67`; that was the top deploy action.
- Prisma migrations: applied, most recently on 2026-09-27.
- OG cache purge: no longer needed. The OG cards last changed on 2026-07-30 and the CDN keeps them 30 days.
- HomepageHero niche-copy ratchet: baseline entry added in `tests/regressions/niche-copy-debt-baseline.json`.
- Company claim step and the /companies "Claimed by employer" badge: shipped.
- Lint debt: `npx eslint` reports 0 errors (checked 2026-09-27).
- "Sync blog posts to prod DB": replaced by 2.2; the code now serves authored posts without rows.

## Shipped since 2026-08-16

- `4252d28` pSEO restyle and the thin-content repair of every programmatic page.
- `dc7308f`, `287ba7c` GA4 tag correctness and indexing safety (Google indexing takes job URLs only).
- `d2fbffe`, `1790c1d` Practice-authority dataset corrected for 26 jurisdictions; templates no longer infer rules from the AANP tier.
- `d588dfd` Metro guides on verified data, one-time expired-job de-indexing, DC location parsing.
- `4212caf` Employer pricing: free launch promo through 2026-12-31, then $199 intro, $299 per post or the $399 per month Employer plan; Stripe hardening and release fixes (migrations applied 2026-09-27).
