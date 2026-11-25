-- Service-role-only access for social_post_logs, like employer_plans
-- (20260913000001_employer_plans_rls) and job_charges.
--
-- The table holds admin-only data (where and when a job was posted) and is
-- read and written through Prisma by the app's database role, which bypasses
-- row level security. With RLS on and no policies, the anon and
-- authenticated roles behind Supabase's public API can read nothing here
-- even if a later grant ever reached the table.

ALTER TABLE "social_post_logs" ENABLE ROW LEVEL SECURITY;
