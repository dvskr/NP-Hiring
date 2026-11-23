-- NP Hiring app for Claude and ChatGPT, second version. The connector is
-- rebuilt on the design PMHNP Hiring runs (lib/mcp): one /mcp endpoint for
-- every host instead of /mcp and /mcp/chatgpt, and an OAuth server whose
-- tokens are random values stored as SHA-256 hashes, so it needs no signing
-- secret.
--
-- The four tables of the first version (20261028000000_add_oauth_for_ai_apps)
-- are dropped. Sign-in never worked in production: its token and register
-- endpoints answered 503 because MCP_OAUTH_SIGNING_SECRET was never set, and
-- all four tables were empty when this was written (read-only count,
-- 2026-11-23). Six new tables replace them:
--
--   oauth_clients                 clients registered through POST /oauth/register
--   oauth_authorization_requests  a connection parked while the person signs in
--   oauth_grants                  one person's approval of one app for one endpoint
--   oauth_authorization_codes     single-use codes, stored as SHA-256 only
--   oauth_tokens                  access and refresh tokens, stored as SHA-256 only
--   mcp_pending_actions           the review an application presents before it is sent
--
-- Applied by `prisma migrate deploy` while the previous deployment still
-- serves. That deployment's connector could not sign anyone in, so nothing
-- it serves depends on the dropped tables.
--
-- oauth_grants.user_id and mcp_pending_actions.user_id reference
-- user_profiles.supabase_id ON DELETE CASCADE: deleting a profile (the purge
-- cron) deletes its connections and reviews, and codes and tokens cascade
-- from the grant. tests/regressions/oauth-migration.test.ts pins this file.

-- Wait at most 5 seconds for a lock (dropping and adding the foreign keys
-- below locks user_profiles): a deploy that would queue behind a long
-- transaction fails and is retried, instead of stalling every write queued
-- behind it. SET LOCAL, for this migration's transaction only: a
-- session-level SET would outlive it on a pooled connection.
SET LOCAL lock_timeout = '5s';

-- DropTable: the first version's tables, children first.
DROP TABLE "oauth_refresh_tokens";
DROP TABLE "oauth_authorization_codes";
DROP TABLE "oauth_grants";
DROP TABLE "oauth_clients";

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_hash" TEXT,
    "client_name" VARCHAR(120) NOT NULL,
    "client_uri" VARCHAR(500),
    "redirect_uris" TEXT[],
    "token_endpoint_auth_method" TEXT NOT NULL DEFAULT 'none',
    "grant_types" TEXT[],
    "software_id" VARCHAR(200),
    "software_version" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_requests" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "state" TEXT,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_authorization_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_grants" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_clients_client_id_key" ON "oauth_clients"("client_id");

-- CreateIndex
CREATE INDEX "oauth_clients_created_at_idx" ON "oauth_clients"("created_at");

-- CreateIndex
CREATE INDEX "oauth_authorization_requests_expires_at_idx" ON "oauth_authorization_requests"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_grants_user_id_idx" ON "oauth_grants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_grants_client_id_user_id_resource_key" ON "oauth_grants"("client_id", "user_id", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_authorization_codes_code_hash_key" ON "oauth_authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_expires_at_idx" ON "oauth_authorization_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_token_hash_key" ON "oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_tokens_grant_id_idx" ON "oauth_tokens"("grant_id");

-- CreateIndex
CREATE INDEX "oauth_tokens_expires_at_idx" ON "oauth_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("supabase_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "mcp_pending_actions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "subject_id" VARCHAR(100),
    "payload" JSONB,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "mcp_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_pending_actions_user_id_idx" ON "mcp_pending_actions"("user_id");

-- CreateIndex
CREATE INDEX "mcp_pending_actions_expires_at_idx" ON "mcp_pending_actions"("expires_at");

-- AddForeignKey
ALTER TABLE "mcp_pending_actions" ADD CONSTRAINT "mcp_pending_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("supabase_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Service role only, with no policies, like employer_post_packs and
-- guide_purchases: the tables hold token hashes, which AI apps a person
-- connected and the applications they are about to send. The app's database
-- role bypasses RLS.
ALTER TABLE "oauth_clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_authorization_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_authorization_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mcp_pending_actions" ENABLE ROW LEVEL SECURITY;
