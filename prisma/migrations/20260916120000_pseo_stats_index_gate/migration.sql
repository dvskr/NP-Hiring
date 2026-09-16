-- pSEO index gate columns on PseoStats (pSEO thin-content program, PLAN C.2).
--
-- Additive only, following the profession-class precedent
-- (20260821000000_add_job_profession_class): two NOT NULL columns with
-- defaults on an existing table. No backfill, no index, no drop, no type
-- change. Generated with
--   prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma --script
-- against the committed datamodel, never against a database.
--
-- distinctEmployers: distinct canonical employers behind totalJobs, written
--   by app/api/cron/aggregate-pseo. Feeds shouldIndexLocalListingPage
--   (lib/pseo/render-gate.ts): a category x city or city page indexes only
--   at 3 or more jobs from 2 or more employers.
-- indexable: the cron's verdict from shouldIndexSettingState for
--   setting x state rows, and from shouldIndexListingPage for the
--   category-landing rows keyed locationSlug = 'all'. The cities sitemap
--   filters on it instead of totalJobs >= 1.
--
-- WHY DEFAULTS OF 0 AND false: every existing row leaves the sitemap until
-- the next aggregate-pseo run recomputes it (one 6h cadence at most).
-- Advertising fewer URLs for a few hours is the safe direction; advertising
-- a URL the page renders noindex is the defect this migration removes.
--
-- CLIENT NOTE: until the branch merges and `prisma generate` runs, the
-- generated client does not know these columns. Readers and writers use
-- prisma.$queryRaw / prisma.$executeRaw tagged templates.

-- AlterTable
ALTER TABLE "PseoStats" ADD COLUMN     "distinctEmployers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "indexable" BOOLEAN NOT NULL DEFAULT false;
