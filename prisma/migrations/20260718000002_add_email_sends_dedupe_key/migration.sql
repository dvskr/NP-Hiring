-- B109: per-effect idempotency for webhook-triggered emails. The Stripe
-- webhook dedupes whole events (processed_stripe_events) but rolls that
-- row back on partial failure so Stripe retries — meaning individual side
-- effects that DID complete (like an email send) would re-run on the
-- retry. A unique dedupe key lets the webhook atomically claim an email
-- send (insert-then-send); the retry's insert hits the unique violation
-- and skips the duplicate send. NULLs are distinct in Postgres unique
-- indexes, so ordinary sendAndLog rows (dedupe_key IS NULL) are unaffected.
ALTER TABLE "email_sends" ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "email_sends_dedupe_key_key"
    ON "email_sends"("dedupe_key");
