/**
 * The OAuth migration for the NP Hiring app in Claude and ChatGPT
 * (20261028000000_add_oauth_for_ai_apps) reaches the PRODUCTION database
 * through `prisma migrate deploy` in the next Vercel build, while the
 * previous deployment still serves. So it must be additive and safe to run
 * under load:
 *   - four new tables and nothing else: no existing table is altered, no
 *     row changed, nothing dropped or renamed;
 *   - a 5 second lock timeout set with SET LOCAL first (the foreign key
 *     locks user_profiles; a session-level SET would outlive the migration
 *     on a pooled connection, the 2026-10-01 pooler lesson);
 *   - oauth_grants.user_id references user_profiles.supabase_id ON DELETE
 *     CASCADE, so purging a profile removes its grants, and the codes and
 *     refresh tokens cascade from the grant;
 *   - row level security on all four tables with no policy (service role
 *     only): they hold token hashes and which AI apps a candidate connected;
 *   - codes and refresh tokens are stored as hashes only.
 * prisma/schema.prisma has to say the same.
 */
import { describe, it, expect } from 'vitest';
import { between, readRepo } from '../support/docs-vs-code';

const FOLDER = '20261028000000_add_oauth_for_ai_apps';
const sql = readRepo(`prisma/migrations/${FOLDER}/migration.sql`);
/** The SQL without its comments, so prose about a statement never counts as one. */
const statements = sql.replace(/--[^\n]*/g, '');
const schema = readRepo('prisma/schema.prisma');

const TABLES = ['oauth_clients', 'oauth_grants', 'oauth_authorization_codes', 'oauth_refresh_tokens'];

describe(`migration ${FOLDER}`, () => {
    it('creates exactly the four OAuth tables', () => {
        expect([...statements.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1])).toEqual(TABLES);
    });

    it('alters no existing table: every ALTER TABLE names one of the four new tables', () => {
        const altered = [...statements.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
        expect(altered.length).toBeGreaterThan(0);
        for (const table of altered) expect(TABLES, table).toContain(table);
        expect(statements).not.toMatch(/ALTER TABLE\s+(?!")/i);
    });

    it('is additive: nothing dropped, renamed or rewritten, no row changed', () => {
        expect(statements).not.toMatch(/\bDROP\b/i);
        expect(statements).not.toMatch(/\bRENAME\b/i);
        expect(statements).not.toMatch(/ALTER\s+COLUMN/i);
        expect(statements).not.toMatch(/^\s*(?:UPDATE|DELETE|INSERT|TRUNCATE)\b/im);
    });

    it('sets a 5 second lock timeout first, for its own transaction only', () => {
        expect(statements.trimStart()).toMatch(/^SET LOCAL lock_timeout = '5s';/);
        expect([...statements.matchAll(/^\s*SET\b[^;]*;/gim)].map((match) => match[0].trim())).toEqual(["SET LOCAL lock_timeout = '5s';"]);
        expect(statements).not.toMatch(/\bSET\s+SESSION\b/i);
    });

    it('links a grant to its candidate profile by supabase_id, deleted with the profile', () => {
        expect(statements).toMatch(
            /ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_fkey" FOREIGN KEY \("user_id"\) REFERENCES "user_profiles"\("supabase_id"\) ON DELETE CASCADE ON UPDATE CASCADE;/,
        );
    });

    it('deletes codes and refresh tokens with their grant', () => {
        for (const table of ['oauth_authorization_codes', 'oauth_refresh_tokens']) {
            expect(statements).toMatch(
                new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_grant_id_fkey" FOREIGN KEY \\("grant_id"\\) REFERENCES "oauth_grants"\\("id"\\) ON DELETE CASCADE ON UPDATE CASCADE;`),
            );
        }
    });

    it('enables row level security on all four tables, with no policy', () => {
        for (const table of TABLES) expect(statements, table).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
        expect(statements).not.toMatch(/CREATE POLICY/i);
    });

    it('stores codes and refresh tokens as hashes only, keyed by the hash', () => {
        const codes = between(statements, 'CREATE TABLE "oauth_authorization_codes" (', ');');
        expect(codes).toContain('CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("code_hash")');
        expect(codes).not.toMatch(/"code"\s/);
        const refresh = between(statements, 'CREATE TABLE "oauth_refresh_tokens" (', ');');
        expect(refresh).toContain('CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("token_hash")');
        expect(refresh).not.toMatch(/"token"\s/);
    });

    it('indexes the lookups the code makes', () => {
        expect(statements).toContain('CREATE INDEX "oauth_grants_user_id_revoked_at_idx" ON "oauth_grants"("user_id", "revoked_at");');
        expect(statements).toContain('CREATE INDEX "oauth_authorization_codes_grant_id_idx" ON "oauth_authorization_codes"("grant_id");');
        expect(statements).toContain('CREATE INDEX "oauth_refresh_tokens_grant_id_idx" ON "oauth_refresh_tokens"("grant_id");');
    });
});

describe('prisma/schema.prisma agrees with it', () => {
    it('maps the four models to the four tables', () => {
        for (const [model, table] of [
            ['OauthClient', 'oauth_clients'],
            ['OauthGrant', 'oauth_grants'],
            ['OauthAuthorizationCode', 'oauth_authorization_codes'],
            ['OauthRefreshToken', 'oauth_refresh_tokens'],
        ]) {
            expect(between(schema, `model ${model} {`, '\n}'), model).toContain(`@@map("${table}")`);
        }
    });

    it('a grant belongs to a profile by supabaseId and is deleted with it', () => {
        const grant = between(schema, 'model OauthGrant {', '\n}');
        expect(grant).toMatch(/user\s+UserProfile\s+@relation\(fields: \[userId\], references: \[supabaseId\], onDelete: Cascade\)/);
        for (const model of ['OauthAuthorizationCode', 'OauthRefreshToken']) {
            expect(between(schema, `model ${model} {`, '\n}'), model).toMatch(/grant\s+OauthGrant\s+@relation\(fields: \[grantId\], references: \[id\], onDelete: Cascade\)/);
        }
    });

    it('keys codes and refresh tokens by their hash', () => {
        expect(between(schema, 'model OauthAuthorizationCode {', '\n}')).toMatch(/codeHash\s+String\s+@id @map\("code_hash"\)/);
        expect(between(schema, 'model OauthRefreshToken {', '\n}')).toMatch(/tokenHash\s+String\s+@id @map\("token_hash"\)/);
    });
});
