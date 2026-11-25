-- The admin social kit's posting tracker (/admin/social-kit): one row each
-- time a live paid job was posted to a social platform or forum, logged by
-- hand from the kit. Clicks on those posts stay in shortlink_clicks under
-- the campaign 'organic-paid-jobs'; this table records where and when each
-- post went out.
--
-- Additive, applied by `prisma migrate deploy` while the previous deployment
-- still serves: one new table, its indexes and its foreign key to jobs, no
-- change to any existing column or row. The old code never reads it.
--
-- ON DELETE CASCADE: a log is about one job and means nothing without it,
-- so deleting a job (the purge and cleanup crons) takes its logs with it.
-- Row level security is turned on by the next migration,
-- 20261126000003_social_post_logs_rls.
-- tests/regressions/social-post-logs-migration.test.ts pins this file.

-- Wait at most 5 seconds for a lock (the foreign key below locks jobs): a
-- deploy that would queue behind a long transaction fails and is retried,
-- instead of stalling every write queued behind it. SET LOCAL, for this
-- migration's transaction only: a session-level SET would outlive it on a
-- pooled connection.
SET LOCAL lock_timeout = '5s';

-- CreateTable
CREATE TABLE "social_post_logs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "venue" VARCHAR(120),
    "post_url" VARCHAR(500),
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_post_logs_pkey" PRIMARY KEY ("id")
);

-- The kit reads every log for a page of jobs, per job and platform, newest
-- first; the second index serves reads by date alone.
CREATE INDEX "social_post_logs_job_id_platform_posted_at_idx" ON "social_post_logs"("job_id", "platform", "posted_at");

CREATE INDEX "social_post_logs_posted_at_idx" ON "social_post_logs"("posted_at");

ALTER TABLE "social_post_logs"
    ADD CONSTRAINT "social_post_logs_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
