-- Stripe integration hardening. Additive only: three nullable/defaulted
-- columns, no backfill, no data rewrite, no index or type change.
--
-- employer_jobs.stripe_checkout_session_id — the latest Checkout Session
--   minted for a posting. /api/create-checkout's resume path expires the
--   previous session before minting a new one, so one posting never has two
--   payable sessions (a second payment for one posting is also detected and
--   alerted at activation).
--
-- processed_stripe_events.status / claimed_at — two-phase webhook dedupe.
--   New deliveries insert 'processing' and flip to 'done' on success; a
--   'processing' row older than the reclaim window (a timed-out or killed
--   function) can be taken over by Stripe's retry instead of being
--   acknowledged as a duplicate. Existing rows default to 'done', which is
--   exactly what they are.
--
-- employer_plans.last_stripe_event_at — `created` of the newest subscription
--   event applied to the row; older out-of-order deliveries are ignored.

ALTER TABLE "employer_jobs" ADD COLUMN "stripe_checkout_session_id" TEXT;

ALTER TABLE "processed_stripe_events" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'done';
ALTER TABLE "processed_stripe_events" ADD COLUMN "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "employer_plans" ADD COLUMN "last_stripe_event_at" TIMESTAMP(3);
