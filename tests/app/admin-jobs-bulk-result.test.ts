/**
 * /admin/jobs reports what a bulk action left alone (app/admin/jobs/bulk-result.ts).
 *
 * POST /api/admin/jobs/bulk answers the number of jobs it changed and, for a
 * publish or a hard delete, skippedJobIds: a publish skips archived and
 * unpaid postings, and a hard delete keeps a posting a payment, a checkout or
 * an application reached after the list loaded. The page showed only
 * "publish: 4 job(s)", so a run that skipped two read as complete.
 *
 * The page cannot be rendered here (no jsdom), so its wiring is read from
 * source with comments blanked; the sentence itself is pinned directly.
 */
import { describe, expect, it } from 'vitest';
import { BULK_JOB_ACTIONS, describeBulkResult, skippedCount } from '@/app/admin/jobs/bulk-result';
import { readCode } from '../helpers/source';

describe('describeBulkResult', () => {
    it('counts the jobs skipped by a publish, with why', () => {
        expect(describeBulkResult('publish', 4, ['a', 'b'])).toBe('Published 4 jobs; 2 skipped (archived or unpaid)');
    });

    it('counts the jobs a hard delete kept, with why', () => {
        expect(describeBulkResult('hard_delete', 3, ['a'])).toBe('Permanently deleted 3 jobs; 1 skipped (changed since the list loaded)');
    });

    it('says only what was done when nothing was skipped', () => {
        expect(describeBulkResult('publish', 6, [])).toBe('Published 6 jobs');
        expect(describeBulkResult('publish', 6, undefined)).toBe('Published 6 jobs');
        expect(describeBulkResult('unpublish', 1)).toBe('Unpublished 1 job');
        expect(describeBulkResult('delete', 2)).toBe('Took down 2 jobs');
        expect(describeBulkResult('feature', 2)).toBe('Featured 2 jobs');
        expect(describeBulkResult('unfeature', 2)).toBe('Unfeatured 2 jobs');
    });

    it('reads a malformed skippedJobIds as nothing skipped, never as a crash', () => {
        expect(skippedCount('two')).toBe(0);
        expect(skippedCount(null)).toBe(0);
        expect(skippedCount([1, 'a', null])).toBe(1);
        expect(describeBulkResult('publish', 4, { count: 2 })).toBe('Published 4 jobs');
    });

    it('names an action it does not know without inventing a verb', () => {
        expect(describeBulkResult('archive', 2, ['a'])).toBe('Applied archive to 2 jobs; 1 skipped');
    });

    it('is house copy: no dashes in any sentence', () => {
        for (const action of BULK_JOB_ACTIONS) {
            expect(describeBulkResult(action, 3, ['a'])).not.toMatch(/[–—]|\s-\s/);
        }
    });
});

describe('the page and the route agree on the field', () => {
    it('the bulk route answers skippedJobIds, and the page passes it to the sentence', () => {
        const route = readCode('app/api/admin/jobs/bulk/route.ts');
        expect(route).toMatch(/skippedJobIds: outcome\.skippedJobIds/);

        const page = readCode('app/admin/jobs/page.tsx');
        expect(page).toMatch(/showMsg\(describeBulkResult\([^)]*result\.data\.skippedJobIds\), false\)/);
        // Still the failure-aware wrapper, with its failure branch first.
        expect(page).toMatch(/adminFetch<\{[^}]*skippedJobIds\?: unknown[^}]*\}>\('\/api\/admin\/jobs\/bulk'/);
    });

    it('every action the route accepts has its own sentence', () => {
        const route = readCode('app/api/admin/jobs/bulk/route.ts');
        const supported = /SUPPORTED_ACTIONS = \[([^\]]*)\]/.exec(route)?.[1] ?? '';
        const routeActions = [...supported.matchAll(/'(\w+)'/g)].map((match) => match[1]);
        expect([...routeActions].sort()).toEqual([...BULK_JOB_ACTIONS].sort());
    });
});
