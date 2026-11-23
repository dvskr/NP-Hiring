/**
 * Tenant list invariants: no duplicate board in any ATS list, and every
 * entry has the shape its adapter expects. A duplicate board is fetched
 * twice per run and double-counts toward the chunk and time budgets.
 */

import { describe, it, expect } from 'vitest';
import { GREENHOUSE_SLUGS, GREENHOUSE_NAMES } from '@/lib/aggregators/tenants/greenhouse';
import { LEVER_SLUGS, LEVER_NAMES } from '@/lib/aggregators/tenants/lever';
import { ASHBY_TENANTS } from '@/lib/aggregators/tenants/ashby';
import { SMARTRECRUITERS_TENANTS } from '@/lib/aggregators/tenants/smartrecruiters';
import { WORKABLE_TENANTS } from '@/lib/aggregators/tenants/workable';

function duplicates(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const v of values) {
        const key = v.toLowerCase();
        if (seen.has(key)) dupes.add(v);
        seen.add(key);
    }
    return [...dupes];
}

describe('ATS tenant lists', () => {
    it('greenhouse has no duplicate slugs and every slug is non-empty', () => {
        expect(duplicates(GREENHOUSE_SLUGS)).toEqual([]);
        for (const slug of GREENHOUSE_SLUGS) expect(slug.trim()).toBe(slug);
        for (const slug of GREENHOUSE_SLUGS) expect(slug.length).toBeGreaterThan(0);
    });

    it('greenhouse name overrides have unique keys that are real tenants or kept for history', () => {
        expect(Object.keys(GREENHOUSE_NAMES).length).toBeGreaterThan(0);
        for (const name of Object.values(GREENHOUSE_NAMES)) expect(name.trim().length).toBeGreaterThan(0);
    });

    it('every greenhouse slug added with a display name resolves one', () => {
        for (const slug of ['1pyra)mid_health&care', 'erc8585757pathlight53t353', 'twochairs', 'peregrinehealth']) {
            expect(GREENHOUSE_SLUGS).toContain(slug);
            expect(GREENHOUSE_NAMES[slug]).toBeTruthy();
        }
    });

    it('lever has no duplicate slugs', () => {
        expect(duplicates(LEVER_SLUGS)).toEqual([]);
    });

    it('lever name overrides have non-empty names', () => {
        for (const name of Object.values(LEVER_NAMES)) expect(name.trim().length).toBeGreaterThan(0);
    });

    it.each([
        ['ashby', ASHBY_TENANTS],
        ['smartrecruiters', SMARTRECRUITERS_TENANTS],
        ['workable', WORKABLE_TENANTS],
    ])('%s has no duplicate slugs and every entry has a slug and a name', (_ats, tenants) => {
        expect(duplicates(tenants.map((t) => t.slug))).toEqual([]);
        for (const t of tenants) {
            expect(t.slug.trim().length).toBeGreaterThan(0);
            expect(t.name.trim().length).toBeGreaterThan(0);
        }
    });

    it('ashby includes Fort Health, whose slug carries a space', () => {
        expect(ASHBY_TENANTS.find((t) => t.slug === 'fort health')?.name).toBe('Fort Health');
    });
});
