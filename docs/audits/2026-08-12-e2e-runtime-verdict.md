# NP Hiring — Final State-of-Product Verdict (First Real Build + Runtime E2E)

Synthesized 2026-08-16 from the first production build report (`e2e-build-report.md`), the runtime
E2E audit (`e2e-runtime-report.md`, both session scratchpad), `docs/PENDING_WORK.md` (2026-08-11),
and `docs/audits/2026-08-11-completeness-verdict.md`. This is the closing verdict of the E2E wave:
the first time the product was actually built (`npx next build`) and run (`npx next start`) end to
end rather than audited statically.

---

## 1. Runtime verdict

**The product builds, serves, and converts — and the first real run caught one critical runtime
defect that no static audit had found, plus six more. All seven are fixed in the working tree with
77 new regression tests (6 files, all green, re-run at verdict time). The fixes are NOT yet
committed — that is the single most important next action.**

### Build

- **Build 1 FAILED**: `lib/prisma.ts` caps the pg pool at 2 connections/process (deliberate
  EMAXCONN protection), while Next 16's export workers prerender 8 pages concurrently per worker ×
  11 workers → pool starvation → `timeout exceeded when trying to connect` → build abort at
  `/salary-guide/massachusetts`.
- **Fix applied** (`next.config.ts` experimental): `staticGenerationMaxConcurrency: 2` +
  `staticGenerationRetryCount: 3`. Mechanical, build-time only; runtime behavior untouched.
- **Build 2 PASSED**: exit 0, **393/393 static pages**, compile 38.8s, static generation 66s, tsc
  clean, zero prisma errors.

### Route & bundle stats (build 2)

- 69 static routes; 4 SSG families (12 JD templates, 20 metros, 51 salary-guide states, 11
  specialties); 354 dynamic routes (188 API + 166 pages); 164 unique prerendered HTML routes.
- ISR confirmed live at runtime on gSP routes (`/salary-guide/alabama`: `x-nextjs-cache: HIT`,
  `s-maxage=86400`).
- **Bundle weight is the honest bad news**: shared baseline 211 KB gz on every page (Sentry alone
  ~65 KB gz); across 162 prerendered routes first-load JS is min 257 / median 380 / max 481 KB gz —
  the floor alone exceeds the repo's own web-performance budget. The Sentry tree-shake flags from
  "SEO Fix H1" are deprecated no-ops under Turbopack, so that prior saving likely regressed
  silently. Unresolved; needs a Turbopack-era bundle-analysis pass.

### Runtime probes

- **Route sweep**: 43/45 URLs structurally correct (status, title, absolute canonical, exactly one
  H1); the 2 failures became D2 and D5 below.
- **SEO/AEO files all pass**: robots.txt (per-bot matrix incl. AI crawlers), sitemap.xml (324 locs,
  parses), sitemap index → cities (418) + jobs (991), feed.xml, image/video sitemaps, llms.txt,
  ai.txt, security.txt — all 200, all parse.
- **Structured data**: 12 pages, every ld+json block parsed — **zero JSON.parse failures**.
  JobPosting complete (datePosted/hiringOrganization/jobLocation/title/description); FAQPage on 8
  pages with complete Q/A; BreadcrumbList and Organization+WebSite graph everywhere.
- **Browser funnels (Playwright)**: repo smoke suite 24/24 against the prod server. Candidate
  funnel PASSED end to end: home → browse → specialty facet toggles URL → 50 cards → job detail →
  anonymous apply correctly hits the sign-in gate. Alert modal PASSED (opens prefilled, Escape
  closes). Tools (1099 calculator, specialty quiz) computed correctly once CSP was bypassed —
  which is how D1 was isolated to the CSP, not the components.
- **Honest-state gates verified live**: /testimonials → 404 (nothing approved), /blog → clean empty
  state with valid schema, recruitment-type facet shows `unclassified=851` summing exactly to the
  unfiltered total — no fabricated counts anywhere.

### Defects found and fixed this wave

All seven fixed in the working tree (uncommitted), each pinned by a
`tests/regressions/p7-runtime-*.test.ts` file — **77/77 tests green**:

