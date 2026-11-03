-- NP Hiring app for Claude and ChatGPT: the OAuth 2.1 authorization server in
-- lib/oauth signs a candidate in from an AI app (consent at /oauth/authorize,
-- tokens at /oauth/token) so the MCP endpoints (/mcp, /mcp/chatgpt) can act
-- on their own applications and saved jobs.
--
-- Additive, applied by `prisma migrate deploy` while the previous deployment
-- still serves: four new tables and their indexes and foreign keys, no change
-- to any existing table or row. The old code never reads them.
--
--   oauth_clients              clients registered through POST /oauth/register
--   oauth_grants               one candidate's approval of one AI app
--   oauth_authorization_codes  single-use codes, stored as SHA-256 only
--   oauth_refresh_tokens       rotating refresh tokens, stored as SHA-256 only
--
-- oauth_grants.user_id references user_profiles.supabase_id ON DELETE
-- CASCADE: deleting a profile (the purge cron) deletes its grants, and the
-- codes and refresh tokens cascade from the grant.
-- tests/regressions/oauth-migration.test.ts pins this file.

-- Wait at most 5 seconds for a lock (the foreign key below locks
-- user_profiles): a deploy that would queue behind a long transaction fails
-- and is retried, instead of stalling every write queued behind it. SET
-- LOCAL, for this migration's transaction only: a session-level SET would
-- outlive it on a pooled connection.
SET LOCAL lock_timeout = '5s';

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,

    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "code_hash" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("code_hash")
);

-- CreateTable
CREATE TABLE "oauth_refresh_tokens" (
    "token_hash" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "oauth_grants_user_id_revoked_at_idx" ON "oauth_grants"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_grant_id_idx" ON "oauth_authorization_codes"("grant_id");

-- CreateIndex
CREATE INDEX "oauth_refresh_tokens_grant_id_idx" ON "oauth_refresh_tokens"("grant_id");

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("supabase_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Service role only, with no policies, like employer_post_packs and
-- employer_plans: the tables hold token hashes and which AI apps a candidate
-- connected. The app's database role bypasses RLS.
ALTER TABLE "oauth_clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_authorization_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_refresh_tokens" ENABLE ROW LEVEL SECURITY;
