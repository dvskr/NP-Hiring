# Pending Work

> The single list of everything still open, checked against the code on 2026-10-26 (after the auth hotfix
> `e78f037`, the security and register batch `8d32e1e` of 2026-10-20, the sweep follow-ups `a8f1d4b`, the alert
> salary rule `4a445ce` and the Stripe SDK upgrade `85116c1` of 2026-10-22, the content follow-ups of
> 2026-10-23, the edit token hotfix `3574809` and its follow-ups `862b8af` of 2026-10-24, the CI fixes and the
> 2027 re-price `8ac1d66` of 2026-10-25, and the 5-post pack `08f2e33` of 2026-10-26; all are live, and `main`
> is the only branch). Shipped work is at the end.
>
> **Who acts:** **OWNER** only you can do it. **DECISION** you decide, then Claude implements.
> **CLAUDE** engineering that needs no decision from you.

## Dates that matter

| When | What happens | What must be done by then |
|---|---|---|
| 2026-10-01 to about 2026-10-29 | Google and Bing make their first passes over the submitted sitemap | OWNER watches Search Console weekly (1.4); submit nothing else |
| Since about 2026-10-21 | The Department of Education's decision on the NP residency consortium's recognition was due (90 days after the July advisory committee meeting). The committee's recommendation is in the fellowship post; the decision letter is in a system that refuses automated requests | Open it in a browser, then CLAUDE states the outcome in the fellowship post (2.24) |
| About 2026-10-29 | Four weeks after the sitemap submission | DECISION D12: re-admit the specialty and setting by state pages if indexing looks healthy. Claude's advice from the 2026-10-25 exports (1.4): wait, Google passed on 178 crawled pages and had not fetched 586 more |
| 2026-10-30 | ANCC's new FNP test content outline takes effect | CLAUDE rewords the three posts that say it is about to change (2.24) |
| 2026-10-30 | Plaintiffs' reply in the Massachusetts student loan case | CLAUDE re-checks that docket, whether the government's 2026-10-16 motion is also a cross motion for summary judgment, and Federal Student Aid for an announcement carrying out the Oregon injunction (2.24) |
| 2026-11-06 | Government cross motions in AANP v. McMahon; the Department's reply closes briefing in the Maryland case | CLAUDE updates the student loan post's case table and confirms the states' 2026-10-16 reply (2.24) |
| 2026-11-13 and 2026-11-20 | The government's reply closes the Massachusetts briefing; plaintiffs' reply in AANP v. McMahon | CLAUDE (2.24) |
| 2026-12-04 | The government's reply closes briefing in AANP v. McMahon; a ruling on the merits may follow and would end or replace the stay | CLAUDE re-checks the stay and GENERAL-26-42 (2.24) |
| Early 2026-11 | The next monthly jobs report | CLAUDE refreshes the job outlook post (2.24) |
| About 2026-11-06 | Quarterly re-check of the /compare claims is due (dated 2026-08-06) | CLAUDE, section 6 |
| About 2026-11-11 | Quarterly NLC roster and scope-of-practice review is due (last 2026-08-11) | CLAUDE, section 6 |
| After 2026-11-14 | NP Week 2026 is over | CLAUDE refreshes or redirects the NP Week post (2.24) |
| About 2026-11-21 | First expiry warning emails for promo posts (sent 5 days before a 60-day post ends) | Only if the $199 renewal should be on sale by then: Stripe live and paid posting on (1.1, 1.2), with the 2027 re-price shipped first (code that predates it would sell the renewal at the old price). Otherwise the email offers a free repost, which is fine |
| Before 2027-01-01 10:00 UTC | The promo ends (midnight Hawaii time, `config.promoEndsAt`) and the paid ladder starts on its own. With no deploy, the pricing copy switches: emails at send time, the employer app on its next render, and each page when its cached render is replaced. A page re-renders at most once an hour (the homepage once a minute), and the first request after that window is still answered with the old render while it triggers the new one, so a page shows the promo once more to its first visitor after the switch, however late that visit comes. /terms does not switch (2.15) | Stripe live (1.1), paid posting on (1.2), pricing decisions made (3.1) |
| 2026-12-31 | The DEA telemedicine flexibilities for prescribing controlled substances expire unless the special registration rule is published first | CLAUDE re-checks the prescribing post, the remote guide and the telehealth FAQ on the remote, telehealth and psychiatric hubs (2.24) |
| About 2027-03-01 | Promo posts made on 2026-12-31 reach their 60 days | CLAUDE may retire the promo code paths (`docs/pricing-system.md` section 11) |
| 2030-07-01 | New York's NP Modernization Act sunset date | Re-check New York before then (section 6) |

## 1. Owner setup (OWNER)

**1.1 Stripe live mode.** Activate the account and set the statement descriptor, then create the live
webhook with all 11 events. There is no Price, Payment Link or Customer Portal to create, and no failed-payment
retry setting to change: you retired the Employer plan on 2026-10-24, and every post and renewal checkout
prices itself from `lib/config.ts`.
- Why: nothing can be sold without it. Hard deadline 2027-01-01, or about 2026-11-21 if renewals should sell for the first expiry warnings.
- Where: Stripe Dashboard, live mode. Step list with exact values: `docs/LAUNCH_RUNBOOK.md` section 8a.

