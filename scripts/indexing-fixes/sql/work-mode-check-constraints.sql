-- scripts/indexing-fixes/sql/work-mode-check-constraints.sql
--
-- Database CHECK constraints for the work-mode invariant (indexing audit
-- GFJ-01, the skeptic's optional step 4): isRemote means FULLY remote, so a
-- row is never both remote and hybrid, and each flag follows the stored mode.
-- The same rules are checked in code every day by the job-posting-integrity
-- cron (lib/work-mode-integrity.ts workModeViolations); these constraints
-- make the database refuse a write that breaks them.
--
-- THIS IS NOT A MIGRATION YET, ON PURPOSE. `npm run build` runs
-- `prisma migrate deploy` against production, and about 33 live rows broke
-- the invariant when the audit ran. Added now, the constraint would fail the
-- deploy (or, NOT VALID, reject the next view-count or renewal update of an
-- inconsistent row). Order of work for the owner:
--   1. Run scripts/backfill-remote-flags.ts: dry run, review the CSV, then
--      --apply, then --check (exit 0).
--   2. Confirm the job-posting-integrity cron reports bothWorkModeFlags = 0
--      and flagsDisagreeWithMode = 0 (cron_runs.metrics, or GET
--      /api/cron/job-posting-integrity as an admin).
--   3. Copy this file to prisma/migrations/<UTC timestamp>_work_mode_checks/
--      migration.sql and ship it in its own commit. The build applies it.
--
-- NOT VALID adds each constraint without scanning existing rows (a short
-- lock); VALIDATE then scans without blocking writes, and fails the
-- migration (nothing half-applied) if any row still breaks the rule.

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_remote_hybrid_exclusive"
  CHECK (NOT ("is_remote" AND "is_hybrid")) NOT VALID;

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_is_remote_follows_mode"
  CHECK ("is_remote" = ("mode" IS NOT DISTINCT FROM 'Remote')) NOT VALID;

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_is_hybrid_follows_mode"
  CHECK ("is_hybrid" = ("mode" IS NOT DISTINCT FROM 'Hybrid')) NOT VALID;

ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_remote_hybrid_exclusive";
ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_is_remote_follows_mode";
ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_is_hybrid_follows_mode";
