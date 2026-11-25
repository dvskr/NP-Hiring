/**
 * The Verify Employers and paid-post twins migrations reach the PRODUCTION
 * database through `prisma migrate deploy` in the next Vercel build, while
 * the previous deployment still serves. Prisma runs each migration file as
 * one transaction and every lock is held until it ends, so a slow statement
 * in the same file as a column change would hold the column change's ACCESS
 * EXCLUSIVE lock on jobs, and every read of the live table, for as long as
 * it runs. The work is split so that never happens:
 *   - 20261126000004 makes only catalog changes under a 5 second lock
 *     timeout: the two columns, and the foreign key added NOT VALID (no
 *     scan);
 *   - 20261126000005 validates that key, the scan, under a lock that lets
 *     reads and writes continue;
 *   - 20261126000006 builds the index alone (it holds writes, never reads);
 *   - 20261126000007 analyzes jobs, after the index exists;
 *   - 20261126000008 adds jobs.twin_company_linked_at, catalog only, in a
 *     file of its own (the sync undoes only the company links it made).
 * Every file is UTF-8 without a byte order mark, and prisma/schema.prisma
 * names the same columns, constraint and index.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { between, existsInRepo, readRepo, ROOT } from '../support/docs-vs-code';

const COLUMNS_FOLDER = '20261126000004_add_verified_employer_twins';
const VALIDATE_FOLDER = '20261126000005_validate_jobs_shadowed_by_job_id_fkey';
const INDEX_FOLDER = '20261126000006_add_jobs_shadowed_by_job_id_idx';
const ANALYZE_FOLDER = '20261126000007_analyze_jobs';
const LINKED_AT_FOLDER = '20261126000008_add_jobs_twin_company_linked_at';
const FOLDERS = [COLUMNS_FOLDER, VALIDATE_FOLDER, INDEX_FOLDER, ANALYZE_FOLDER, LINKED_AT_FOLDER];

const pathOf = (folder: string): string => `prisma/migrations/${folder}/migration.sql`;

/** The file's statements, without comments, each on one line with single spaces. */
function statementsOf(folder: string): string[] {
    return readRepo(pathOf(folder))
        .replace(/--[^\n]*/g, '')
        .split(';')
        .map((statement) => statement.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((statement) => `${statement};`);
}

const schema = readRepo('prisma/schema.prisma');

describe(`migration ${COLUMNS_FOLDER}`, () => {
    it('sets the lock timeout, adds the two columns and adds the foreign key NOT VALID, and nothing else', () => {
        expect(statementsOf(COLUMNS_FOLDER)).toEqual([
            "SET LOCAL lock_timeout = '5s';",
            'ALTER TABLE "user_profiles" ADD COLUMN "verified_employer_org_keys" TEXT[] NOT NULL DEFAULT \'{}\';',
            'ALTER TABLE "jobs" ADD COLUMN "shadowed_by_job_id" TEXT;',
            'ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shadowed_by_job_id_fkey" FOREIGN KEY ("shadowed_by_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;',
        ]);
    });

    it('builds no index, scans nothing and changes no row', () => {
        const sql = statementsOf(COLUMNS_FOLDER).join('\n');

        expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
        expect(sql).not.toMatch(/\bVALIDATE\b/i);
        expect(sql).not.toMatch(/\bANALYZE\b/i);
        expect(sql).not.toMatch(/^\s*(?:UPDATE|DELETE|INSERT|TRUNCATE|DROP)\b/im);
        expect(sql).not.toMatch(/ALTER\s+COLUMN|\bRENAME\b/i);
    });
});

describe(`migration ${VALIDATE_FOLDER}`, () => {
    it('validates the foreign key and does nothing else', () => {
        expect(statementsOf(VALIDATE_FOLDER)).toEqual([
            'ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_shadowed_by_job_id_fkey";',
        ]);
    });
});

describe(`migration ${INDEX_FOLDER}`, () => {
    it('builds the index alone, under a 5 second lock timeout', () => {
        expect(statementsOf(INDEX_FOLDER)).toEqual([
            "SET LOCAL lock_timeout = '5s';",
            'CREATE INDEX IF NOT EXISTS "jobs_shadowed_by_job_id_idx" ON "jobs"("shadowed_by_job_id");',
        ]);
    });
});

describe(`migration ${ANALYZE_FOLDER}`, () => {
    it('analyzes jobs and does nothing else', () => {
        expect(statementsOf(ANALYZE_FOLDER)).toEqual(['ANALYZE "jobs";']);
    });
});

describe(`migration ${LINKED_AT_FOLDER}`, () => {
    it('adds the one nullable column, with no default and no backfill, under a 5 second lock timeout', () => {
        expect(statementsOf(LINKED_AT_FOLDER)).toEqual([
            "SET LOCAL lock_timeout = '5s';",
            'ALTER TABLE "jobs" ADD COLUMN "twin_company_linked_at" TIMESTAMP(3);',
        ]);
    });
});

describe('the five files together', () => {
    it('sort in that order, after every earlier migration', () => {
        expect([...FOLDERS].sort()).toEqual(FOLDERS);
        expect(COLUMNS_FOLDER > '20261126000003_social_post_logs_rls').toBe(true);
    });

    it('each hold a slot no other migration shares, and the analyze file no longer sits in slot 000005', () => {
        const names = fs.readdirSync(path.join(ROOT, 'prisma/migrations'));
        for (const folder of FOLDERS) {
            const slot = folder.slice(0, folder.indexOf('_'));
            expect(names.filter((name) => name.startsWith(`${slot}_`))).toEqual([folder]);
            expect(existsInRepo(pathOf(folder))).toBe(true);
        }
        expect(existsInRepo(pathOf('20261126000005_analyze_jobs'))).toBe(false);
    });

    it('never ask for CONCURRENTLY, which cannot run inside the transaction Prisma wraps a file in', () => {
        for (const folder of FOLDERS) expect(statementsOf(folder).join('\n')).not.toMatch(/\bCONCURRENTLY\b/i);
    });

    it('set the lock timeout with SET LOCAL only, never for the whole session', () => {
        for (const folder of FOLDERS) expect(statementsOf(folder).join('\n')).not.toMatch(/\bSET\s+(?:SESSION\s+)?(?!LOCAL\b)\w+\s*(?:=|TO)/i);
    });

    it.each(FOLDERS)('%s is UTF-8 without a byte order mark', (folder) => {
        const bytes = fs.readFileSync(path.join(ROOT, pathOf(folder)));

        expect(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf).toBe(false);
    });
});

describe('prisma/schema.prisma agrees with them', () => {
    const job = between(schema, 'model Job {', '\n}');

    it('maps Job.shadowedByJobId to the nullable column, with the PaidPostTwin relation releasing copies on delete', () => {
        expect(job).toMatch(/\n\s+shadowedByJobId\s+String\?\s+@map\("shadowed_by_job_id"\)\n/);
        expect(job).toMatch(/shadowedBy\s+Job\?\s+@relation\("PaidPostTwin", fields: \[shadowedByJobId\], references: \[id\], onDelete: SetNull\)/);
        expect(job).toMatch(/shadowedCopies\s+Job\[\]\s+@relation\("PaidPostTwin"\)/);
    });

    it('indexes the pointer, which Prisma names jobs_shadowed_by_job_id_idx', () => {
        expect(job).toContain('@@index([shadowedByJobId])');
        expect(job).not.toMatch(/@@index\(\[shadowedByJobId\],\s*map:/);
    });

    it('maps UserProfile.verifiedEmployerOrgKeys to the non-null array column with an empty default', () => {
        expect(schema).toMatch(/\n\s+verifiedEmployerOrgKeys\s+String\[\]\s+@default\(\[\]\)\s+@map\("verified_employer_org_keys"\)\n/);
    });

    it('maps Job.twinCompanyLinkedAt to the nullable column, so every existing link reads as not made by the sync', () => {
        expect(job).toMatch(/\n\s+twinCompanyLinkedAt\s+DateTime\?\s+@map\("twin_company_linked_at"\)\n/);
    });
});
