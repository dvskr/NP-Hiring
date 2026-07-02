# Forking Checklist

> Take this codebase and turn it into a different niche job board (e.g., RN Hiring, PA Hiring, Dental NP Hiring) without losing the compliance posture you've already built.

## TL;DR — What you change

1. **`config/brand.ts`** — single source of truth: name, niche, domain, legal
   entity (incl. governing state / venue / Stripe descriptor), inboxes,
   from-addresses, asset bases, indexer UA, socials.
2. **`config/niche/salary.ts`** — every salary validation/clamp band in the
   pipeline. The pipeline CLAMPS out-of-range values, so wrong bands
   FABRICATE salaries — retune all sections for the new niche's pay levels.
3. **`lib/pseo/taxonomy-registry.ts`** — the category taxonomy (axes, slugs,
   state/city eligibility, indexing priority). Create the matching
   `app/jobs/<slug>/` folders; `tests/seo/jobs-segments-drift.test.ts` fails
   until registry and folders agree.
4. **DB** — point a new Supabase project, run `prisma migrate deploy`
   (bootstrap works end-to-end as of the 20260702 baseline migration;
   `tests/db/migrations-cover-schema.test.ts` guards column-level coverage).
5. **Marketing copy** — rewrite home, about, FAQ, blog (niche-specific anyway).
6. **Reissue DPIA** — `docs/dpia.md` is a template; replace brand placeholders
   AND re-verify the data-category inventory (e.g. DEA/NPI may not apply).
7. **Confirm sub-processor list** — same vendors usually, but verify.
8. **Regenerate the brand-leak baseline** — after your copy rewrite, run
   `UPDATE_BRAND_LEAK_BASELINE=1 npx vitest run tests/regressions/brand-leak-ratchet.test.ts`.
   The ratchet fails CI on any file that still hardcodes the ORIGINAL brand,
   so leftover pmhnphiring strings can't silently ship on your fork.
9. **The rest of the niche packs** (`config/niche/`): relevance.ts (filter
   keywords — the quality-critical one), copy.ts, content-map.ts, stats.ts
   (EMPTY the fallback employers!), credentials.ts, regulatory.ts, plus
   `lib/aggregators/search-terms/*` and `lib/aggregators/tenants/*`.
10. **Regenerate crons** — edit `config/cron-schedule.ts` for your source mix,
    then `npm run crons:generate` (never hand-edit vercel.json's crons; a
    drift test enforces this).
11. **Run the preflight** — `npm run fork:preflight` must exit 0 before launch.
    Full operational sequence: `docs/pilot-fork-runbook.md`.

## What carries over for free

Everything in Sprints 1–4 is generic compliance infrastructure:

- Schema (`audit_logs`, `data_requests`, soft-delete columns, double opt-in alerts, sensitive-data consent)
- API routes (`/api/consent`, `/api/data-request`, `/api/auth/*`, `/api/jobs/*`)
- Crons (`purge-soft-deleted`, `purge-inactive-users`, `cleanup-expired`)
- Audit logging (`lib/audit-log.ts` writes to `audit_logs`)
- Resume virus scan (`lib/virus-scan.ts`)
- GA Consent Mode v2, GPC handling, region detection, CSP, HttpOnly consent cookie
- Incident-response runbook (`docs/incident-response.md`) — template, swap brand
- Privacy/terms/security/sub-processors/do-not-sell/data-request pages — read from `config/brand.ts` (terms included as of Phase 0: entity, venue, arbitration locale, and Stripe descriptor all come from `brand.legal`)
- Security allowlists derive from `config/brand.ts`: CSRF origins (`lib/csrf.ts`), middleware CORS, password-reset redirect hosts, email-job same-origin check, widget CSP frame-ancestors, lead-mining self-domain filter
- Search-engine plumbing derives from brand/env: `lib/search-indexing.ts` + `lib/indexnow.ts` hosts, ingest/webhook/deindex ping URLs, OG-image logo fetch, sitemaps, GSC property default
- Invoice seller identity (`lib/invoice-generator.tsx`) reads `brand.legal`
- Email sender defaults exist in ONE place (`config/brand.ts`) — `lib/env.ts` and `lib/email-service.ts` both read it; env vars still override at runtime
- `public/push-sw.js` matches on `self.location.origin` — no per-fork edit needed
- E2E mutation guards (`AGAINST_PROD`) derive from `brand.domain` — your fork's production is protected automatically

