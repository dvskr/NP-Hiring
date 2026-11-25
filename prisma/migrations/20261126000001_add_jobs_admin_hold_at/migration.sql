-- jobs.admin_hold_at: a posting an admin took down, which only an admin can
-- put back (lib/admin/job-hold.ts).
--
-- Taking a posting down from the admin tools set is_published = false and
-- is_manually_unpublished = true, which is also what an employer's own pause
-- looks like. So the employer could press Unpause on the dashboard, or buy a
-- renewal, and undo a removal made for a policy reason. An admin takedown now
-- stamps this column as well, and while it is set the owner's resume and
-- renewal are refused and no payment puts the posting back up. An admin
-- publishing the posting again clears it.
--
-- Additive, applied by `prisma migrate deploy` while the previous deployment
-- still serves: one nullable column with no default and no backfill. On
-- PostgreSQL that is a catalog-only change: the table is not rewritten and
-- its lock is held only for the moment of the change. Every existing posting
-- starts with no hold, so nothing a visitor sees changes on deploy, and the
-- old code never reads the column. jobs has no triggers.
-- tests/regressions/jobs-admin-hold-migration.test.ts pins this file.

-- Wait at most 5 seconds for the lock on jobs: a deploy that would queue
-- behind a long transaction fails and is retried, instead of stalling every
-- read and write queued behind it. SET LOCAL, for this migration's
-- transaction only: a session-level SET would outlive it on a pooled
-- connection.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "jobs" ADD COLUMN "admin_hold_at" TIMESTAMP(3);
