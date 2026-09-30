/**
 * GFJ-08: PATCH /api/admin/companies/:id/profile, the admin data pass for an
 * employer's website and logo (JobPosting hiringOrganization sameAs, logo).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: { findUnique: vi.fn() },
        company: { findUnique: vi.fn(), update: vi.fn() },
    },
}));

const logAuditMock = vi.fn(async () => undefined);
vi.mock('@/lib/audit-log', () => ({ logAudit: (...args: unknown[]) => logAuditMock(...(args as [])) }));

vi.mock('@/lib/logger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '@/lib/prisma';
import { PATCH } from '@/app/api/admin/companies/[id]/profile/route';

type Mock = ReturnType<typeof vi.fn>;
const m = (fn: unknown) => fn as Mock;

function req(body: unknown): NextRequest {
    return new NextRequest('https://example.com/api/admin/companies/c1/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify(body),
    });
}
const ctx = { params: Promise.resolve({ id: 'c1' }) };

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'admin-supabase-id' } }, error: null });
    m(prisma.userProfile.findUnique).mockResolvedValue({ id: 'admin-profile', role: 'admin' });
});

describe('PATCH /api/admin/companies/:id/profile', () => {
    it('stores the website as its site origin and the logo as given, audit-logged', async () => {
        m(prisma.company.findUnique)
            .mockResolvedValueOnce({ id: 'c1', name: 'LifeStance Health', website: null, logoUrl: null })
            .mockResolvedValueOnce({ name: 'LifeStance Health', normalizedName: 'lifestance', jobs: [] });
        m(prisma.company.update).mockResolvedValue({ id: 'c1', website: 'https://www.lifestance.com', logoUrl: 'https://www.lifestance.com/logo.png' });

        const res = await PATCH(req({ website: 'https://www.lifestance.com/about-us', logoUrl: 'https://www.lifestance.com/logo.png' }), ctx);
        expect(res.status).toBe(200);
        expect(m(prisma.company.update).mock.calls[0][0].data).toEqual({
            website: 'https://www.lifestance.com',
            logoUrl: 'https://www.lifestance.com/logo.png',
        });
        expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
            action: 'company.web_identity.update',
            targetId: 'c1',
            metadata: expect.objectContaining({ previousWebsite: null, previousLogoUrl: null }),
        }));
        expect(revalidatePathMock).toHaveBeenCalled();
    });

    it('clears a field with null', async () => {
        m(prisma.company.findUnique).mockResolvedValueOnce({ id: 'c1', name: 'X', website: 'https://x.org', logoUrl: null });
        m(prisma.company.update).mockResolvedValue({ id: 'c1' });
        const res = await PATCH(req({ website: null }), ctx);
        expect(res.status).toBe(200);
        expect(m(prisma.company.update).mock.calls[0][0].data).toEqual({ website: null });
    });

    it.each([
        ['an http URL', { website: 'http://www.example.org' }],
        ['a relative path', { logoUrl: '/logo.png' }],
        ['a javascript URL', { website: 'javascript:alert(1)' }],
        ['no field at all', {}],
        ['a field this route does not own', { recruitmentType: 'direct_hire' }],
    ])('refuses %s', async (_label, body) => {
        const res = await PATCH(req(body), ctx);
        expect(res.status).toBe(400);
        expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown company', async () => {
        m(prisma.company.findUnique).mockResolvedValueOnce(null);
        const res = await PATCH(req({ website: 'https://www.example.org' }), ctx);
        expect(res.status).toBe(404);
    });

    it('is admin only', async () => {
        m(prisma.userProfile.findUnique).mockResolvedValue({ id: 'p', role: 'job_seeker' });
        const res = await PATCH(req({ website: 'https://www.example.org' }), ctx);
        expect([401, 403]).toContain(res.status);
        expect(prisma.company.update).not.toHaveBeenCalled();
    });
});
