/**
 * POST /api/webhooks/stripe — fulfilling a 5-post pack checkout (2027
 * re-price, phase 2; app/api/webhooks/stripe/post-pack-checkout.ts).
 *
 * Pins:
 *   - a pack session (metadata.type 'post_pack') takes its own branch before
 *     the per-post paths: it carries no jobId and never reaches their "Missing
 *     job ID" 400, the new-post activation or the JobCharge ledger;
 *   - the same money gate as every per-post path: an unpaid session (a
 *     delayed method still settling) is deferred, 'no_payment_required' is
 *     alerted, and checkout.session.async_payment_succeeded fulfils later
 *     through the same branch;
 *   - the pack row: config.packPosts credits for the buying account, the
 *     signup domain, what Stripe charged, the payment intent, the invoice,
 *     and expiresAt = packExpiresAt(now);
 *   - one create keyed on the unique stripeSessionId: a session already on
 *     the books, or a P2002 from a racing path, is 'already_fulfilled' and
 *     runs no side effect a second time;
 *   - then, once: the purchase email (claimed through EmailSend), the GA
 *     purchase event (item post-pack-5), a log line;
 *   - the money is always recorded: bought while pack sales were closed, by
 *     an account that is not an employer, or with no account at all, the pack
 *     is still written and staff are alerted to refund it;
 *   - a failed write answers 500 and rolls the dedupe row back, so Stripe
 *     retries; an event already processed is acknowledged without a write;
 *   - invoice.paid with no matching JobCharge refreshes the pack's invoice.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { packExpiresAt } from '@/lib/post-packs';
import { sendPostPackPurchasedEmail } from '@/lib/email-service';
import { trackServerPurchase } from '@/lib/analytics-server';
import { sendDiscordMessage } from '@/lib/discord-notifier';

vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
        invoices: {
            retrieve: vi.fn().mockResolvedValue({ id: 'in_pack', invoice_pdf: 'https://pay.stripe.test/in_pack.pdf', hosted_invoice_url: 'https://invoice.stripe.test/in_pack', number: 'INV-0101' }),
        },
    })),
}));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
const sale = vi.hoisted(() => ({ isPackSaleOpen: vi.fn() }));
vi.mock('@/lib/post-pack-sale', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/post-pack-sale')>()),
    isPackSaleOpen: sale.isPackSaleOpen,
}));

const NOW = new Date('2027-03-01T12:00:00.000Z');

function packSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 'cs_pack',
        object: 'checkout.session',
        mode: 'payment',
        status: 'complete',
        payment_status: 'paid',
        payment_intent: 'pi_pack',
        amount_total: 124500,
        currency: 'usd',
        invoice: 'in_pack',
        client_reference_id: 'user-1',
        customer_email: 'owner@clinic.example',
        customer_details: { email: 'owner@clinic.example' },
        created: Math.floor(NOW.getTime() / 1000) - 60,
        metadata: { type: 'post_pack', sku: 'post-pack-5', userId: 'user-1', quotaDomain: 'clinic.example', posts: '5', gaClientId: '1234567890.1699999999', gaSessionId: '1748000000' },
        ...overrides,
    };
}

function delivery(session: Record<string, unknown>, type = 'checkout.session.completed', id = 'evt_pack') {
    return new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify({ id, type, data: { object: session } }),
    });
}

async function deliver(session: Record<string, unknown>, type?: string, id?: string) {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(delivery(session, type, id) as never);
    return { res, json: await res.json() };
}

const alerts = (): string => JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);

beforeAll(async () => {
    await import('@/app/api/webhooks/stripe/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    sale.isPackSaleOpen.mockReturnValue(true);
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employerPostPack.findUnique).mockReset().mockResolvedValue(null as never);
    vi.mocked(prisma.employerPostPack.create).mockReset().mockResolvedValue({ id: 'pack-1' } as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'employer', email: 'owner@clinic.example' } as never);
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('a paid pack checkout', () => {
    it('records the pack for the buying account, with what Stripe charged', async () => {
        const { res, json } = await deliver(packSession());

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, pack: 'fulfilled' });
        expect(prisma.employerPostPack.create).toHaveBeenCalledTimes(1);
        expect(vi.mocked(prisma.employerPostPack.create).mock.calls[0][0]).toEqual({
            data: {
                userId: 'user-1',
                email: 'owner@clinic.example',
                quotaDomain: 'clinic.example',
                status: 'paid',
                source: 'stripe',
                creditsTotal: config.packPosts,
                creditsRemaining: config.packPosts,
                amountCents: 124500,
                currency: 'usd',
                purchasedAt: NOW,
                expiresAt: packExpiresAt(NOW),
                stripeSessionId: 'cs_pack',
                stripePaymentIntentId: 'pi_pack',
                stripeInvoiceId: 'in_pack',
                invoicePdfUrl: 'https://pay.stripe.test/in_pack.pdf',
                hostedInvoiceUrl: 'https://invoice.stripe.test/in_pack',
                invoiceNumber: 'INV-0101',
            },
            select: { id: true },
        });
        // A pack is not a post: no posting row, no ledger row, no activation.
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
        expect(prisma.jobCharge.create).not.toHaveBeenCalled();
        expect(sendDiscordMessage).not.toHaveBeenCalled();
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('sends the purchase email once, claimed through EmailSend', async () => {
        await deliver(packSession());

        expect(sendPostPackPurchasedEmail).toHaveBeenCalledTimes(1);
        expect(sendPostPackPurchasedEmail).toHaveBeenCalledWith('owner@clinic.example', {
            posts: config.packPosts,
            expiresAt: packExpiresAt(NOW),
            hostedInvoiceUrl: 'https://invoice.stripe.test/in_pack',
            invoiceNumber: 'INV-0101',
        });
        expect(prisma.emailSend.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ dedupeKey: 'post-pack-purchased:cs_pack', emailType: 'post_pack_purchased', status: 'claimed' }),
        }));
    });

    it('sends the GA purchase event for the pack item, priced as charged', async () => {
        await deliver(packSession());

        expect(trackServerPurchase).toHaveBeenCalledTimes(1);
        expect(trackServerPurchase).toHaveBeenCalledWith({
            clientId: 'pack-1',
            gaClientId: '1234567890.1699999999',
            gaSessionId: '1748000000',
            sessionId: 'cs_pack',
            amountCents: 124500,
            currency: 'usd',
            type: 'pack',
            tier: 'pack',
            itemId: 'post-pack-5',
        });
    });

    it('fulfils on checkout.session.async_payment_succeeded through the same branch', async () => {
        const { res, json } = await deliver(packSession(), 'checkout.session.async_payment_succeeded', 'evt_pack_async');

        expect(res.status).toBe(200);
        expect(json.pack).toBe('fulfilled');
        expect(prisma.employerPostPack.create).toHaveBeenCalledTimes(1);
    });
});

describe('the payment gate', () => {
    it('defers a session whose delayed payment has not settled: nothing is written', async () => {
        const { res, json } = await deliver(packSession({ payment_status: 'unpaid' }));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, deferred: true });
        expect(prisma.employerPostPack.create).not.toHaveBeenCalled();
        expect(sendPostPackPurchasedEmail).not.toHaveBeenCalled();
    });

    it("alerts a session completed with 'no_payment_required', and records nothing", async () => {
        const { json } = await deliver(packSession({ payment_status: 'no_payment_required', amount_total: 0 }));

        expect(json.deferred).toBe(true);
        expect(prisma.employerPostPack.create).not.toHaveBeenCalled();
        expect(alerts()).toContain('no payment required');
    });

    it('never reaches the per-post paths, whose "Missing job ID" would 400 a pack', async () => {
        const { res } = await deliver(packSession({ payment_status: 'unpaid' }));

        expect(res.status).not.toBe(400);
    });
});

describe('idempotency', () => {
    it('a session already on the books is acknowledged with no write and no side effect', async () => {
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue({ id: 'pack-1' } as never);

        const { res, json } = await deliver(packSession(), 'checkout.session.completed', 'evt_pack_replay');

        expect(res.status).toBe(200);
        expect(json.pack).toBe('already_fulfilled');
        expect(prisma.employerPostPack.create).not.toHaveBeenCalled();
        expect(sendPostPackPurchasedEmail).not.toHaveBeenCalled();
        expect(trackServerPurchase).not.toHaveBeenCalled();
    });

    it('a path that loses the create race (P2002) runs no side effect', async () => {
        vi.mocked(prisma.employerPostPack.findUnique)
            .mockResolvedValueOnce(null as never)
            .mockResolvedValueOnce({ id: 'pack-raced' } as never);
        vi.mocked(prisma.employerPostPack.create).mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

        const { res, json } = await deliver(packSession());

        expect(res.status).toBe(200);
        expect(json.pack).toBe('already_fulfilled');
        expect(sendPostPackPurchasedEmail).not.toHaveBeenCalled();
        expect(trackServerPurchase).not.toHaveBeenCalled();
    });

    it('a failed write answers 500 and rolls the dedupe row back, so Stripe retries', async () => {
        vi.mocked(prisma.employerPostPack.create).mockRejectedValue(new Error('connection reset'));

        const { res } = await deliver(packSession(), 'checkout.session.completed', 'evt_pack_fail');

        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_pack_fail' } });
        expect(alerts()).toContain('5-post pack fulfilment failed');
        expect(sendPostPackPurchasedEmail).not.toHaveBeenCalled();
    });

    it('an event already processed is acknowledged without a write', async () => {
        vi.mocked(prisma.processedStripeEvent.create).mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));

        const { json } = await deliver(packSession());

        expect(json.deduped).toBe(true);
        expect(prisma.employerPostPack.create).not.toHaveBeenCalled();
    });

    it('an email another delivery already claimed is not sent again', async () => {
        vi.mocked(prisma.emailSend.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

        await deliver(packSession());

        expect(sendPostPackPurchasedEmail).not.toHaveBeenCalled();
    });

    it('a failed email releases its claim so a later replay can send it', async () => {
        vi.mocked(sendPostPackPurchasedEmail).mockResolvedValueOnce({ success: false, error: 'bad address' } as never);

        const { res } = await deliver(packSession());

        expect(res.status).toBe(200);
        expect(prisma.emailSend.delete).toHaveBeenCalledWith({ where: { dedupeKey: 'post-pack-purchased:cs_pack' } });
    });
});

describe('the money is always recorded, and staff told when it should not have been taken', () => {
    it('bought while pack sales were closed: recorded, and alerted for a refund', async () => {
        sale.isPackSaleOpen.mockReturnValue(false);

        const { res } = await deliver(packSession());

        expect(res.status).toBe(200);
        expect(prisma.employerPostPack.create).toHaveBeenCalledTimes(1);
        expect(alerts()).toContain('pack sales were closed');
        expect(alerts()).toContain('cs_pack');
    });

    it('bought by an account that is not an employer: recorded on it, and alerted', async () => {
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'job_seeker', email: 'np@clinic.example' } as never);

        await deliver(packSession());

        expect(vi.mocked(prisma.employerPostPack.create).mock.calls[0][0]).toMatchObject({ data: { userId: 'user-1' } });
        expect(alerts()).toContain('not an employer');
        // Its credits cannot be spent, so no "your pack is ready" email.
        expect(sendPostPackPurchasedEmail).not.toHaveBeenCalled();
    });

    it('a session that names no account: recorded unattached, from the checkout email, and alerted', async () => {
        const rest = Object.fromEntries(Object.entries(packSession().metadata as Record<string, string>).filter(([key]) => key !== 'userId'));
        await deliver(packSession({ client_reference_id: null, metadata: rest }));

        expect(vi.mocked(prisma.employerPostPack.create).mock.calls[0][0]).toMatchObject({ data: { userId: null, email: 'owner@clinic.example', quotaDomain: 'clinic.example' } });
        expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
        expect(alerts()).toContain('no account');
        expect(sendPostPackPurchasedEmail).not.toHaveBeenCalled();
    });

    it('keeps the price Stripe charged, a coupon included', async () => {
        await deliver(packSession({ amount_total: 100000 }));

        expect(vi.mocked(prisma.employerPostPack.create).mock.calls[0][0]).toMatchObject({ data: { amountCents: 100000 } });
    });

    it('falls back to the list price only for a session Stripe sent without a total', async () => {
        await deliver(packSession({ amount_total: null }));

        expect(vi.mocked(prisma.employerPostPack.create).mock.calls[0][0]).toMatchObject({ data: { amountCents: config.stripePackPriceInCents } });
    });
});

describe('the other pack events', () => {
    it('a delayed pack payment that failed is alerted like any other, and nothing is recorded', async () => {
        const { res } = await deliver(packSession({ payment_status: 'unpaid' }), 'checkout.session.async_payment_failed', 'evt_pack_failed');

        expect(res.status).toBe(200);
        expect(prisma.employerPostPack.create).not.toHaveBeenCalled();
        expect(alerts()).toContain('Delayed checkout payment failed');
        expect(alerts()).toContain('post_pack');
    });

    it("invoice.paid with no JobCharge refreshes the pack's invoice links", async () => {
        vi.mocked(prisma.jobCharge.findFirst).mockResolvedValue(null as never);
        vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 1 } as never);

        const { res } = await deliver(
            { id: 'in_pack', object: 'invoice', invoice_pdf: 'https://pay.stripe.test/paid.pdf', hosted_invoice_url: 'https://invoice.stripe.test/paid', number: 'INV-0101' },
            'invoice.paid',
            'evt_invoice_paid',
        );

        expect(res.status).toBe(200);
        expect(prisma.employerPostPack.updateMany).toHaveBeenCalledWith({
            where: { stripeInvoiceId: 'in_pack' },
            data: { invoicePdfUrl: 'https://pay.stripe.test/paid.pdf', hostedInvoiceUrl: 'https://invoice.stripe.test/paid', invoiceNumber: 'INV-0101' },
        });
        expect(prisma.jobCharge.update).not.toHaveBeenCalled();
    });

    it('invoice.paid for a JobCharge never touches a pack', async () => {
        vi.mocked(prisma.jobCharge.findFirst).mockResolvedValue({ id: 'jc-1' } as never);
        vi.mocked(prisma.jobCharge.update).mockResolvedValue({} as never);

        await deliver({ id: 'in_post', object: 'invoice', invoice_pdf: null, hosted_invoice_url: null, number: null }, 'invoice.paid', 'evt_invoice_post');

        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
    });
});