**1.2 Vercel Production env for paid posting.** Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `ENABLE_PAID_POSTING=true` and `NEXT_PUBLIC_BASE_URL=https://nphiring.com`.
`STRIPE_PLAN_PAYMENT_LINK` is not set: the plan is retired, and while the variable is unset no plan can be
sold (`npm run fork:preflight` warns about it; ignore that). Keep `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`,
`DISCORD_WEBHOOK_URL` and `SENTRY_DSN` set.
- Why: without the flag and the key, checkout answers 503. Turning the flag on during the promo only opens renewals; new posts stay free. Set the key and the webhook secret before the flag, or in the same deploy: the webhook answers 503 to every Stripe event until both are set. After 2027-01-01, no test-mode key may stay in Production.
- Where: Vercel, then redeploy. Table: `docs/LAUNCH_RUNBOOK.md` section 8b. A restricted live key can stand in for the secret key; its permissions are in `docs/pricing-system.md` section 9b.

**1.3 Google Analytics.** Done 2026-09-28 (`G-PT7KQ9ZEXQ`, 14 month retention). Optional: `GA_API_SECRET`
(plus `GA_MEASUREMENT_ID` if it differs) for server-side purchase events once paid posting is on.

**1.4 Search Console follow-through.** The sitemap index is submitted (Success), the Indexing API and the
Search Console API are on, and the health check passes. Left:
1. If not done yet, Request indexing (URL Inspection) on the 10 hub URLs: home, /jobs, /jobs/remote,
   /jobs/state/california, /jobs/state/texas, /salary-guide, /scope-of-practice, /companies, /tools and /blog.
   All ten answered 200, `index, follow` and a self canonical on 2026-10-24. Bing gets them through IndexNow.
2. Once a week, read Pages, Job postings and Sitemaps, and send Claude the three drilldown exports (Crawled,
   Discovered, Not found) when the chart moves. Submit nothing else: never `/sitemap.xml` on its own, never
   the image sitemap.
3. The service account key whose JSON was pasted into a chat (id starting `87bf15c7`): you chose on
   2026-10-23 to leave it. It can still submit URLs as nphiring.com. To rotate it later: Google Cloud, IAM,
   Service accounts, `nphiring-indexing@np-hiring.iam.gserviceaccount.com`, Keys: delete that key, create a new
   JSON key, paste it into `GOOGLE_INDEXING_CREDENTIALS` in Vercel (and `GSC_SERVICE_ACCOUNT_KEY` if it is the
   same key), then redeploy.
- What the 2026-10-25 exports showed (data to 2026-10-16): 524 pages indexed, 1,160 not. Not found 308, all
  expired jobs (now 410) or retired listing pages, none in the sitemap. Discovered but never fetched 586,
  among them /jobs, /companies, /blog, 23 state hubs and 340 live jobs. Crawled but not indexed 178: 126 job
  pages, 17 posts (13 state license guides), 12 company pages. Job postings: 9 valid, 0 errors, although the
  Indexing API accepted every job URL sent since 2026-10-07. The limit is crawl attention for a young site;
  the levers are links from other sites and more unique content (2.32).
- Where: Search Console, Bing Webmaster Tools.

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
   to: its read-only `--check` on 2026-10-24 was blocked by auto mode, so approve that run or turn auto mode
   off), then `--apply`, then `--check` (exit 0 when clean). Until then, /jobs/remote can list a job whose own
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

