# Pending Work

> The single list of everything still open, checked against the code on 2026-10-02 (this release, on top of
> main at `96f035e`; everything earlier is live). Shipped work is at the end.
>
> **Who acts:** **OWNER** only you can do it. **DECISION** you decide, then Claude implements.
> **CLAUDE** engineering that needs no decision from you.

## Dates that matter

| When | What happens | What must be done by then |
|---|---|---|
| Now | The Google indexing service account key was pasted into a chat | OWNER rotates it, 1.4 |
| 2026-10-01 to about 2026-10-29 | Google and Bing make their first passes over the submitted sitemap | OWNER watches Search Console weekly (1.4); submit nothing else |
| About 2026-10-29 | Four weeks after the sitemap submission | DECISION D12: re-admit the specialty and setting by state pages if indexing looks healthy |
| About 2026-11-06 | Quarterly re-check of the /compare claims is due (dated 2026-08-06) | CLAUDE, section 6 |
| About 2026-11-11 | Quarterly NLC roster and scope-of-practice review is due (last 2026-08-11) | CLAUDE, section 6 |
| About 2026-11-21 | First expiry warning emails for promo posts (sent 5 days before a 60-day post ends) | Only if the $179 renewal should be on sale by then: Stripe live and paid posting on (1.1, 1.2). Otherwise the email offers a free repost, which is fine |
| Before 2027-01-01 10:00 UTC | The promo ends (midnight Hawaii time, `config.promoEndsAt`) and the paid ladder starts on its own. With no deploy, the pricing copy switches: emails at send time, the employer app on its next render, and each page when its cached render is replaced. A page re-renders at most once an hour (the homepage once a minute), and the first request after that window is still answered with the old render while it triggers the new one, so a page shows the promo once more to its first visitor after the switch, however late that visit comes. /terms does not switch (2.15) | Stripe live (1.1), paid posting on (1.2), pricing decisions made (3.1) |
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
- Why: without the flag and the key, checkout answers 503. Turning the flag on during the promo only opens renewals; new posts stay free and plan sales stay closed. Set the key and the webhook secret before the flag, or in the same deploy: after the promo, the flag and the Payment Link alone open plan sales, and a plan bought then is recorded only once the key and the secret are set (2.16). After 2027-01-01, no test-mode key and no `https://buy.stripe.com/test_` link may stay in Production.
- Where: Vercel, then redeploy. Table: `docs/LAUNCH_RUNBOOK.md` section 8b.

**1.3 Google Analytics.** Done 2026-09-28 (`G-PT7KQ9ZEXQ`, 14 month retention). Optional: `GA_API_SECRET`
(plus `GA_MEASUREMENT_ID` if it differs) for server-side purchase events once paid posting is on.

**1.4 Search Console follow-through.** The sitemap index is submitted (Success), the Indexing API and the
Search Console API are on, and the health check passes. Three things are left:
1. **Rotate the service account key now.** Its JSON was pasted into a chat. In Google Cloud, IAM, Service
   accounts, `nphiring-indexing@np-hiring.iam.gserviceaccount.com`, Keys: delete the key whose id starts
   `87bf15c7`, create a new JSON key, paste it into `GOOGLE_INDEXING_CREDENTIALS` in Vercel (and into
   `GSC_SERVICE_ACCOUNT_KEY` if you used the same key there), then redeploy.
2. If not done yet, Request indexing (URL Inspection) on the 10 hub URLs, about 10 a day, and paste the
   same list into Bing's URL Submission: home, /jobs, /jobs/remote, /jobs/state/california,
   /jobs/state/texas, /salary-guide, /scope-of-practice, /companies, /tools and /blog.
3. Once a week for four weeks, read Pages, Job postings and Sitemaps. Submit nothing else: never
   `/sitemap.xml` on its own, never the image sitemap.
- Why: the key is a credential that can submit URLs as nphiring.com; the first month decides how Google rates the site.
- Where: Google Cloud console, Search Console, Vercel.

**1.5 Bing.** Done 2026-10-01: verified (imported from Search Console), `INDEXNOW_KEY` set, the key file is
served, and IndexNow accepted all 165 URLs of the first run. Optional: `BING_WEBMASTER_API_KEY` for the
Webmaster API channel (IndexNow already reaches Bing).

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

