/**
 * GET /api/verify-pack-session?session_id=cs_... — what the 5-post pack's
 * success page is told about the purchase (2027 re-price, phase 2).
 *
 * Pins:
 *   - the caller must be signed in, and the session's metadata.userId must
 *     be that account (403 otherwise): a session id seen in a URL or a log
 *     reveals nothing to anyone else, and nothing reaches Stripe before the
 *     sign-in check;
 *   - only a pack checkout is answered for (400 for any other session);
 *   - a paid session whose pack is not on the books yet (the webhook was lost
 *     or has not landed) is fulfilled here with the webhook's own
 *     fulfilPostPackCheckout (self-heal); a failure there never breaks the
 *     answer, which then says paid with no pack yet;
 *   - a completed session whose delayed payment is still settling answers
 *     'processing'; an open or expired one 'unpaid';
 *   - (fix pass, code review L1) once the pack is on the books, the purchase
 *     email a failed send left unsent is sent here: a replayed webhook finds
 *     the pack recorded and runs no side effect, so nothing else would.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { captureException } from '@/lib/sentry';

const sessionsRetrieve = vi.fn();
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { retrieve: sessionsRetrieve } } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
const fulfilment = vi.hoisted(() => ({ fulfilPostPackCheckout: vi.fn(), sendPurchasedEmailIfUnsent: vi.fn() }));
vi.mock('@/app/api/webhooks/stripe/post-pack-checkout', () => fulfilment);
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const EXPIRES = new Date('2028-03-01T12:00:00.000Z');
const PACK_ROW = { id: 'pack-1', creditsTotal: 5, creditsRemaining: 5, expiresAt: EXPIRES, status: 'paid' };

function packSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 'cs_pack',
        status: 'complete',
        payment_status: 'paid',
        client_reference_id: 'user-1',
        metadata: { type: 'post_pack', sku: 'post-pack-5', userId: 'user-1', quotaDomain: 'clinic.example', posts: '5' },
        ...overrides,
    };
}

async function verify(sessionId: string | null = 'cs_pack') {
    const { GET } = await import('@/app/api/verify-pack-session/route');
    const url = sessionId === null ? 'https://test.local/api/verify-pack-session' : `https://test.local/api/verify-pack-session?session_id=${encodeURIComponent(sessionId)}`;
    const res = await GET(new NextRequest(url));
    return { res, json: await res.json() };
}

beforeAll(async () => {
    await import('@/app/api/verify-pack-session/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@clinic.example' } }, error: null });
    sessionsRetrieve.mockResolvedValue(packSession());
    vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue(PACK_ROW as never);
    fulfilment.fulfilPostPackCheckout.mockResolvedValue({ outcome: 'fulfilled', packId: 'pack-1' });
    fulfilment.sendPurchasedEmailIfUnsent.mockResolvedValue(undefined);
});

describe('who is answered', () => {
    it('503 without the Stripe key', async () => {
        delete process.env.STRIPE_SECRET_KEY;

        const { res } = await verify();

        expect(res.status).toBe(503);
    });

    it.each([
        ['no session id', null],
        ['an empty one', ''],
        ['one that is not a Checkout Session id', 'pi_123'],
        ['one with characters a session id never has', 'cs_abc/../x'],
    ])('400 for %s, before Stripe is asked', async (_label, sessionId) => {
        const { res } = await verify(sessionId);

        expect(res.status).toBe(400);
        expect(sessionsRetrieve).not.toHaveBeenCalled();
    });

    it('401 signed out, before Stripe is asked', async () => {
        getUserMock.mockResolvedValue({ data: { user: null }, error: null });

        const { res } = await verify();

        expect(res.status).toBe(401);
        expect(sessionsRetrieve).not.toHaveBeenCalled();
    });

    it('403 when the pack was bought by another account, and nothing is fulfilled', async () => {
        sessionsRetrieve.mockResolvedValue(packSession({ client_reference_id: 'user-2', metadata: { type: 'post_pack', userId: 'user-2' } }));
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue(null as never);

        const { res, json } = await verify();

        expect(res.status).toBe(403);
        expect(JSON.stringify(json)).not.toContain('pack-1');
        expect(fulfilment.fulfilPostPackCheckout).not.toHaveBeenCalled();
    });

    it('400 for a session that is not a pack checkout', async () => {
        sessionsRetrieve.mockResolvedValue(packSession({ metadata: { jobId: 'job-1', pricing: 'pro', userId: 'user-1' } }));

        const { res } = await verify();

        expect(res.status).toBe(400);
        expect(fulfilment.fulfilPostPackCheckout).not.toHaveBeenCalled();
    });

    it('404 for a session Stripe does not know', async () => {
        sessionsRetrieve.mockRejectedValue(Object.assign(new Error('No such checkout.session'), { code: 'resource_missing' }));

        const { res } = await verify();

        expect(res.status).toBe(404);
    });
});

describe('what a paid session answers', () => {
    it('the pack on the books, with no fulfilment run', async () => {
        const { res, json } = await verify();

        expect(res.status).toBe(200);
        expect(json).toEqual({ status: 'paid', pack: { creditsTotal: 5, creditsRemaining: 5, expiresAt: EXPIRES.toISOString() } });
        expect(prisma.employerPostPack.findUnique).toHaveBeenCalledWith({
            where: { stripeSessionId: 'cs_pack' },
            select: { creditsTotal: true, creditsRemaining: true, expiresAt: true },
        });
        expect(fulfilment.fulfilPostPackCheckout).not.toHaveBeenCalled();
    });

    it('a paid session with no pack yet is fulfilled here, with the webhook own fulfilment', async () => {
        vi.mocked(prisma.employerPostPack.findUnique)
            .mockResolvedValueOnce(null as never)
            .mockResolvedValueOnce(PACK_ROW as never);

        const { json } = await verify();

        expect(fulfilment.fulfilPostPackCheckout).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'cs_pack' }), { eventId: 'verify-pack-session' });
        expect(json).toEqual({ status: 'paid', pack: { creditsTotal: 5, creditsRemaining: 5, expiresAt: EXPIRES.toISOString() } });
    });

    it('a failed self-heal never breaks the answer: paid, no pack yet, and Sentry is told', async () => {
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue(null as never);
        fulfilment.fulfilPostPackCheckout.mockRejectedValue(new Error('db down'));

        const { res, json } = await verify();

        expect(res.status).toBe(200);
        expect(json).toEqual({ status: 'paid', pack: null });
        expect(captureException).toHaveBeenCalled();
    });
});

describe('the purchase email a failed send left unsent (code review L1)', () => {
    it('is retried for a pack on the books, with the buyer session', async () => {
        await verify();

        expect(fulfilment.sendPurchasedEmailIfUnsent).toHaveBeenCalledTimes(1);
        expect(fulfilment.sendPurchasedEmailIfUnsent).toHaveBeenCalledWith(expect.objectContaining({ id: 'cs_pack' }));
    });

    it('is retried after a self-heal recorded the pack too (the claim keeps it to one email)', async () => {
        vi.mocked(prisma.employerPostPack.findUnique)
            .mockResolvedValueOnce(null as never)
            .mockResolvedValueOnce(PACK_ROW as never);

        await verify();

        expect(fulfilment.sendPurchasedEmailIfUnsent).toHaveBeenCalledTimes(1);
    });

    it('is not tried while no pack is on the books, for an unpaid session, or for another account', async () => {
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue(null as never);
        fulfilment.fulfilPostPackCheckout.mockRejectedValue(new Error('db down'));
        await verify();
        sessionsRetrieve.mockResolvedValue(packSession({ payment_status: 'unpaid' }));
        await verify();
        sessionsRetrieve.mockResolvedValue(packSession({ client_reference_id: 'user-2', metadata: { type: 'post_pack', userId: 'user-2' } }));
        await verify();

        expect(fulfilment.sendPurchasedEmailIfUnsent).not.toHaveBeenCalled();
    });
});

describe('what an unpaid session answers', () => {
    it("'processing' for a completed session whose delayed payment is still settling", async () => {
        sessionsRetrieve.mockResolvedValue(packSession({ payment_status: 'unpaid' }));

        const { json } = await verify();

        expect(json).toEqual({ status: 'processing', pack: null });
        expect(fulfilment.fulfilPostPackCheckout).not.toHaveBeenCalled();
    });

    it.each(['open', 'expired'])("'unpaid' for an %s session", async (status) => {
        sessionsRetrieve.mockResolvedValue(packSession({ status, payment_status: 'unpaid' }));

        const { json } = await verify();

        expect(json).toEqual({ status: 'unpaid', pack: null });
        expect(fulfilment.fulfilPostPackCheckout).not.toHaveBeenCalled();
    });
});
