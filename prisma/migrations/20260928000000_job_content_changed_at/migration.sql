-- jobs.content_changed_at: when a job's published content last changed.
-- Sitemap lastmod and the job page's "Last updated" line read it instead of
-- updated_at, which moves on every bookkeeping write (view counts, link and
-- presence checks, freshness scoring) and so told search engines that almost
-- every job changed every day.
--
-- Additive: one nullable column. The backfill copies created_at, which is the
-- last content change we can prove for existing rows. It is a plain SQL
-- UPDATE, so Prisma's @updatedAt does not fire and updated_at (the
-- deindex-expired cursor) is left untouched; jobs has no triggers.

ALTER TABLE "jobs" ADD COLUMN "content_changed_at" TIMESTAMP(3);

UPDATE "jobs" SET "content_changed_at" = "created_at" WHERE "content_changed_at" IS NULL;
