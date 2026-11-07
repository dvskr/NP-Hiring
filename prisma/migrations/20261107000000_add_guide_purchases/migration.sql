-- NP guides store (/guides): one row per delivery of a guide or a bundle,
-- either claimed free during the launch promo (source 'promo', POST
-- /api/guides/claim) or bought through Stripe Checkout from
-- config.promoEndsAt (source 'stripe', lib/guides/fulfill.ts).
--
-- Additive, applied by `prisma migrate deploy` while the previous deployment
-- still serves: one new table and its indexes, no change to any existing
-- table or row. The old code never reads it.
--
-- user_id is the Supabase auth id held loosely (no FK), the
-- employer_post_packs precedent: a purchase is the sales record and outlives
-- an account. Account erasure (the purge cron) nulls email and user_id.
--
-- The CHECK is what Prisma cannot express: a Stripe row always has its
-- Checkout session, and a promo row has no Stripe ids and no amount, so a
-- refund or dispute (matched by payment intent) can never reach a claim.
-- tests/regressions/guide-purchases-migration.test.ts pins this file.

-- Wait at most 5 seconds for a lock: a deploy that would queue behind a long
-- transaction fails and is retried, instead of stalling every write queued
-- behind it. SET LOCAL, for this migration's transaction only: a
-- session-level SET would outlive it on a pooled connection.
SET LOCAL lock_timeout = '5s';

-- CreateTable
CREATE TABLE "guide_purchases" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'stripe',
    "stripe_session_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "email" TEXT,
    "user_id" TEXT,
    "product_slug" VARCHAR(64) NOT NULL,
    "guide_slugs" TEXT[],
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'usd',
    "access_token" TEXT NOT NULL,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "email_sent_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "disputed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "guide_purchases_source_check" CHECK (
        ("source" = 'stripe' AND "stripe_session_id" IS NOT NULL)
        OR ("source" = 'promo' AND "stripe_session_id" IS NULL AND "stripe_payment_intent_id" IS NULL AND "amount_cents" = 0)
    )
);

-- The Checkout session is the key both fulfilment paths (webhook, success
-- page) create a sale by; the payment intent is how a refund or a dispute
-- finds it; the access token is the reader's library credential. Postgres
-- allows any number of NULLs under a unique index, so promo rows coexist.
CREATE UNIQUE INDEX "guide_purchases_stripe_session_id_key" ON "guide_purchases"("stripe_session_id");

CREATE UNIQUE INDEX "guide_purchases_stripe_payment_intent_id_key" ON "guide_purchases"("stripe_payment_intent_id");

CREATE UNIQUE INDEX "guide_purchases_access_token_key" ON "guide_purchases"("access_token");

CREATE INDEX "guide_purchases_email_idx" ON "guide_purchases"("email");

CREATE INDEX "guide_purchases_created_at_idx" ON "guide_purchases"("created_at");

-- Service role only, with no policies, like employer_post_packs and the
-- OAuth tables: the table holds reader emails and bearer tokens. The app's
-- database role bypasses RLS.
ALTER TABLE "guide_purchases" ENABLE ROW LEVEL SECURITY;
