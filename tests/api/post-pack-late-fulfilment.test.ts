/**
 * A 5-post pack recorded after its payment was already refunded or disputed
 * (security review M1, fix pass), by the two paths besides the webhook that
 * record one: the verify page's self-heal (/api/verify-pack-session) and the
 * daily payment reconciliation sweep. Both run the webhook's own
 * fulfilPostPackCheckout, which reads the payment before the pack is
 * written. Their own suites mock it; here it runs for real, against a small
 * in-memory pack table:
 *   - a charge refunded in full records the pack 'refunded': no credit left
 *     to spend (all of them revoked), the refund on the row, and no "your
 *     pack is ready" email, on the record or on the email retry;
 *   - a disputed charge records it 'disputed' (frozen, its credits counted);
 *   - a charge left alone records it 'paid', as before.
 * The webhook's retry is pinned in tests/api/webhooks-stripe-post-pack.test.ts.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { sendPostPackPurchasedEmail } from '@/lib/email-service';

const stripeApi = vi.hoisted(() => ({
    sessionsRetrieve: vi.fn(),
    sessionsList: vi.fn(),
    paymentIntentsRetrieve: vi.fn(),
}));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        checkout: { sessions: { retrieve: stripeApi.sessionsRetrieve, list: stripeApi.sessionsList } },
        paymentIntents: { retrieve: stripeApi.paymentIntentsRetrieve },
        invoices: { retrieve: vi.fn().mockResolvedValue({ id: 'in_pack', invoice_pdf: null, hosted_invoice_url: null, number: null }) },
    })),
}));

type StepRun = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
interface CapturedFunction {
    handler: (ctx: { step: { run: StepRun } }) => Promise<{ activated: number; failures: number }>;
}
vi.mock('@/lib/inngest/client', () => ({
    inngest: { createFunction: vi.fn((opts: unknown, handler: CapturedFunction['handler']) => ({ opts, handler })) },
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/post-pack-sale', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/post-pack-sale')>()),
    isPackSaleOpen: vi.fn(() => true),
}));

const HOUR_S = 3600;

function packSession() {
    return {
        id: 'cs_pack_late',
        object: 'checkout.session',
        mode: 'payment',
        status: 'complete',
        payment_status: 'paid',
        payment_intent: 'pi_pack_late',
        amount_total: config.stripePackPriceInCents,
        currency: 'usd',
        client_reference_id: 'user-1',
        customer_details: { email: 'owner@clinic.example' },
        created: Math.floor(Date.now() / 1000) - 5 * HOUR_S,
        metadata: { type: 'post_pack', sku: 'post-pack-5', userId: 'user-1', quotaDomain: 'clinic.example', posts: '5' },
    };
}

/** The payment intent, read with its latest charge, in the state Stripe holds it. */
function chargeNow(state: 'refunded' | 'disputed' | 'untouched') {
    stripeApi.paymentIntentsRetrieve.mockResolvedValue({
        id: 'pi_pack_late',
        metadata: { type: 'post_pack', userId: 'user-1' },
        latest_charge: {
            id: 'ch_pack_late',
            amount: config.stripePackPriceInCents,
            amount_refunded: state === 'refunded' ? config.stripePackPriceInCents : 0,
            refunded: state === 'refunded',
            disputed: state === 'disputed',
        },
    });
}

/** The pack table: empty until the fulfilment writes the one row; a read returns the fields it selects. */
let stored: Record<string, unknown> | null = null;
function emptyPackTable() {
    stored = null;
    vi.mocked(prisma.employerPostPack.create).mockReset().mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
        stored = { id: 'pack-late', ...data };
        return { id: 'pack-late' };
    }) as never);
    vi.mocked(prisma.employerPostPack.findUnique).mockReset().mockImplementation((async ({ select }: { select: Record<string, boolean> }) =>
        (stored ? Object.fromEntries(Object.keys(select).map((key) => [key, stored![key]])) : null)) as never);
}

/** The EmailSend claims: a key once claimed is found, and claiming it again is a unique violation. */
function emptyEmailClaims() {
    const claims = new Set<string>();
    vi.mocked(prisma.emailSend.create).mockReset().mockImplementation((async ({ data }: { data: { dedupeKey?: string } }) => {
        if (data.dedupeKey && claims.has(data.dedupeKey)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        if (data.dedupeKey) claims.add(data.dedupeKey);
        return {};
    }) as never);
    vi.mocked(prisma.emailSend.findFirst).mockReset().mockImplementation((async ({ where }: { where: { dedupeKey: string } }) =>
        (claims.has(where.dedupeKey) ? { id: 'claim-1' } : null)) as never);
}

async function verifyPage() {
    const { GET } = await import('@/app/api/verify-pack-session/route');
    const res = await GET(new NextRequest('https://test.local/api/verify-pack-session?session_id=cs_pack_late'));
    return { res, json: await res.json() };
}

async function runSweep() {
    const mod = await import('@/lib/inngest/functions/payment-reconciliation');
    const fn = mod.paymentReconciliationSweep as unknown as CapturedFunction;
    return fn.handler({ step: { run: (async (_name: string, cb: () => Promise<unknown>) => cb()) as StepRun } });
}

beforeAll(async () => {
    await import('@/app/api/verify-pack-session/route');
    await import('@/lib/inngest/functions/payment-reconciliation');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    emptyPackTable();
    emptyEmailClaims();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@clinic.example' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'employer', email: 'owner@clinic.example' } as never);
    vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never); // no pending new-post rows for the sweep
    stripeApi.sessionsRetrieve.mockResolvedValue(packSession());
    stripeApi.sessionsList.mockReturnValue({ async *[Symbol.asyncIterator]() { yield packSession(); } });
});

const PATHS = [
    ['the verify page self-heal', verifyPage],
    ['the daily reconciliation sweep', runSweep],
] as const;

describe.each(PATHS)('%s', (_path, record) => {
    it('records a pack whose charge was refunded in full as refunded: every credit revoked, the refund on the row, no ready email', async () => {
        chargeNow('refunded');

        await record();

        expect(stripeApi.paymentIntentsRetrieve).toHaveBeenCalledWith('pi_pack_late', { expand: ['latest_charge'] });
        expect(stored).toMatchObject({
            status: 'refunded',
            creditsTotal: config.packPosts,
            creditsRemaining: 0,
            creditsRevoked: config.packPosts,
            refundedAmountCents: config.stripePackPriceInCents,
        });
        expect(sendPostPackPurchasedEmail).not.toHaveBeenCalled();
    });

    it('records a pack whose charge is disputed as disputed: frozen, its credits counted, no ready email', async () => {
        chargeNow('disputed');

        await record();

        expect(stored).toMatchObject({ status: 'disputed', creditsRemaining: config.packPosts, creditsRevoked: 0 });
        expect(sendPostPackPurchasedEmail).not.toHaveBeenCalled();
    });

    it('records a pack whose charge stands as paid, and sends the purchase email once', async () => {
        chargeNow('untouched');

        await record();

        expect(stored).toMatchObject({ status: 'paid', creditsRemaining: config.packPosts, creditsRevoked: 0 });
        expect(sendPostPackPurchasedEmail).toHaveBeenCalledTimes(1);
    });
});

describe('what the verify page answers for a pack recorded refunded', () => {
    it('paid, with the pack as recorded: no credit left', async () => {
        chargeNow('refunded');

        const { res, json } = await verifyPage();

        expect(res.status).toBe(200);
        expect(json).toMatchObject({ status: 'paid', pack: { creditsTotal: config.packPosts, creditsRemaining: 0 } });
    });
});
