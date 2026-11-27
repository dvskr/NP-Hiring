-- The index on jobs.state_code, named as Prisma names the schema's
-- @@index([stateCode]).
--
-- Every city page, state page and state directory filters jobs by
-- (state = $name OR state_code = $code). jobs.state has had an index since
-- 0_init and state_code had none, so PostgreSQL could not combine the two
-- with a bitmap OR and read the whole jobs table instead, several times per
-- uncached city page. On Nov 26 a burst on the city pages held enough
-- connections in those reads to fill the pooler's 200 clients.
--
-- In its own file, so its own transaction. CREATE INDEX takes a SHARE lock
-- on jobs: reads continue while the index builds, writes wait until it is
-- built. IF NOT EXISTS lets the file run again on a database where the index
-- was built by hand. Wait at most 5 seconds for the lock, as
-- 20261126000006_add_jobs_shadowed_by_job_id_idx does, so a deploy behind an
-- open write fails and is retried instead of queueing every write.
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS "jobs_state_code_idx" ON "jobs"("state_code");