**2.24 Dated posts to re-check.** The ten posts published on 2026-10-13 carry claims that expire. Each was
re-checked against its sources that day; the dates table at the top lists the next ones.
- `np-student-loan-limits-professional-degree`: re-checked against every docket on 2026-10-17 (its review date).
  The Oregon court's 2026-10-16 opinion was read from GovInfo on 2026-10-20 and the post now states it: a
  preliminary injunction that makes the Department treat the N.D. degree as a professional degree for the
  plaintiff groups and their members, with no stay pending appeal; it changes nothing for NP programs. Next: the
  dates in the table at the top. The AFL-CIO briefing ends about 2027-01-08 (from a law firm summary; the
  court's scheduling order could not be read). A ruling in Oregon, Maryland or Massachusetts can come at any
  time. The review date stays the docket check day, not the ship day, because the post's own test ties every
  "As of" date to it (`tests/regressions/student-loan-post-docket-recheck.test.ts`).
- `np-fellowship-residency-programs`: re-checked on 2026-10-22. The advisory committee's report of its July
  2026 meeting (the NACIQI archive) records a 12 to 0 vote recommending five more years of recognition and a
  monitoring report within 12 months, and the post now states it (its review date is that check day). The senior Department official's
  decision letter, due about 2026-10-21, is posted in the Department's e-Recognition system, which refuses
  automated requests, as does the consortium's own site, so a person has to open them in a browser; then
  state the outcome with its date. The same post's UC Davis line ("reaccreditation due in 2026") should be
  re-read against the consortium's August 2026 notice of accreditation actions, on that site.
- `how-to-become-a-nurse-practitioner`, `fnp-certification-aanp-vs-ancc` and `fnp-vs-pmhnp-vs-agacnp`: reword
  "about to change" once the ANCC outline is in force.
- `nurse-practitioner-job-outlook`: refresh after each monthly jobs report it cites.
- `nurse-practitioner-week-2026`: refresh or redirect after the week ends.
- `can-nurse-practitioners-prescribe-controlled-substances`, `remote-telehealth-np-jobs-guide` and
  `TELEHEALTH_RULES_FAQ` in `lib/pseo/category-faq-data.ts`: the DEA flexibilities and the special registration
  rule, which has been under White House review since 2026-08-25.
- `nurse-practitioner-noncompete-laws`: one reviewer read the Colorado row ("with a limited exception for some
  minority owners") as looser than the session law, which keeps sale of business covenants and caps their length
  for some minority owners. Confirm against the statute, then tighten the cell. The Maine statute page also
  flags a second version of subsection 5 that takes effect on 2027-01-01.

**2.25 Smaller follow-ups from the content release.** Three shipped on 2026-10-23 (see Closed). Left:
- A blog post has no "content changed" stamp apart from `reviewed`. A post served from its `.mdx` file
  (`lib/blog-mdx-posts.ts`) is dated in the sitemap by `reviewed`; a post synced into `blog_posts` is dated by
  that row's `updated_at`, which Prisma stamps on every write of `scripts/sync-blog-to-db.ts` (a production
  write you run). BlogPosting.dateModified reads `reviewed` first either way, so a refreshed post can keep an
  earlier date than its copy. Under-claiming is the safe side; a frontmatter stamp read by both paths, and a
  sync run, would fix it.
- /resources/1099-vs-w2, /resources/fpa-guide and /resources/private-practice-guide print "Last Updated" from
  review dates older than the copy the plain copy pass changed. They are review dates, so they stay until the
  guides are reviewed again (section 6).

**2.26 Follow-ups from the 2026-10 security sweep.** All but one shipped on 2026-10-22 (see Closed). Left:
`lib/compare-data.ts` says Indeed's licensure guidance was not found (2026-08-06), while the job seeker table
marks it limited; settle it at the quarterly /compare review (section 6). The avatar check found nothing to clean (2026-10-24, 1.14 under Closed).

**2.27 The 2027 re-price build.** Phase 1 (the new ladder, both renewal prices, and the Employer plan taken off
every page) is live since 2026-10-25 (8ac1d66). Phases 2 and 3 shipped together on 2026-10-26: the 5-post
pack's backend (00282e6), its pages and copy (1d3e18b: `/employer/post-pack`, the /pricing card, the dashboard
card, Settings, Billing, the wizard captions, the emails, the GA events and the admin page `/admin/post-packs`,
with all sales final on /terms and in every refund answer, D38), and the code and security review fixes
(e0e9d4e). The deploy applied migration `20261025000000_add_employer_post_packs`; the eight pages carry
2026-10-26 in `PAGE_CONTENT_DATES`. The pack sells only once the ladder starts (2027-01-01) and paid posting
is on. Left:
- phase 4: delete the dormant plan code (docs/pricing-system.md §11) once there is still no plan row. Read
  only: `select count(*) from employer_plans;` and `select count(*) from employer_jobs where payment_status =
  'plan';` should both answer 0 (both did on 2026-10-24).
- known gaps the reviews left open: no real-Postgres concurrency test (no non-production database, 1.8); if the
  verify page or the sweep wins a post's claim and then fails the ledger write, nothing backfills it unless
  Stripe is still retrying; the pack checkout return page names "ready" for a pack recorded refunded or
  disputed before fulfilment (the pack list below it is right).

**2.29 Security follow-ups from the 2026-10-24 sweep.** The sweep that followed the edit token hotfix
(`3574809`, `862b8af`) read all 91 routes that parse a request body and found no other critical or high hole.
Left, all low:
- An edit token never expires for editing or unpublishing (`app/api/jobs/update/route.ts`), while the edit
  page (`app/api/jobs/edit/[token]/route.ts`) allows 30 days.
- The paid checkout (`app/api/create-checkout/route.ts`) stores benefits, setting and population without the
  validators the free post uses (`app/api/jobs/post-free/_lib/job-attributes.ts`), and both store the logo
  address without `sanitizeUrl`.
- A new post deletes any saved draft filed under the same client supplied contact email
  (`app/api/jobs/post-free/route.ts`), even another employer's.
- A lint rule (no unsafe assignment or member access) would flag every `const body: T = await
  request.json()`, the pattern behind the edit token hole.

**2.30 Monitoring that reports the wrong thing.** CI is green again since 2026-10-25 (Closed). Left:
- The daily Search Console snapshot (`gsc_snapshots`, written by the gsc-health-check cron) has saved all
  zeros since at least 2026-10-15, so its "indexing dropped" alert can never fire. Find why (credentials, the
  property, or no coverage API: B40) and either read real data or stop writing zero rows.
- The daily indexing cron (`app/api/cron/index-urls/route.ts`) reports every Bing Webmaster submission as
  failed while `BING_WEBMASTER_API_KEY` is unset (1.5); it should say skipped. IndexNow already reaches Bing.

**2.32 Grow what Google will index.** Today the sitemaps list about 1,000 URLs (781 jobs, 213 others) by
design: a listing page needs 5 jobs from 3 employers, a company page 5 live jobs, and the specialty by state
pages wait on D12. Waiting on your go:
- More jobs: every live job is a page, and they fill city, specialty and company pages until those pass the
  listing floor on their own. Find the NP employers and job sources the ingest misses.
- Make job pages say what the employer's own posting does not (state practice authority, licensure, pay
  context): Google passed on 126 job pages.
- Make the state license guides more distinct: 13 of them sit in "Crawled, currently not indexed".

## 3. Decisions (DECISION)

Reply with the id (for example "D2: keep Hawaii") and Claude implements it.

### 3.1 Pricing and billing (before the paid ladder starts on 2027-01-01)

