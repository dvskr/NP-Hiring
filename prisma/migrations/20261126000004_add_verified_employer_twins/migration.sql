-- Verify Employers and paid-post twins (lib/paid-post-twins.ts).
--
-- Additive, applied by `prisma migrate deploy` while the previous deployment
-- still serves: two new columns and one foreign key, no backfill and no data
-- change. The old code never reads either column.
--
-- Prisma runs each migration file as one transaction, and every lock a
-- statement takes is held until that transaction ends. So the work is split
-- across four files, each holding its locks only for its own statements:
--   20261126000004 (this file): catalog-only changes under a short ACCESS
--     EXCLUSIVE lock, with the foreign key added NOT VALID, which skips the
--     scan of existing rows;
--   20261126000005: VALIDATE CONSTRAINT, the scan, under a lock that lets
--     reads and writes continue;
--   20261126000006: the index, which holds writes, never reads, while it builds;
--   20261126000007: ANALYZE, so the planner sees the new column.
-- tests/regressions/verified-employer-twins-migration.test.ts pins all four.
--
-- user_profiles.verified_employer_org_keys: the employer names an operator
-- confirmed the account speaks for, as lib/paid-post-twins.ts employerOrgKey
-- keys, written only from /admin/verify-employers. A paid post hides that
-- employer's free copies, and an employer post shows the Verified employer
-- check, only while its account is confirmed here. A constant default, so
-- the table is not rewritten.
--
-- jobs.shadowed_by_job_id: a free feed listing that copies a confirmed
-- employer's live paid post points at that post. Every listing predicate
-- hides a marked row and its URL redirects to the post. Nullable with no
-- default, so every existing row is valid as it stands. ON DELETE SET NULL:
-- deleting the paid post releases its copies at once instead of waiting for
-- the next hourly sync. The constraint name matches Prisma's default for the
-- PaidPostTwin relation. NOT VALID still enforces the key on every row
-- written from now on; it only defers the check of the rows already there,
-- which 20261126000005 makes. Every one of them is NULL here, so that check
-- cannot fail.

-- Wait at most 5 seconds for a lock (the statements below lock jobs and
-- user_profiles): a deploy that would queue behind a long transaction fails
-- and is retried, instead of stalling every read and write queued behind it.
-- SET LOCAL, for this migration's transaction only: a session-level SET
-- would outlive it on a pooled connection.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "user_profiles" ADD COLUMN "verified_employer_org_keys" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "jobs" ADD COLUMN "shadowed_by_job_id" TEXT;

ALTER TABLE "jobs"
    ADD CONSTRAINT "jobs_shadowed_by_job_id_fkey"
    FOREIGN KEY ("shadowed_by_job_id") REFERENCES "jobs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
