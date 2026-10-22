/**
 * Register 2.26: the featured jobs on the home page and /for-job-seekers hide
 * what every other listing hides.
 *
 * FeaturedJobsSection queried published, unexpired, recent jobs with no
 * GLOBAL_EXCLUSIONS (rows classified as another profession, and the provider
 * title vetoes for rows not yet classified) and no dead-link filter, so a
 * physician or PA posting, or a listing whose apply link is dead, could be
 * featured on the most visited pages while /jobs hid it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';
import { liveLinkWhere } from '@/lib/dead-link-threshold';

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import FeaturedJobsSection from '@/components/FeaturedJobsSection';

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);
});

describe('FeaturedJobsSection: the featured query', () => {
    it('excludes every globally excluded row and dead links, as /jobs does', async () => {
        await FeaturedJobsSection();
        expect(prisma.job.findMany).toHaveBeenCalled();
        const [{ where }] = vi.mocked(prisma.job.findMany).mock.calls[0] as unknown as [{ where: { AND: unknown[] } }];
        for (const exclusion of GLOBAL_EXCLUSIONS) {
            expect(where.AND).toContainEqual({ NOT: exclusion });
        }
        expect(where.AND).toContainEqual(liveLinkWhere());
    });
});
