-- Data-only backfill (no schema changes). Pairs with the fix that makes the
-- two signup auto-creation paths (Google OAuth callback + /api/auth/profile)
-- set confirmed_at on the default "Job Highlights" alert.
--
-- Before that fix, auto-created alerts had confirmed_at = NULL, and the digest
-- sender (lib/job-alerts-service.ts) selects only alerts with
-- confirmed_at IS NOT NULL — so every auto-created alert was permanently
-- invisible to the sender: the flagship onboarding feature was dead for every
-- signup.
--
-- Consent basis: these rows were created either by account creation itself
-- (single opt-in, same policy the public /api/job-alerts endpoint already
-- applies) or by the user explicitly checking "job highlights" at signup.
-- We stamp created_at as the confirmation time — the moment consent was given.
--
-- Scoped to name = 'Job Highlights' (only the auto-created alerts) and
-- is_active = true. Manually created alerts pending double opt-in via
-- /api/job-alerts/confirm are untouched.
--
-- Idempotent: re-running matches zero rows once confirmed_at is set.

BEGIN;

UPDATE job_alerts
SET confirmed_at = created_at
WHERE confirmed_at IS NULL
  AND is_active = true
  AND name = 'Job Highlights';

COMMIT;
