/**
 * TECH-06: a category landing with 0 canonical jobs answers 404 instead of
 * an empty "0 positions" 200 (the soft-404 pattern). From 1 to the listing
 * floor it keeps rendering `noindex, follow`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        pseoStats: { findUnique: vi.fn(), findMany: vi.fn() },
        job: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
        company: { findMany: vi.fn() },
        $queryRaw: vi.fn(),
    },
}));

import { prisma } from '@/lib/prisma';
import { buildCategoryLandingMetadata } from '@/lib/pseo/category-landing-template';
import { MIN_JOBS_FOR_CATEGORY_LANDING_RENDER, shouldRenderCategoryLanding } from '@/lib/pseo/render-gate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

async function rejection(promise: Promise<unknown>): Promise<string> {
    return promise.then(
        () => 'resolved',
        (error: unknown) => {
            const e = error as { digest?: string; message?: string };
            return `${e.digest ?? ''} ${e.message ?? ''}`;
        },
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => { });
    db.job.groupBy.mockResolvedValue([]);
    db.job.findMany.mockResolvedValue([]);
    db.job.aggregate.mockResolvedValue({});
    db.company.findMany.mockResolvedValue([]);
    db.pseoStats.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue([]);
});

describe('shouldRenderCategoryLanding', () => {
    it('renders from 1 job, 404s at 0', () => {
        expect(MIN_JOBS_FOR_CATEGORY_LANDING_RENDER).toBe(1);
        expect(shouldRenderCategoryLanding(0)).toBe(false);
        expect(shouldRenderCategoryLanding(1)).toBe(true);
        expect(shouldRenderCategoryLanding(Number.NaN)).toBe(false);
    });
});

describe('the shared landing template', () => {
    it('answers not found for 0 canonical jobs', async () => {
        db.job.count.mockResolvedValue(0);
        expect(await rejection(buildCategoryLandingMetadata('family-practice', {}))).toMatch(/404|NOT_FOUND/);
    });

    it('keeps rendering noindex, follow for 1 or 2 jobs', async () => {
        db.job.count.mockResolvedValue(2);
        const meta = await buildCategoryLandingMetadata('family-practice', {});
        expect(meta.robots).toEqual({ index: false, follow: true });
    });

    it('never links a related landing that has 0 jobs', () => {
        const src = read('lib/pseo/category-landing-template.tsx');
        expect(src).toContain('const linkableRelated = related.filter((sibling) => sibling.count === null || shouldRenderCategoryLanding(sibling.count));');
        expect(src).toContain('{linkableRelated.map((sibling) => (');
        expect(src).toMatch(/if \(isPageOutOfRange\(page, facts\.total, take\) \|\| !shouldRenderCategoryLanding\(facts\.total\)\)/);
    });
});