**1.12 Indexing data repairs (indexing readiness audit).** Run on 2026-10-01 with your approval, each as a
dry run first and then with `--apply` in one transaction:
1. `scripts/indexing-fixes/backfill-content-changed-at.ts`: nothing to do; the migration filled every row.
2. The job row fixes, listed in the order of `RUN_ORDER` in `scripts/indexing-fixes/lib/runtime.ts` (the
   location and pay fix was applied first):
   unpublish-misrepresented-jobs (none left once the location and pay fix had run), unpublish-non-us-jobs (4),
   hold-stub-description-jobs (1), backfill-job-locations (31 rows changed: 19 given a place, 12 a corrected work
   mode; 32 could not be placed and were left alone; its pass for rows that store a state but no town found none
   left), correct-location-and-pay (73), collapse-duplicate-jobs (none; the 32 look-alike groups are
   different postings), rederive-job-type (145) and retag-category-tags (375), then the aggregate-pseo refresh.
3. **Still open:** `scripts/backfill-remote-flags.ts` was not previewed in this pass. Run it as a dry run (or ask Claude
   to), then `--apply`, then `--check` (exit 0 when clean). Until then, /jobs/remote can list a job whose own
   page does not call it Remote; the daily job-posting-integrity cron reports those rows. Once `--check`
   passes, CLAUDE moves `scripts/indexing-fixes/sql/work-mode-check-constraints.sql` into `prisma/migrations`.
4. `scripts/indexing-fixes/populate-company-website-logo.ts` filled 23 companies. **Still open:** fill the
   other 72 by hand on /admin/companies.
- Why: the code fixes stop new bad rows; these repair the rows already stored.
- Where: a terminal on a trusted machine. The repo `.env` is the production database.

## 2. Engineering (CLAUDE)

**2.3 Repair garbled city slugs.** `PseoStats` and the snippet tables still hold slugs such as
`la-caada-flintridge-ca`, and those pages sit out of the sitemap. `scripts/repair-city-slug-diacritics-db.ts`
(run `--check` first) writes to production, so it needs your OK.

**2.8 Stripe SDK upgrade and the restricted key list.** Upgrade `stripe` from ^20 to ^22 and rerun the webhook
suites. It needs `npm install` in the main checkout, whose `node_modules` every worktree shares, so it waits for
2.9. The other half of the old item is open too: the permission list for a restricted live key is not written yet
(`docs/pricing-system.md` has no such section). It belongs there as section 9b, beside the production Stripe
checklist, and has to cover every Stripe call in the code:
Checkout Sessions create, retrieve (with `payment_intent` expanded), list and expire; Subscriptions retrieve
and list; Invoices retrieve; Customer Portal sessions create. `webhooks.constructEvent` needs no permission, as
it verifies the signature locally. Until the list is written, the live key in 1.2 has to be the standard secret key.

**2.9 Worktree housekeeping.** `.worktrees/copy` (merged) belongs to a peer session; remove it when that
session ends. `.worktrees/soften` is merged. `.worktrees/indexing` holds this release (branch
`fix/engineering-backlog`) and is merged once the release lands. `.worktrees/main` is behind `origin/main`. The
main checkout (`C:\Users\sathish.kumar\np-hiring`) is on `design/sticker-cards` with one uncommitted change
nobody has claimed: find its owner before switching it to `main`. Use the safe junction removal steps.

**2.11 Guest Easy Apply: closed.** Closed (owner decision 2026-09): applying requires an NP Hiring account
for external and Easy Apply jobs alike; guest Easy Apply will not be built; JobPosting directApply stays false.

**2.13 Work-mode check constraints.** Once the remote-flags repair passes `--check` (1.12), move
`scripts/indexing-fixes/sql/work-mode-check-constraints.sql` into `prisma/migrations`.

**2.14 Colorado license guide.** Colorado publishes no initial APRN fee, so its guide stays noindexed. At each
quarterly review (section 6), re-check the board and fill `initialFee` in `lib/license-guide-facts.ts` once a
fee is published.

**2.15 /terms after the promo.** /terms is static and keeps its dated "Launch promotion (through December 31,
2026)" section after the promo ends. It stays true, but in the first deploy after 2027-01-01, move that section
to the past tense and update "Last updated".

