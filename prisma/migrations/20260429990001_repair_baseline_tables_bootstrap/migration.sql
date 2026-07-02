-- Fresh-DB bootstrap ordering repair #2 (table-level twin of the
-- 20260429990000 pricing_tier column repair).
--
-- Two db-push-era TABLES are referenced by migrations that sort BEFORE the
-- 20260611_create_missing_tables_baseline that creates them:
--   - saved_candidates <- 20260430_add_saved_candidate_tags (ADD COLUMN tags)
--   - user_feedback    <- 20260501_feedback_userid_and_testimonials (ADD user_id)
-- On production both tables already existed via `prisma db push`, so the
-- ordering never mattered there; on a fresh `prisma migrate deploy` the
-- sequence fails at 20260430. Discovered by the first real fresh deploy
-- (NP Hiring board, 2026-07-02) — the earlier repair sweep checked drift
-- COLUMNS, not the baseline's TABLES.
--
-- Definitions are copied verbatim from 20260611_create_missing_tables_baseline
-- (whose own CREATE TABLE IF NOT EXISTS then no-ops). The referencing
-- migrations use ADD COLUMN IF NOT EXISTS, so the fuller definitions here
-- are safe. Idempotent; no-op on databases where the tables already exist.
-- Checksum rule: never edit the applied migrations — this file pre-dates
-- them lexicographically instead ('9' 0x39 sorts before '_' 0x5F).

CREATE TABLE IF NOT EXISTS "saved_candidates" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "employer_job_id" TEXT,
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "rating" INTEGER NOT NULL,
    "message" TEXT,
    "page" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id")
);
