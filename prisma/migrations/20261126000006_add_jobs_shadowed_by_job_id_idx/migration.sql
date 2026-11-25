-- The index on jobs.shadowed_by_job_id (20261126000004_add_verified_employer_twins),
-- named as Prisma names the schema's @@index([shadowedByJobId]). The sync
-- reads every marked row by it, and a paid post's copies are counted and
-- released by it.
--
-- In its own file, so its own transaction. CREATE INDEX takes a SHARE lock
-- on jobs: reads continue while the index builds, writes wait until it is
-- built, and the lock is released when this file's transaction ends.
-- CREATE INDEX CONCURRENTLY would hold no writes, but it cannot run inside a
-- transaction and no migration in this repository uses it; IF NOT EXISTS
-- lets the file run again on a database where the index was built by hand.
--
-- Wait at most 5 seconds for the lock: while CREATE INDEX waits behind an
-- open write transaction, every new write to jobs queues behind it, so a
-- deploy that would wait longer fails and is retried instead. SET LOCAL, for
-- this migration's transaction only.
-- tests/regressions/verified-employer-twins-migration.test.ts pins this file.
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS "jobs_shadowed_by_job_id_idx" ON "jobs"("shadowed_by_job_id");
