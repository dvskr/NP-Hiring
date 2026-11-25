-- jobs.twin_company_linked_at: when lib/paid-post-twins-sync.ts filed a paid
-- post under the company its copies were listed under.
--
-- The sync takes a post off a company page, once its account is no longer
-- verified for its name, only when this is set. On this board an employer
-- post can also be filed under a company another way (scripts/link-all-jobs.ts
-- files every job without one, a company merge moves links), and every link
-- already on the table was made that way, so the sync must never undo those.
--
-- Additive, applied by `prisma migrate deploy` while the previous deployment
-- still serves: one nullable column with no default and no backfill, a
-- catalog-only change that does not rewrite the table. Every existing row
-- reads as "not filed by the sync". The old code never reads the column. In a
-- file of its own, after the twin migrations, so a database that already ran
-- an earlier draft of 20261126000004 still gets it.
-- tests/regressions/verified-employer-twins-migration.test.ts pins this file.

-- Wait at most 5 seconds for the lock on jobs: a deploy that would queue
-- behind a long transaction fails and is retried, instead of stalling every
-- read and write queued behind it. SET LOCAL, for this migration's
-- transaction only.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "jobs" ADD COLUMN "twin_company_linked_at" TIMESTAMP(3);
