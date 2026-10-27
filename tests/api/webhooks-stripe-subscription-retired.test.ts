/**
 * Stripe webhook: the Employer plan is retired (owner decision 2026-10-24)
 * and its code is deleted (phase 4 of the 2027 re-price, 2026-10-27). Nothing
 * sells a subscription, but a Checkout Session in subscription mode can still
 * reach the endpoint: a test-mode Payment Link left active, or a link someone
 * kept. Money may have been taken for a plan that no longer exists.
 *
 * Pinned:
 *   - checkout.session.completed and checkout.session.async_payment_succeeded
 *     with mode 'subscription' raise one alert, "Employer plan retired: refund
 *     it in Stripe", naming the session and the subscription, and answer 200:
 *     nothing is granted, written or read from Stripe, and the dedupe row is
 *     kept, so Stripe does not retry an event that cannot get better;
 *   - the check comes first: a subscription session is never fulfilled as a
 *     5-post pack or a post, whatever its metadata says; and it is keyed on
 *     the mode, so the same empty metadata on a payment-mode session is still
 *     the "Missing job ID" 400;
 *   - async_payment_failed for one is the generic "nothing fulfilled" alert;
 *   - invoice.paid of a subscription that no post or pack carries (the first
 *     charge of one, and each renewal nobody cancelled) raises the same alert,
 *     naming the invoice and the subscription, and writes nothing (security
 *     review F1, 2026-10-27); a one-off invoice of no row of ours is still
 *     skipped quietly;
 *   - the plan's subscription and dunning events (customer.subscription.*,
 *     invoice.payment_failed), should an endpoint still send one, are
 *     acknowledged and ignored, with no Stripe call and no write;
 *   - the plan handlers are gone, and no source calls the Subscriptions or
 *     Customer Portal APIs, so a restricted key needs neither permission.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { captureException } from '@/lib/sentry';

const stripeMocks = vi.hoisted(() => ({
    subscriptionsRetrieve: vi.fn(),
    paymentIntentsRetrieve: vi.fn(),
}));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: {
            constructEvent: vi.fn().mockImplementation((rawBody: string) => JSON.parse(rawBody)),
        },
        subscriptions: { retrieve: stripeMocks.subscriptionsRetrieve },
        paymentIntents: { retrieve: stripeMocks.paymentIntentsRetrieve },
        invoices: { retrieve: vi.fn() },
    })),
}));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
const discordMocks = vi.hoisted(() => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/discord-notifier', () => discordMocks);

const RETIRED_ALERT = 'Employer plan retired: refund it in Stripe';

function makeRequest(body: object): Request {
    return new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify(body),
    });
}

function event(type: string, object: Record<string, unknown>, id = 'evt_retired_1') {
    return { id, type, created: 1_800_000_000, data: { object } };
}

/** A completed Checkout Session from a plan Payment Link: subscription mode, no jobId. */
function subscriptionSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 'cs_sub_1',
        object: 'checkout.session',
        mode: 'subscription',
        payment_status: 'paid',
        amount_total: 39900,
        currency: 'usd',
        client_reference_id: 'user-1',
        customer: 'cus_1',
        customer_details: { email: 'owner@clinic.example' },
        subscription: 'sub_1',
        payment_intent: null,
        metadata: {},
        ...overrides,
    };
}

async function post(body: object) {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(makeRequest(body) as never);
    return { res, json: await res.json() as Record<string, unknown> };
}

/** The alert reasons sent to Sentry: alertWebhookFailure puts each in `extra.reason`. */
function alertReasons(): string[] {
    return vi.mocked(captureException).mock.calls.map((call) => String((call[1] as { extra?: { reason?: string } } | undefined)?.extra?.reason));
}

function expectNothingWritten(): void {
    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
    expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
    expect(prisma.employerJob.update).not.toHaveBeenCalled();
    expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.jobCharge.create).not.toHaveBeenCalled();
    expect(prisma.jobCharge.update).not.toHaveBeenCalled();
    expect(prisma.employerPostPack.create).not.toHaveBeenCalled();
    expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
    expect(prisma.emailSend.create).not.toHaveBeenCalled();
    // The deprecated employer_plans table is not even read.
    expect(prisma.employerPlan.findUnique).not.toHaveBeenCalled();
    expect(prisma.employerPlan.findFirst).not.toHaveBeenCalled();
    expect(prisma.employerPlan.findMany).not.toHaveBeenCalled();
    expect(prisma.employerPlan.count).not.toHaveBeenCalled();
}

