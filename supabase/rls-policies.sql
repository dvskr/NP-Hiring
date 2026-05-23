-- ============================================================================
-- Row-Level Security policies — NP Hiring
-- ============================================================================
--
-- Why this exists: `prisma db push` doesn't manage RLS. Without these
-- policies, ANYONE with the anon key (which is intentionally public, used
-- in the browser) can read ALL rows in tables that hold user data —
-- including user_profiles, candidate licenses, saved jobs, messages, etc.
--
-- Paste this file ONCE into Supabase Dashboard → SQL Editor → Run.
-- Safe to re-run: every policy uses `CREATE POLICY IF NOT EXISTS` pattern
-- (Postgres 15+) or is DROP-then-CREATE.
--
-- Coverage:
--   - user_profiles, candidate_* tables → owner-only
--   - employer_jobs, employer-side records → owner-only
--   - saved_jobs, job_alerts, conversations, messages → owner-only
--   - public job data (jobs, companies) → readable when published
--   - audit/system tables → service_role only (denies anon entirely)
--
-- The Prisma client in our Next.js server uses the SERVICE_ROLE_KEY for
-- writes, which bypasses RLS. The anon key (browser) is restricted by these
-- policies.
-- ============================================================================

-- ── Public-read tables (when published) ────────────────────────────────────

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

-- ── User-owned tables (auth.uid() match) ──────────────────────────────────

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_profiles_owner ON user_profiles;
CREATE POLICY user_profiles_owner ON user_profiles
    FOR ALL TO authenticated
    USING (supabase_id = auth.uid())
    WITH CHECK (supabase_id = auth.uid());
-- Also allow employers to see profiles where profile_visible=true
DROP POLICY IF EXISTS user_profiles_employer_browse ON user_profiles;
CREATE POLICY user_profiles_employer_browse ON user_profiles
    FOR SELECT TO authenticated
    USING (profile_visible = true AND open_to_offers = true);

ALTER TABLE candidate_licenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_licenses_owner ON candidate_licenses;
CREATE POLICY candidate_licenses_owner ON candidate_licenses
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE candidate_certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_certifications_owner ON candidate_certifications;
CREATE POLICY candidate_certifications_owner ON candidate_certifications
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE candidate_education ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_education_owner ON candidate_education;
CREATE POLICY candidate_education_owner ON candidate_education
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE candidate_work_experience ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_work_experience_owner ON candidate_work_experience;
CREATE POLICY candidate_work_experience_owner ON candidate_work_experience
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE candidate_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_references_owner ON candidate_references;
CREATE POLICY candidate_references_owner ON candidate_references
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE candidate_screening_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_screening_answers_owner ON candidate_screening_answers;
CREATE POLICY candidate_screening_answers_owner ON candidate_screening_answers
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE candidate_open_ended_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_open_ended_responses_owner ON candidate_open_ended_responses;
CREATE POLICY candidate_open_ended_responses_owner ON candidate_open_ended_responses
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_jobs_owner ON saved_jobs;
CREATE POLICY saved_jobs_owner ON saved_jobs
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_applications_owner ON job_applications;
CREATE POLICY job_applications_owner ON job_applications
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

-- ── Job alerts (email-keyed, no user_id) ──────────────────────────────────
-- These use the alert's confirmation_token for ownership; not exposed to
-- anon at all. Service role manages all access.
ALTER TABLE job_alerts ENABLE ROW LEVEL SECURITY;
-- (No policies → denies all anon access; only service_role can read/write.)

ALTER TABLE email_leads ENABLE ROW LEVEL SECURITY;
-- (No policies → service_role only.)

-- ── Employer-side tables ──────────────────────────────────────────────────

ALTER TABLE employer_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employer_jobs_owner ON employer_jobs;
CREATE POLICY employer_jobs_owner ON employer_jobs
    FOR ALL TO authenticated
    USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE saved_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_candidates_owner ON saved_candidates;
CREATE POLICY saved_candidates_owner ON saved_candidates
    FOR ALL TO authenticated
    USING (employer_user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (employer_user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE candidate_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_tags_owner ON candidate_tags;
CREATE POLICY candidate_tags_owner ON candidate_tags
    FOR ALL TO authenticated
    USING (employer_user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (employer_user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE employer_testimonials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employer_testimonials_public_read ON employer_testimonials;
CREATE POLICY employer_testimonials_public_read ON employer_testimonials
    FOR SELECT TO anon, authenticated
    USING (featured_at IS NOT NULL);
DROP POLICY IF EXISTS employer_testimonials_owner_write ON employer_testimonials;
CREATE POLICY employer_testimonials_owner_write ON employer_testimonials
    FOR ALL TO authenticated
    USING (employer_user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (employer_user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

ALTER TABLE employer_candidate_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employer_candidate_alerts_owner ON employer_candidate_alerts;
CREATE POLICY employer_candidate_alerts_owner ON employer_candidate_alerts
    FOR ALL TO authenticated
    USING (employer_user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()))
    WITH CHECK (employer_user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

-- ── Messaging (both participants can access) ──────────────────────────────

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_participant ON conversations;
CREATE POLICY conversations_participant ON conversations
    FOR ALL TO authenticated
    USING (
        participant_a_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid())
        OR participant_b_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid())
    );

ALTER TABLE employer_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employer_messages_participant ON employer_messages;
CREATE POLICY employer_messages_participant ON employer_messages
    FOR ALL TO authenticated
    USING (
        sender_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid())
        OR recipient_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid())
    );

ALTER TABLE profile_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profile_views_owner ON profile_views;
CREATE POLICY profile_views_owner ON profile_views
    FOR ALL TO authenticated
    USING (viewer_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()));

-- ── System / audit tables — service_role only ─────────────────────────────
-- These have NO policies. RLS enabled + no policies = service_role only.

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE ai_feature_flag_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE short_link_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_director_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE employer_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pseo_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE deindex_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE gsc_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE jd_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_screening_questions ENABLE ROW LEVEL SECURITY;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- After running, confirm with:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND rowsecurity=true;
-- Should list all of the above ~50 tables.
