# Pending Work

> Status as of 2026-08-11, HEAD `2daa875`. Everything buildable from the enterprise audit (159 items),
> the content/SEO worklist (P0–P3 + wedges), and the competitive teardown (A1–A8) is **shipped**.
> Suite: 4210/4211 (the one red is item 3.1 below, a decision not a defect).
> What remains is listed here: deploy actions, human inputs, product decisions, data procurement,
> and recurring maintenance. Trackers: content/SEO tracker and competitor teardown artifacts
> (links in the project README of whoever holds them; both also live in the session scratchpad).

---

## 1. Deploy-time actions (do with/after the next deploy)

| # | Action | Why | Command / place |
|---|--------|-----|-----------------|
| 1.1 | **Sync blog posts to prod DB** | ~15 authored `.mdx` posts (career pillars, malpractice + credentialing guides, preceptor pillar, program-evaluation wedge, 4 certification guides) are invisible until synced. Surfaces render nothing meanwhile — no 404s. | `npx tsx scripts/sync-blog-to-db.ts` against prod |
| 1.2 | **Purge Vercel CDN for `/api/og*`** | OG cards carry 30-day `s-maxage`; already-crawled share URLs keep serving the old dark-navy donor card until purged. | Vercel dashboard → purge cache for `/api/og*` |
| 1.3 | **Prisma migrations apply automatically** | Two new additive migrations ride `npm run build`: `20260731…_add_company_claims`, `20260806…_add_company_recruitment_type` (both verified additive, no backfill). Nothing to do — listed so the schema change isn't a surprise. | automatic via `npm run build` |
| 1.4 | Optional: **repair 3 stale city slugs in DB** | `PseoStats.locationSlug` / `CitySnippet` / `CategoryCitySnippet` still hold the pre-fix garbled slugs for La Cañada Flintridge, Cañon City, Española. Harmless meanwhile (they just sit out of the sitemap until `aggregate-pseo` rewrites them). | `scripts/repair-city-slug-diacritics-db.ts` — has `--check` dry-run; never executed from here |

## 2. Inputs only you can supply

| # | Input | Impact | Where it goes |
|---|-------|--------|---------------|
| 2.1 | **A credentialed NP reviewer** (name + credentials, real person who agrees) | The single biggest remaining E-E-A-T unlock. **Zero audited competitors have clinician-reviewed content.** Populating it flips every post from "Reviewed by the editorial team" (Organization schema) to a named byline with Person schema. | `config/brand.ts` → `editorial.reviewer` (currently `null`; `components/EditorialByline.tsx` does the rest) |
| 2.2 | **Artwork commission** — all 1024×1024 webp, existing sage-green flat style; drop over the filenames and run `node scripts/regen-image-ladders.mjs` | Current mappings are best-fit stand-ins; several specialties share one illustration. | Wishlist: (a) ~19+ bespoke category heroes; (b) re-render 4 job-seeker scenes currently 400×300 (`remote-telehealth`, `clinical-inperson`, `parttime-prn`, `private-practice`); (c) per-benefit icon set (≥144px) + 6-icon explore-card set; (d) the `PENDING_RERENDER` list in `scripts/regen-image-ladders.mjs` (contact/terms heroes, employer + job-seeker bentos); (e) salary-guide factor icons ≥144px; (f) optional homepage hero art + an on-palette /about employer scene |

## 3. Product decisions waiting on you

| # | Decision | Context |
|---|----------|---------|
| 3.1 | **HomepageHero niche-copy ratchet** — the only red test | The 5 flagged strings (`STAMP_ROLES`, PMHNP category chip) are *intentional* specialty mentions on an NP-wide board, from your redesign. Fix = a one-line baseline entry in `tests/regressions/niche-copy-debt-baseline.json`; suite goes fully green. Your editorial call. |
| 3.2 | **`ai.search.semantic` flag** | UI + endpoint + eval suites exist and are off. Readiness assessment written (session scratchpad `semantic-eval-readiness.md`): run the evals, review cost projection, then flip — or don't. Never flipped silently. |
| 3.3 | **Classify companies (direct-hire vs staffing)** | Machinery shipped (`/admin/companies`, audit-logged). **Zero classified** — deliberate; classification is a human act. Triage order: largest job counts first. Badges + the /jobs filter light up as you classify. |
| 3.4 | **Approve testimonials / company claims as they arrive** | `/admin/testimonials` and `/admin/company-claims` queues. Public surfaces render nothing until approvals exist (by design — never seeded). |
| 3.5 | **Audit-era business items** (from the enterprise audit, unchanged) | Stripe Tax enablement (B113) · Supabase PITR + restore drill (B111) · CI eval-gate enforcement (B93) · GscSnapshot coverage columns — no public API exists, drop or wire manual export (B40) · broadcast `scheduledFor` leg (B74) · employer CSV export placement (B22) · InMail gate semantics — implemented as "new thread = charged"; revisit if per-candidate charging was intended (B1) |
| 3.6 | **Four briefed product bets** (decision briefs artifact) | Company claim step: **shipped**. Employer reviews: **don't** (triggers: non-thin employer volume + UGC/takedown Terms + named moderator). Schools directory: **blocked on dataset procurement** — wedge shipped; revisit only if you license/hand-verify an accredited-program dataset. Preceptor marketplace/flag: **don't** — pillar shipped; flag only as a self-declared /post-job checkbox once employer-posted volume is material. Full city-slug rename: **don't now** — ride it along free at the next `cities.ts` regeneration. |

