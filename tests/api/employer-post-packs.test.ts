/**
 * GET /api/employer/post-packs — the signed-in employer's 5-post packs, and
 * whether one can be bought now (2027 re-price, phase 3). The dashboard usage
 * widget and Settings, Billing read it.
 *
 * Pins:
 *   - 401 signed out and 403 for an account that is not an employer, before
 *     any pack is read;
 *   - only the caller's own packs are read (userId = the session's account),
 *     newest first, with a bound on the read; nothing is written;
 *   - each pack in the view the pages print (lib/post-pack-view.ts), with its
 *     Stripe hosted invoice link;
 *   - the account's current credit across its packs, a used-up pack included
 *     ("5 of 5 used"), and null with no current pack;
 *   - whether the pack can be bought now (lib/post-pack-sale.ts#isPackSaleOpen)
 *     and the offer from config;
 *   - a failed read answers 500 without the error's text.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { MAX_PACKS_LISTED, POST_PACK_VIEW_SELECT } from '@/lib/post-pack-view';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const sale = vi.hoisted(() => ({ open: false }));
vi.mock('@/lib/post-pack-sale', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/post-pack-sale')>();
    return { ...actual, isPackSaleOpen: () => sale.open };
});

const NOW = new Date('2027-06-01T12:00:00.000Z');
const EXPIRES = new Date('2028-03-01T12:00:00.000Z');

function pack(overrides: Record<string, unknown> = {}) {
    return {
        id: 'pack-1',
        status: 'paid',
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
        ...overrides,
    };
}

/** The table for the caller: the full list for the page, and the current packs for the credit. */
function packsInTable(rows: ReturnType<typeof pack>[]) {
    vi.mocked(prisma.employerPostPack.findMany).mockImplementation((async (args: { where: Record<string, unknown> }) =>
        'expiresAt' in args.where
            ? rows.filter((row) => row.status === 'paid' && row.expiresAt.getTime() > NOW.getTime())
            : rows) as never);
}

async function list() {
    const { GET } = await import('@/app/api/employer/post-packs/route');
    const res = await GET(new NextRequest('https://test.local/api/employer/post-packs'));
    return { res, json: await res.json() };
}

beforeAll(async () => {
    await import('@/app/api/employer/post-packs/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    sale.open = false;
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@clinic.example' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-1', role: 'employer' } as never);
    packsInTable([]);
});

describe('who is answered', () => {
    it('401s a signed-out caller and reads no pack', async () => {
        getUserMock.mockResolvedValue({ data: { user: null }, error: null });

        const { res } = await list();

        expect(res.status).toBe(401);
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
    });

    it('403s an account that is not an employer and reads no pack', async () => {
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-2', role: 'job_seeker' } as never);

        const { res } = await list();

        expect(res.status).toBe(403);
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
    });
});

describe("the caller's packs", () => {
    it('reads only the signed-in account\'s packs, newest first, bounded, and writes nothing', async () => {
        packsInTable([pack()]);

        await list();

        expect(prisma.employerPostPack.findMany).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            orderBy: { purchasedAt: 'desc' },
            take: MAX_PACKS_LISTED,
            select: POST_PACK_VIEW_SELECT,
        });
        for (const [args] of vi.mocked(prisma.employerPostPack.findMany).mock.calls) {
            expect((args as { where: { userId: string } }).where.userId).toBe('user-1');
        }
        expect(prisma.employerPostPack.update).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
    });

    it('answers each pack as the pages print it, with its hosted invoice link, and the credit across the current packs', async () => {
        packsInTable([pack(), pack({ id: 'pack-0', status: 'refunded', creditsRemaining: 0, creditsRevoked: 4, hostedInvoiceUrl: null })]);

        const { res, json } = await list();

        expect(res.status).toBe(200);
        expect(json.packs).toEqual([
            expect.objectContaining({ id: 'pack-1', state: 'active', remaining: 3, used: 2, total: config.packPosts, hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc', invoiceNumber: 'INV-0042' }),
            expect.objectContaining({ id: 'pack-0', state: 'refunded', remaining: 0, used: 1, total: 1, hostedInvoiceUrl: null }),
        ]);
        expect(json.credit).toEqual({ remaining: 3, used: 2, total: config.packPosts, expiresAt: EXPIRES.toISOString() });
    });

    it('a used-up pack still reports its credit: 5 of 5 used', async () => {
        packsInTable([pack({ creditsRemaining: 0 })]);

        const { json } = await list();

        expect(json.credit).toEqual({ remaining: 0, used: config.packPosts, total: config.packPosts, expiresAt: EXPIRES.toISOString() });
        expect(json.packs[0]).toMatchObject({ state: 'used', used: config.packPosts });
    });

    it('no current pack: no credit, and an empty list', async () => {
        const { json } = await list();

        expect(json.credit).toBeNull();
        expect(json.packs).toEqual([]);
    });
});

describe('the offer', () => {
    it('states whether a pack can be bought now, and the offer from config', async () => {
        for (const open of [false, true]) {
            sale.open = open;
            const { json } = await list();
            expect(json.saleOpen).toBe(open);
            expect(json.offer).toEqual({
                posts: config.packPosts,
                price: config.packPrice,
                priceCents: config.stripePackPriceInCents,
                validityMonths: config.packValidityMonths,
            });
        }
    });
});

describe('failures', () => {
    it('answers 500 without the error text', async () => {
        vi.mocked(prisma.employerPostPack.findMany).mockRejectedValue(new Error('select failed: secret detail'));

        const { res, json } = await list();

        expect(res.status).toBe(500);
        expect(JSON.stringify(json)).not.toContain('secret detail');
    });
});