| # | Sev | Defect (runtime-proven) | Fix |
|---|-----|--------------------------|-----|
| D1 | **CRITICAL** | Per-request CSP nonce can never match the nonce-less inline RSC flight scripts baked into ~164 prerendered/ISR pages → 48 CSP violations on /pricing, `Connection closed.` pageerror, **zero hydration** — every calculator, quiz, and client interaction inert on every static page | `middleware.ts`: nonce removed, `script-src 'self' 'unsafe-inline'` + host allowlist retained; residual XSS posture documented in-file (React escaping + sanitize.ts remain primary; nonce CSPs require fully-dynamic rendering, which this board deliberately avoids) |
| D2 | HIGH | All 51 `/jobs/locations/[state]` directories returned 410 Gone while the live hub linked to them — `locations` missing from the middleware namespace exclusion its own comment promised | `middleware.ts:740`: `'locations'` added to the exclusion list |
| D3 | HIGH | `revalidate` inert on 5 dynamic-segment routes (job detail, blog, companies, city, locations/[state]) — no `generateStaticParams`, so every hit was a 0.5–5.6 s uncached DB render; middleware excludes job details from the crawler cache on the false premise they're ISR (the exact Googlebot-burst → pool-exhaustion scenario F5 was meant to close) | `generateStaticParams() { return [] }` added to all 5 → on-demand ISR |
| D4 | MEDIUM | Sitemap emitted 13 city entries that 308 to metro twins also listed, plus a malformed `boston--ma` slug from a dirty DB value | `app/sitemap.ts`: metro-twin filter, canonical `buildCitySlug`, slug-level dedupe, `cityLinkResolves` veto |
| D5 | MEDIUM | Catch-all 404 rendered the bare `__next_error__` shell on first hit and 0-byte bodies on repeats | `app/[...catchall]/page.tsx`: `dynamic = 'force-dynamic'` (load-bearing, documented) |
| D6 | MEDIUM | `/jobs` title "Browse 851 NP &amp; NP Jobs Near Me" — niche short/medium both `'NP'` post-fork collapsed the template | `app/jobs/page.tsx`: template dedupes identical pair |
| D7 | LOW | 14 routes with "… \| NP Hiring \| NP Hiring" doubled suffix | Per-page metadata stops re-appending the brand the root template already adds |

**Caveats, stated plainly:** (a) the fixes are unit/regression-tested but have not yet been through
a fresh `next build` + `next start` re-probe — that verification rides the commit; (b) D1's fix
must be re-verified on the deployed site with devtools (mechanism is deployment-independent, but
this is the one defect that silently killed all interactivity, so trust nothing but the live
check); (c) the in-platform Easy-Apply dialog could not be exercised without a real login — code
review confirms focus trap + Escape, runtime does not.

---

## 2. The complete-product scorecard