// Load the webhook's module graph once, outside the first test's 5 second
// budget (a cold import under a loaded full run can come close to it).
beforeAll(async () => {
    await import('@/app/api/webhooks/stripe/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
});

describe('a subscription-mode Checkout Session: alerted for a refund, acknowledged, nothing granted', () => {
    it.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])('%s raises the retired-plan alert and answers 200', async (type) => {
        const { res, json } = await post(event(type, subscriptionSession()));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'retired' });

        expect(alertReasons()).toEqual([RETIRED_ALERT]);
        const [, context] = vi.mocked(captureException).mock.calls[0] as [unknown, { extra: Record<string, unknown> }];
        expect(context.extra).toMatchObject({ eventId: 'evt_retired_1', sessionId: 'cs_sub_1', subscriptionId: 'sub_1', paymentStatus: 'paid', amountCents: 39900 });
        const discord = JSON.stringify(discordMocks.sendDiscordMessage.mock.calls);
        expect(discord).toContain(RETIRED_ALERT);
        expect(discord).toContain('subscriptionId=sub_1');
        // The buyer's email is never put into the alert.
        expect(discord).not.toContain('owner@clinic.example');

        // Nothing read from Stripe, nothing written.
        expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
        expect(stripeMocks.paymentIntentsRetrieve).not.toHaveBeenCalled();
        expectNothingWritten();
        // The dedupe row stays and is marked done: a retry cannot do better.
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
        expect(prisma.processedStripeEvent.updateMany).toHaveBeenCalledWith({ where: { eventId: 'evt_retired_1' }, data: { status: 'done' } });
    });

    it('alerts a session whose payment has not settled too: the subscription still has to be cancelled', async () => {
        const { res, json } = await post(event('checkout.session.completed', subscriptionSession({ payment_status: 'unpaid' })));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'retired' });
        expect(alertReasons()).toEqual([RETIRED_ALERT]);
        const [, context] = vi.mocked(captureException).mock.calls[0] as [unknown, { extra: Record<string, unknown> }];
        expect(context.extra).toMatchObject({ sessionId: 'cs_sub_1', subscriptionId: 'sub_1', paymentStatus: 'unpaid' });
        expectNothingWritten();
    });

    it('is checked first: a subscription session is never fulfilled as a 5-post pack or a post', async () => {
        const session = subscriptionSession({ metadata: { type: 'post_pack', jobId: 'job-1', userId: 'user-1' } });
        const { res, json } = await post(event('checkout.session.completed', session));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'retired' });
        expect(alertReasons()).toEqual([RETIRED_ALERT]);
        expect(stripeMocks.paymentIntentsRetrieve).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.findUnique).not.toHaveBeenCalled();
        expectNothingWritten();
    });

    // The guard is keyed on the mode alone. The same empty metadata on a
    // per-post (payment mode) session is still the "Missing job ID" 400, so a
    // guard widened to "no jobId, so acknowledge" fails here (code review F2,
    // 2026-10-27).
    it('a payment-mode session with the same empty metadata is still refused 400 Missing job ID', async () => {
        const { res, json } = await post(event('checkout.session.completed', subscriptionSession({ mode: 'payment', subscription: null })));

        expect(res.status).toBe(400);
        expect(json).toEqual({ error: 'Missing job ID' });
        expect(alertReasons()).not.toContain(RETIRED_ALERT);
        expectNothingWritten();
    });

    it('a subscription session whose delayed payment failed gets the generic alert, nothing more', async () => {
        const { res, json } = await post(event('checkout.session.async_payment_failed', subscriptionSession({ payment_status: 'unpaid' })));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true });
        expect(alertReasons()).toEqual(['Delayed checkout payment failed — nothing fulfilled']);
        expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
        expectNothingWritten();
    });
});

describe("the retired plan's subscription and dunning events are acknowledged and ignored", () => {
    it.each([
        ['customer.subscription.created', { id: 'sub_1', object: 'subscription', status: 'active' }],
        ['customer.subscription.updated', { id: 'sub_1', object: 'subscription', status: 'past_due' }],
        ['customer.subscription.deleted', { id: 'sub_1', object: 'subscription', status: 'canceled' }],
        ['invoice.payment_failed', { id: 'in_1', object: 'invoice', attempt_count: 1, parent: { subscription_details: { subscription: 'sub_1' } } }],
    ])('%s: 200, no Stripe call, no write, no alert', async (type, object) => {
        const { res, json } = await post(event(type, object, `evt_${type}`));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true });
        expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
        expect(captureException).not.toHaveBeenCalled();
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();
        expectNothingWritten();
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });
});

