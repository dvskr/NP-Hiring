-- 5-post pack (2027 re-price, phase 2): a one-time purchase of 5 post
-- credits (config.packPosts) for $1,245 (config.packPrice), used within 12
-- months of purchase (config.packValidityMonths). Each credit publishes one
-- ordinary post, written to employer_jobs with payment_status = 'pack',
-- pricing_tier = 'pack' and post_pack_id set.
--
-- Additive, applied by `prisma migrate deploy` while the previous deployment
-- still serves: one new table, one nullable column on employer_jobs with its
-- index and foreign key, no backfill and no data change. The old code never
-- reads either, so it keeps working against this schema.
--
-- user_id is the Supabase auth id held loosely (no FK), the employer_plans
-- precedent (20260912000000_add_employer_plans): account deletion must not
-- cascade away the billing trail.
--
-- The CHECK is what Prisma cannot express, and the last line of defence
-- behind the conditional decrement in lib/post-packs.ts: credits never go
-- below zero, and never more are used plus revoked than were sold.
-- tests/regressions/post-pack-migration.test.ts pins this file.

CREATE TABLE "employer_post_packs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "quota_domain" TEXT,
    -- 'paid' | 'refunded' | 'disputed'. Text rather than an enum, as for
    -- employer_plans.status, so a future state needs no migration.
    "status" TEXT NOT NULL DEFAULT 'paid',
    -- 'stripe' | 'admin'
    "source" TEXT NOT NULL DEFAULT 'stripe',
    "credits_total" INTEGER NOT NULL,
    "credits_remaining" INTEGER NOT NULL,
    "credits_revoked" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "stripe_session_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_invoice_id" TEXT,
    "invoice_pdf_url" TEXT,
    "hosted_invoice_url" TEXT,
    "invoice_number" TEXT,
    "refunded_at" TIMESTAMP(3),
    "refunded_amount_cents" INTEGER,
    "refund_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employer_post_packs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employer_post_packs_credits_check" CHECK ("credits_remaining" >= 0 AND "credits_revoked" >= 0 AND "credits_remaining" + "credits_revoked" <= "credits_total")
);

-- The Stripe session is the key every fulfilment path (webhook, verify page,
-- reconciliation sweep) creates the pack by; the payment intent is how a
-- refund or a dispute finds it.
CREATE UNIQUE INDEX "employer_post_packs_stripe_session_id_key" ON "employer_post_packs"("stripe_session_id");
CREATE UNIQUE INDEX "employer_post_packs_stripe_payment_intent_id_key" ON "employer_post_packs"("stripe_payment_intent_id");
CREATE INDEX "employer_post_packs_user_id_status_expires_at_idx" ON "employer_post_packs"("user_id", "status", "expires_at");
CREATE INDEX "employer_post_packs_quota_domain_status_idx" ON "employer_post_packs"("quota_domain", "status");
CREATE INDEX "employer_post_packs_stripe_invoice_id_idx" ON "employer_post_packs"("stripe_invoice_id");

-- Service role only, with no policies, like employer_plans
-- (20260913000001_employer_plans_rls) and job_charges: the table holds
-- billing emails and Stripe ids. The app's role bypasses RLS.
ALTER TABLE "employer_post_packs" ENABLE ROW LEVEL SECURITY;

-- The pack whose credit published a post. Nullable, so every existing row is
-- valid as it stands; ON DELETE SET NULL, so deleting a pack never deletes a
-- post (the job_charges.employer_job_id precedent, 20260718000001).
ALTER TABLE "employer_jobs" ADD COLUMN "post_pack_id" TEXT;

CREATE INDEX "employer_jobs_post_pack_id_idx" ON "employer_jobs"("post_pack_id");

ALTER TABLE "employer_jobs"
    ADD CONSTRAINT "employer_jobs_post_pack_id_fkey"
    FOREIGN KEY ("post_pack_id") REFERENCES "employer_post_packs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
