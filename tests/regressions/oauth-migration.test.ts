/**
 * The OAuth migration for the second version of the NP Hiring app in Claude
 * and ChatGPT (20261123000000_replace_ai_app_oauth) reaches the PRODUCTION
 * database through `prisma migrate deploy` in the next Vercel build, while
 * the previous deployment still serves. So it must be narrow and safe to run
 * under load:
 *   - it drops exactly the first version's four tables (empty: sign-in never
 *     worked in production), children first, and touches no other table;
 *   - it creates exactly the six tables the connector reads, and every ALTER
 *     TABLE names one of them; nothing is renamed or rewritten, no row of any
 *     other table changes;
 *   - a 5 second lock timeout set with SET LOCAL first (the foreign keys
 *     lock user_profiles; a session-level SET would outlive the migration on
 *     a pooled connection, the 2026-10-01 pooler lesson);
 *   - grants and pending reviews reference user_profiles.supabase_id ON
 *     DELETE CASCADE, so purging a profile removes them, and codes and tokens
 *     cascade from the grant;
 *   - row level security on all six tables with no policy (service role
 *     only): they hold token hashes, which AI apps a person connected and the
 *     applications they are about to send;
 *   - codes and tokens are stored as hashes only.
 * The first version's migration stays in the history as it shipped, and
 * prisma/schema.prisma has to say what this one leaves.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { between, readRepo } from '../support/docs-vs-code';

const FOLDER = '20261123000000_replace_ai_app_oauth';
const FIRST_VERSION = '20261028000000_add_oauth_for_ai_apps';
const sql = readRepo(`prisma/migrations/${FOLDER}/migration.sql`);
/** The SQL without its comments, so prose about a statement never counts as one. */
const statements = sql.replace(/--[^\n]*/g, '');
const schema = readRepo('prisma/schema.prisma');

const DROPPED = ['oauth_refresh_tokens', 'oauth_authorization_codes', 'oauth_grants', 'oauth_clients'];
const CREATED = [
    'oauth_clients',
    'oauth_authorization_requests',
    'oauth_grants',
    'oauth_authorization_codes',
    'oauth_tokens',
    'mcp_pending_actions',
];

