-- Job profession classification (live-review fix #1 — quarantine work package).
--
-- Additive and reversible by construction, following the claim-step precedent
-- (20260731000000_add_company_claims) and the recruitment-type precedent
-- (20260806000000_add_company_recruitment_type): one new enum type plus two
-- NULLABLE columns and one index on an existing table. No backfill, no
-- default, no data rewrite, no column drop, no type change. Every existing
-- jobs row keeps profession_class = NULL, which is exactly the correct value
-- for a row the classifier has not seen — every query-time gate lets NULL
-- pass, so this migration changes zero public surfaces on its own and can
-- never mass-unpublish or mass-hide inventory on deploy.
--
-- WHY AN ENUM (vs text): this is a closed fact about which profession a
-- posting recruits; a ninth value is a product decision worth a migration.
-- "unknown"/"unclassified" is deliberately NOT a value — it is the NULL
-- state, so nothing can ever write "unclassified" as a positive class.
--
-- WHY NULLABLE + NO BACKFILL HERE: classification of existing rows is a
-- separate, human-gated step (scripts/backfill-profession-class.ts, dry-run
-- by default). The ingest pipeline classifies new rows at insert
-- (lib/ingestion-service.ts -> lib/profession-classifier.ts, deterministic
-- rules with confidence — no LLM calls).
--
-- WHY AN INDEX: unlike companies.recruitment_type (~150 rows), jobs holds
-- thousands of rows and EVERY published-listing predicate composes the
-- profession gate (GLOBAL_EXCLUSIONS in lib/filters.ts) plus both semantic
-- search legs filter on it in SQL; the backfill/quarantine scripts also scan
-- by class. Index name matches Prisma's default for @@index([professionClass]).

CREATE TYPE "ProfessionClass" AS ENUM (
    'np_eligible',
    'aprn_midwife',
    'aprn_crna',
    'aprn_cns',
    'pa_only',
    'physician',
    'other_clinical',
    'nonclinical'
);

ALTER TABLE "jobs" ADD COLUMN "profession_class" "ProfessionClass";
ALTER TABLE "jobs" ADD COLUMN "profession_confidence" DOUBLE PRECISION;

CREATE INDEX "jobs_profession_class_idx" ON "jobs"("profession_class");
