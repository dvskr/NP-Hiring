-- Direct-hire vs staffing-agency classification (competitive teardown A6).
--
-- Additive and reversible by construction, following the claim-step precedent
-- (20260731000000_add_company_claims): one new enum type plus one NULLABLE
-- column on an existing table. No backfill, no default, no data rewrite, no
-- column drop, no type change. Every existing companies row keeps
-- recruitment_type = NULL, which is exactly the correct value for a row no
-- human has classified — the candidate-side badge and filter render nothing
-- for NULL, so this migration changes zero public surfaces on its own.
--
-- WHY NO BACKFILL / NO HEURISTIC: classification is a HUMAN act, performed one
-- company at a time from /admin/companies (PATCH /api/admin/companies/:id is
-- the only writer, audit-logged). Name keywords ("staffing", "locums") and
-- website hosts are unreliable evidence in both directions, and a wrong
-- "staffing agency" label on a real employer — or the reverse — is a public
-- trust failure attached to a named organization.
--
-- WHY AN ENUM (vs the TEXT pattern company_claims.status uses): claim status
-- legitimately grows workflow states without ceremony, but this is a closed
-- two-value fact about what kind of organization the company is; a third value
-- would be a product decision worth a migration. "unclassified" is
-- deliberately NOT a value — it is the NULL state, so nothing can ever write
-- "unclassified" as if it were a positive classification.
--
-- WHY NO INDEX: companies holds ~150 rows (2026-08); candidate-side filtering
-- reaches this column through the already-indexed jobs.company_id join and a
-- trivially small companies scan. If the table ever grows enough to matter,
-- add the index in its own migration with an explicit map: name, per the
-- company_claims index-naming precedent.

CREATE TYPE "RecruitmentType" AS ENUM ('direct_hire', 'staffing_agency');

ALTER TABLE "companies" ADD COLUMN "recruitment_type" "RecruitmentType";