describe(`migration ${FOLDER}`, () => {
    it('drops exactly the first version\'s four tables, children first, and nothing else', () => {
        expect([...statements.matchAll(/DROP TABLE "(\w+)"/g)].map((match) => match[1])).toEqual(DROPPED);
        expect(statements).not.toMatch(/DROP TABLE IF EXISTS/i);
        expect([...statements.matchAll(/\bDROP\s+(\w+)/gi)].map((match) => match[1].toUpperCase())).toEqual(DROPPED.map(() => 'TABLE'));
    });

    it('creates exactly the six tables the connector reads', () => {
        expect([...statements.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1])).toEqual(CREATED);
    });

    it('alters no other table: every ALTER TABLE names one of the six new tables', () => {
        const altered = [...statements.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
        expect(altered.length).toBeGreaterThan(0);
        for (const table of altered) expect(CREATED, table).toContain(table);
        expect(statements).not.toMatch(/ALTER TABLE\s+(?!")/i);
    });

    it('renames and rewrites nothing, and changes no row', () => {
        expect(statements).not.toMatch(/\bRENAME\b/i);
        expect(statements).not.toMatch(/ALTER\s+COLUMN/i);
        expect(statements).not.toMatch(/^\s*(?:UPDATE|DELETE|INSERT|TRUNCATE)\b/im);
    });

    it('sets a 5 second lock timeout first, for its own transaction only', () => {
        expect(statements.trimStart()).toMatch(/^SET LOCAL lock_timeout = '5s';/);
        expect([...statements.matchAll(/^\s*SET\b[^;]*;/gim)].map((match) => match[0].trim())).toEqual(["SET LOCAL lock_timeout = '5s';"]);
        expect(statements).not.toMatch(/\bSET\s+SESSION\b/i);
    });

    it('links a grant and a pending review to their profile by supabase_id, deleted with it', () => {
        for (const table of ['oauth_grants', 'mcp_pending_actions']) {
            expect(statements).toMatch(
                new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_user_id_fkey" FOREIGN KEY \\("user_id"\\) REFERENCES "user_profiles"\\("supabase_id"\\) ON DELETE CASCADE ON UPDATE CASCADE;`),
            );
        }
    });

    it('deletes codes and tokens with their grant, and requests and grants with their client', () => {
        for (const table of ['oauth_authorization_codes', 'oauth_tokens']) {
            expect(statements).toMatch(
                new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_grant_id_fkey" FOREIGN KEY \\("grant_id"\\) REFERENCES "oauth_grants"\\("id"\\) ON DELETE CASCADE ON UPDATE CASCADE;`),
            );
        }
        for (const table of ['oauth_authorization_requests', 'oauth_grants']) {
            expect(statements).toMatch(
                new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_client_id_fkey" FOREIGN KEY \\("client_id"\\) REFERENCES "oauth_clients"\\("client_id"\\) ON DELETE CASCADE ON UPDATE CASCADE;`),
            );
        }
    });

    it('enables row level security on all six tables, with no policy', () => {
        for (const table of CREATED) expect(statements, table).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
        expect(statements).not.toMatch(/CREATE POLICY/i);
    });

    it('stores codes and tokens as hashes only, each hash unique', () => {
        const codes = between(statements, 'CREATE TABLE "oauth_authorization_codes" (', ');');
        expect(codes).toContain('"code_hash" TEXT NOT NULL');
        expect(codes).not.toMatch(/"code"\s/);
        const tokens = between(statements, 'CREATE TABLE "oauth_tokens" (', ');');
        expect(tokens).toContain('"token_hash" TEXT NOT NULL');
        expect(tokens).not.toMatch(/"token"\s/);
        expect(statements).toContain('CREATE UNIQUE INDEX "oauth_authorization_codes_code_hash_key" ON "oauth_authorization_codes"("code_hash");');
        expect(statements).toContain('CREATE UNIQUE INDEX "oauth_tokens_token_hash_key" ON "oauth_tokens"("token_hash");');
    });

    it('sorts after every earlier migration, and the first version stays in the history', () => {
        const folders = fs.readdirSync(path.join(process.cwd(), 'prisma/migrations')).filter((name) => /^\d{14}_/.test(name)).sort();
        expect(folders[folders.length - 1]).toBe(FOLDER);
        expect(folders).toContain(FIRST_VERSION);
    });
});

describe('prisma/schema.prisma agrees with it', () => {
    it('maps the six models to the six tables', () => {
        for (const [model, table] of [
            ['OAuthClient', 'oauth_clients'],
            ['OAuthAuthorizationRequest', 'oauth_authorization_requests'],
            ['OAuthGrant', 'oauth_grants'],
            ['OAuthAuthorizationCode', 'oauth_authorization_codes'],
            ['OAuthToken', 'oauth_tokens'],
            ['McpPendingAction', 'mcp_pending_actions'],
        ]) {
            expect(between(schema, `model ${model} {`, '\n}'), model).toContain(`@@map("${table}")`);
        }
    });

    it('has none of the first version\'s models left', () => {
        for (const model of ['OauthClient', 'OauthGrant', 'OauthAuthorizationCode', 'OauthRefreshToken']) {
            expect(schema, model).not.toMatch(new RegExp(`\\b${model}\\b`));
        }
    });

    it('a grant and a pending review belong to a profile by supabaseId and are deleted with it', () => {
        expect(between(schema, 'model OAuthGrant {', '\n}')).toMatch(/user\s+UserProfile\s+@relation\(fields: \[userId\], references: \[supabaseId\], onDelete: Cascade\)/);
        expect(between(schema, 'model McpPendingAction {', '\n}')).toMatch(/user\s+UserProfile\s+@relation\(fields: \[userId\], references: \[supabaseId\], onDelete: Cascade\)/);
    });
});
