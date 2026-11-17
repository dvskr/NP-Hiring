/**
 * Job pages are ISR for a day (app/jobs/[slug]/page.tsx), so an employer's or
 * an admin's edit refreshes the page at once through revalidateJobPage, and a
 * failed refresh never fails the saved edit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import fs from 'node:fs';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { revalidateJobPage } from '@/lib/job-page-revalidation';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

beforeEach(() => {
    vi.mocked(revalidatePath).mockReset();
    vi.mocked(logger.error).mockReset();
});

describe('revalidateJobPage', () => {
    it('refreshes the job page by its slug', () => {
        revalidateJobPage('np-in-austin-0b6f1a2e-1111-4222-8333-944455556666', 'test');
        expect(revalidatePath).toHaveBeenCalledWith('/jobs/np-in-austin-0b6f1a2e-1111-4222-8333-944455556666');
    });

    it('does nothing without a slug', () => {
        for (const slug of [null, undefined, '', '   ']) revalidateJobPage(slug, 'test');
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('logs a failed refresh instead of throwing', () => {
        vi.mocked(revalidatePath).mockImplementationOnce(() => {
            throw new Error('no static generation store');
        });
        expect(() => revalidateJobPage('a-slug', 'Job Update')).not.toThrow();
        expect(logger.error).toHaveBeenCalledWith('[Job Update] revalidatePath failed', expect.any(Error), { path: '/jobs/a-slug' });
    });
});

describe('the edit routes refresh the page after the write', () => {
    it.each([
        ['app/api/jobs/update/route.ts', 'updatedJob.slug'],
        ['app/api/admin/jobs/[id]/route.ts', 'job.slug'],
    ])('%s', (rel, slugExpr) => {
        const src = read(rel);
        expect(src).toContain("import { revalidateJobPage } from '@/lib/job-page-revalidation';");
        const call = src.indexOf(`revalidateJobPage(${slugExpr},`);
        expect(call).toBeGreaterThan(-1);
        // After the job row is written.
        expect(call).toBeGreaterThan(src.indexOf('prisma.job.update({'));
    });

    it('the admin route reads the slug it refreshes', () => {
        const src = read('app/api/admin/jobs/[id]/route.ts');
        expect(src).toMatch(/isFeatured: true, updatedAt: true, expiresAt: true, slug: true,/);
    });
});
