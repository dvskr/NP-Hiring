-- Company claim step (P3 brief #7, recommended slice: claim only).
--
-- Additive and reversible by construction: one nullable column on an existing
-- table plus one new table. No backfill, no data rewrite, no column drop, no
-- type change. Every existing companies row keeps claim_verified_at = NULL,
-- which is exactly the correct value for a scraped row that nobody has
-- claimed, so the new public badge renders nowhere until an admin approves a
-- real claim.
--
-- WHY A NEW COLUMN INSTEAD OF REUSING companies.is_verified:
-- is_verified is written once, at row creation, by lib/company-normalizer.ts
-- ("the scraped employer name matched the KNOWN_COMPANIES map"). It is already
-- live on the public UI. Overloading it with "an employer claimed this profile
-- and an admin approved it" would make one badge assert two unrelated things
-- and would retroactively upgrade the meaning of every already-badged row.
-- The two signals stay in two columns with two labels.

ALTER TABLE "companies" ADD COLUMN "claim_verified_at" TIMESTAMP(3);

CREATE TABLE "company_claims" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    -- Supabase auth user id (UserProfile.supabase_id / employer_jobs.user_id).
    -- Deliberately not an FK: employer_testimonials.user_id sets the precedent
    -- of holding the auth id loosely so account deletion cannot cascade away
    -- the moderation trail.
    "claimant_user_id" TEXT NOT NULL,
    -- Immutable submission-time evidence, same rationale as
    -- employer_jobs.quota_domain: the admin reviews what was true when the
    -- claim was filed, not whatever the account looks like at review time.
    "claimant_email" TEXT NOT NULL,
    "claimant_domain" TEXT NOT NULL,
    "company_host" TEXT,
    -- Advisory signals for the admin. Neither auto-approves nor auto-rejects.
    "domain_match" BOOLEAN NOT NULL DEFAULT false,
    "free_email_domain" BOOLEAN NOT NULL DEFAULT false,
    "claimant_role" TEXT,
    "note" TEXT,
    -- 'pending' | 'approved' | 'rejected'. Text rather than an enum so a
    -- future state needs no migration (employer_testimonials.display_as
    -- precedent).
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "review_note" TEXT,
    -- Holds company_id while pending, NULL once resolved. See the unique
    -- index below.
    "pending_company_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_claims_pkey" PRIMARY KEY ("id")
);

-- One OPEN claim per (company, claimant). pending_company_id is company_id
-- while the claim is pending and NULL once approved/rejected; Postgres treats
-- NULLs as distinct in unique indexes (the same property email_sends.dedupe_key
-- relies on), so resolved rows accumulate freely for the audit trail while a
-- duplicate pending submission hits this constraint and is refused with a 409.
CREATE UNIQUE INDEX "company_claims_pending_company_claimant_uq"
    ON "company_claims" ("pending_company_id", "claimant_user_id");

-- Profile page + claim route: "is there already an approved claim on this
-- company?" and "does this claimant already have an open claim?"
CREATE INDEX "company_claims_company_id_idx"
    ON "company_claims" ("company_id");

CREATE INDEX "company_claims_claimant_user_id_idx"
    ON "company_claims" ("claimant_user_id");

-- Admin queue: pending first, newest first.
CREATE INDEX "company_claims_status_created_at_idx"
    ON "company_claims" ("status", "created_at");

ALTER TABLE "company_claims"
    ADD CONSTRAINT "company_claims_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
