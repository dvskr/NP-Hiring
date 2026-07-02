# Niche Job Board Template

A production-grade template for launching **niche job boards** — one fork per
board, shared engine, per-niche configuration packs. Extracted from a live,
SEO-hardened job board for psychiatric nurse practitioners (which remains the
reference "first board" throughout the code and content).

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)
![Tailwind](https://img.shields.io/badge/Tailwind-4-cyan?style=flat-square&logo=tailwindcss)
![Prisma](https://img.shields.io/badge/Prisma-7-teal?style=flat-square&logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-blue?style=flat-square&logo=postgresql)

## What you get

**Engine (shared across every board, niche-agnostic):**

- **Multi-source job aggregation** — 16 source connectors (Greenhouse, Lever,
  Workday, Ashby, BambooHR, SmartRecruiters, Workable, JazzHR, Adzuna, Jooble,
  JSearch, USAJobs, and more) behind a pluggable registry, with per-source
  rate limiting, chunked cron ingestion, and a 240s time budget.
- **Quality pipeline** — tiered relevance classifier (data-driven, see packs),
  multi-strategy deduplication, salary normalization, location parsing,
  company normalization, quality scoring, freshness decay.
- **Job health system** — dead-link probes with multi-signal voting, soft-404
  detection, source-presence monitoring, self-tuning anomaly alerts,
  Inngest-based false-positive recovery.
- **SEO machinery** — programmatic SEO for category × state × city pages with
  render gates and canonical discipline, edge 410s for guessed URLs, dynamic
  sitemaps (partitioned under the 50K cap), IndexNow + Google Indexing API +
  Bing submission, structured data throughout, dynamic OG images.
- **Product surface** — job search with filters, saved/applied tracking, job
  alerts (double opt-in), candidate profiles + resume upload, employer
  dashboard with paid posting (Stripe), candidate search with unlock quotas,
  messaging, blog (MDX), browser-extension API.
- **Compliance plumbing** — consent mode, GPC, DSAR endpoints, audit logging,
  suppression-aware email with one-click unsubscribe, CAN-SPAM footers,
  soft-delete purge crons.
- **AI features (per-board opt-in)** — resume parsing, job enrichment,
  semantic search + recommendations behind an instrumented gateway with cost
  tracking, caching, feature flags, and a CI eval harness.

**Per-board variance is confined to declared surfaces:**

| Surface | What lives there |
|---|---|
| `config/brand.ts` | Identity: name, niche descriptors, domain, legal entity (incl. ToS venue + Stripe descriptor), inboxes, storage origin, socials |
| `config/niche/relevance.ts` | Every keyword list the relevance engine consumes (the quality-critical pack) |
| `config/niche/salary.ts` | Every salary validation/clamp band in the pipeline |
| `config/niche/copy.ts` | Email chrome, OG headlines/claims, hashtags, wordmark |
| `config/niche/content-map.ts` | Blog slug maps that code links to (incl. the state-guide series prefix) |
| `config/niche/stats.ts` | Marketing claims + placeholder/testimonial data (re-author per board) |
| `config/niche/credentials.ts` | Credential taxonomy (certs, licenses, degrees, specialties) |
| `config/niche/regulatory.ts` | Per-state professional-regulation surface (seam) |
| `lib/pseo/taxonomy-registry.ts` | The category taxonomy (slugs, axes, eligibility) — drift-tested against route folders |
| `lib/aggregators/{search-terms,tenants}/` | Per-source queries and curated employer lists |
| `config/cron-schedule.ts` | Declarative cron schedule → generates vercel.json |

Guardrail tests keep the boundary honest: taxonomy ⇄ route-folder drift,
migrations ⇄ schema column coverage, cron schedule ⇄ vercel.json, and a
brand-leak ratchet that fails CI when production code hardcodes brand strings
outside the packs.

## Quickstart (development)

```bash
npm install                      # postinstall runs prisma generate (needs DIRECT_URL in .env)
cp .env.example .env             # fill in at least DATABASE_URL/DIRECT_URL, Supabase, CRON_SECRET
npx prisma migrate deploy        # fresh databases bootstrap end-to-end
npm run dev
```

Verification:

```bash
npm run type-check
npm test                         # vitest — unit + drift guards + ratchet
npm run test:e2e                 # Playwright (needs a running app)
```

## Launching a new board

The complete operational sequence lives in **`docs/pilot-fork-runbook.md`**.
The short version:

1. Fork this repo (keep the template as `upstream` for engine updates).
2. Edit `config/brand.ts` and every `config/niche/*` pack; define your
   taxonomy in `lib/pseo/taxonomy-registry.ts` and create the matching
   `app/jobs/<slug>/` folders (drift test enforces agreement).
3. Adjust the source mix and `config/cron-schedule.ts`, then
   `npm run crons:generate`.
4. Author the content pack (category copy, pSEO narratives, blog seed set,
   salary facts, imagery in your own storage bucket).
5. Regenerate the brand-leak baseline, then `npm run fork:preflight` — it must
   exit 0 (env completeness, config coherence, leftover-brand scan, pack
   integrity).
6. Provision accounts (Supabase, Vercel, Stripe, Resend, Upstash, Inngest,
   GSC/Bing/IndexNow) per the runbook checklist and deploy.

## Key documents

| Doc | Purpose |
|---|---|
| `docs/templatization-plan.md` | Architecture, phase history, deliberate deferrals |
| `docs/fork-checklist.md` | The per-fork change list |
| `docs/pilot-fork-runbook.md` | End-to-end launch sequence for a new board |
| `.env.example` | Every environment variable, annotated |

## Honest notes

- **Content is the real per-board cost.** The engine transfers for free; the
  relevance keyword pack needs a tuning loop against real ingestion data, and
  category/pSEO/blog copy must be authored per niche. Budget weeks for
  content, days for code.
- Some surfaces are still first-board-shaped by design (credential schema
  fields, pSEO editorial layer, AI prompts/eval fixtures, browser extension,
  `scripts/` operator tools) — see the deferrals section of
  `docs/templatization-plan.md`.
- Production builds expect live infrastructure (`prisma migrate deploy` and
  static generation query the database; email modules need `RESEND_API_KEY`).

## License

MIT
