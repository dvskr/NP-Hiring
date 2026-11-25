/**
 * The social kit's posting tracker migrations reach the PRODUCTION database
 * through `prisma migrate deploy` in the next Vercel build, while the
 * previous deployment still serves. So they must be additive and safe on a
 * live database:
 *   - 20261126000002_add_social_post_logs creates one new table, its two
 *     indexes and its foreign key to jobs, and changes no existing table,
 *     column or row; a 5 second lock timeout is set first with SET LOCAL,
 *     because the foreign key locks jobs;
 *   - 20261126000003_social_post_logs_rls turns row level security on for
 *     that table, with no policy (service role only), and does nothing else;
 *   - both files are UTF-8 without a byte order mark.
 * prisma/schema.prisma has to say the same.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { between, readRepo, ROOT } from '../support/docs-vs-code';

const TABLE_FOLDER = '20261126000002_add_social_post_logs';
const RLS_FOLDER = '20261126000003_social_post_logs_rls';
const tablePath = `prisma/migrations/${TABLE_FOLDER}/migration.sql`;
const rlsPath = `prisma/migrations/${RLS_FOLDER}/migration.sql`;

/** The SQL without its comments, so prose about a statement never counts as one. */
const statementsOf = (sql: string): string => sql.replace(/--[^\n]*/g, '');

const tableSql = statementsOf(readRepo(tablePath));
const rlsSql = statementsOf(readRepo(rlsPath));
const schema = readRepo('prisma/schema.prisma');

function startsWithBom(rel: string): boolean {
    const bytes = fs.readFileSync(path.join(ROOT, rel));
    return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

describe(`migration ${TABLE_FOLDER}`, () => {
    it('creates exactly one table, social_post_logs, with the columns the model maps', () => {
        expect([...tableSql.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1])).toEqual(['social_post_logs']);
        const table = between(tableSql, 'CREATE TABLE "social_post_logs" (', '\n);');
        expect(table).toContain('"id" TEXT NOT NULL,');
        expect(table).toContain('"job_id" TEXT NOT NULL,');
        expect(table).toContain('"platform" VARCHAR(16) NOT NULL,');
        expect(table).toContain('"venue" VARCHAR(120),');
        expect(table).toContain('"post_url" VARCHAR(500),');
        expect(table).toContain('"posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,');
        expect(table).toContain('CONSTRAINT "social_post_logs_pkey" PRIMARY KEY ("id")');
    });

    it('indexes the reads the kit makes', () => {
        expect(tableSql).toContain('CREATE INDEX "social_post_logs_job_id_platform_posted_at_idx" ON "social_post_logs"("job_id", "platform", "posted_at");');
        expect(tableSql).toContain('CREATE INDEX "social_post_logs_posted_at_idx" ON "social_post_logs"("posted_at");');
    });

    it('cascades from jobs, so deleting a job takes its logs with it', () => {
        expect(tableSql.replace(/\s+/g, ' ')).toContain(
            'ALTER TABLE "social_post_logs" ADD CONSTRAINT "social_post_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
        );
    });

    it('alters no existing table', () => {
        expect([...tableSql.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1])).toEqual(['social_post_logs']);
        expect(tableSql).not.toMatch(/ALTER TABLE\s+(?!")/i);
    });

    it('is additive: nothing dropped, renamed or rewritten, no row changed', () => {
        expect(tableSql).not.toMatch(/\bDROP\b/i);
        expect(tableSql).not.toMatch(/\bRENAME\b/i);
        expect(tableSql).not.toMatch(/ALTER\s+COLUMN/i);
        expect(tableSql).not.toMatch(/^\s*(?:UPDATE|DELETE|INSERT|TRUNCATE)\b/im);
    });

    it('sets a 5 second lock timeout first, for its own transaction only', () => {
        expect(tableSql.trimStart()).toMatch(/^SET LOCAL lock_timeout = '5s';/);
        expect(tableSql).not.toMatch(/\bSET\s+SESSION\b/i);
    });
});

describe(`migration ${RLS_FOLDER}`, () => {
    it('enables row level security on social_post_logs, with no policy, and nothing else', () => {
        expect(rlsSql.trim()).toBe('ALTER TABLE "social_post_logs" ENABLE ROW LEVEL SECURITY;');
        expect(rlsSql).not.toMatch(/CREATE POLICY/i);
    });

    it('sorts right after the table it protects, and after every earlier migration', () => {
        expect(RLS_FOLDER > TABLE_FOLDER).toBe(true);
        expect(TABLE_FOLDER > '20261123000000_replace_ai_app_oauth').toBe(true);
    });
});

describe('encoding', () => {
    it.each([tablePath, rlsPath])('%s is UTF-8 without a byte order mark', (rel) => {
        expect(startsWithBom(rel)).toBe(false);
    });
});

describe('prisma/schema.prisma agrees with it', () => {
    const model = between(schema, 'model SocialPostLog {', '\n}');

    it('maps SocialPostLog to social_post_logs with the same columns and indexes', () => {
        expect(model).toContain('@@map("social_post_logs")');
        expect(model).toMatch(/jobId\s+String\s+@map\("job_id"\)/);
        expect(model).toMatch(/platform\s+String\s+@db\.VarChar\(16\)/);
        expect(model).toMatch(/venue\s+String\?\s+@db\.VarChar\(120\)/);
        expect(model).toMatch(/postUrl\s+String\?\s+@map\("post_url"\) @db\.VarChar\(500\)/);
        expect(model).toMatch(/postedAt\s+DateTime\s+@default\(now\(\)\) @map\("posted_at"\)/);
        expect(model).toContain('@@index([jobId, platform, postedAt])');
        expect(model).toContain('@@index([postedAt])');
    });

    it('belongs to a job and goes when the job goes', () => {
        expect(model).toMatch(/job\s+Job\s+@relation\(fields: \[jobId\], references: \[id\], onDelete: Cascade\)/);
        expect(between(schema, 'model Job {', '\n}')).toMatch(/socialPostLogs\s+SocialPostLog\[\]/);
    });
});
