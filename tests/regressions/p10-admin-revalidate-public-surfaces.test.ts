/**
 * P10 admin-revalidate regressions:
 *  1. the admin sidebar nav scrolls (1280x720 cannot fit every link) and its
 *     footer no longer sits absolutely over the lowest links
 *  2. below lg the drawer starts under the fixed mobile bar instead of behind it
 *  3. featuring / unfeaturing a testimonial revalidates /testimonials and the
 *     other ISR surfaces that render featured testimonials
 *  4. classifying a company and reviewing a company claim revalidate the A to Z
 *     hub, the ISR profile and every job page of that company
 *  5. the A to Z hub reads Company.claimVerifiedAt and marks claimed employers
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

const revalidatePathMock = vi.fn();
vi.mock('next/cache', () => ({
    revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { admin: { limit: 20, windowMs: 60_000 } },
}));

vi.mock('@/lib/prisma', () => {
    const prisma = {
        userProfile: { findUnique: vi.fn() },
        employerTestimonial: { findUnique: vi.fn(), update: vi.fn() },
        company: { findUnique: vi.fn(), update: vi.fn() },
        companyClaim: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
        $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
    return { prisma };
});

vi.mock('@/lib/audit-log', () => ({ logAudit: vi.fn(async () => undefined) }));

vi.mock('@/lib/logger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { PATCH as testimonialPATCH } from '@/app/api/admin/testimonials/[id]/route';
import { PATCH as companyPATCH } from '@/app/api/admin/companies/[id]/route';
import { PATCH as claimPATCH } from '@/app/api/admin/company-claims/[id]/route';
import {
    companyPublicPaths,
    revalidateCompanySurfaces,
    TESTIMONIAL_PUBLIC_PATHS,
} from '@/app/api/admin/_lib/public-revalidation';

type Mock = ReturnType<typeof vi.fn>;
const m = (fn: unknown) => fn as Mock;
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function req(url: string, body: unknown): NextRequest {
    return new NextRequest(`https://example.com${url}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify(body),
    });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const revalidated = () => revalidatePathMock.mock.calls.map((call) => call[0]);

const COMPANY_LOOKUP = {
    normalizedName: 'e2e behavioral health',
    jobs: [{ slug: 'pmhnp-role-one' }, { slug: 'pmhnp-role-two' }],
};

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'admin-supabase-id' } }, error: null });
    m(prisma.userProfile.findUnique).mockResolvedValue({ id: 'admin-profile', role: 'admin' });
});

describe('companyPublicPaths', () => {
    it('covers the hub, the kebab profile URL and each job page, deduped', () => {
        expect(companyPublicPaths('life stance', ['a', null, '', 'a', undefined, 'b'])).toEqual([
            '/companies',
            '/companies/life-stance',
            '/jobs/a',
            '/jobs/b',
        ]);
    });

    it('lists every ISR surface that renders featured testimonials', () => {
        expect(TESTIMONIAL_PUBLIC_PATHS).toEqual(['/testimonials', '/for-employers', '/post-job/checkout']);
    });

    it('never throws when revalidation or the lookup fails (the write already committed)', async () => {
        m(prisma.company.findUnique).mockRejectedValueOnce(new Error('db down'));
        revalidatePathMock.mockImplementationOnce(() => { throw new Error('no store'); });
        await expect(revalidateCompanySurfaces('c1', 'Test')).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalled();
    });
});

describe('testimonial feature revalidates public pages', () => {
    it('featuring a pending testimonial revalidates /testimonials', async () => {
        m(prisma.employerTestimonial.findUnique).mockResolvedValue({ id: 't1', featuredAt: null, displayAs: 'initial', consent: true });
        m(prisma.employerTestimonial.update).mockResolvedValue({ id: 't1', featuredAt: new Date(), displayAs: 'initial' });
        const res = await testimonialPATCH(req('/api/admin/testimonials/t1', { featured: true }), ctx('t1'));
        expect(res.status).toBe(200);
        expect(revalidated()).toEqual(expect.arrayContaining(['/testimonials', '/for-employers', '/post-job/checkout']));
    });

    it('a refused write revalidates nothing', async () => {
        const res = await testimonialPATCH(req('/api/admin/testimonials/t1', {}), ctx('t1'));
        expect(res.status).toBe(400);
        expect(revalidatePathMock).not.toHaveBeenCalled();
    });
});

describe('company classification and claim review revalidate public pages', () => {
    const expected = ['/companies', '/companies/e2e-behavioral-health', '/jobs/pmhnp-role-one', '/jobs/pmhnp-role-two'];

    it('PATCH /api/admin/companies/:id revalidates hub, profile and job pages', async () => {
        m(prisma.company.findUnique)
            .mockResolvedValueOnce({ id: 'c1', name: 'E2E Behavioral Health', recruitmentType: null })
            .mockResolvedValueOnce(COMPANY_LOOKUP);
        m(prisma.company.update).mockResolvedValue({ id: 'c1', recruitmentType: 'direct_hire' });
        const res = await companyPATCH(req('/api/admin/companies/c1', { recruitmentType: 'direct_hire' }), ctx('c1'));
        expect(res.status).toBe(200);
        expect(revalidated()).toEqual(expected);
    });

    it('an unknown company is a 404 and revalidates nothing', async () => {
        m(prisma.company.findUnique).mockResolvedValueOnce(null);
        const res = await companyPATCH(req('/api/admin/companies/nope', { recruitmentType: 'direct_hire' }), ctx('nope'));
        expect(res.status).toBe(404);
        expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it('approving a claim revalidates hub, profile and job pages', async () => {
        m(prisma.companyClaim.findUnique)
            .mockResolvedValueOnce({ id: 'k1', companyId: 'c1', status: 'pending', claimantUserId: 'u1' })
            .mockResolvedValueOnce({ id: 'k1', status: 'approved' });
        m(prisma.company.findUnique)
            .mockResolvedValueOnce({ claimVerifiedAt: null })
            .mockResolvedValueOnce(COMPANY_LOOKUP);
        const res = await claimPATCH(req('/api/admin/company-claims/k1', { action: 'approve' }), ctx('k1'));
        expect(res.status).toBe(200);
        expect(prisma.company.update).toHaveBeenCalled();
        expect(revalidated()).toEqual(expected);
    });

    it('revoking a claim also revalidates, so the badge disappears publicly', async () => {
        m(prisma.companyClaim.findUnique)
            .mockResolvedValueOnce({ id: 'k1', companyId: 'c1', status: 'approved', claimantUserId: 'u1' })
            .mockResolvedValueOnce({ id: 'k1', status: 'rejected' });
        m(prisma.companyClaim.count).mockResolvedValue(0);
        m(prisma.company.findUnique)
            .mockResolvedValueOnce({ claimVerifiedAt: new Date() })
            .mockResolvedValueOnce(COMPANY_LOOKUP);
        const res = await claimPATCH(req('/api/admin/company-claims/k1', { action: 'reject' }), ctx('k1'));
        expect(res.status).toBe(200);
        expect(revalidated()).toEqual(expected);
    });
});

describe('admin sidebar layout', () => {
    const src = read('app/admin/_components/AdminSidebar.tsx');

    it('makes the nav the scroll container inside a flex column aside', () => {
        expect(src).toMatch(/<aside[\s\S]*?className=\{`[^`]*\bflex flex-col\b/);
        expect(src).toMatch(/<nav[\s\S]*?className="[^"]*\bflex-1\b[^"]*\bmin-h-0\b[^"]*\boverflow-y-auto\b/);
    });

    it('no longer positions the footer absolutely over the nav links', () => {
        expect(src).not.toMatch(/position:\s*'absolute'/);
    });

    it('starts the mobile drawer below the fixed 65px mobile bar', () => {
        expect(src).toMatch(/top-\[65px\] lg:top-0/);
    });
});

describe('A to Z employer hub', () => {
    const src = read('app/companies/page.tsx');

    it('selects claimVerifiedAt and renders a Claimed marker for claimed entries', () => {
        expect(src).toMatch(/claimVerifiedAt: true/);
        expect(src).toMatch(/isClaimed: company\.claimVerifiedAt !== null/);
        expect(src).toMatch(/entry\.isClaimed && \(/);
        expect(src).toContain('Claimed by employer');
    });
});