**2.16 Plan sales do not check the Stripe key.** `isPlanSaleOpen` (`lib/employer-plan-link.ts`) reads
`ENABLE_PAID_POSTING`, the Payment Link and the promo clock, never `STRIPE_SECRET_KEY`. So with the flag on
after the promo and a valid `https://buy.stripe.com/` link, the /pricing plan card and
`/api/employer/plan/subscribe` send a buyer to Stripe while `POST /api/webhooks/stripe` still answers 503
without `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`: the subscription is paid and no `EmployerPlan` row
records it, and the daily plan reconciliation cannot recover it either, since it needs the key too. Make
`isPlanSaleOpen` require the key and the webhook secret as well, so the sale closes while the money path
cannot record it. Until then the deploy order in 1.2 is the only guard, and `docs/pricing-system.md` section
1d states the gap.

**2.17 Dashes in email subjects and previews.** Ten strings in `lib/email-service.ts` still join their two
halves with an em dash on the one line a recipient reads in the inbox list: the job-alert welcome subject, the
post-is-live confirmation, the refund notice, the plan-payment-failure preview, the new-message, new-application,
application-received and application-status subjects, the employer report subject and the saved-jobs reminder.
The house style bans the character, so each needs a colon, a comma or two sentences instead. Separate from D10,
which waits on your wording for the Stripe line items; these need no decision.

## 3. Decisions (DECISION)

Reply with the id (for example "D2: keep Hawaii") and Claude implements it.

### 3.1 Pricing and billing (before plans go on sale on 2027-01-01)

| # | Question | Today | Where |
|---|---|---|---|
| D1 | Plan posts: 60 days each, or live for the whole subscription? | 60 days each, then the slot frees; code and copy agree. Your original wording ("for the whole subscription") needs a code change | `lib/config.ts`, `lib/employer-plan.ts` |
| D2 | Promo end instant | 2027-01-01 10:00 UTC (midnight Hawaii), so "free through December 31" holds in every US zone. Alternative: midnight Eastern with "11:59 pm ET" printed | `lib/config.ts` |
| D3 | Intro price taken more than once | A company can open several $199 checkouts before its first paid post and pay each. `detectIntroDoubleCharge` tells staff to "refund the difference", the wrong direction: the company paid $100 less, not more. Block a second open intro checkout per domain, or accept it? The alert wording gets fixed either way | `app/api/webhooks/stripe/activate-paid-job.ts` |
| D4 | Plan money edge cases | A refund or chargeback on a plan payment is only logged; the plan stays active. A plan bought while plan sales are closed is granted, with a "refund required" alert. A full refund of a renewal takes the whole post down, even inside its original free window. Plan purchases send no GA purchase event. Which should change? | `app/api/webhooks/stripe/route.ts`, `app/api/webhooks/stripe/plan-checkout.ts` |
| D13 | A post archived while its checkout was open, then paid | The payment is recorded and the post stays archived. It goes live only once the employer restores it and then republishes it: the archive route clears `archivedAt` and leaves `isPublished` false ("Republish it to make it visible again"), and the republish route answers 409 for an archived post until it is restored. Stripe's receipt goes out, but no NP Hiring confirmation, because both confirmation emails say the listing is live. Add an archived variant ("Payment received. Restore the post from the Archived tab, then republish it to put it live")? | `lib/email-service.ts`, `app/api/employer/jobs/[jobId]/archive/route.ts`, `app/api/webhooks/stripe/apply-renewal.ts`, `activate-paid-job.ts` |
| D15 | Should archiving a paid post pause its 60-day listing window? | It does not. `expiresAt` is stamped when the post is created (`expiresFromNow(config.durationDays)`), and again only if an abandoned checkout is resumed; neither the archive route nor the later republish writes it, so the days it spends archived count against it and the post can expire while it sits in the Archived tab. Only a renewal extends it (`renewalExpiresAt`). Pausing the clock means writing a fresh `expiresAt` on restore | `app/api/employer/jobs/[jobId]/archive/route.ts`, `app/api/employer/jobs/[jobId]/toggle-publish/route.ts`, `lib/expires-at.ts` |

### 3.2 Moderation and takedowns

