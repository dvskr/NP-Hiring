/**
 * P0 hubs-truth regression guards — dashboard application statuses
 * (content audit 2026-07, P0 #9) + company-page JSON-LD escaping (P0 #14).
 *
 * #9  — the dashboard's Recent Applications card FABRICATED statuses from
 *       days elapsed since application ("Submitted" → "Under Review" →
 *       "In Progress"), regardless of what the employer actually did.
 *       The real JobApplication.status is in the /api/dashboard payload:
 *       the recent applications query selects it explicitly, next to id,
 *       appliedAt and the job card fields, and selects none of the
 *       employer's private notes or AI assessment (an `include` returned
 *       every column, those among them). The dashboard must render it via
 *       a status map that mirrors app/my-applications/page.tsx.
 *
 * #14 — /companies/[slug] serialized a scraped company description into
 *       Organization JSON-LD unescaped: a description containing
 *       "</script>" broke out of the script tag (script injection /
 *       broken schema). Must escape < and > like app/jobs/page.tsx does.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The source of the first call after `marker`, from its opening parenthesis to the matching one. */
function callSource(src: string, marker: string): string {
    const open = src.indexOf('(', src.indexOf(marker));
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '(') depth++;
        if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1);
    }
    throw new Error(`unbalanced call after ${marker}`);
}

const DASHBOARD = 'components/dashboard/DashboardContent.tsx';
const MY_APPLICATIONS = 'app/my-applications/page.tsx';
const COMPANY_PAGE = 'app/companies/[slug]/page.tsx';
const DASHBOARD_API = 'app/api/dashboard/route.ts';

describe('P0 #9 — dashboard renders real application statuses', () => {
    it('the elapsed-days status fabrication is gone', () => {
        const src = read(DASHBOARD);
        expect(src).not.toContain('daysSince');
        expect(src).not.toContain("'Under Review'");
        expect(src).not.toContain("'In Progress'");
        expect(src).not.toContain("'Submitted'");
    });

    it('status badges derive from app.status via the shared-shape config', () => {
        const src = read(DASHBOARD);
        expect(src).toMatch(/APPLICATION_STATUS_CONFIG\[app\.status\]/);
        // The Application payload type must carry the real column.
        expect(src).toMatch(/interface Application \{[\s\S]*?\bstatus: string\b[\s\S]*?\}/);
    });

    it('dashboard status entries mirror /my-applications exactly', () => {
        const dashboard = read(DASHBOARD);
        const myApplications = read(MY_APPLICATIONS);
        // Same key → same label on both surfaces (values from the
        // JobApplication.status enum comment in prisma/schema.prisma).
        const entries = [
            "applied: { label: 'Applied'",
            "screening: { label: 'Screening'",
            "interview: { label: 'Interview'",
            "offered: { label: 'Offered'",
            "hired: { label: 'Hired'",
            "rejected: { label: 'Not Selected'",
            "withdrawn: { label: 'Withdrawn'",
        ];
        for (const entry of entries) {
            expect(dashboard, `dashboard missing status entry: ${entry}`).toContain(entry);
            expect(myApplications, `my-applications missing status entry: ${entry}`).toContain(entry);
        }
    });

    it('the /api/dashboard recent applications select status, and no employer-private field', () => {
        const src = read(DASHBOARD_API);
        expect(src.indexOf('jobApplication.findMany')).toBeGreaterThan(-1);
        const call = callSource(src, 'jobApplication.findMany');
        // A top-level select, never `include`: include returns every column,
        // the employer's private notes and AI assessment among them.
        // tests/api/dashboard-application-fields.test.ts pins the payload.
        expect(call, 'the recent applications query must not use include').not.toContain('include:');
        const selectAt = call.indexOf('select:');
        expect(selectAt, 'the recent applications query must select its fields').toBeGreaterThan(-1);
        expect(selectAt, 'the first select must be the top-level one, before the job sub-select').toBeLessThan(call.indexOf('job:'));
        // Dropping status from the select would lose real statuses again.
        expect(call).toMatch(/\bstatus: true\b/);
        for (const field of ['notes', 'aiMatchScore', 'aiMatchReasons', 'aiMissingItems']) {
            expect(call, `the recent applications query must not select ${field}`).not.toContain(field);
        }
    });
});

describe('P0 #14 — company Organization JSON-LD is escaped', () => {
    // NOTE: the target sources literally contain `.replace(/</g, '<')`
    // written with an escaped backslash (`'\\u003c'` in their raw bytes), so
    // the assertion string here uses doubled escapes to match those bytes.
    const ESCAPE_CHAIN = ".replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e')";

    it('the JSON-LD stringify chains the same </> escapes as app/jobs/page.tsx', () => {
        const src = read(COMPANY_PAGE);
        expect(src).toContain(ESCAPE_CHAIN);
    });

    it('reference pattern still present on /jobs (source of the convention)', () => {
        const src = read('app/jobs/page.tsx');
        expect(src).toContain(ESCAPE_CHAIN);
    });
});
