/**
 * P10 employer-posting-auth-ui regressions:
 *   - header profile loads were issued 8 to 9 times per page load; every
 *     HeaderAuth instance now shares one in-flight request per user
 *   - employer jobs posted as Remote stored isRemote=false (flags came from
 *     the location string only); the work mode now decides
 *   - post-free / update never classified professionClass
 *   - benefits / setting / population were stored unvalidated (500 on
 *     non-string benefits, off-registry values persisted)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    normalizeWorkMode,
    deriveWorkModeFlags,
    validateBenefits,
    validateSetting,
    validatePopulation,
    classifyEmployerJob,
    MAX_BENEFITS,
} from '@/app/api/jobs/post-free/_lib/job-attributes';
import {
    loadHeaderProfile,
    clearHeaderProfile,
    HEADER_PROFILE_TTL_MS,
} from '@/components/auth/header-profile-store';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const NO_LOCATION_FLAGS = { isRemote: false, isHybrid: false };

describe('work mode decides isRemote / isHybrid', () => {
    it('normalizes the wizard values and common variants', () => {
        expect(normalizeWorkMode('Remote')).toBe('Remote');
        expect(normalizeWorkMode(' hybrid ')).toBe('Hybrid');
        expect(normalizeWorkMode('On-site')).toBe('In-Person');
        expect(normalizeWorkMode('In-Person')).toBe('In-Person');
        expect(normalizeWorkMode('anywhere')).toBeNull();
        expect(normalizeWorkMode(42)).toBeNull();
    });

    it('Remote mode with a city location is fully remote', () => {
        expect(deriveWorkModeFlags('Remote', NO_LOCATION_FLAGS)).toEqual({ isRemote: true, isHybrid: false });
    });

    it('Hybrid and In-Person modes are exclusive and override the location string', () => {
        expect(deriveWorkModeFlags('Hybrid', { isRemote: true, isHybrid: false })).toEqual({ isRemote: false, isHybrid: true });
        expect(deriveWorkModeFlags('In-Person', { isRemote: true, isHybrid: false })).toEqual({ isRemote: false, isHybrid: false });
    });

    it('falls back to location flags only without a recognised mode', () => {
        expect(deriveWorkModeFlags(null, { isRemote: true, isHybrid: false })).toEqual({ isRemote: true, isHybrid: false });
        expect(deriveWorkModeFlags(undefined, { isRemote: true, isHybrid: true })).toEqual({ isRemote: false, isHybrid: true });
    });
});

describe('benefits validation', () => {
    it('rejects non-string entries instead of reaching Prisma', () => {
        const r = validateBenefits([{ nested: 'object' }, 42]);
        expect(r.ok).toBe(false);
    });

    it('rejects a non-array and oversized lists', () => {
        expect(validateBenefits('Health Insurance').ok).toBe(false);
        expect(validateBenefits(Array.from({ length: MAX_BENEFITS + 1 }, (_, i) => `b${i}`)).ok).toBe(false);
        expect(validateBenefits(['x'.repeat(101)]).ok).toBe(false);
    });

    it('accepts absent benefits and strips markup, blanks and duplicates', () => {
        expect(validateBenefits(undefined)).toEqual({ ok: true, value: [] });
        expect(validateBenefits(['Health Insurance', '<b>CME Allowance</b>', '  ', 'Health Insurance']))
            .toEqual({ ok: true, value: ['Health Insurance', 'CME Allowance'] });
    });
});

describe('setting / population registry validation', () => {
    it('accepts registry values and empty input', () => {
        expect(validateSetting('Telehealth')).toEqual({ ok: true, value: 'Telehealth' });
        expect(validatePopulation("Women's Health")).toEqual({ ok: true, value: "Women's Health" });
        expect(validateSetting('')).toEqual({ ok: true, value: null });
        expect(validatePopulation(undefined)).toEqual({ ok: true, value: null });
    });

    it('rejects off-registry and non-string values', () => {
        expect(validateSetting('not-a-registry-setting').ok).toBe(false);
        expect(validatePopulation('<b>not-a-population</b>').ok).toBe(false);
        expect(validateSetting({ in: ['x'] }).ok).toBe(false);
        expect(validateSetting('toString').ok).toBe(false);
    });

    it('lets an edit resubmit the legacy value the row already stores, and nothing else', () => {
        expect(validateSetting('Community Health', 'Community Health')).toEqual({ ok: true, value: 'Community Health' });
        expect(validateSetting('Community Health', 'Outpatient').ok).toBe(false);
    });
});

describe('profession classification for employer posts', () => {
    it('assigns a class and confidence like ingestion', () => {
        const r = classifyEmployerJob('Psychiatric Mental Health Nurse Practitioner (PMHNP)', '<p>Telehealth role</p>');
        expect(r.professionClass).toBe('np_eligible');
        expect(r.professionConfidence).toBeGreaterThan(0.5);
    });
});

describe('post-free and update routes wire the shared rules', () => {
    for (const rel of ['app/api/jobs/post-free/route.ts', 'app/api/jobs/update/route.ts']) {
        it(`${rel} uses work-mode flags, the classifier and validation`, () => {
            const src = read(rel);
            expect(src).toContain('deriveWorkModeFlags(');
            expect(src).toContain('isRemote: workModeFlags.isRemote');
            expect(src).not.toContain('isRemote: parsedLoc.isRemote');
            expect(src).toContain('professionClass: profession.professionClass');
            expect(src).toContain('validateBenefits(');
            expect(src).toContain('validateSetting(');
            expect(src).toContain('validatePopulation(');
        });
    }

    it('post-free validates before auth and the quota transaction', () => {
        const src = read('app/api/jobs/post-free/route.ts');
        expect(src.indexOf('validateBenefits(')).toBeLessThan(src.indexOf('supabase.auth.getUser()'));
        expect(src.indexOf('validatePopulation(')).toBeLessThan(src.indexOf('prisma.$transaction'));
    });
});

describe('header profile store dedupes /api/auth/profile', () => {
    beforeEach(() => clearHeaderProfile());

    const okFetcher = (payload: object) =>
        vi.fn(async () => ({ ok: true, json: async () => payload }));

    it('concurrent and repeated callers share a single request', async () => {
        const fetcher = okFetcher({ role: 'employer' });
        const results = await Promise.all([
            loadHeaderProfile('u1', { fetcher }),
            loadHeaderProfile('u1', { fetcher }),
            loadHeaderProfile('u1', { fetcher }),
        ]);
        await loadHeaderProfile('u1', { fetcher });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(results.every((r) => r?.role === 'employer')).toBe(true);
    });

    it('refetches for another user, on force, after the TTL, and after clear', async () => {
        let t = 0;
        const now = () => t;
        const fetcher = okFetcher({ role: 'job_seeker' });
        await loadHeaderProfile('u1', { fetcher, now });
        await loadHeaderProfile('u2', { fetcher, now });
        expect(fetcher).toHaveBeenCalledTimes(2);
        await loadHeaderProfile('u2', { fetcher, now, force: true });
        expect(fetcher).toHaveBeenCalledTimes(3);
        t += HEADER_PROFILE_TTL_MS + 1;
        await loadHeaderProfile('u2', { fetcher, now });
        expect(fetcher).toHaveBeenCalledTimes(4);
        clearHeaderProfile();
        await loadHeaderProfile('u2', { fetcher, now });
        expect(fetcher).toHaveBeenCalledTimes(5);
    });

    it('does not cache a failed request', async () => {
        const failing = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
        expect(await loadHeaderProfile('u1', { fetcher: failing })).toBeNull();
        const fetcher = okFetcher({ role: 'employer' });
        expect((await loadHeaderProfile('u1', { fetcher }))?.role).toBe('employer');
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('HeaderAuth and UserMenu no longer fetch the profile directly', () => {
        const header = read('components/auth/HeaderAuth.tsx');
        const menu = read('components/auth/UserMenu.tsx');
        expect(header).not.toContain("fetch('/api/auth/profile')");
        expect(header).toContain('loadHeaderProfile(');
        expect(header).toMatch(/INITIAL_SESSION/);
        expect(menu).not.toContain('/api/auth/profile');
    });
});