| # | Question | Today | Where |
|---|---|---|---|
| D5 | After enough reports take a job down, may the employer put it back up? | 3 distinct reports unpublish a job (only `isPublished` changes). The employer can republish it from the dashboard, because the republish route checks payment status, not why the post came down. A reported plan post also comes back at the next plan renewal. Setting `isManuallyUnpublished` would stop that revival (and pin reported aggregator jobs against ingest renewal) but would not stop the employer's own republish; that needs the takedown marker in D6 | `app/api/jobs/report/route.ts` |
| D6 | Admin takedown vs employer pause | Both write the same fields, so an employer can unpause a post an admin took down. Telling them apart needs a schema change, for example an `unpublishedBy` column | `app/api/admin/jobs/_lib/job-input.ts` |
| D7 | Should republishing a paused promo post count against the promo cap? | It does not re-check `config.promoMaxActivePostsPerDomain` (10 live promo posts per domain) | `app/api/employer/jobs/[jobId]/toggle-publish/route.ts` |
| D16 | Should a new account inherit the unclaimed posts filed under its sign-in email? | It does. One rule, `employerJobOwnershipBranches`, decides what the dashboard lists: the rows this user claimed (`userId` is their Supabase id) plus the unclaimed ones (`userId` null) whose `contactEmail` equals the sign-in email. A row another account already claimed stays off the page even on the same contact email (P5.A). So whoever signs up with the address a pre-account post was filed under gets that post, its applicant counts and its edit token, with no separate claim step. Keep it (it is how pre-account posters reach their posts), or require a claim you approve, as company claims already work? | `lib/employer-ownership.ts`, `app/employer/dashboard/page.tsx` |

### 3.3 Data and growth calls

| # | Question | Today | Where |
|---|---|---|---|
| D8 | Turn on semantic search? | `ai.search.semantic` is off; UI, endpoint and eval suites exist. Run the evals, review the cost, then decide | `lib/ai/feature-flags.ts` |
| D9 | Classify companies (direct employer or staffing) | All 168 are unclassified. Badges and the /jobs filter appear as you classify; start with the largest job counts | `/admin/companies` |
| D12 | Re-admit the specialty and setting by state pages (`/jobs/{specialty}/{state}`, for example /jobs/telehealth/texas) about 2026-10-29? | They are out of the sitemap and noindexed (`SETTING_STATE_INDEXING_ENABLED` is false); 10 pass the strict content gate today. Say go once Search Console shows the first month indexing cleanly ("Crawled, currently not indexed" low), and Claude flips the switch for those 10 only | `lib/pseo/render-gate.ts`, `lib/gsc-coverage.ts` |
| D14 | Per-state compact verdicts in the multi-state planner and licensure checker? | The NLC member set is verified (2026-08-11) and the metro guides use it, but these two tools state the compact rules and link NCSBN instead of printing "member" or "not a member" per state. A verdict there is personal licensing advice, only as current as the last roster check. Recommended: keep it this way; lifting it needs a fixed re-check cadence and the check date beside every verdict | `components/tools/MultiStatePlanner.tsx`, `app/tools/licensure-checker/page.tsx` |

### 3.4 Copy approvals

