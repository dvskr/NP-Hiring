/**
 * P0 hubs-truth regression guards — dashboard application statuses
 * (content audit 2026-07, P0 #9) + company-page JSON-LD escaping (P0 #14).
 *
 * #9  — the dashboard's Recent Applications card FABRICATED statuses from
 *       days elapsed since application ("Submitted" → "Under Review" →
 *       "In Progress"), regardless of what the employer actually did.
 *       The real JobApplication.status is already in the /api/dashboard
 *       payload (the jobApplication.findMany uses `include`, which returns
 *       all application scalars). The dashboard must render it via a
 *       status map that mirrors app/my-applications/page.tsx.
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

    it('the /api/dashboard payload keeps returning application scalars (status included)', () => {
        const src = read(DASHBOARD_API);
        const idx = src.indexOf('jobApplication.findMany');
        expect(idx).toBeGreaterThan(-1);
        const snippet = src.slice(idx, idx + 800);
        // `include` (not a top-level `select`) returns every scalar on the
        // application row — including `status`. If someone converts this
        // call to a select that omits status, the dashboard silently loses
        // real statuses again.
        const includeAt = snippet.indexOf('include:');
        const selectAt = snippet.indexOf('select:');
        expect(includeAt).toBeGreaterThan(-1);
        expect(
            selectAt === -1 || includeAt < selectAt,
            'jobApplication.findMany must use include (full scalars) — a top-level select could drop status',
        ).toBe(true);
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
