/**
 * The 5-post pack back office API (2027 re-price, phase 3; plan section
 * 3.9): GET /api/admin/post-packs and PATCH /api/admin/post-packs/:id.
 *
 * Pinned, with the real admin gate and the real CSRF check:
 *   - both answer 401 signed out and 403 for an account that is not an
 *     admin, before a pack is read;
 *   - the PATCH refuses a cross-site request (403) and a body that is not
 *     one of the three changes (400), writing nothing;
 *   - GET lists the packs newest first, bounded, as admin views;
 *   - revoke, extend and restore each write one compare-and-set
 *     (lib/post-pack-admin.ts#planPackChange), answer the pack as it now
 *     stands and leave an audit entry naming the admin, the pack and the
 *     counters before and after;
 *   - a refused change (a refunded pack) and a write that matched nothing
 *     (a post spent a credit in between) write no audit entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { brand } from '@/config/brand';
import { packExpiresAtForUseBy } from '@/lib/pricing-copy';
import { ADMIN_PACK_SELECT, MAX_ADMIN_PACKS_LISTED } from '@/lib/post-pack-admin';

const session = vi.hoisted(() => ({ user: { id: 'admin-supabase-id' } as { id: string } | null }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: vi.fn(async () => ({ data: { user: session.user }, error: null })) } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { admin: { limit: 20, windowMs: 60_000 } },
}));
const logAudit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/audit-log', () => ({ logAudit }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { GET } from '@/app/api/admin/post-packs/route';
import { PATCH } from '@/app/api/admin/post-packs/[id]/route';

const EXPIRES = new Date('2028-03-01T12:00:00.000Z');

function pack(overrides: Record<string, unknown> = {}) {
    return {
        id: 'pack-1',
        userId: 'user-1',
        email: 'owner@clinic.example',
        status: 'paid',
        source: 'stripe',
        creditsTotal: config.packPosts,
        creditsRemaining: 3,
        creditsRevoked: 0,
        amountCents: config.stripePackPriceInCents,
        currency: 'usd',
        purchasedAt: new Date('2027-03-01T12:00:00.000Z'),
        expiresAt: EXPIRES,
        hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc',
        invoicePdfUrl: null,
        invoiceNumber: 'INV-0042',
        stripePaymentIntentId: 'pi_1',
        refundedAt: null,
        updatedAt: new Date('2027-03-01T12:00:00.000Z'),
        ...overrides,
    };
}

const SAME_SITE = { origin: brand.baseUrl };

function listRequest(): NextRequest {
    return new NextRequest('https://test.local/api/admin/post-packs');
}

function patchRequest(body: unknown, headers: Record<string, string> = SAME_SITE): NextRequest {
    return new NextRequest('https://test.local/api/admin/post-packs/pack-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

async function patch(body: unknown, headers?: Record<string, string>) {
    const res = await PATCH(patchRequest(body, headers), { params: Promise.resolve({ id: 'pack-1' }) });
    return { res, json: await res.json() };
}

beforeEach(() => {
    vi.clearAllMocks();
    session.user = { id: 'admin-supabase-id' };
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'admin-profile', role: 'admin' } as never);
    vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue(pack() as never);
    vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe('the admin gate', () => {
    it.each([
        ['signed out', () => { session.user = null; }, 401],
        ['an employer', () => { vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'p', role: 'employer' } as never); }, 403],
    ])('%s: GET and PATCH answer %i before a pack is read', async (_who, arrange, status) => {
        arrange();

        expect((await GET(listRequest())).status).toBe(status);
        expect((await patch({ action: 'restore' })).res.status).toBe(status);
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.findUnique).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/post-packs', () => {
    it('lists the packs newest first, bounded, as admin views', async () => {
        vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([pack()] as never);

        const res = await GET(listRequest());
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(prisma.employerPostPack.findMany).toHaveBeenCalledWith({
            orderBy: { purchasedAt: 'desc' },
            take: MAX_ADMIN_PACKS_LISTED,
            select: ADMIN_PACK_SELECT,
        });
        expect(json.packs).toEqual([expect.objectContaining({ id: 'pack-1', email: 'owner@clinic.example', remaining: 3, used: 2, total: config.packPosts })]);
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/admin/post-packs/:id: what it refuses', () => {
    it('a cross-site request: 403, nothing written', async () => {
        const { res } = await patch({ action: 'restore' }, { origin: 'https://evil.example' });

        expect(res.status).toBe(403);
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it.each([
        ['not JSON', 'not json'],
        ['an array', [{ action: 'restore' }]],
        ['no action', {}],
        ['an unknown action', { action: 'delete' }],
        ['a field the action does not take', { action: 'restore', credits: 1 }],
        ['a count that is not a whole number', { action: 'revoke', credits: 1.5 }],
        ['a count below one', { action: 'revoke', credits: 0 }],
        ['a date that is not a string', { action: 'extend', useBy: { gt: '2027-01-01' } }],
    ])('%s: 400, nothing read or written', async (_label, body) => {
        const { res } = await patch(body);

        expect(res.status).toBe(400);
        expect(prisma.employerPostPack.findUnique).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
    });

    it('a pack that does not exist: 404', async () => {
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue(null as never);

        expect((await patch({ action: 'restore' })).res.status).toBe(404);
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
    });

    it('a change the pack does not allow (a refunded pack): 409 with the reason, no write, no audit', async () => {
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue(pack({ status: 'refunded', creditsRemaining: 0, creditsRevoked: 3 }) as never);

        const { res, json } = await patch({ action: 'restore' });

        expect(res.status).toBe(409);
        expect(json.error).toBe('This pack is refunded. Only a paid pack can be changed here.');
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('a write that matched nothing (a post spent a credit in between): 409, no audit', async () => {
        vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 0 } as never);

        const { res, json } = await patch({ action: 'revoke' });

        expect(res.status).toBe(409);
        expect(json.error).toBe('This pack changed while you were editing it. Reload and try again.');
        expect(logAudit).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/admin/post-packs/:id: the three changes', () => {
    it('revoke: takes back the unused posts as a compare-and-set, audited', async () => {
        vi.mocked(prisma.employerPostPack.findUnique)
            .mockResolvedValueOnce(pack() as never)
            .mockResolvedValueOnce(pack({ creditsRemaining: 1, creditsRevoked: 2 }) as never);

        const { res, json } = await patch({ action: 'revoke', credits: 2 });

        expect(res.status).toBe(200);
        expect(prisma.employerPostPack.updateMany).toHaveBeenCalledWith({
            where: { id: 'pack-1', status: 'paid', creditsRemaining: 3, creditsRevoked: 0 },
            data: { creditsRemaining: 1, creditsRevoked: 2 },
        });
        expect(json.pack).toMatchObject({ id: 'pack-1', remaining: 1, revoked: 2 });
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'post_pack.revoke',
            actorType: 'admin',
            actorId: 'admin-profile',
            targetType: 'post_pack',
            targetId: 'pack-1',
            ip: '203.0.113.9',
            metadata: expect.objectContaining({
                email: 'owner@clinic.example',
                userId: 'user-1',
                credits: 2,
                previous: { creditsRemaining: 3, creditsRevoked: 0, expiresAt: EXPIRES.toISOString() },
                next: { creditsRemaining: 1, creditsRevoked: 2, expiresAt: EXPIRES.toISOString() },
            }),
        }));
    });

    it('extend: sets the expiry that reads "Use by" the date given, audited', async () => {
        const expiresAt = packExpiresAtForUseBy('2028-06-30') as Date;
        vi.mocked(prisma.employerPostPack.findUnique)
            .mockResolvedValueOnce(pack() as never)
            .mockResolvedValueOnce(pack({ expiresAt }) as never);

        const { res } = await patch({ action: 'extend', useBy: '2028-06-30' });

        expect(res.status).toBe(200);
        expect(prisma.employerPostPack.updateMany).toHaveBeenCalledWith({
            where: { id: 'pack-1', status: 'paid', expiresAt: EXPIRES },
            data: { expiresAt },
        });
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'post_pack.extend',
            targetId: 'pack-1',
            metadata: expect.objectContaining({
                previous: expect.objectContaining({ expiresAt: EXPIRES.toISOString() }),
                next: expect.objectContaining({ expiresAt: expiresAt.toISOString() }),
            }),
        }));
    });

    it('restore: gives back one post the pack spent, audited', async () => {
        vi.mocked(prisma.employerPostPack.findUnique)
            .mockResolvedValueOnce(pack() as never)
            .mockResolvedValueOnce(pack({ creditsRemaining: 4 }) as never);

        const { res, json } = await patch({ action: 'restore' });

        expect(res.status).toBe(200);
        expect(prisma.employerPostPack.updateMany).toHaveBeenCalledWith({
            where: { id: 'pack-1', status: 'paid', creditsRemaining: 3, creditsRevoked: 0 },
            data: { creditsRemaining: 4 },
        });
        expect(json.pack).toMatchObject({ remaining: 4, used: 1 });
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'post_pack.restore', actorId: 'admin-profile', targetId: 'pack-1' }));
    });
});