| # | Question | Today | Where |
|---|---|---|---|
| D10 | Stripe line-item names | Checkout and renewal item names and descriptions contain an em dash and spaced hyphens. Waiting on your approval of new wording | `app/api/create-checkout/route.ts`, `app/api/create-renewal-checkout/route.ts` |
| D11 | Renewal wording | While renewals cannot be bought the dashboard says "Renewal is not available yet": keep "yet"? The edit page names savings against the $299 post price, which overstates it for a company whose next post is the $199 intro. After the promo, if paid posting is still off, renewal offers are withheld and no free repost is offered | `components/employer/EmployerDashboardClient.tsx`, `app/jobs/edit/[token]/page.tsx` |
| D17 | The post-promo pricing copy you have not read yet | Both pricing surfaces switch themselves at `config.promoEndsAt` with no deploy (2.1), to wording written here, not approved by you. /pricing then runs the eyebrow "Per post or by the month" over the heading "Three ways to post", carries a new FAQ "Do all prices include the same features?" and ends its browser title with "Posts From $199". /for-employers stamps its receipt card "No bidding, no contracts" and labels its bento "Flat Per-Post Pricing · From $199". Approve it, or send replacement wording before 2027-01-01 | `app/pricing/pricing-page-copy.ts`, `app/for-employers/for-employers-copy.ts` |
| D18 | The /resources card for the salary guide | Its description now reads "Interactive calculator by state, experience, setting, and specialty, with the BLS national median and state medians from live postings." It names no edition year and claims no completeness, because the figures refresh daily and a state below the publishing gate prints none. Approve that line, or name an edition instead | `app/resources/page.tsx` |
| D19 | What a post that costs nothing is told at the till | House rule: never print $0. So the preview shows the price as "Free" and captions a plan post "Included in your Employer plan.", and /post-job/checkout shows "Free" over the caption "no payment needed" whenever the server quote says this post needs no payment, whether that is the promo or a plan slot. Approve both captions, or word them differently | `app/post-job/preview/page.tsx`, `app/post-job/checkout/page.tsx` |

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
| Weekly, through 2026-10-29 | OWNER | Search Console: Pages, Job postings, Sitemaps (1.4) | Search Console |
| Weekly, once plans sell | OWNER | Plan purchases that matched no account; link them by hand | `/admin/employer-plans` |
| Quarterly | CLAUDE | Re-verify the NLC roster against NCSBN; bump `NLC_ROSTER_VERIFIED_AT` (2026-08-11) | `lib/blog-license-guides.ts` |
| Quarterly | CLAUDE | Re-verify practice authority and scope of practice against AANP and each state's source; bump `SOP_LAST_REVIEWED` (2026-08-11), and `LICENSE_GUIDE_REVIEWED_AT` (2026-09-25) when the guides change. Every licensing statement must match that state's `details` string. New York's NP Modernization Act is a sunset provision, now running to 2030-07-01. `STAT_SOURCES.fullPracticeStates` records the AANP map vintage (`asOf`); bump it when AANP revises the map | `lib/state-practice-authority.ts`, `components/ScopeOfPracticeData.ts`, `lib/stats-sources.ts` |
| Quarterly, or on a competitor change | CLAUDE | Re-verify /compare claims; bump `COMPARE_REVIEW_DATE` (2026-08-06) | `lib/compare-data.ts` |
| On each BLS OEWS release | CLAUDE | Refresh the salary vintage (drift tests enforce consumers) | `lib/stats-sources.ts` |
| Annual | CLAUDE | Issue the next data report edition | `lib/reports/editions.ts` |
| On a real content review | CLAUDE | Bump per-surface `LAST_REVIEWED` literals; never automate them to render time | salary guide, resource guides |

## Closed since the last version (2026-09-27)

- 1.3 Google Analytics: live since 2026-09-28.
- 1.4 Search Console and Google indexing: sitemap index submitted 2026-10-01, Indexing API and Search Console API on, service account is an Owner, health check passes (key rotation and the first month's watch remain, 1.4).
- 1.5 Bing and IndexNow: verified, key file served (`96f035e`), first run accepted 165 of 165.
- 1.12 Indexing data repairs: applied 2026-10-01 (counts in 1.12); remote flags and 72 company records remain.
- 2.1 Ladder copy: every pricing surface switches at `config.promoEndsAt` with no deploy (this release).
- 2.2, 2.4 to 2.7, 2.10: done in this release (see Shipped).
- 2.11 Guest Easy Apply: closed by your decision; applying requires an account.
- 2.12 Job rows that stored a state but no town: the planner shipped as `planStateOnlyTownBackfill` in `scripts/indexing-fixes/lib/planners.ts`, `scripts/indexing-fixes/backfill-job-locations.ts` runs it in every pass, and the 2026-10-01 pass found no such row left.
- Prisma migrations: applied, most recently `20260928000000_job_content_changed_at` on 2026-09-30.

## Shipped since 2026-08-16

- `4252d28` pSEO restyle and the thin-content repair of every programmatic page.
- `dc7308f`, `287ba7c` GA4 tag correctness and indexing safety (Google indexing takes job URLs only).
- `d2fbffe`, `1790c1d` Practice-authority dataset corrected for 26 jurisdictions; templates no longer infer rules from the AANP tier.
- `d588dfd` Metro guides on verified data, one-time expired-job de-indexing, DC location parsing.
- `4212caf` Employer pricing: free launch promo through 2026-12-31, then $199 intro, $299 per post or the $399 per month Employer plan; Stripe hardening and release fixes (migrations applied 2026-09-27).
- `8c023e4` Unsourced generalizations softened; this register rebuilt.
- `b393f53`, `f984ba2` Indexing readiness release: honest sitemap lastmod (`jobs.content_changed_at`), cited license guide facts for 51 jurisdictions (50 indexable), apply requires an account, the blush header, and every readiness audit finding.
- `96f035e` IndexNow key file.
- This release: pricing copy that switches itself when the promo ends (2.1), /resources and /for-programs served from code (2.2), Stripe subscription events applied from the live subscription (2.4), one payable renewal session per post (2.5), one client-safe renewal-offer rule (2.6), archive route tests (2.7), small leftovers (2.10).
