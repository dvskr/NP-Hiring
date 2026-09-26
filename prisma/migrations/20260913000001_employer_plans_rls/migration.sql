-- Service-role-only access for employer_plans, like job_charges and
-- processed_stripe_events (supabase/rls-policies.sql, system tables).
--
-- Today no grant reaches this table: production's default privileges give
-- anon and authenticated nothing on tables that postgres creates in public.
-- RLS with no policies keeps it closed if a grant is ever added, since the
-- table holds billing emails and Stripe customer and subscription ids.
--
-- The app is unaffected: its database role bypasses RLS (checked read-only
-- on 2026-09-27: rolbypassrls = true), which is also how it already writes
-- processed_stripe_events and job_charges with RLS enabled.

ALTER TABLE "employer_plans" ENABLE ROW LEVEL SECURITY;
