-- B112: job_charges.employer_job_id had no foreign key — deleting a Job
-- (cascading to employer_jobs) silently orphaned charge rows with dangling
-- ids, and nothing guaranteed referential integrity for new writes.
--
-- Behavior choice: ON DELETE SET NULL (not CASCADE, not RESTRICT).
--   - CASCADE would delete the financial ledger with the job — wrong for
--     accounting and refund/dispute audit trails.
--   - RESTRICT would block the GDPR purge and cleanup crons from deleting
--     any job that was ever paid for.
--   - SET NULL preserves the ledger row (amounts, Stripe ids, refund
--     fields) while the refund/dispute webhook handlers already treat a
--     charge without a matching employer_jobs row as an orphaned ledger
--     row: they log a warning and skip entitlement revocation.

-- 1. Column must be nullable for SET NULL.
ALTER TABLE "job_charges" ALTER COLUMN "employer_job_id" DROP NOT NULL;

-- 2. Null out pre-existing orphans so the constraint can be added.
UPDATE "job_charges"
SET "employer_job_id" = NULL
WHERE "employer_job_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "employer_jobs" ej WHERE ej."id" = "job_charges"."employer_job_id"
  );

-- 3. Add the FK.
ALTER TABLE "job_charges"
    ADD CONSTRAINT "job_charges_employer_job_id_fkey"
    FOREIGN KEY ("employer_job_id") REFERENCES "employer_jobs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
