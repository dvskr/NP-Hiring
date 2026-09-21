-- Employer plan ($399/month, config.planPrice): N concurrent job slots, live
-- while subscribed. Additive: one new table, no backfill, no change to
-- employer_jobs. Plan posts are ordinary employer_jobs rows with
-- payment_status = 'plan' / pricing_tier = 'plan'.
--
-- user_id is the Supabase auth id held loosely (no FK), the
-- company_claims.claimant_user_id precedent: account deletion must not
-- cascade away the billing trail. It is NULL when the Stripe checkout email
-- matched no employer account; `email` lets an admin attach the row later.

CREATE TABLE "employer_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    -- 'active' | 'past_due' | 'cancelled'. Text rather than an enum so a
    -- future state needs no migration (employer_testimonials.display_as
    -- precedent).
    "status" TEXT NOT NULL DEFAULT 'active',
    "slots" INTEGER NOT NULL DEFAULT 5,
    "price_cents" INTEGER NOT NULL DEFAULT 39900,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    -- 'stripe' | 'admin'
    "source" TEXT NOT NULL DEFAULT 'stripe',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employer_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employer_plans_user_id_key" ON "employer_plans"("user_id");
CREATE UNIQUE INDEX "employer_plans_stripe_subscription_id_key" ON "employer_plans"("stripe_subscription_id");
CREATE INDEX "employer_plans_email_idx" ON "employer_plans"("email");
CREATE INDEX "employer_plans_status_current_period_end_idx" ON "employer_plans"("status", "current_period_end");