| # | Question | Today | Where |
|---|---|---|---|
| D2 | Promo end instant | 2027-01-01 10:00 UTC (midnight Hawaii), so "free through December 31" holds in every US zone. Alternative: midnight Eastern with "11:59 pm ET" printed | `lib/config.ts` |
| D3 | Intro price taken more than once | A company can open several $249 checkouts before its first paid post and pay each. `detectIntroDoubleCharge` tells staff to "refund the difference", the wrong direction: the company paid $100 less, not more. Block a second open intro checkout per domain, or accept it? The alert wording gets fixed either way | `app/api/webhooks/stripe/activate-paid-job.ts` |
| D4 | A full refund of a renewal on a post that cost nothing to post | It takes the whole post down, even inside its original free window: the rule for a promo post, and for a pack post since the 5-post pack was built. Keep it, or keep such a post up until its original end date? (The plan money cases this row used to list ended with the plan.) | `app/api/webhooks/stripe/route.ts` |
| D13 | A post archived while its checkout was open, then paid | The payment is recorded and the post stays archived. It goes live only once the employer restores it and then republishes it: the archive route clears `archivedAt` and leaves `isPublished` false ("Republish it to make it visible again"), and the republish route answers 409 for an archived post until it is restored. Stripe's receipt goes out, but no NP Hiring confirmation, because both confirmation emails say the listing is live. Add an archived variant ("Payment received. Restore the post from the Archived tab, then republish it to put it live")? | `lib/email-service.ts`, `app/api/employer/jobs/[jobId]/archive/route.ts`, `app/api/webhooks/stripe/apply-renewal.ts`, `activate-paid-job.ts` |
| D15 | Should archiving a paid post pause its 60-day listing window? | It does not. `expiresAt` is stamped when the post is created (`expiresFromNow(config.durationDays)`), and again only if an abandoned checkout is resumed; neither the archive route nor the later republish writes it, so the days it spends archived count against it and the post can expire while it sits in the Archived tab. Only a renewal extends it (`renewalExpiresAt`). Pausing the clock means writing a fresh `expiresAt` on restore | `app/api/employer/jobs/[jobId]/archive/route.ts`, `app/api/employer/jobs/[jobId]/toggle-publish/route.ts`, `lib/expires-at.ts` |

### 3.1b The 2027 re-price (recorded 2026-10-24)

You decided the 2027 re-price on 2026-10-24: $249 for a company's first paid post and $349 for every later
post; renewals at $199, or $249 for a post bought at $349; the Employer plan retired; and a one-time 5-post
pack at $1,245 in its place. The rows below record the pack decision, the defaults set the same day for the
questions it left open, and your decision of 2026-10-25 that all sales are final (D38). Reply with an id to
change any of them.