You **do not** redo any of this per fork. It's library code now.

## What's still hardcoded (intentionally) and needs per-fork work

These were considered for `config/brand.ts` and rejected because they're too varied / niche-specific to parameterize:

| Surface | Why hardcoded |
|---|---|
| Home page hero & marketing copy | Different value prop per niche |
| About / FAQ / Contact pages | Founder story, niche FAQs |
| Blog posts | Editorial work |
| Job category routes (`/jobs/inpatient`, `/jobs/lgbtq`, etc.) | Different niches have different categories |
| pSEO templates (`lib/pseo/*`) | Niche-specific keyword targeting |
| AI matching prompts | Tuned per role family |
| EEO field values (race, disability, veteran) | Federal forms — same across forks |
| Email confirmation copy in `app/api/job-alerts/route.ts` (most of it) | Already partially branded; rewrite per fork |
| Logo / favicon / social images in `/public` | Brand assets — replace files |
| `next.config.ts` redirects | Niche-specific URL consolidations |
| `robots.txt`, `humans.txt`, `ai.txt`, `llms.txt` (in `/public`) | Brand-specific |

## Step-by-step fork procedure

```bash
# 1. Clone
gh repo clone yourorg/<original-repo> <new-fork-repo>
cd <new-fork-repo>

# 2. Edit the brand config (one file, ~10 lines)
$EDITOR config/brand.ts

# 3. Replace brand assets
#    /public/logo.png, /public/favicon-*.png, /public/apple-touch-icon.png
#    /public/og-default.png, /public/site.webmanifest

# 4. Set up the new database
#    Create a fresh Supabase project for the new fork
#    Update DATABASE_URL + DIRECT_URL in Vercel env
npx prisma migrate deploy

# 5. Rewrite niche-specific surfaces
#    - app/page.tsx (home)
#    - app/about/page.tsx
#    - app/faq/page.tsx
#    - app/contact/page.tsx
#    - app/jobs/[category]/page.tsx (category landing pages — keep
#      structure, swap copy + filters)
#    - lib/pseo/* (programmatic SEO templates)

# 6. Reissue compliance docs (privacy + DPIA)
#    Most content auto-updates from config/brand.ts. Verify:
$EDITOR docs/dpia.md           # confirm processing description still accurate
$EDITOR app/sub-processors/page.tsx  # check vendors list (same usually)

# 7. Rotate environment secrets in Vercel
#    - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (new project)
#    - STRIPE_SECRET / STRIPE_WEBHOOK_SECRET (new account or product)
#    - RESEND_API_KEY (new account or domain)
#    - GA_MEASUREMENT_ID (new GA4 property)
#    - SENTRY_* (new project, optional)
#    - CLOUDMERSIVE_API_KEY (can reuse — same account)

# 8. DNS + Vercel
#    Point new domain at the Vercel project. SSL auto.

# 9. Smoke tests
npm run dev
#    Visit /, /privacy, /sub-processors, /security, /data-request,
#    /do-not-sell, /jobs. Confirm brand swapped everywhere visible.
```

## Things to NOT change per fork

- The `data_requests` schema — keep as-is so a future enterprise customer audit shows consistent DSAR structure across products.
- The `audit_logs` table — same reason.
- `lib/consent.ts` cookie names (`pmhnp_consent_v2`) — these are scoped to the domain so they don't conflict across forks.
- The 25-gap audit doc structure (`docs/compliance-audit.md`) — re-run the audit per fork using the same checklist; don't rewrite the framework.

## When to invest in further consolidation

If you end up with three or more forks, consider:

- Promote the compliance scaffolding to a private `npm` package (`@yourorg/job-board-compliance`).
- Move shared UI to a private design system.
- Use Turborepo to manage the monorepo of forks with shared internals.

Until then, plain forking + `config/brand.ts` is the right level of abstraction.
