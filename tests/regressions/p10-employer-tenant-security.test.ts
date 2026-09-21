/**
 * P10 employer tenant security regressions:
 *   1. GET /api/employer/applicants?jobId=<foreign job> replaced the ownership
 *      scope instead of intersecting it (cross-tenant applicant read)
 *   2. PATCH /api/employer/settings stored javascript: websites that
 *      AboutEmployer rendered as a raw href on the public job page
 *   3. PATCH /api/employer/settings let non-string fields reach Prisma (500)
 *   4. anonymous gate inconsistencies on jd-templates, free-quota-status,
 *      profile-snapshot
 *   5. em dash in the candidates/[id] 403 copy
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { scopeJobIdsToOwned } from '@/app/api/employer/applicants/scope';
import {
    normalizeHttpUrl,
    parseEmployerSettings,
    buildEmployerJobUpdate,
    buildProfileUpdate,
} from '@/app/api/employer/settings/validation';
import { jdTemplateGateStatus } from '@/app/api/employer/jd-templates/auth';
import { safeExternalHref } from '@/components/AboutEmployer';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const DASHES = /[–—]/;

describe('applicants jobId scope (defect 1)', () => {
    const owned = ['job-a1', 'job-a2'];

    it('returns all owned jobs when no filter is given', () => {
        expect(scopeJobIdsToOwned(owned, null)).toEqual(owned);
        expect(scopeJobIdsToOwned(owned, '')).toEqual(owned);
        expect(scopeJobIdsToOwned(owned, '   ')).toEqual(owned);
    });

    it('narrows to an owned job', () => {
        expect(scopeJobIdsToOwned(owned, 'job-a2')).toEqual(['job-a2']);
    });

    it('refuses a job the caller does not own', () => {
        expect(scopeJobIdsToOwned(owned, 'job-b-foreign')).toBeNull();
        expect(scopeJobIdsToOwned([], 'job-b-foreign')).toBeNull();
    });

    it('route uses the scoped ids, never the raw filter', () => {
        const src = read('app/api/employer/applicants/route.ts');
        expect(src).not.toMatch(/in:\s*\[jobIdFilter\]/);
        expect(src).toMatch(/scopeJobIdsToOwned\(jobIds,\s*jobIdFilter\)/);
        expect(src).toMatch(/status:\s*404/);
    });
});

describe('employer settings URL safety (defect 2)', () => {
    it.each([
        'javascript:alert(document.domain)',
        ' JavaScript:alert(1)',
        'java\tscript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        '//evil.example.com',
        'http://localhost',
        'not a url',
    ])('rejects %j', (value) => {
        expect(normalizeHttpUrl(value)).toBeUndefined();
        const parsed = parseEmployerSettings({ companyWebsite: value });
        expect(parsed.ok).toBe(false);
    });

    it('accepts and normalises http(s) and bare hosts', () => {
        expect(normalizeHttpUrl('https://acme-health.com/careers')).toBe('https://acme-health.com/careers');
        expect(normalizeHttpUrl('acme.com')).toBe('https://acme.com/');
        expect(normalizeHttpUrl('acme.com:8080/x')).toBe('https://acme.com:8080/x');
        expect(normalizeHttpUrl('   ')).toBeNull();
    });

    it('a blank website clears the column', () => {
        const parsed = parseEmployerSettings({ companyWebsite: '' });
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(buildEmployerJobUpdate(parsed.data)).toEqual({ companyWebsite: null });
    });

    it('logo accepts https and site-relative paths but not scripts', () => {
        expect(parseEmployerSettings({ companyLogoUrl: '/logos/acme.png' }).ok).toBe(true);
        expect(parseEmployerSettings({ companyLogoUrl: 'https://cdn.acme.com/l.png' }).ok).toBe(true);
        expect(parseEmployerSettings({ companyLogoUrl: 'javascript:alert(1)' }).ok).toBe(false);
        expect(parseEmployerSettings({ companyLogoUrl: '//evil.com/x.png' }).ok).toBe(false);
    });

    it('AboutEmployer only renders absolute http(s) hrefs', () => {
        expect(safeExternalHref('javascript:alert(document.domain)')).toBeNull();
        expect(safeExternalHref('data:text/html,x')).toBeNull();
        expect(safeExternalHref('//evil.com')).toBeNull();
        expect(safeExternalHref('/relative')).toBeNull();
        expect(safeExternalHref(null)).toBeNull();
        expect(safeExternalHref('https://acme.com')).toBe('https://acme.com/');
        expect(safeExternalHref('www.acme.com')).toBe('https://www.acme.com/');
    });

    it('AboutEmployer never passes a raw website prop to href', () => {
        const src = read('components/AboutEmployer.tsx');
        expect(src).toMatch(/safeExternalHref\(company\?\.website\)/);
        expect(src).not.toMatch(/company\?\.website \|\| companyWebsite/);
    });
});

describe('employer settings input validation (defect 3)', () => {
    it.each([
        [{ phone: { nested: 'object' } }],
        [{ firstName: ['array'] }],
        [{ lastName: 42 }],
        [{ company: true }],
        [{ companyDescription: 'x'.repeat(5001) }],
    ])('rejects %j with a message', (body) => {
        const parsed = parseEmployerSettings(body);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(0);
    });

    it('rejects non-object bodies', () => {
        for (const body of [null, [], 'x', 3]) expect(parseEmployerSettings(body).ok).toBe(false);
    });

    it('builds updates only for sent keys and never nulls employerName', () => {
        const parsed = parseEmployerSettings({ firstName: ' Ada ', company: '', phone: null });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(buildProfileUpdate(parsed.data)).toEqual({ firstName: 'Ada', company: null, phone: null });
        expect(buildEmployerJobUpdate(parsed.data)).not.toHaveProperty('employerName');
    });

    it('route validates before touching Prisma and does not echo errors', () => {
        const src = read('app/api/employer/settings/route.ts');
        expect(src).toMatch(/parseEmployerSettings\(body\)/);
        expect(src).toMatch(/status:\s*400/);
        expect(src).not.toMatch(/const \{[^}]*companyWebsite[^}]*\} = body/);
    });
});

describe('anonymous gates (defect 4)', () => {
    it('jd-templates distinguishes no session (401) from wrong role (403)', () => {
        expect(jdTemplateGateStatus(false, null)).toBe(401);
        expect(jdTemplateGateStatus(true, 'job_seeker')).toBe(403);
        expect(jdTemplateGateStatus(true, null)).toBe(403);
        expect(jdTemplateGateStatus(true, 'employer')).toBe(200);
    });

    it('free-quota-status answers 401 JSON and never echoes err.message', () => {
        const src = read('app/api/employer/free-quota-status/route.ts');
        expect(src).toMatch(/status:\s*401/);
        const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toMatch(/err\.message|error\.message/);
    });

    it('profile-snapshot 401 carries an error string', () => {
        const src = read('app/api/employer/profile-snapshot/route.ts');
        expect(src).toMatch(/\{\s*error:\s*'Unauthorized'[^}]*\},\s*\{\s*status:\s*401/);
    });
});

describe('copy rule (defect 5)', () => {
    it('candidates/[id] response strings carry no dashes', () => {
        const src = read('app/api/employer/candidates/[id]/route.ts');
        const strings = src.match(/(['`])(?:(?!\1).)*\1/g) ?? [];
        expect(strings.filter((s) => DASHES.test(s))).toEqual([]);
    });
});