### 3.7 Deferred taxonomy verticals (recorded 2026-08-11)

Eight NP verticals from the 2026-07 content-gap synthesis §7 were evaluated and
**deferred**: endocrinology/diabetes, sleep-medicine, utilization-review, informatics,
education-faculty, wound-care, iv-infusion, functional-medicine. The synthesis itself was a
session artifact and is not committed — this entry is its in-repo record. (Synthesis §7's
shipped remainder: the P1 #14 state-tier promotions and the P1 #15 verticals aesthetics /
pain-management / palliative-hospice, both live in `lib/pseo/taxonomy-registry.ts`.)

Original deferral rationale: **add after checking live inventory coverage.** A new slug
launches with zero rows carrying it in `Job.categoryTags` (see the tag-backfill warning in
the `taxonomy-registry.ts` header), so a vertical without real inventory ships as a
permanently-noindexed empty shell. Check live job counts for each vertical's keywords
before promoting any of them.

Adding one of these later is a full tier build — the drift tests fail until every side
agrees:

1. **Registry entry** — the slug in `CATEGORY_AXES` in `lib/pseo/taxonomy-registry.ts`
   (plus `STATE_ELIGIBLE_CATEGORY_SLUGS` + a `SETTING_CONFIGS` entry in
   `lib/pseo/setting-state-config.ts` if promoted to the [state] tier).
2. **Folder trio** — `app/jobs/<slug>/` with `page.tsx` + `city/[slug]/` (+ `[state]/` if
   state-eligible); `tests/seo/jobs-segments-drift.test.ts` enforces registry ↔ folder
   parity in both directions.
3. **Tagger rules** — `lib/pseo/category-tagger.ts`, then the deploy step
   `npx tsx scripts/backfill-category-tags.ts --force --apply` (existing rows stay
   invisible to the new category until the classifier re-runs).
4. **Asset-registry entry** — `lib/pseo/category-asset-registry.ts` (hero/OG art mapping).
5. **FAQ content** — `lib/pseo/category-faq-data.ts` (or a documented null, as
   psychiatric-mental-health does).

## 4. Data procurement (unblocks specific features)

| # | Dataset | Unblocks |
|---|---------|----------|
| 4.1 | **HRSA "Designated HPSA — Primary Care" quarterly file** (data.hrsa.gov), keyed by (city, state) | All-NP shortage signals across pSEO (currently honestly limited to behavioral-health HPSA). Spec documented in `lib/pseo/city-data/types.ts`. Also the natural moment for the city-slug rename ride-along (3.6). |
| 4.2 | Accredited NP-program dataset (CCNE/ACEN status + as-of, IPEDS spine) | The schools directory — only if 3.6's decision changes. ~4–8h/quarter re-verification forever. |
| 4.3 | CEU/CE course inventory (provider partnerships or licensed feeds) | CEU directory (teardown B1). Do not scrape-and-assert credit values. |

## 5. Ops / staffing investments (from the teardown — not engineering)

- **Association distribution partnerships** — ENP Network's moat; a BD motion. Existing beachhead: the free `/for-programs` widget.
- **Career fairs / virtual events** — a run-rate operations business (PracticeMatch does 2–3/week).
- **Native mobile app** — measure PWA + web-push engagement first; app is an investment call.
- **Community salary survey** — wait until the alert/newsletter base supports honest per-specialty sample sizes; then it feeds the annual report.
- **Walkthrough videos** — `lib/video-seo.ts` map is intentionally empty until real videos exist; recording is a human task.

## 6. Small foreign-file follow-ups (flagged by agents, safe as-is)

- Four files carry now-outdated "NLC set is stale — don't consume" embargo comments; the set was fixed and verified 2026-08-11. Their owners may now consume the tri-state data: `app/resources/fpa-guide/page.tsx` (~36), `app/tools/licensure-checker/page.tsx` (~14), `components/tools/MultiStatePlanner.tsx` (~13), `lib/metro-data.ts` (~63 — also remove the asserted MA signing-date comment).
- `/companies` A–Z hub doesn't render the new "Claimed by employer" badge (selects `isVerified` only) — one-line select + badge for parity.
- `/scope-of-practice` is reachable via /resources + cross-links but has no header/footer nav slot — optional promotion.
- `app/api/og/city/route.tsx` doc comment carries a `$120K-$165K` example pinned by a ratchet-exception entry — whoever cleans it up must delete the ratchet entry in the same change.
- Pre-existing repo lint debt: ~124 errors in files untouched by any wave (`scripts/*`, legacy components) — optional hygiene sweep.

## 7. Recurring maintenance (calendar items)

| Cadence | What | Where |
|---------|------|-------|
| Quarterly | Re-verify NLC roster against NCSBN; bump `NLC_ROSTER_VERIFIED_AT` | `lib/blog-license-guides.ts` |
| Quarterly | Re-verify scope-of-practice / practice-authority data (AANP); bump `SOP_LAST_REVIEWED` | `components/ScopeOfPracticeData.ts`, `lib/state-practice-authority.ts` |
| Quarterly (or on competitor change) | Re-verify /compare claims; bump `COMPARE_REVIEW_DATE` — claims are dated 2026-08-06 | `lib/compare-data.ts` |
| On BLS OEWS release (~annual) | Refresh salary vintage | `lib/stats-sources.ts` (drift tests enforce consumers) |
| Annual | Re-issue the data report (new edition config) | `lib/reports/editions.ts` |
| On real content review | Bump per-surface `LAST_REVIEWED` literals — never automate to render-time | salary guide, resource guides |
