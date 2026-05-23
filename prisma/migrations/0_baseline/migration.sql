-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "employer" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "job_type" TEXT,
    "mode" TEXT,
    "experience_level" TEXT,
    "min_years_experience" INTEGER,
    "max_years_experience" INTEGER,
    "new_grad_friendly" BOOLEAN NOT NULL DEFAULT false,
    "experience_qualifier" VARCHAR(80),
    "experience_label" TEXT,
    "description" TEXT NOT NULL,
    "description_summary" TEXT,
    "salary_range" TEXT,
    "min_salary" INTEGER,
    "max_salary" INTEGER,
    "salary_period" TEXT,
    "city" TEXT,
    "state" TEXT,
    "state_code" TEXT,
    "country" TEXT DEFAULT 'US',
    "is_remote" BOOLEAN NOT NULL DEFAULT false,
    "is_hybrid" BOOLEAN NOT NULL DEFAULT false,
    "normalized_min_salary" INTEGER,
    "normalized_max_salary" INTEGER,
    "salary_is_estimated" BOOLEAN NOT NULL DEFAULT false,
    "salary_confidence" DOUBLE PRECISION,
    "display_salary" TEXT,
    "apply_link" TEXT,
    "apply_on_platform" BOOLEAN NOT NULL DEFAULT false,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "is_manually_unpublished" BOOLEAN NOT NULL DEFAULT false,
    "unpublish_reason" VARCHAR(60),
    "unpublish_reason_note" TEXT,
    "unpublished_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "last_renewed_at" TIMESTAMP(3),
    "is_verified_employer" BOOLEAN NOT NULL DEFAULT false,
    "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clinical_setting" TEXT,
    "patient_population" TEXT,
    "source_type" TEXT,
    "source_provider" TEXT,
    "source_site" TEXT,
    "external_id" TEXT,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "apply_click_count" INTEGER NOT NULL DEFAULT 0,
    "quality_score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "company_id" TEXT,
    "original_posted_at" TIMESTAMP(3),
    "last_link_checked_at" TIMESTAMP(3),
    "last_enriched_at" TIMESTAMP(3),
    "health_consecutive_missing" INTEGER NOT NULL DEFAULT 0,
    "health_last_seen_at" TIMESTAMP(3),
    "category_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_health_checks" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "check_type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "alive" BOOLEAN NOT NULL,
    "http_status" INTEGER,
    "redirect_hops" INTEGER,
    "final_url" TEXT,
    "api_url" TEXT,
    "soft_pattern_id" TEXT,
    "soft_match_text" TEXT,
    "error_kind" TEXT,
    "error_message" TEXT,
    "elapsed_ms" INTEGER,
    "presence_source" TEXT,
    "presence_fetched" INTEGER,
    "presence_historical_avg" DOUBLE PRECISION,
    "presence_seen_again" INTEGER,
    "presence_missing" INTEGER,
    "presence_skipped_reason" TEXT,
    "checker_version" TEXT NOT NULL,

    CONSTRAINT "job_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_leads" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT,
    "is_subscribed" BOOLEAN NOT NULL DEFAULT true,
    "is_suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressed_at" TIMESTAMP(3),
    "suppression_reason" TEXT,
    "newsletter_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribe_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_alerts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "keyword" TEXT,
    "location" TEXT,
    "mode" TEXT,
    "job_type" TEXT,
    "min_salary" INTEGER,
    "max_salary" INTEGER,
    "new_grad_friendly" BOOLEAN,
    "min_years_experience_filter" INTEGER,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMP(3),
    "confirmation_token" TEXT,
    "last_sent_at" TIMESTAMP(3),
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_jobs" (
    "id" TEXT NOT NULL,
    "employer_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "company_logo_url" TEXT,
    "company_description" TEXT,
    "company_website" TEXT,
    "job_id" TEXT NOT NULL,
    "edit_token" TEXT NOT NULL,
    "dashboard_token" TEXT NOT NULL,
    "payment_status" TEXT NOT NULL,
    "pricing_tier" TEXT NOT NULL DEFAULT 'pro',
    "quota_domain" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expiry_warning_sent_at" TIMESTAMP(3),
    "notify_on_application" BOOLEAN NOT NULL DEFAULT true,
    "notify_digest" TEXT NOT NULL DEFAULT 'instant',
    "user_id" TEXT,

    CONSTRAINT "employer_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_stripe_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_charges" (
    "id" TEXT NOT NULL,
    "employer_job_id" TEXT NOT NULL,
    "stripe_session_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "stripe_invoice_id" TEXT,
    "invoice_pdf_url" TEXT,
    "hosted_invoice_url" TEXT,
    "invoice_number" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refunded_at" TIMESTAMP(3),
    "refunded_amount_cents" INTEGER,
    "refund_reason" TEXT,

    CONSTRAINT "job_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_stats" (
    "id" TEXT NOT NULL,
    "total_jobs" INTEGER NOT NULL DEFAULT 0,
    "total_subscribers" INTEGER NOT NULL DEFAULT 0,
    "total_companies" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT,
    "form_data" JSONB NOT NULL,
    "resume_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logo_url" TEXT,
    "website" TEXT,
    "description" TEXT,
    "job_count" INTEGER NOT NULL DEFAULT 0,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_stats" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "jobs_fetched" INTEGER NOT NULL DEFAULT 0,
    "jobs_added" INTEGER NOT NULL DEFAULT 0,
    "jobs_duplicate" INTEGER NOT NULL DEFAULT 0,
    "jobs_expired" INTEGER NOT NULL DEFAULT 0,
    "jobs_rejected" INTEGER NOT NULL DEFAULT 0,
    "rejected_by_reason" JSONB,
    "avg_quality_score" DOUBLE PRECISION,
    "total_views" INTEGER NOT NULL DEFAULT 0,
    "total_apply_clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apply_clicks" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "source" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" TEXT,
    "referrer" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "apply_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_leads" (
    "id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_title" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "linkedin_url" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'prospect',
    "source" TEXT,
    "last_contacted_at" TIMESTAMP(3),
    "next_follow_up_at" TIMESTAMP(3),
    "jobs_posted" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employer_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_director_leads" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "university_name" TEXT NOT NULL,
    "director_name" TEXT,
    "email" TEXT,
    "email_status" TEXT,
    "phone" TEXT,
    "program_types" TEXT,
    "distance_education" TEXT,
    "program_website_url" TEXT,
    "linkedin_url" TEXT,
    "cohort_size" INTEGER,
    "graduation_month" TEXT,
    "outreach_status" TEXT NOT NULL DEFAULT 'not_contacted',
    "notes" TEXT,
    "last_contacted_at" TIMESTAMP(3),
    "next_follow_up_at" TIMESTAMP(3),
    "widget_installed" BOOLEAN NOT NULL DEFAULT false,
    "widget_installed_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_director_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "supabase_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'job_seeker',
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "resume_url" TEXT,
    "avatar_url" TEXT,
    "email_suppressed" BOOLEAN NOT NULL DEFAULT false,
    "headline" TEXT,
    "years_experience" INTEGER,
    "certifications" TEXT,
    "license_states" TEXT,
    "specialties" TEXT,
    "bio" TEXT,
    "linkedin_url" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resume_parsed_at" TIMESTAMP(3),
    "resume_parse_status" TEXT,
    "preferred_work_mode" TEXT,
    "preferred_job_type" TEXT,
    "desired_salary_min" INTEGER,
    "desired_salary_max" INTEGER,
    "desired_salary_type" TEXT,
    "available_date" TIMESTAMP(3),
    "open_to_offers" BOOLEAN NOT NULL DEFAULT true,
    "profile_visible" BOOLEAN NOT NULL DEFAULT true,
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "country" TEXT DEFAULT 'US',
    "work_authorized" BOOLEAN,
    "requires_sponsorship" BOOLEAN,
    "veteran_status" TEXT,
    "disability_status" TEXT,
    "race_ethnicity" TEXT,
    "gender" TEXT,
    "sensitive_data_consent" BOOLEAN NOT NULL DEFAULT false,
    "sensitive_data_consent_at" TIMESTAMP(3),
    "npi_number" TEXT,
    "dea_number" TEXT,
    "dea_expiration_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_nudged_at" TIMESTAMP(3),
    "last_saved_job_reminder_at" TIMESTAMP(3),
    "email_suppressed_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "purge_at" TIMESTAMP(3),
    "purge_warning_email_sent_at" TIMESTAMP(3),

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "source_url" TEXT,
    "cover_letter" TEXT,
    "cover_letter_url" TEXT,
    "resume_url" TEXT,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "notes" TEXT,
    "status_updated_at" TIMESTAMP(3),
    "consent_given" BOOLEAN NOT NULL DEFAULT false,
    "consent_given_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "ai_match_score" INTEGER,
    "ai_match_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ai_missing_items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "screening_answers" JSONB,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_view_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" TEXT,
    "referrer" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "job_view_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "participant_a" TEXT NOT NULL,
    "participant_b" TEXT NOT NULL,
    "job_id" TEXT,
    "subject" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_by_a" BOOLEAN NOT NULL DEFAULT false,
    "deleted_by_b" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_messages" (
    "id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "job_id" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachment_url" TEXT,
    "attachment_name" TEXT,
    "deleted_by_sender" BOOLEAN NOT NULL DEFAULT false,
    "deleted_by_recipient" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),

    CONSTRAINT "employer_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_views" (
    "id" TEXT NOT NULL,
    "viewer_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "employer_job_id" TEXT,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta_description" TEXT,
    "target_keyword" TEXT,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publish_date" TIMESTAMP(3),
    "image_url" TEXT,
    "youtube_video_id" TEXT,
    "video_url" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "faq_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_videos" (
    "id" TEXT NOT NULL,
    "state_key" TEXT NOT NULL,
    "state_name" TEXT NOT NULL,
    "blog_slug" TEXT NOT NULL,
    "yt_title" TEXT NOT NULL,
    "yt_description" TEXT NOT NULL,
    "yt_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seo_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnail_url" TEXT,
    "video_url" TEXT,
    "youtube_video_id" TEXT,
    "postiz_post_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduled_date" TIMESTAMP(3),
    "published_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_licenses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "license_type" TEXT NOT NULL,
    "license_number" TEXT NOT NULL,
    "license_state" TEXT NOT NULL,
    "expiration_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_certifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "certification_name" TEXT NOT NULL,
    "certifying_body" TEXT,
    "certification_number" TEXT,
    "expiration_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_education" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "degree_type" TEXT NOT NULL,
    "field_of_study" TEXT,
    "school_name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "graduation_date" TIMESTAMP(3),
    "gpa" TEXT,
    "is_highest_degree" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_work_experience" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,
    "employer_name" TEXT NOT NULL,
    "employer_city" TEXT,
    "employer_state" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "supervisor_name" TEXT,
    "supervisor_phone" TEXT,
    "supervisor_email" TEXT,
    "may_contact" BOOLEAN,
    "reason_for_leaving" TEXT,
    "description" TEXT,
    "practice_setting" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_work_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_screening_answers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_key" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "answer_type" TEXT NOT NULL,
    "answer_bool" BOOLEAN,
    "answer_text" TEXT,
    "category" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_screening_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_open_ended_responses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_key" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_open_ended_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_references" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "title" TEXT,
    "organization" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "relationship" TEXT,
    "years_known" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_log" (
    "id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_screening_questions" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "question_type" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_knockout" BOOLEAN NOT NULL DEFAULT false,
    "knockout_answer" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_screening_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autofill_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "page_url" TEXT NOT NULL,
    "ats_name" TEXT,
    "fields_filled" INTEGER NOT NULL DEFAULT 0,
    "ai_generations" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autofill_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_reports" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "ip_hash" TEXT,
    "reporter_email" TEXT,
    "reporter_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "rating" INTEGER NOT NULL,
    "message" TEXT,
    "page" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_testimonials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "employer_job_id" TEXT,
    "employer_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rating" INTEGER,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "displayAs" TEXT NOT NULL DEFAULT 'initial',
    "featured_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employer_testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autofill_telemetry" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "ats_domain" TEXT,
    "field_name" TEXT NOT NULL,
    "field_label" TEXT NOT NULL,
    "field_type" TEXT NOT NULL,
    "match_method" TEXT NOT NULL,
    "profile_key" TEXT,
    "value_sample" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "filled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autofill_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejected_jobs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "employer" TEXT,
    "location" TEXT,
    "apply_link" TEXT,
    "external_id" TEXT,
    "source_provider" TEXT NOT NULL,
    "rejection_reason" TEXT NOT NULL,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejected_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_candidates" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "employer_job_id" TEXT,
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_tags" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0D9488',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_candidate_alerts" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "specialties" TEXT,
    "states" TEXT,
    "min_experience" INTEGER,
    "work_mode" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employer_candidate_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_broadcasts" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "audience_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduled_for" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "template_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "email_broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_sends" (
    "id" TEXT NOT NULL,
    "resend_id" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deindex_queue" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deindex_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_runs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "success" BOOLEAN NOT NULL DEFAULT false,
    "duration_ms" INTEGER,
    "error" TEXT,
    "metrics" JSONB,

    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gsc_snapshots" (
    "id" TEXT NOT NULL,
    "captured_on" DATE NOT NULL,
    "indexed_total" INTEGER NOT NULL DEFAULT 0,
    "not_indexed_total" INTEGER NOT NULL DEFAULT 0,
    "not_found_404" INTEGER NOT NULL DEFAULT 0,
    "server_error_5xx" INTEGER NOT NULL DEFAULT 0,
    "soft_404" INTEGER NOT NULL DEFAULT 0,
    "crawled_not_indexed" INTEGER NOT NULL DEFAULT 0,
    "discovered_not_indexed" INTEGER NOT NULL DEFAULT 0,
    "duplicate_no_canonical" INTEGER NOT NULL DEFAULT 0,
    "excluded_noindex" INTEGER NOT NULL DEFAULT 0,
    "page_with_redirect" INTEGER NOT NULL DEFAULT 0,
    "blocked_by_robots" INTEGER NOT NULL DEFAULT 0,
    "indexed_but_blocked" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gsc_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_snippets" (
    "id" TEXT NOT NULL,
    "city_slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source_model" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "city_snippets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_city_snippets" (
    "id" TEXT NOT NULL,
    "category_slug" TEXT NOT NULL,
    "city_slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source_model" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_city_snippets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PseoStats" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "locationSlug" TEXT NOT NULL,
    "totalJobs" INTEGER NOT NULL DEFAULT 0,
    "rawAvgSalary" INTEGER NOT NULL DEFAULT 0,
    "colAdjustedSalary" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PseoStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_requests" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "jurisdiction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "identity_verified" BOOLEAN NOT NULL DEFAULT false,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "due_by" TIMESTAMP(3) NOT NULL,
    "requester_ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "target_type" TEXT,
    "target_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_recommendations" (
    "id" TEXT NOT NULL,
    "supabase_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'external',
    "reason" TEXT,
    "clicked_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feature_flag_override" (
    "id" TEXT NOT NULL,
    "flag" TEXT NOT NULL,
    "tenant_type" TEXT NOT NULL,
    "tenant_id" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT,
    "set_by" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_feature_flag_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_embeddings" (
    "job_id" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "input_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_embeddings_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "candidate_embeddings" (
    "supabase_id" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "input_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_embeddings_pkey" PRIMARY KEY ("supabase_id")
);

-- CreateTable
CREATE TABLE "ai_eval_snapshot" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "mean_score" DOUBLE PRECISION NOT NULL,
    "passed" INTEGER NOT NULL,
    "total_cases" INTEGER NOT NULL,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "p95_latency_ms" INTEGER NOT NULL DEFAULT 0,
    "holds_baseline" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jd_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "summary" VARCHAR(300),
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jd_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_call_log" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_id" TEXT,
    "prompt_version" TEXT,
    "tenant_id" TEXT NOT NULL,
    "tenant_type" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_assignment" (
    "id" TEXT NOT NULL,
    "experiment" TEXT NOT NULL,
    "tenant_type" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_event" (
    "id" TEXT NOT NULL,
    "experiment" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "tenant_type" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "subject_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlink_clicks" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "job_id" INTEGER NOT NULL,
    "destination_path" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "referer" TEXT,
    "country" VARCHAR(2),
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "bot_name" TEXT,
    "recipient_lead_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shortlink_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_slug_key" ON "jobs"("slug");

-- CreateIndex
CREATE INDEX "jobs_is_published_idx" ON "jobs"("is_published");

-- CreateIndex
CREATE INDEX "jobs_is_featured_idx" ON "jobs"("is_featured");

-- CreateIndex
CREATE INDEX "jobs_location_idx" ON "jobs"("location");

-- CreateIndex
CREATE INDEX "jobs_created_at_idx" ON "jobs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_min_salary_max_salary_idx" ON "jobs"("min_salary", "max_salary");

-- CreateIndex
CREATE INDEX "jobs_state_idx" ON "jobs"("state");

-- CreateIndex
CREATE INDEX "jobs_is_remote_idx" ON "jobs"("is_remote");

-- CreateIndex
CREATE INDEX "jobs_company_id_idx" ON "jobs"("company_id");

-- CreateIndex
CREATE INDEX "jobs_slug_idx" ON "jobs"("slug");

-- CreateIndex
CREATE INDEX "jobs_external_id_source_provider_idx" ON "jobs"("external_id", "source_provider");

-- CreateIndex
CREATE INDEX "jobs_quality_score_idx" ON "jobs"("quality_score" DESC);

-- CreateIndex
CREATE INDEX "jobs_source_provider_health_consecutive_missing_idx" ON "jobs"("source_provider", "health_consecutive_missing");

-- CreateIndex
CREATE INDEX "jobs_category_tags_idx" ON "jobs" USING GIN ("category_tags");

-- CreateIndex
CREATE INDEX "jobs_new_grad_friendly_min_years_experience_idx" ON "jobs"("new_grad_friendly", "min_years_experience");

-- CreateIndex
CREATE INDEX "job_health_checks_job_id_checked_at_idx" ON "job_health_checks"("job_id", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "job_health_checks_outcome_checked_at_idx" ON "job_health_checks"("outcome", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "job_health_checks_checked_at_idx" ON "job_health_checks"("checked_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "email_leads_email_key" ON "email_leads"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_leads_unsubscribe_token_key" ON "email_leads"("unsubscribe_token");

-- CreateIndex
CREATE INDEX "email_leads_email_idx" ON "email_leads"("email");

-- CreateIndex
CREATE INDEX "email_leads_unsubscribe_token_idx" ON "email_leads"("unsubscribe_token");

-- CreateIndex
CREATE UNIQUE INDEX "job_alerts_confirmation_token_key" ON "job_alerts"("confirmation_token");

-- CreateIndex
CREATE UNIQUE INDEX "job_alerts_token_key" ON "job_alerts"("token");

-- CreateIndex
CREATE INDEX "job_alerts_email_idx" ON "job_alerts"("email");

-- CreateIndex
CREATE INDEX "job_alerts_token_idx" ON "job_alerts"("token");

-- CreateIndex
CREATE INDEX "job_alerts_is_active_idx" ON "job_alerts"("is_active");

-- CreateIndex
CREATE INDEX "job_alerts_confirmed_at_idx" ON "job_alerts"("confirmed_at");

-- CreateIndex
CREATE UNIQUE INDEX "employer_jobs_job_id_key" ON "employer_jobs"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "employer_jobs_edit_token_key" ON "employer_jobs"("edit_token");

-- CreateIndex
CREATE UNIQUE INDEX "employer_jobs_dashboard_token_key" ON "employer_jobs"("dashboard_token");

-- CreateIndex
CREATE INDEX "employer_jobs_user_id_idx" ON "employer_jobs"("user_id");

-- CreateIndex
CREATE INDEX "employer_jobs_edit_token_idx" ON "employer_jobs"("edit_token");

-- CreateIndex
CREATE INDEX "employer_jobs_contact_email_idx" ON "employer_jobs"("contact_email");

-- CreateIndex
CREATE INDEX "employer_jobs_dashboard_token_idx" ON "employer_jobs"("dashboard_token");

-- CreateIndex
CREATE INDEX "employer_jobs_quota_domain_payment_status_idx" ON "employer_jobs"("quota_domain", "payment_status");

-- CreateIndex
CREATE UNIQUE INDEX "processed_stripe_events_event_id_key" ON "processed_stripe_events"("event_id");

-- CreateIndex
CREATE INDEX "processed_stripe_events_event_type_idx" ON "processed_stripe_events"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "job_charges_stripe_session_id_key" ON "job_charges"("stripe_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_charges_stripe_payment_intent_id_key" ON "job_charges"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "job_charges_employer_job_id_idx" ON "job_charges"("employer_job_id");

-- CreateIndex
CREATE INDEX "job_charges_type_idx" ON "job_charges"("type");

-- CreateIndex
CREATE INDEX "job_charges_refunded_at_idx" ON "job_charges"("refunded_at");

-- CreateIndex
CREATE INDEX "job_charges_stripe_invoice_id_idx" ON "job_charges"("stripe_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_drafts_user_id_key" ON "job_drafts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_drafts_resume_token_key" ON "job_drafts"("resume_token");

-- CreateIndex
CREATE INDEX "job_drafts_email_idx" ON "job_drafts"("email");

-- CreateIndex
CREATE INDEX "job_drafts_resume_token_idx" ON "job_drafts"("resume_token");

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_normalized_name_key" ON "companies"("normalized_name");

-- CreateIndex
CREATE INDEX "companies_normalized_name_idx" ON "companies"("normalized_name");

-- CreateIndex
CREATE INDEX "companies_is_verified_idx" ON "companies"("is_verified");

-- CreateIndex
CREATE INDEX "source_stats_source_idx" ON "source_stats"("source");

-- CreateIndex
CREATE INDEX "source_stats_date_idx" ON "source_stats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "source_stats_source_date_key" ON "source_stats"("source", "date");

-- CreateIndex
CREATE INDEX "apply_clicks_job_id_idx" ON "apply_clicks"("job_id");

-- CreateIndex
CREATE INDEX "apply_clicks_source_idx" ON "apply_clicks"("source");

-- CreateIndex
CREATE INDEX "apply_clicks_timestamp_idx" ON "apply_clicks"("timestamp");

-- CreateIndex
CREATE INDEX "employer_leads_status_idx" ON "employer_leads"("status");

-- CreateIndex
CREATE INDEX "employer_leads_company_name_idx" ON "employer_leads"("company_name");

-- CreateIndex
CREATE INDEX "employer_leads_contact_email_idx" ON "employer_leads"("contact_email");

-- CreateIndex
CREATE INDEX "program_director_leads_outreach_status_idx" ON "program_director_leads"("outreach_status");

-- CreateIndex
CREATE INDEX "program_director_leads_tier_idx" ON "program_director_leads"("tier");

-- CreateIndex
CREATE INDEX "program_director_leads_state_idx" ON "program_director_leads"("state");

-- CreateIndex
CREATE INDEX "program_director_leads_email_idx" ON "program_director_leads"("email");

-- CreateIndex
CREATE UNIQUE INDEX "program_director_leads_university_director_uq" ON "program_director_leads"("university_name", "director_name");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_supabase_id_key" ON "user_profiles"("supabase_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_email_key" ON "user_profiles"("email");

-- CreateIndex
CREATE INDEX "user_profiles_supabase_id_idx" ON "user_profiles"("supabase_id");

-- CreateIndex
CREATE INDEX "user_profiles_email_idx" ON "user_profiles"("email");

-- CreateIndex
CREATE INDEX "user_profiles_profile_visible_open_to_offers_role_idx" ON "user_profiles"("profile_visible", "open_to_offers", "role");

-- CreateIndex
CREATE INDEX "user_profiles_deleted_at_idx" ON "user_profiles"("deleted_at");

-- CreateIndex
CREATE INDEX "user_profiles_purge_at_idx" ON "user_profiles"("purge_at");

-- CreateIndex
CREATE INDEX "user_profiles_last_seen_at_idx" ON "user_profiles"("last_seen_at");

-- CreateIndex
CREATE INDEX "job_applications_user_id_idx" ON "job_applications"("user_id");

-- CreateIndex
CREATE INDEX "job_applications_job_id_idx" ON "job_applications"("job_id");

-- CreateIndex
CREATE INDEX "job_applications_status_idx" ON "job_applications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_user_id_job_id_key" ON "job_applications"("user_id", "job_id");

-- CreateIndex
CREATE INDEX "job_view_events_job_id_idx" ON "job_view_events"("job_id");

-- CreateIndex
CREATE INDEX "job_view_events_timestamp_idx" ON "job_view_events"("timestamp");

-- CreateIndex
CREATE INDEX "job_view_events_job_id_timestamp_idx" ON "job_view_events"("job_id", "timestamp");

-- CreateIndex
CREATE INDEX "conversations_participant_a_last_message_at_idx" ON "conversations"("participant_a", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_participant_b_last_message_at_idx" ON "conversations"("participant_b", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_participant_a_participant_b_job_id_key" ON "conversations"("participant_a", "participant_b", "job_id");

-- CreateIndex
CREATE INDEX "employer_messages_sender_id_idx" ON "employer_messages"("sender_id");

-- CreateIndex
CREATE INDEX "employer_messages_recipient_id_idx" ON "employer_messages"("recipient_id");

-- CreateIndex
CREATE INDEX "employer_messages_conversation_id_idx" ON "employer_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "employer_messages_job_id_idx" ON "employer_messages"("job_id");

-- CreateIndex
CREATE INDEX "profile_views_viewer_id_idx" ON "profile_views"("viewer_id");

-- CreateIndex
CREATE INDEX "profile_views_candidate_id_idx" ON "profile_views"("candidate_id");

-- CreateIndex
CREATE INDEX "profile_views_employer_job_id_idx" ON "profile_views"("employer_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_views_viewer_id_candidate_id_key" ON "profile_views"("viewer_id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_status_publish_date_idx" ON "blog_posts"("status", "publish_date" DESC);

-- CreateIndex
CREATE INDEX "blog_posts_slug_idx" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_category_idx" ON "blog_posts"("category");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_videos_state_key_key" ON "youtube_videos"("state_key");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_videos_blog_slug_key" ON "youtube_videos"("blog_slug");

-- CreateIndex
CREATE INDEX "youtube_videos_status_idx" ON "youtube_videos"("status");

-- CreateIndex
CREATE INDEX "youtube_videos_state_key_idx" ON "youtube_videos"("state_key");

-- CreateIndex
CREATE INDEX "candidate_licenses_user_id_idx" ON "candidate_licenses"("user_id");

-- CreateIndex
CREATE INDEX "candidate_certifications_user_id_idx" ON "candidate_certifications"("user_id");

-- CreateIndex
CREATE INDEX "candidate_education_user_id_idx" ON "candidate_education"("user_id");

-- CreateIndex
CREATE INDEX "candidate_work_experience_user_id_idx" ON "candidate_work_experience"("user_id");

-- CreateIndex
CREATE INDEX "candidate_screening_answers_user_id_idx" ON "candidate_screening_answers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_screening_answers_user_id_question_key_key" ON "candidate_screening_answers"("user_id", "question_key");

-- CreateIndex
CREATE INDEX "candidate_open_ended_responses_user_id_idx" ON "candidate_open_ended_responses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_open_ended_responses_user_id_question_key_key" ON "candidate_open_ended_responses"("user_id", "question_key");

-- CreateIndex
CREATE INDEX "candidate_references_user_id_idx" ON "candidate_references"("user_id");

-- CreateIndex
CREATE INDEX "document_access_log_owner_id_created_at_idx" ON "document_access_log"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "document_access_log_actor_id_created_at_idx" ON "document_access_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "document_access_log_doc_type_created_at_idx" ON "document_access_log"("doc_type", "created_at");

-- CreateIndex
CREATE INDEX "job_screening_questions_job_id_idx" ON "job_screening_questions"("job_id");

-- CreateIndex
CREATE INDEX "autofill_usage_user_id_idx" ON "autofill_usage"("user_id");

-- CreateIndex
CREATE INDEX "autofill_usage_user_id_created_at_idx" ON "autofill_usage"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "job_reports_job_id_idx" ON "job_reports"("job_id");

-- CreateIndex
CREATE INDEX "user_feedback_user_id_idx" ON "user_feedback"("user_id");

-- CreateIndex
CREATE INDEX "employer_testimonials_user_id_idx" ON "employer_testimonials"("user_id");

-- CreateIndex
CREATE INDEX "employer_testimonials_employer_job_id_idx" ON "employer_testimonials"("employer_job_id");

-- CreateIndex
CREATE INDEX "employer_testimonials_featured_at_idx" ON "employer_testimonials"("featured_at");

-- CreateIndex
CREATE INDEX "autofill_telemetry_user_id_idx" ON "autofill_telemetry"("user_id");

-- CreateIndex
CREATE INDEX "autofill_telemetry_match_method_idx" ON "autofill_telemetry"("match_method");

-- CreateIndex
CREATE INDEX "autofill_telemetry_field_name_idx" ON "autofill_telemetry"("field_name");

-- CreateIndex
CREATE INDEX "autofill_telemetry_created_at_idx" ON "autofill_telemetry"("created_at");

-- CreateIndex
CREATE INDEX "rejected_jobs_source_provider_idx" ON "rejected_jobs"("source_provider");

-- CreateIndex
CREATE INDEX "rejected_jobs_rejection_reason_idx" ON "rejected_jobs"("rejection_reason");

-- CreateIndex
CREATE INDEX "rejected_jobs_created_at_idx" ON "rejected_jobs"("created_at");

-- CreateIndex
CREATE INDEX "saved_candidates_employer_id_idx" ON "saved_candidates"("employer_id");

-- CreateIndex
CREATE INDEX "saved_candidates_employer_job_id_idx" ON "saved_candidates"("employer_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_candidates_employer_id_candidate_id_employer_job_id_key" ON "saved_candidates"("employer_id", "candidate_id", "employer_job_id");

-- CreateIndex
CREATE INDEX "candidate_tags_employer_id_idx" ON "candidate_tags"("employer_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_tags_employer_id_name_key" ON "candidate_tags"("employer_id", "name");

-- CreateIndex
CREATE INDEX "employer_candidate_alerts_employer_id_idx" ON "employer_candidate_alerts"("employer_id");

-- CreateIndex
CREATE INDEX "employer_candidate_alerts_is_active_idx" ON "employer_candidate_alerts"("is_active");

-- CreateIndex
CREATE INDEX "email_broadcasts_status_idx" ON "email_broadcasts"("status");

-- CreateIndex
CREATE INDEX "email_broadcasts_scheduled_for_idx" ON "email_broadcasts"("scheduled_for");

-- CreateIndex
CREATE INDEX "email_broadcast_recipients_broadcast_id_idx" ON "email_broadcast_recipients"("broadcast_id");

-- CreateIndex
CREATE INDEX "email_broadcast_recipients_status_idx" ON "email_broadcast_recipients"("status");

-- CreateIndex
CREATE INDEX "saved_jobs_user_id_idx" ON "saved_jobs"("user_id");

-- CreateIndex
CREATE INDEX "saved_jobs_job_id_idx" ON "saved_jobs"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_jobs_user_id_job_id_key" ON "saved_jobs"("user_id", "job_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "email_sends_to_idx" ON "email_sends"("to");

-- CreateIndex
CREATE INDEX "email_sends_email_type_idx" ON "email_sends"("email_type");

-- CreateIndex
CREATE INDEX "email_sends_status_idx" ON "email_sends"("status");

-- CreateIndex
CREATE INDEX "email_sends_created_at_idx" ON "email_sends"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "deindex_queue_url_key" ON "deindex_queue"("url");

-- CreateIndex
CREATE INDEX "deindex_queue_status_addedAt_idx" ON "deindex_queue"("status", "addedAt");

-- CreateIndex
CREATE INDEX "deindex_queue_source_idx" ON "deindex_queue"("source");

-- CreateIndex
CREATE INDEX "cron_runs_name_started_at_idx" ON "cron_runs"("name", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "gsc_snapshots_captured_on_key" ON "gsc_snapshots"("captured_on");

-- CreateIndex
CREATE UNIQUE INDEX "city_snippets_city_slug_key" ON "city_snippets"("city_slug");

-- CreateIndex
CREATE INDEX "city_snippets_approved_at_idx" ON "city_snippets"("approved_at");

-- CreateIndex
CREATE INDEX "category_city_snippets_approved_at_idx" ON "category_city_snippets"("approved_at");

-- CreateIndex
CREATE UNIQUE INDEX "category_city_snippets_category_slug_city_slug_key" ON "category_city_snippets"("category_slug", "city_slug");

-- CreateIndex
CREATE INDEX "PseoStats_type_locationSlug_idx" ON "PseoStats"("type", "locationSlug");

-- CreateIndex
CREATE INDEX "PseoStats_categorySlug_idx" ON "PseoStats"("categorySlug");

-- CreateIndex
CREATE UNIQUE INDEX "PseoStats_type_categorySlug_locationSlug_key" ON "PseoStats"("type", "categorySlug", "locationSlug");

-- CreateIndex
CREATE INDEX "data_requests_email_idx" ON "data_requests"("email");

-- CreateIndex
CREATE INDEX "data_requests_status_idx" ON "data_requests"("status");

-- CreateIndex
CREATE INDEX "data_requests_due_by_idx" ON "data_requests"("due_by" ASC);

-- CreateIndex
CREATE INDEX "data_requests_created_at_idx" ON "data_requests"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "candidate_recommendations_supabase_id_batch_id_rank_idx" ON "candidate_recommendations"("supabase_id", "batch_id", "rank");

-- CreateIndex
CREATE INDEX "candidate_recommendations_supabase_id_job_id_created_at_idx" ON "candidate_recommendations"("supabase_id", "job_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "candidate_recommendations_clicked_at_idx" ON "candidate_recommendations"("clicked_at" DESC);

-- CreateIndex
CREATE INDEX "candidate_recommendations_tier_idx" ON "candidate_recommendations"("tier");

-- CreateIndex
CREATE INDEX "ai_feature_flag_override_flag_idx" ON "ai_feature_flag_override"("flag");

-- CreateIndex
CREATE INDEX "ai_feature_flag_override_expires_at_idx" ON "ai_feature_flag_override"("expires_at");

-- CreateIndex
CREATE INDEX "job_embeddings_updated_at_idx" ON "job_embeddings"("updated_at" DESC);

-- CreateIndex
CREATE INDEX "candidate_embeddings_updated_at_idx" ON "candidate_embeddings"("updated_at" DESC);

-- CreateIndex
CREATE INDEX "ai_eval_snapshot_task_created_at_idx" ON "ai_eval_snapshot"("task", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_eval_snapshot_created_at_idx" ON "ai_eval_snapshot"("created_at" DESC);

-- CreateIndex
CREATE INDEX "jd_templates_user_id_created_at_idx" ON "jd_templates"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_call_log_created_at_idx" ON "ai_call_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_call_log_task_created_at_idx" ON "ai_call_log"("task", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_call_log_tenant_id_created_at_idx" ON "ai_call_log"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "experiment_assignment_experiment_assigned_at_idx" ON "experiment_assignment"("experiment", "assigned_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "experiment_assignment_experiment_tenant_type_tenant_id_key" ON "experiment_assignment"("experiment", "tenant_type", "tenant_id");

-- CreateIndex
CREATE INDEX "experiment_event_experiment_arm_event_type_created_at_idx" ON "experiment_event"("experiment", "arm", "event_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "experiment_event_tenant_type_tenant_id_created_at_idx" ON "experiment_event"("tenant_type", "tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "shortlink_clicks_campaign_platform_created_at_idx" ON "shortlink_clicks"("campaign", "platform", "created_at");

-- CreateIndex
CREATE INDEX "shortlink_clicks_campaign_is_bot_created_at_idx" ON "shortlink_clicks"("campaign", "is_bot", "created_at");

-- CreateIndex
CREATE INDEX "shortlink_clicks_campaign_created_at_ip_hash_idx" ON "shortlink_clicks"("campaign", "created_at", "ip_hash");

-- CreateIndex
CREATE INDEX "shortlink_clicks_code_created_at_idx" ON "shortlink_clicks"("code", "created_at");

-- CreateIndex
CREATE INDEX "shortlink_clicks_created_at_idx" ON "shortlink_clicks"("created_at");

-- CreateIndex
CREATE INDEX "shortlink_clicks_recipient_lead_id_created_at_idx" ON "shortlink_clicks"("recipient_lead_id", "created_at");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_health_checks" ADD CONSTRAINT "job_health_checks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_alerts" ADD CONSTRAINT "job_alerts_email_fkey" FOREIGN KEY ("email") REFERENCES "email_leads"("email") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_jobs" ADD CONSTRAINT "employer_jobs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_jobs" ADD CONSTRAINT "employer_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("supabase_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apply_clicks" ADD CONSTRAINT "apply_clicks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("supabase_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_view_events" ADD CONSTRAINT "job_view_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant_a_fkey" FOREIGN KEY ("participant_a") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant_b_fkey" FOREIGN KEY ("participant_b") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_messages" ADD CONSTRAINT "employer_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_messages" ADD CONSTRAINT "employer_messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_messages" ADD CONSTRAINT "employer_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_messages" ADD CONSTRAINT "employer_messages_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_employer_job_id_fkey" FOREIGN KEY ("employer_job_id") REFERENCES "employer_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_licenses" ADD CONSTRAINT "candidate_licenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_certifications" ADD CONSTRAINT "candidate_certifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_work_experience" ADD CONSTRAINT "candidate_work_experience_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_screening_answers" ADD CONSTRAINT "candidate_screening_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_open_ended_responses" ADD CONSTRAINT "candidate_open_ended_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_references" ADD CONSTRAINT "candidate_references_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_screening_questions" ADD CONSTRAINT "job_screening_questions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_usage" ADD CONSTRAINT "autofill_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_telemetry" ADD CONSTRAINT "autofill_telemetry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_candidates" ADD CONSTRAINT "saved_candidates_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_candidates" ADD CONSTRAINT "saved_candidates_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_candidates" ADD CONSTRAINT "saved_candidates_employer_job_id_fkey" FOREIGN KEY ("employer_job_id") REFERENCES "employer_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_candidate_alerts" ADD CONSTRAINT "employer_candidate_alerts_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_broadcasts" ADD CONSTRAINT "email_broadcasts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_broadcast_recipients" ADD CONSTRAINT "email_broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "email_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_embeddings" ADD CONSTRAINT "job_embeddings_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

