-- ============================================================================
-- Row-Level Security policies â€” NP Hiring
-- ============================================================================
--
-- Why this exists: `prisma db push` doesn't manage RLS. Without these
-- policies, ANYONE with the anon key (which is intentionally public, used
-- in the browser) can read ALL rows in tables that hold user data â€”
-- including user_profiles, candidate licenses, saved jobs, messages, etc.
--
-- NOT APPLIED AUTOMATICALLY. No deploy step or migration runs this file.
-- The live database (docs/AUDIT_RUNBOOK.md A.10) has only the two
-- blog_posts policies, and the anon and authenticated roles hold a table
-- grant on blog_posts only, so no other table is reachable through the data
-- API whatever this file says. Applying it, or restoring any grant, is an
-- owner decision: review every policy below against the live grants first.
--
-- To apply: paste it into Supabase Dashboard, SQL Editor, and run it.
-- Safe to re-run: every policy is DROP POLICY IF EXISTS, then CREATE POLICY.
--
-- Every policy below only reads (FOR SELECT). The app writes every table
-- through its own routes (Prisma, with the service role) and queries no
-- table but blog_posts through supabase-js, so no write policy is needed,
-- and a FOR ALL owner policy would let the owner of a row write any of its
-- columns through PostgREST.
--
-- Coverage:
--   - user_profiles: each signed-in user may read their own row, and
--     nothing else; no writes and no cross-user reads (see that section)
--   - candidate_* tables: the owner may read their own rows
--   - employer_jobs, employer-side records: the owner may read their own rows
--   - saved_jobs, job_applications: the owner may read their own rows
--   - conversations, messages: each participant may read them
--   - job_alerts, email_leads: no policy, so service_role only
--   - public job data (jobs, companies): readable when published
--   - audit/system tables: service_role only (denies anon entirely)
--
-- The Prisma client in our Next.js server uses the SERVICE_ROLE_KEY for
-- writes, which bypasses RLS. The anon key (browser) is restricted by these
-- policies.
-- ============================================================================

-- â”€â”€ Public-read tables (when published) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jobs_public_read ON jobs;
CREATE POLICY jobs_public_read ON jobs
    FOR SELECT TO anon, authenticated
    USING (is_published = true);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_public_read ON companies;
CREATE POLICY companies_public_read ON companies
    FOR SELECT TO anon, authenticated
    USING (true);

ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blog_posts_public_read ON blog_posts;
CREATE POLICY blog_posts_public_read ON blog_posts
    FOR SELECT TO anon, authenticated
    USING (status = 'published');

ALTER TABLE youtube_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS youtube_videos_public_read ON youtube_videos;
CREATE POLICY youtube_videos_public_read ON youtube_videos
    FOR SELECT TO anon, authenticated
    USING (status = 'published');

ALTER TABLE city_snippets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS city_snippets_public_read ON city_snippets;
CREATE POLICY city_snippets_public_read ON city_snippets
    FOR SELECT TO anon, authenticated
    USING (approved_at IS NOT NULL);

ALTER TABLE category_city_snippets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS category_city_snippets_public_read ON category_city_snippets;
CREATE POLICY category_city_snippets_public_read ON category_city_snippets
    FOR SELECT TO anon, authenticated
    USING (approved_at IS NOT NULL);

-- â”€â”€ User-owned tables (auth.uid() match) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- SECURITY: read-only, own row only. This policy was FOR ALL with no column
-- limit, so once applied with a grant restored a signed-in user could PATCH
-- or INSERT their own row through PostgREST with {"role":"admin"}, and every
-- admin guard reads that column. A second policy let ANY signed-in user read
-- every visible profile with all of its columns (EEO answers, NPI and DEA
-- numbers, address). Profiles are written only by the app's own routes
-- (Prisma, which bypasses RLS), and employers browse candidates through
-- those routes, which choose the columns, so no write policy and no browse
-- policy is needed. The own-row read stays: every owner policy below finds
-- the caller's profile id with a subquery on this table, which RLS filters
-- through this policy. The DROP below removes a browse policy an older run
-- of this file created. tests/regressions/rls-user-profiles-policy.test.ts
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_profiles_owner ON user_profiles;
CREATE POLICY user_profiles_owner ON user_profiles
    FOR SELECT TO authenticated
    USING (supabase_id = auth.uid()::text);
DROP POLICY IF EXISTS user_profiles_employer_browse ON user_profiles;

