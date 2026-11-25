/**
 * The admin hold migration reaches the PRODUCTION database through
 * `prisma migrate deploy` in the next Vercel build, while the previous
 * deployment still serves. So it must be additive and safe on a live table:
 *   - 20261126000001_add_jobs_admin_hold_at adds one nullable column with no
 *     default (a catalog-only change, no table rewrite) and changes no other
 *     table, column or row;
 *   - a 5 second lock timeout is set first with SET LOCAL, because the
 *     column locks jobs;
 *   - the file is UTF-8 without a byte order mark.
 * prisma/schema.prisma has to say the same.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { between, readRepo, ROOT } from '../support/docs-vs-code';

const FOLDER = '20261126000001_add_jobs_admin_hold_at';
const migrationPath = `prisma/migrations/${FOLDER}/migration.sql`;

/** The SQL without its comments, so prose about a statement never counts as one. */
const statements = readRepo(migrationPath).replace(/--[^\n]*/g, '').trim();
const schema = readRepo('prisma/schema.prisma');

describe(`migration ${FOLDER}`, () => {
    it('sets a lock timeout for its own transaction, then adds the one column', () => {
        const lines = statements.split('\n').map((line) => line.trim()).filter(Boolean);

        expect(lines).toEqual([
            "SET LOCAL lock_timeout = '5s';",
            'ALTER TABLE "jobs" ADD COLUMN "admin_hold_at" TIMESTAMP(3);',
        ]);
    });

    it('is additive: no default, no backfill, nothing dropped, altered or rewritten', () => {
        expect(statements).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME|DEFAULT|NOT NULL|INSERT)\b/i);
        expect(statements).not.toMatch(/ALTER COLUMN/i);
    });

    it('is UTF-8 without a byte order mark', () => {
        const bytes = fs.readFileSync(path.join(ROOT, migrationPath));

        expect(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf).toBe(false);
    });
});

describe('prisma/schema.prisma', () => {
    it('maps Job.adminHoldAt to the nullable admin_hold_at column', () => {
        const job = between(schema, 'model Job {', '\n}');

        expect(job).toMatch(/\n\s+adminHoldAt\s+DateTime\?\s+@map\("admin_hold_at"\)\n/);
    });
});