describe('invoice.paid of a subscription nothing of ours carries: the retired-plan alert at every charge', () => {
    /** A paid invoice a plan subscription generated: its first charge or a renewal. */
    function subscriptionInvoice(overrides: Record<string, unknown> = {}) {
        return {
            id: 'in_sub_1',
            object: 'invoice',
            amount_paid: 39900,
            billing_reason: 'subscription_cycle',
            customer_email: 'owner@clinic.example',
            invoice_pdf: null,
            hosted_invoice_url: null,
            number: null,
            parent: { type: 'subscription_details', quote_details: null, subscription_details: { subscription: 'sub_1', metadata: null } },
            ...overrides,
        };
    }

    it('alerts for a refund, names the invoice and the subscription, writes nothing and answers 200', async () => {
        const { res, json } = await post(event('invoice.paid', subscriptionInvoice(), 'evt_invoice_1'));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'retired' });
        expect(alertReasons()).toEqual([RETIRED_ALERT]);
        const [, context] = vi.mocked(captureException).mock.calls[0] as [unknown, { extra: Record<string, unknown> }];
        expect(context.extra).toMatchObject({ eventId: 'evt_invoice_1', invoiceId: 'in_sub_1', subscriptionId: 'sub_1', amountCents: 39900 });
        expect(JSON.stringify(discordMocks.sendDiscordMessage.mock.calls)).not.toContain('owner@clinic.example');
        expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
        expect(prisma.jobCharge.update).not.toHaveBeenCalled();
        // Acknowledged for good: a retry cannot do better.
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('an expanded subscription is named by its id', async () => {
        const invoice = subscriptionInvoice({
            parent: { type: 'subscription_details', quote_details: null, subscription_details: { subscription: { id: 'sub_2', object: 'subscription' }, metadata: null } },
        });
        await post(event('invoice.paid', invoice, 'evt_invoice_2'));

        expect(alertReasons()).toEqual([RETIRED_ALERT]);
        const [, context] = vi.mocked(captureException).mock.calls[0] as [unknown, { extra: Record<string, unknown> }];
        expect(context.extra).toMatchObject({ invoiceId: 'in_sub_1', subscriptionId: 'sub_2' });
    });

    it('a one-off invoice of no row of ours is still skipped quietly', async () => {
        const { res, json } = await post(event('invoice.paid', subscriptionInvoice({ parent: null }), 'evt_invoice_3'));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true });
        expect(captureException).not.toHaveBeenCalled();
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();
    });

    it("a post's invoice is refreshed as before and never alerted", async () => {
        vi.mocked(prisma.jobCharge.findFirst).mockResolvedValueOnce({ id: 'charge-1' } as never);
        const invoice = subscriptionInvoice({
            parent: null, invoice_pdf: 'https://pay.stripe.com/invoice/pdf', hosted_invoice_url: 'https://invoice.stripe.com/i/1', number: 'NP-0001',
        });
        const { res, json } = await post(event('invoice.paid', invoice, 'evt_invoice_4'));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true });
        expect(prisma.jobCharge.update).toHaveBeenCalledWith({
            where: { id: 'charge-1' },
            data: { invoicePdfUrl: 'https://pay.stripe.com/invoice/pdf', hostedInvoiceUrl: 'https://invoice.stripe.com/i/1', invoiceNumber: 'NP-0001' },
        });
        expect(captureException).not.toHaveBeenCalled();
    });
});

describe('the plan code is gone', () => {
    const ROOT = process.cwd();
    const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

    it('the webhook has no plan handler modules left to import', () => {
        for (const rel of ['app/api/webhooks/stripe/plan-checkout.ts', 'app/api/webhooks/stripe/plan-subscription.ts']) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(false);
        }
        const route = read('app/api/webhooks/stripe/route.ts');
        expect(route).not.toMatch(/plan-checkout|plan-subscription|@\/lib\/employer-plan/);
        expect(route).toContain(`'${RETIRED_ALERT}'`);
    });

    // Reads every source file: about 2 seconds alone, so it gets its own budget
    // for a loaded full run.
    it('no source calls the Subscriptions or the Customer Portal API', () => {
        const sources: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
                const rel = path.posix.join(dir, entry.name);
                if (entry.isDirectory()) walk(rel);
                else if (/\.(?:ts|tsx)$/.test(entry.name)) sources.push(rel);
            }
        };
        for (const dir of ['app', 'lib', 'components']) walk(dir);
        expect(sources.length).toBeGreaterThan(100);
        const callers = sources.filter((rel) => /\.(?:subscriptions|billingPortal)\.\w+/.test(read(rel)));
        expect(callers).toEqual([]);
    }, 60_000);
});