-- SECURITY: every owner and participant policy from here down was FOR ALL
-- with no column limit, the class user_profiles had: once applied with a
-- grant restored, the owner of a row could write any of its columns through
-- PostgREST (publish or mark paid their own employer_jobs row, save
-- candidates or add alerts past the routes' plan and pool gates, insert
-- messages as either participant). The app writes all of these tables
-- through Prisma alone, so each policy now only reads.
-- tests/regressions/rls-user-profiles-policy.test.ts
ALTER TABLE candidate_licenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_licenses_owner ON candidate_licenses;
CREATE POLICY candidate_licenses_owner ON candidate_licenses
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE candidate_certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_certifications_owner ON candidate_certifications;
CREATE POLICY candidate_certifications_owner ON candidate_certifications
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE candidate_education ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_education_owner ON candidate_education;
CREATE POLICY candidate_education_owner ON candidate_education
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE candidate_work_experience ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_work_experience_owner ON candidate_work_experience;
CREATE POLICY candidate_work_experience_owner ON candidate_work_experience
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE candidate_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_references_owner ON candidate_references;
CREATE POLICY candidate_references_owner ON candidate_references
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE candidate_screening_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_screening_answers_owner ON candidate_screening_answers;
CREATE POLICY candidate_screening_answers_owner ON candidate_screening_answers
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE candidate_open_ended_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_open_ended_responses_owner ON candidate_open_ended_responses;
CREATE POLICY candidate_open_ended_responses_owner ON candidate_open_ended_responses
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_jobs_owner ON saved_jobs;
CREATE POLICY saved_jobs_owner ON saved_jobs
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_applications_owner ON job_applications;
CREATE POLICY job_applications_owner ON job_applications
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

-- â”€â”€ Job alerts (email-keyed, no user_id) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- These use the alert's confirmation_token for ownership; not exposed to
-- anon at all. Service role manages all access.
ALTER TABLE job_alerts ENABLE ROW LEVEL SECURITY;
-- (No policies â†’ denies all anon access; only service_role can read/write.)

ALTER TABLE email_leads ENABLE ROW LEVEL SECURITY;
-- (No policies â†’ service_role only.)

-- â”€â”€ Employer-side tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE employer_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employer_jobs_owner ON employer_jobs;
CREATE POLICY employer_jobs_owner ON employer_jobs
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE saved_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_candidates_owner ON saved_candidates;
CREATE POLICY saved_candidates_owner ON saved_candidates
    FOR SELECT TO authenticated
    USING (employer_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE candidate_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_tags_owner ON candidate_tags;
CREATE POLICY candidate_tags_owner ON candidate_tags
    FOR SELECT TO authenticated
    USING (employer_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE employer_testimonials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employer_testimonials_public_read ON employer_testimonials;
CREATE POLICY employer_testimonials_public_read ON employer_testimonials
    FOR SELECT TO anon, authenticated
    USING (featured_at IS NOT NULL);
-- The owner policy was employer_testimonials_owner_write, FOR ALL: an owner
-- could set featured_at on their own row and so publish it under the public
-- read above. It only reads now, under a name that says so; the first DROP
-- removes the write policy an older run of this file created.
DROP POLICY IF EXISTS employer_testimonials_owner_write ON employer_testimonials;
DROP POLICY IF EXISTS employer_testimonials_owner ON employer_testimonials;
CREATE POLICY employer_testimonials_owner ON employer_testimonials
    FOR SELECT TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

ALTER TABLE employer_candidate_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employer_candidate_alerts_owner ON employer_candidate_alerts;
CREATE POLICY employer_candidate_alerts_owner ON employer_candidate_alerts
    FOR SELECT TO authenticated
    USING (employer_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

-- â”€â”€ Messaging (both participants can access) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_participant ON conversations;
CREATE POLICY conversations_participant ON conversations
    FOR SELECT TO authenticated
    USING (
        participant_a IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text)
        OR participant_b IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text)
    );

ALTER TABLE employer_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employer_messages_participant ON employer_messages;
CREATE POLICY employer_messages_participant ON employer_messages
    FOR SELECT TO authenticated
    USING (
        sender_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text)
        OR recipient_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text)
    );

ALTER TABLE profile_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profile_views_owner ON profile_views;
CREATE POLICY profile_views_owner ON profile_views
    FOR SELECT TO authenticated
    USING (viewer_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text));

-- â”€â”€ System / audit tables â€” service_role only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- These have NO policies. RLS enabled + no policies = service_role only.

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejected_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE apply_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_view_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_eval_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feature_flag_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE shortlink_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_director_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE employer_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PseoStats" ENABLE ROW LEVEL SECURITY; -- template schema: PseoStats has no @@map (donor called it pseo_stats)
ALTER TABLE deindex_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE gsc_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE employer_plans ENABLE ROW LEVEL SECURITY; -- also in migration 20260913000001_employer_plans_rls
ALTER TABLE employer_post_packs ENABLE ROW LEVEL SECURITY; -- also in migration 20261025000000_add_employer_post_packs
ALTER TABLE jd_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_screening_questions ENABLE ROW LEVEL SECURITY;

-- â”€â”€ Verify â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- After running, confirm with:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND rowsecurity=true;
-- Should list all of the above ~50 tables.
