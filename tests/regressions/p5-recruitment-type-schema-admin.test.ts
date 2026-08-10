/**
 * P5 A6 — schema, migration, and admin-writer invariants for the direct-hire
 * vs staffing-agency classification machinery.
 *
 * The whole feature rests on three non-negotiables:
 *   1. The migration is ADDITIVE-ONLY (claim-step precedent): one enum type,
 *      one nullable column, no backfill, no default — every existing company
 *      stays NULL (= unclassified) until a human decides otherwise.
 *   2. Classification is a HUMAN act: the admin PATCH route is the only
 *      writer, it is auth-gated + CSRF-checked + audit-logged, and no ingest
 *      or backfill code path ever touches Company.recruitmentType.
 *   3. The admin route never overloads the other two trust columns
 *      (isVerified / claimVerifiedAt) — three signals, three writers.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATION = 'prisma/migrations/20260806000000_add_company_recruitment_type/migration.sql';

describe('migration is additive-only', () => {
    const sql = read(MIGRATION);
    // Scan STATEMENTS only — the header comments legitimately discuss what
    // the migration deliberately avoids ("no column drop", "no backfill").
    const statements = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

    it('creates the enum with exactly the two values', () => {
        expect(statements).toMatch(/CREATE TYPE "RecruitmentType" AS ENUM \('direct_hire', 'staffing_agency'\);/);
    });

    it('adds a NULLABLE column with no default and no backfill', () => {
        expect(statements).toMatch(/ALTER TABLE "companies" ADD COLUMN "recruitment_type" "RecruitmentType";/);
        expect(statements).not.toMatch(/NOT NULL/);
        expect(statements).not.toMatch(/DEFAULT/);
        // No data rewrite of any kind — NULL (unclassified) is the correct
        // value for every existing row.
        expect(statements).not.toMatch(/\bUPDATE\b/i);
        expect(statements).not.toMatch(/\bINSERT\b/i);
        expect(statements).not.toMatch(/\bDROP\b/i);
    });
});

describe('schema.prisma', () => {
    const schema = read('prisma/schema.prisma');

    it('Company.recruitmentType is optional, mapped, and enum-typed', () => {
        expect(schema).toMatch(/recruitmentType RecruitmentType\? @map\("recruitment_type"\)/);
        expect(schema).toMatch(/enum RecruitmentType \{\s*direct_hire\s*staffing_agency\s*\}/);
    });

    it('documents that classification is a human act with a single writer', () => {
        // The doc comment is the contract future ingest/backfill authors read.
        expect(schema).toContain('HUMAN act');
        expect(schema).toContain('/api/admin/companies');
    });
});

describe('admin PATCH route — the only writer', () => {
    const route = read('app/api/admin/companies/[id]/route.ts');

    it('is auth-gated, CSRF-checked, and audit-logged like the claims routes', () => {
        expect(route).toContain('requireApiAdmin');
        expect(route).toContain('verifyCsrf');
        expect(route).toContain('logAudit');
        expect(route).toMatch(/company\.recruitment_type\.(set|clear)/);
    });

    it('validates to the two enum values or null (undo) and nothing else', () => {
        expect(route).toMatch(/z\.enum\(\['direct_hire', 'staffing_agency'\]\)\.nullable\(\)/);
    });

    it('records the previous value in the audit trail so mistakes are traceable', () => {
        expect(route).toContain('previousRecruitmentType');
    });

    it('never writes the other two trust columns', () => {
        // isVerified belongs to the ingest pipeline, claimVerifiedAt to the
        // claim queue. This route reading them would be fine; writing them
        // would re-conflate the trust family the schema deliberately splits.
        // No `s` flag (tsconfig targets ES2017); the character class already
        // spans newlines, so the match behavior is unchanged.
        expect(route).not.toMatch(/data:\s*\{[^}]*isVerified/);
        expect(route).not.toMatch(/data:\s*\{[^}]*claimVerifiedAt/);
    });

    it('list route is admin-gated too', () => {
        const list = read('app/api/admin/companies/route.ts');
        expect(list).toContain('requireApiAdmin');
    });
});

describe('no machine classifier exists', () => {
    it('no ingest/backfill code path writes recruitmentType', () => {
        // The classification is company-level and human-only. Scan the write
        // surfaces a machine classifier would live in: the normalizer, the
        // ingestion service, and scripts/. The admin route is the one
        // permitted writer.
        const suspects = [
            'lib/company-normalizer.ts',
            'lib/ingestion-service.ts',
        ];
        const scriptsDir = path.join(ROOT, 'scripts');
        if (fs.existsSync(scriptsDir)) {
            for (const entry of fs.readdirSync(scriptsDir)) {
                if (entry.endsWith('.ts') || entry.endsWith('.mjs') || entry.endsWith('.js')) {
                    suspects.push(path.join('scripts', entry));
                }
            }
        }
        for (const rel of suspects) {
            const full = path.join(ROOT, rel);
            if (!fs.existsSync(full)) continue;
            const src = fs.readFileSync(full, 'utf8');
            expect(src, `${rel} must never write recruitmentType`).not.toContain('recruitmentType:');
        }
    });
});

describe('migration drift guard interplay', () => {
    it('the new column has migration coverage under the same rules as tests/db/migrations-cover-schema.test.ts', () => {
        // Cheap local mirror of the repo-wide coverage test so THIS package's
        // failure mode (schema edited, migration forgotten) fails in this
        // file with a readable message.
        const sql = read(MIGRATION);
        expect(sql).toContain('"recruitment_type"');
        const schema = read('prisma/schema.prisma');
        expect(schema).toContain('@map("recruitment_type")');
    });
});