| # | Question | Recorded 2026-10-24 | Where |
|---|---|---|---|
| D36 | A one-time 5-post pack, or a monthly subscription? | Decided by the owner on 2026-10-24: a one-time pack, 5 posts for $1,245 ($249 a post), used within 12 months of purchase. It replaces the Employer plan, and a paid pack uses up the company's intro price. Built on 2026-10-25: the backend (phase 2) and its pages, copy, emails and admin page (phase 3, item 2.27). It goes on sale on its own when the ladder starts, once paid posting is live | the pack phases |
| D37 | Pack posts for the buying account only, or for anyone at the company domain? | Default set 2026-10-24, the owner may change it: the buying account only, as the plan was. A colleague at the same domain pays $349 a post | the pack phases |
| D38 | What a refund of a pack does | Decided by the owner on 2026-10-25: all sales are final ("all post are non refundable"). Posts, renewals and packs are not refunded, unused pack posts included; /terms §8 keeps only two exceptions, a refund the law requires and a billing error such as a charge made twice for the same post, and every refund answer on /pricing, /faq and /for-employers says the same. A refund you still issue by hand in Stripe, or a chargeback, is honoured by the code: a full refund or a dispute revokes the pack's unused posts and takes its live posts down (a won dispute puts them back); a partial refund changes nothing on its own and alerts staff, and the posts it paid back can be revoked by hand in /admin/post-packs | `app/terms/page.tsx`, `app/api/webhooks/stripe/post-pack-refunds.ts` |
| D39 | The renewal price of the legacy `free_renewed` and `free_upgraded` posts | Default set 2026-10-24, the owner may change it: $199, the price of every renewal except one of a post bought at $349 | `lib/renewal-price.ts` |
| D40 | May the pack copy name a saving? | Default set 2026-10-24, the owner may change it: copy never says "save $500" (a first-time buyer's single posts would cost $1,645, not $1,745, and the pack also uses up the intro price). It says "5 posts for $1,245, $249 a post" and, where a comparison helps, "Bought one at a time at $349, five posts cost $1,745." | the pack phases |
| D41 | A reminder email before unused pack posts expire? | Default set 2026-10-24, the owner may change it: no reminder email. Unused posts lapse 12 months after purchase, and the dashboard shows the date | the pack phases |
| D42 | Tell the employers with live promo posts that a renewal now costs $199? The welcome emails since 2026-09-12 quoted $179 | Default set 2026-10-24, the owner may change it: no notice. Renewals have never been on sale, so nobody was charged the old price | none |

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
| D10 | Stripe line-item names | Only the new-post checkout's item name and description still contain an em dash and spaced hyphens; the renewal items already read "Job renewal: (title)" and "(employer), 60 more days". Proposed for the new post: "Intro job post: (title)" or "Pro job post: (title)", described "(employer), (location), 60-day Featured listing". The 5-post pack's checkout already uses the wording proposed for it: "5-post pack", described "5 job posts, each a 60-day Featured listing, to use within 12 months". Approve both, or send other wording | `app/api/create-checkout/route.ts`, `app/api/create-pack-checkout/route.ts` |
| D11 | Renewal wording | While renewals cannot be bought the dashboard says "Renewal is not available yet": keep "yet"? The edit page names the saving against the $349 post price, which overstates it for a company whose next post is the $249 intro: a $199 renewal saves 20% against that, not 42%, and a $249 renewal saves nothing (the dashboard knows the next post price and gets it right). After the promo, if paid posting is still off, renewal offers are withheld and no free repost is offered | `components/employer/EmployerDashboardClient.tsx`, `app/jobs/edit/[token]/page.tsx` |
| D17 | The post-promo pricing copy you have not read yet | Both pricing surfaces switch themselves at `config.promoEndsAt` with no deploy (2.1), to wording written here, not approved by you. /pricing then runs the eyebrow "Per post" over the heading "What a post costs" (plain per-post wording since the plan was retired; they read "Per post or by the month" and "Three ways to post" while it was on sale), carries a new FAQ "Do all prices include the same features?" and ends its browser title with "Posts From $249". /for-employers stamps its receipt card "No bidding, no contracts" and labels its bento "Flat Per-Post Pricing · From $249". Approve it, or send replacement wording before 2027-01-01 | `app/pricing/pricing-page-copy.ts`, `app/for-employers/for-employers-copy.ts` |
| D18 | The /resources card for the salary guide | Its description now reads "Interactive calculator by state, experience, setting, and specialty, with the BLS national median and state medians from live postings." It names no edition year and claims no completeness, because the figures refresh daily and a state below the publishing gate prints none. Approve that line, or name an edition instead | `app/resources/page.tsx` |
| D19 | What a post that costs nothing is told at the till | House rule: never print $0. So the preview shows the price as "Free", and /post-job/checkout shows "Free" over the caption "no payment needed" whenever the server quote says this post needs no payment. A post from the 5-post pack is captioned "Included in your post pack." on both pages, as proposed (built in phase 3); the plan caption went with the plan's posting mode. Approve both captions, or word them differently | `app/post-job/preview/page.tsx`, `app/post-job/checkout/page.tsx` |

### 3.4b Left from the 2026-10-12 text cleanup

| # | Question | Today | Where |
|---|---|---|---|
| D20 | Two alert buttons on every landing page | Specialty, setting, state and metro pages show a hero "Set Alert" button and a sidebar "Create Alert" card. Keep both, or one? | `lib/pseo/category-landing-template.tsx`, the landing pages |
| D21 | Repeated benefit cards on 15 landing pages | The bento grids repeat themselves (hospital "Acute Inpatient Care" and "Acute Care", part-time "Work-Life Balance" twice). Removing them means re-laying out each grid | `app/jobs/<category>/page.tsx` |
| D22 | Newsletter cadence | The blog sidebar says "delivered weekly", the exit popup checkbox says "monthly". Which is true? | `components/blog/**`, `components/ExitIntentPopup.tsx` |
| D23 | Marketing blocks kept for your call | Employer dashboard "Hiring Tips" card, the /job-alerts "Why Set Up Alerts?" card, and the /for-programs "How It Works" steps (they describe emailing us although the page has a self-serve builder) | `components/employer/EmployerDashboardClient.tsx`, `app/job-alerts/page.tsx`, `app/for-programs/page.tsx` |
| D24 | The family NP credential letters | The content release session reported that AANPCB's handbook writes the credential as NP-C, while the posts and the tests write FNP-C. Not re-checked on 2026-10-13. Which form should the site print? | the certification posts in `content/blog`, `lib/pseo/category-faq-data.ts` |

### 3.4c Left from the 2026-10 security sweep

| # | Question | Today | Where |
|---|---|---|---|
| D26 | Anonymous job alert signups (sweep JA-2) | POST /api/job-alerts takes no session. For an address that unsubscribed it lifts the suppression, and for an existing alert it turns a paused alert back on and rewrites its frequency, for whoever typed the address. The exit popup promises re-enabling on repeat. Recommended: do either only for a signed-in owner of the address, or after a click on an emailed confirmation link | `app/api/job-alerts/route.ts`, `components/ExitIntentPopup.tsx` |
| D27 | Employers created from sign-up metadata skip the free email block | The block exists only in POST /api/auth/profile and the sign-up form; an employer created in the email confirmation flow or by Google sign-in never meets it. Should such an account become a job seeker, an employer pending review, or be refused? | `lib/auth/ensure-profile.ts`, `app/auth/callback/route.ts` |
| D28 | A signed-out newsletter signup turns a settings opt-out back on | Opt-out and the status check now need a matching session, but the public opt-in still flips a stored opt-out for any address. Double opt-in, or never flip a stored opt-out without a session? | `app/api/newsletter/route.ts` |
| D29 | What deletion and restore do to pool visibility | A restore sets both visibility switches on, Clear All turns them back on, and Google sign-in never restores a deleted account (only the password form does), so such a session stays signed in with the account deleted. Keep the person's earlier choice, and restore on any sign-in? | `app/api/auth/restore-account/route.ts`, `app/api/profile/clear/route.ts`, `app/auth/callback/route.ts` |
| D30 | The license states filter for employers without a posting | An alert or a candidate search filtered to a state tells an employer with no live post that every listed candidate holds that license, although the cards hide license states from them. Ignore the filter for them? | `app/api/employer/candidates/route.ts`, `app/api/cron/candidate-alerts/route.ts` |
| D31 | What the inbox shows | Once a thread exists the inbox shows a pool candidate's full last name (the pool masks it), and a thread whose other side deleted the account stays listed with their profile fields until the purge; only replies are refused | `app/api/conversations/route.ts`, `app/api/conversations/[id]/route.ts` |
| D32 | Moving files when a profile is relinked | A profile relinked to a new sign-in keeps resume, avatar and application files under the old account id, which the new ownership checks refuse: the person sees no resume and must upload again. Move the files and rewrite the keys, or clear them? | `lib/auth/ensure-profile.ts` |
| D33 | Naming and token follow-ups | The FNP guide's title and tags keep "AANP vs ANCC" as a search phrase; the candidate settings list stores "AANP" as a certifying body (`config/niche/credentials.ts`); existing alert and unsubscribe tokens are cuid values. Rename, keep, rotate? | `content/blog/fnp-certification-aanp-vs-ancc.mdx`, `config/niche/credentials.ts` |
| D34 | Newsletter consent that someone else can give | Since 2026-10-22 a new account joins the Beehiiv newsletter only when it opted in, but the email sign-up form and the exit popup tick the box for the person. US law allows that; a privacy reader, or a European visitor's law, counts a pre-ticked box as no choice. The opt-in is also whatever the sign-up form sent, so a stranger who signs up someone else's address opts it in once its owner clicks the confirmation link, and the anonymous newsletter and alert forms subscribe any typed address. Start both boxes unchecked, and send a Beehiiv double opt-in? | `components/auth/SignUpForm.tsx`, `components/ExitIntentPopup.tsx`, `app/api/newsletter/route.ts` |
| D35 | What deleting a resume does to the applications sent with it | An application stores the key of the resume it was sent with, which is usually the profile resume itself. Deleting the resume removes that file even when an application names it, so the employer's resume link for that application stops working; since 2026-10-22 older files an application names are kept. Keep the file while an application names it, or remove every copy on delete? | `app/api/profile/resume/route.ts`, `app/api/applications/apply-direct/route.ts` |

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
| Quarterly | CLAUDE | Re-verify the NLC roster against NCSBN; bump `NLC_ROSTER_VERIFIED_AT` (2026-08-11) | `lib/blog-license-guides.ts` |
| Quarterly | CLAUDE | Re-verify practice authority and scope of practice against AANP and each state's source; bump `SOP_LAST_REVIEWED` (2026-08-11), and `LICENSE_GUIDE_REVIEWED_AT` (2026-09-25) when the guides change. Every licensing statement must match that state's `details` string. New York's NP Modernization Act is a sunset provision, now running to 2030-07-01. `STAT_SOURCES.fullPracticeStates` records the AANP map vintage (`asOf`); bump it when AANP revises the map | `lib/state-practice-authority.ts`, `components/ScopeOfPracticeData.ts`, `lib/stats-sources.ts` |
| Quarterly, or on a competitor change | CLAUDE | Re-verify /compare claims; bump `COMPARE_REVIEW_DATE` (2026-08-06) | `lib/compare-data.ts` |
| On each BLS OEWS release | CLAUDE | Refresh the salary vintage (drift tests enforce consumers) | `lib/stats-sources.ts` |
| Annual | CLAUDE | Issue the next data report edition | `lib/reports/editions.ts` |
| On a real content review | CLAUDE | Bump per-surface `LAST_REVIEWED` literals; never automate them to render time | salary guide, resource guides |

## Closed since the last version (2026-09-27)

- 1.14 Security checks (done 2026-10-23 to 2026-10-24; you asked Claude to run the read-only ones): no planted admin account (both queries empty; no admin role exists at all); the leaked audit test password belonged to the PMHNP Hiring project, not this one, and was replaced there on 2026-10-23 with an unseen random one, its sessions ended; Supabase Authentication checked on screen (Site URL `https://nphiring.com`, no `*.vercel.app` redirect, Confirm email on); all 4 profile pictures are the account's own upload or Google photo; no unconfirmed employer owns an unclaimed post. The comparison table stays as it is: Indeed's own help page says it no longer supports its paid Career Services, and its California and Texas NP articles are still indexed. You chose to leave the indexing key (1.4).
- 2.28 Pricing review follow-ups: the renewal price can no longer be computed from a row loaded without its charges, a failed first-post ledger write makes Stripe retry, and the long test file was split (`00282e6`, `e0e9d4e`).
- 2.31 AI in production: production had no `OPENAI_API_KEY` until you added it on 2026-10-24, so every AI call had failed since launch (555 calls, 485 of them the site's own daily eval). Since the redeploy every call succeeds; the 2026-10-25 08:00 UTC eval made 5 of 5 scoring calls (about $0.25 a month). One application from 2026-10-23 still has no AI score; scoring it is a production write, so it waits for your OK.
- 2.30 (part) CI: every workflow failed on every push in October. `9e1a154`, `ff42e8f` and `0ad137e` fixed the installs (a placeholder `DIRECT_URL` for prisma generate), the PII scan (the resume parser's do-not-extract list), SEO Guard's base address, and run the AI evals dry without the OpenAI key secret. The migration workflow now skips with a notice without `PROD_DIRECT_DATABASE_URL` (the Vercel build applies migrations).
- Edit token hotfix (2026-10-24): `POST /api/jobs/update` read the edit token from the JSON body into a non-unique Prisma query, so a filter object matched any post; it and the renewal checkout now accept only a plain string (`lib/request-body.ts`, `3574809`). A read-only look at all 13 employer posts found no sign it was used. Six low cases of the same kind followed in `862b8af`.

- D1 Plan posts, 60 days each or live for the whole subscription: moot. You retired the Employer plan on 2026-10-24 (3.1b); no page offers it and none is sold, and its code stays dormant until it is deleted.
- 1.3 Google Analytics: live since 2026-09-28.
- 1.4 Search Console and Google indexing: sitemap index submitted 2026-10-01, Indexing API and Search Console API on, service account is an Owner, health check passes (key rotation and the first month's watch remain, 1.4).
- 1.5 Bing and IndexNow: verified, key file served (`96f035e`), first run accepted 165 of 165.
- 1.12 Indexing data repairs: applied 2026-10-01 (counts in 1.12); remote flags and 72 company records remain.
- 2.1 Ladder copy: every pricing surface switches at `config.promoEndsAt` with no deploy (this release).
- 2.2, 2.4 to 2.7, 2.10: done in this release (see Shipped).
- 2.11 Guest Easy Apply: closed by your decision; applying requires an account.
- 2.12 Job rows that stored a state but no town: the planner shipped as `planStateOnlyTownBackfill` in `scripts/indexing-fixes/lib/planners.ts`, `scripts/indexing-fixes/backfill-job-locations.ts` runs it in every pass, and the 2026-10-01 pass found no such row left.
- 2.17 Dashes in email subjects and previews: every subject, preview and preheader in `lib/email-service.ts` now uses a colon, a comma or two sentences (plain UI copy sweep, 2026-10-12).
- Explanatory text sweep (2026-10-12, same branch): field hints, page narration, label restatements, duplicated lines and filler removed across the public site at the owner's request; legal, billing, consent, provenance and accuracy text kept. Follow-ups: 2.18, 2.21, D20 to D23.
- 2.9 Worktree housekeeping: done on 2026-10-13. Every merged worktree and branch is gone, here and on GitHub, and the main checkout is on `main`. Each worktree's `.next` held links into the shared `node_modules`; they were removed first, link by link, and the shared folder was checked before and after. Two old stashes were left alone (a July work in progress and the Clay 2.0 redesign you asked to keep), and so was an untracked file named `text` in the main checkout (a saved state board rule page from license research).
- The content release's open item "sitemap lastmod for changed tools": `PAGE_CONTENT_DATES` now dates all 33 pages the plain copy pass or the content release changed to 2026-10-13, the UTC day both went live; /terms, /privacy and /sub-processors kept their dates. The /compare hub is 2.22.
- Ship-day review of the content release (2026-10-13): 195 time-bound claims in the ten new posts and the refreshed surfaces were re-checked at their sources. 189 held. Four were corrected: the student loan post counted three open federal cases where the dockets show at least five (in the body and in one FAQ answer), the fellowship post said every VA site names a program director, and the noncompete post described Maine's statute page as the text before the 2026 amendment. Two, on the residency consortium's federal recognition, could not be confirmed because the Department's pages refuse automated requests, so that sentence now says so. Follow-ups: 2.23 to 2.25, D24, D25, 1.13.
- Prisma migrations: applied, most recently `20261025000000_add_employer_post_packs` on 2026-10-26 (by the Vercel build, checked read-only afterwards).
- 2.16 Plan sales and the Stripe key: `isPlanSaleOpen` (`lib/employer-plan-link.ts`) now also requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. The /pricing plan card and `/api/employer/plan/subscribe` send no buyer to Stripe while the webhook would answer 503 and could not record the plan. The per post checkout and renewal routes and the availability endpoint apply the same rule (2026-10-20).
- Route authorization sweep (2026-10-13): all 193 API routes read, every finding checked by two skeptics. The three critical holes (sign-up metadata could grant admin, the anonymous alert signup answered with the alert's token, and reset links could point at any vercel.app host) shipped as `e78f037` on 2026-10-17. The rest shipped in the 2026-10-20 batch: resume and avatar paths held to the owner's folder at every writer and reader; the applications and dashboard answers stopped sending employer notes and AI scores to candidates; saved candidates, candidate search, candidate alerts and the alert cron follow the talent pool rules; employer messages, replies and candidate messages refuse recipients the employer may not contact or deleted accounts; employer testimonials need an employer account; newsletter opt-out and status need a matching session; the autofill quota no longer trusts the client; admin and job list parameters are bounded; checkout resume ownership matches the employer rule; the welcome email's unsubscribe links work; new alert tokens are UUIDs and the three alert token routes are rate limited; message attachment keys are matched whole; the alert digest escapes the alert's own criteria and the welcome email the first name; employers see a signed link to an applicant's cover letter, and a cover letter upload no longer replaces the profile resume. Owner checks: 1.14. Follow-ups: 2.26, D26 to D33.
- 1.13 Salary guide PDF: regenerated on 2026-10-13 from live, read-only counts (491 postings with pay from 65 employers in 43 states) with the 41% and 100 million+ figures and a cited quick answer.
- 2.19 Employer analytics: a job the caller does not own answers 404, and `days` is held to 1 to 365.
- 2.20 The dashboard handles an account with no email.
- 2.21 Coverage claims: every card and the footer link to /jobs/locations read without a coverage count ("States and cities" on the cards), and the /jobs/locations travel tile no longer names locum tenens.
- 2.22 The /compare hub has its own copy date.
- 2.23 The certifying body reads AANPCB in the hiring guide, the 51 license guides, the CE hub, the category by city template, the job description templates and nine posts.
- D25 The job seeker comparison table was audited row by row against the code and each competitor's own pages and rebuilt from the cells that hold (`lib/seeker-comparison.ts`); the "how it works" steps on the home page lost the AI and no recruiter claims.
- 2.26 Sweep follow-ups (2026-10-22): a new account joins the newsletter only when it opted in, on all three sign-up paths, and the stored newsletter flag takes the same explicit opt-in; the alert welcome email skips an address suppressed after a bounce or a complaint (and skips the email, not the signup, when that check fails), and an alert signup no longer lifts the suppression of a deleted account; the legacy ownership branch (an unclaimed post filed under the session's email) needs a confirmed sign-in email, in every route that uses it (the applicants and notification settings writes included) and in the checkout and renewal verify routes; every capability token defaults to a UUID; a Stripe key or webhook secret made only of spaces counts as unset, and the expiry warning offers a renewal only while the webhook secret is set; every talent pool read uses one rule (`lib/candidate-pool.ts`), which also leaves deleted accounts out, the AI search's vector query included, and the candidate alert caps live in one module (`lib/candidate-alert-filters.ts`), so the settings page gets back a row stored over the caps cut to what the digest uses; the featured jobs on the home page hide what /jobs hides; JazzHR apply pages count as the employer's site in the label and on every surface that features such jobs; account erasure empties the upload folders under every upload prefix, re-reads each account first so one restored mid-run keeps its files, and names any folder it could not empty in the purge audit record; deleting a resume also removes the earlier uploads older than a day that no application names (D35 covers the current file); the job page's type links go to the landing that lists the job (a contract job was sent to Travel), and the travel and locum tenens card check reads components and lib modules too. Owner check: the last bullet of 1.14.
- 2.8 Stripe SDK and the restricted key (2026-10-22): `stripe` is on ^22 (22.6.2) and `lib/stripe.ts` pins its API version, `2026-08-26.dahlia`; none of the Dahlia breaking changes touches a field the code sends or reads, and a test holds the pin to the installed SDK. The permission list for a restricted live key is in `docs/pricing-system.md` section 9b, checked against every Stripe call in the code, and the launch runbook (8a) gives the live webhook the same API version.
- 2.25 Content release follow-ups (2026-10-23): on 2026-10-22 /jobs/anesthesia answered 200, but /jobs/adult-gerontology and /jobs/private-practice had no jobs and answered 404 (TECH-06), and a post body, the private practice guide and the private practice income calculator linked them. Post bodies, the blog's related jobs box and those two pages now drop a link to a landing whose stats row counts no job (`lib/pseo/live-landing-links.ts`); a landing with a few jobs renders and stays linked, and every link stays while the rows cannot be read. The category auto-linker no longer links three /jobs pages the board never had. The three tool breadcrumbs name the tools as their titles do (Specialty Quiz, Private Practice Income, Cost to Hire). The six priority posts of the content plan sit inside the 700 to 1,200 word band (`tests/regressions/p1-content-library-blog-seed.test.ts` holds them there); the 21 longer posts are the long-form guides of July and October, outside that plan.
- 2.18 Job alert salary rule (2026-10-22, shipped on its own): an alert's minimum salary now keeps exactly the jobs the /jobs salary filter keeps (`salaryClause` in `lib/filters.ts`): a job whose low or high figure reaches it, never a job with no pay. A single-figure posting ("$130,000/yr") now reaches a $100k+ alert, and jobs that post no pay no longer do, so the email and its "View All Matching Jobs" link list the same jobs. A maximum keeps its rule.

## Shipped since 2026-08-16

- `4252d28` pSEO restyle and the thin-content repair of every programmatic page.
- `dc7308f`, `287ba7c` GA4 tag correctness and indexing safety (Google indexing takes job URLs only).
- `d2fbffe`, `1790c1d` Practice-authority dataset corrected for 26 jurisdictions; templates no longer infer rules from the AANP tier.
- `d588dfd` Metro guides on verified data, one-time expired-job de-indexing, DC location parsing.
- `4212caf` Employer pricing: free launch promo through 2026-12-31, then $199 intro, $299 per post or the $399 per month Employer plan; Stripe hardening and release fixes (migrations applied 2026-09-27).
- `8c023e4` Unsourced generalizations softened; this register rebuilt.
- `b393f53`, `f984ba2` Indexing readiness release: honest sitemap lastmod (`jobs.content_changed_at`), cited license guide facts for 51 jurisdictions (50 indexable), apply requires an account, the blush header, and every readiness audit finding.
- `96f035e` IndexNow key file.
- `ff6aa1c` Pricing copy that switches itself when the promo ends (2.1), /resources and /for-programs served from code (2.2), Stripe subscription events applied from the live subscription (2.4), one payable renewal session per post (2.5), one client-safe renewal-offer rule (2.6), archive route tests (2.7), small leftovers (2.10).
- `71236b5` Psychiatric job seekers and employers are pointed to the sister board from the homepage, the psychiatric landing page and the post-job form.
- `a74a4d5` Plain UI copy, email subjects without dashes, and explanatory text removed site-wide.
- `6263323` The SEO, AEO and GEO content release (2026-10-13): ten new posts, 18 refreshed, the 2025 to 2035 growth figure and the HRSA floor, the full practice quick answer on /scope-of-practice, retitled tools, the ClaudeBot sitemap carve-out and rebuilt llms files.
- `3574809`, `862b8af` (2026-10-24) Request body values reach Prisma only as plain strings (the edit token hotfix and its six follow-ups).
- `9e1a154`, `ff42e8f`, `0ad137e` (2026-10-25) CI green again.
- `8ac1d66` (2026-10-25) The 2027 re-price: $249 first post, $349 after, renewals $199 or $249 by post, the Employer plan retired from every page.
- `00282e6`, `1d3e18b`, `e0e9d4e`, `08f2e33` (2026-10-26) The one-time 5-post pack for $1,245 (backend, pages, emails, admin), all sales final, and the code and security review fixes; migration `20261025000000_add_employer_post_packs` applied by the build.