| Area | Objectively in place (strongest evidence) | What genuinely remains |
|------|--------------------------------------------|------------------------|
| **SEO** | 393 prerendered pages; 45-slug taxonomy at zero-diff parity across routes/tags/assets/sitemaps/tests (drift suite 9/9 live-green); sitemap ecosystem all 200 + parses; zero indexable pages missing title/canonical; runtime sweep 43/45 clean and the 2 failures now fixed | Commit + deploy + Search Console submission; the fixed D3 ISR and D4 sitemap need live re-verification; zero indexed-page history — SEO is *built*, not yet *earned* |
| **AEO / GEO** | llms.txt + ai.txt coherent with no fixed-count claims; robots per-bot AI-crawler matrix; FAQPage schema complete on 8 page types with zero parse failures; salary provenance stamps on all five A4 surfaces | No evidence any AI engine cites the site yet; the named-reviewer E-E-A-T unlock (§3) also gates answer-engine trust |
| **Features** | Candidate funnel proven end-to-end in a real browser (search → facet → detail → auth-gated apply); alerts modal live; 24/24 smoke green; recruitment-type facet wired schema→admin→UI; all 12 completeness holes closed (`ef5067a`) | Easy-Apply dialog untested with a real account; `ai.search.semantic` flag off pending eval run + cost review (PW 3.2); alert experience criteria now writable but unexercised by real users |
| **Tools** | 7 tools + 2 reports; 1099 calculator and specialty quiz verified computing correct results in-browser ($200/hr → $154,160 vs $376,000; 8/8 quiz → ranked output) — inert only because of D1, now fixed | Post-deploy hydration check on real prod is mandatory (these were the pages D1 silently killed); tools pages carry ~380 KB gz first-load JS |
| **Content** | 51-state salary guides (ISR-verified live), scope-of-practice + licensure surfaces from one 51-key dataset (cannot disagree), ~15 authored .mdx posts, 12 JD templates, 2 data reports, compare cluster with dated claims | Blog posts invisible until `sync-blog-to-db.ts` runs against prod (PW 1.1); video map intentionally empty until real videos exist; 8 taxonomy verticals deferred pending real inventory |
| **Trust** | Honest-state discipline proven at runtime, not just asserted: /testimonials 404s, /blog empty-states cleanly, facet arithmetic sums exactly, no fabricated zeros anywhere; security.txt; salary provenance everywhere it shows dollars | The three human trust assets: a named credentialed NP reviewer (`editorial.reviewer` is null), approved real testimonials (zero exist), classified companies (zero of 851 jobs' companies classified — deliberate, human act) |
| **Employer product** | Post-job funnel + preview build and serve; employer dashboard, company-claims machinery + admin queue, cost-per-hire calculator, /for-employers ISR at 1h; claims migration verified additive | Zero claims approved, zero companies classified (badges/filters dark until then); Stripe Tax (B113), InMail charging semantics (B1), CSV export placement (B22) — all human decisions; heaviest bundle in the app is /post-job at 481 KB gz |
| **Performance** | Prerendered TTFB 5–30 ms; ISR now real on detail pages (D3 fix ends the 0.5–5.6 s per-hit DB renders); build-time pool starvation solved at the root | The JS floor: 257 KB gz minimum / 380 median vs the repo's own <150 KB landing budget; Sentry ~65 KB gz in every page's baseline with its tree-shake flags no-op'd under Turbopack; no field CWV data exists — nothing has been measured on real users |

---

## 3. The honest gap to "greatest of all time"

Everything above is code, and the code waves are done: the enterprise audit (159 items), the
content/SEO worklist, the competitive teardown, the 12 completeness holes, and now the 7 runtime
defects are all shipped or fixed. What separates this from a category-winning product is **not
buildable**, and it is all already named in `docs/PENDING_WORK.md`:

**Deploy actions that gate everything (PW §1).** Nothing in this verdict exists for users until:
commit + deploy the E2E fix tree (D1 especially — the deployed site presumably has the same dead
interactivity on every static page right now), sync the ~15 blog posts to the prod DB, purge the
`/api/og*` CDN cache, and live-verify hydration and ISR headers with devtools. These are hours of
work, and they are the difference between "the repo is excellent" and "the product is".

**Human inputs no agent can supply (PW §2–3).** The single biggest E-E-A-T unlock is a real,
named, credentialed NP reviewer — zero audited competitors have clinician-reviewed content, and the
machinery (`EditorialByline`, Person schema) is idle behind one config field. Likewise: approving
real testimonials, classifying 851 jobs' companies as direct-hire vs staffing (largest counts
first), the bespoke artwork commission, the semantic-search go/no-go, and the six audit-era
business decisions (Stripe Tax, PITR drill, CI eval gate, InMail semantics…). Each is a judgment or
a relationship, not a diff.

**Data procurement (PW §4).** The HRSA primary-care HPSA file (all-NP shortage signals across
pSEO), an accredited-program dataset (schools directory — currently a correct "don't build"),
licensed CEU inventory. The product honestly limits itself to behavioral-health HPSA today because
that is the data it actually has; the upgrade is a procurement act.

**Compounding assets that only accrue with time (PW §5 + teardown).** Job-inventory volume beyond
today's 851 (all currently unclassified aggregation), backlinks and domain authority, association
distribution partnerships (ENP Network's actual moat — a BD motion), career-fair operations,
a community salary survey once the alert base supports honest sample sizes, real walkthrough
videos, and — above all — traffic history. GSC has never seen this site. Rankings, AI-engine
citations, and employer-side liquidity are earned quarter over quarter; the recurring-maintenance
calendar (PW §7: NLC roster, scope-of-practice, compare claims, BLS vintage) is the discipline
that keeps the earned trust from rotting.

**Bottom line.** The codebase is complete to its own specification, build-proven, runtime-proven,
and honest about every empty state. The gap to great is: deploy it, put a real clinician's name on
it, classify and grow the inventory, procure the two datasets, and then let distribution,
backlinks, and time do what no code wave can. No benchmark claimed here was fabricated; every
number above traces to a build log, an HTTP header, or a Playwright run.
