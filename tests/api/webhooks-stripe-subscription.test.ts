/**
 * Stripe webhook — Employer plan lifecycle (2026-09-12 launch promo + 2027
 * ladder). The plan is sold through a Payment Link in subscription mode.
 *
 * Pins:
 *   - a `checkout.session.completed` with mode 'subscription' attaches the
 *     plan ONLY by the server-issued account reference (client_reference_id /
 *     metadata.userId resolving to an employer) — a typed checkout email that
 *     matches an employer never attaches (anti-hijack) and lands unattached
 *     with an alert;
 *   - money rules: an unsettled session / 'incomplete' subscription is stored
 *     'pending' (no posts, no welcome email) and is promoted by
 *     async_payment_succeeded or the subscription turning active; only the
 *     Employer plan price is fulfilled; a second live subscription is stored
 *     detached and alerted, never merged; a purchase while plan sales are
 *     closed is recorded and alerted for refund;
 *   - `customer.subscription.deleted` keeps posts live through the paid period
 *     and tells the employer the date; `.updated` anchors past_due at the
 *     start of the unpaid period, resumes on 'active', ignores out-of-order
 *     events, and alerts on unknown subscriptions;
 *   - `invoice.payment_failed` sends one dunning email per attempt;
 *   - every 500 path rolls back the ProcessedStripeEvent dedupe row (C2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';

const stripeMocks = vi.hoisted(() => ({
    subscriptionsRetrieve: vi.fn(),
}));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: {
            constructEvent: vi.fn().mockImplementation((rawBody: string) => JSON.parse(rawBody)),
        },
        subscriptions: { retrieve: stripeMocks.subscriptionsRetrieve },
        invoices: { retrieve: vi.fn().mockResolvedValue({ id: 'inv_x', invoice_pdf: null, hosted_invoice_url: null, number: null }) },
    })),
}));

const emailMocks = vi.hoisted(() => ({
    sendPlanActivatedEmail: vi.fn(),
    sendPlanPausedEmail: vi.fn(),
    sendPlanPaymentFailedEmail: vi.fn(),
    sendPlanLinkPendingEmail: vi.fn(),
}));
vi.mock('@/lib/email-service', () => ({
    sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendRenewalConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendRefundConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
    ...emailMocks,
}));

const planMocks = vi.hoisted(() => ({
    upsertPlan: vi.fn(),
    resumePlanPosts: vi.fn(),
    pausePlanPosts: vi.fn(),
    getPlanBySubscriptionId: vi.fn(),
    getPlanForUser: vi.fn(),
}));
vi.mock('@/lib/employer-plan', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/employer-plan')>();
    // Keep the real status mapping + entitlement rule; stub the DB-touching helpers.
    return { ...actual, ...planMocks };
});

const envMocks = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/env', () => ({
    isFeatureEnabled: envMocks.isFeatureEnabled,
    getEnv: vi.fn(() => ({})),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
const discordMocks = vi.hoisted(() => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/discord-notifier', () => discordMocks);

const EMAIL = 'Owner@Clinic.Example';
const PERIOD_START_UNIX = 1_797_321_600; // 2026-12-15T08:00:00Z
const PERIOD_END_UNIX = 1_800_000_000; // 2027-01-15T08:00:00Z
const PERIOD_START = new Date(PERIOD_START_UNIX * 1000);
const PERIOD_END = new Date(PERIOD_END_UNIX * 1000);
const PLAN_PRICE = { id: 'price_plan', lookup_key: 'np_hiring_employer_plan_monthly', unit_amount: 39900, metadata: {} };

function makeRequest(body: object): Request {
    return new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify(body),
    });
}

function liveSubscription(overrides: Record<string, unknown> = {}) {
    return {
        id: 'sub_1',
        status: 'active',
        current_period_start: PERIOD_START_UNIX,
        current_period_end: PERIOD_END_UNIX,
        items: { data: [{ price: PLAN_PRICE }] },
        metadata: {},
        ...overrides,
    };
}

function subscriptionCheckout(overrides: Record<string, unknown> = {}, type = 'checkout.session.completed', id = 'evt_sub_checkout') {
    return {
        id,
        type,
        created: 1_790_000_000,
        data: {
            object: {
                id: 'cs_sub_1',
                mode: 'subscription',
                payment_status: 'paid',
                client_reference_id: 'user-1',
                customer_details: { email: EMAIL },
                customer_email: null,
                subscription: 'sub_1',
                customer: 'cus_1',
                metadata: {}, // Payment Links carry no jobId
                ...overrides,
            },
        },
    };
}

function subscriptionEvent(
    type: 'customer.subscription.updated' | 'customer.subscription.deleted',
    status: string,
    id = 'evt_sub_change',
    extra: Record<string, unknown> = {},
) {
    return {
        id,
        type,
        created: 1_790_000_100,
        data: { object: { ...liveSubscription({ status }), customer: 'cus_1', ...extra } },
    };
}

const existingPlan = {
    id: 'plan-1',
    userId: 'user-1',
    email: 'owner@clinic.example',
    status: 'active',
    slots: 5,
    priceCents: 39900,
    currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    source: 'stripe',
    lastStripeEventAt: null as Date | null,
};

async function post(body: object) {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(makeRequest(body) as never);
    return { res, json: await res.json() };
}

function discordText(): string {
    return JSON.stringify(discordMocks.sendDiscordMessage.mock.calls);
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    envMocks.isFeatureEnabled.mockReturnValue(true);
    vi.spyOn(config, 'isPromoActive').mockReturnValue(false);
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never); // B109 claim succeeds
    vi.mocked(prisma.userProfile.findFirst).mockResolvedValue({ supabaseId: 'user-1' } as never);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(liveSubscription());
    planMocks.upsertPlan.mockResolvedValue({ ...existingPlan });
    planMocks.resumePlanPosts.mockResolvedValue([]);
    planMocks.pausePlanPosts.mockResolvedValue(['job-a', 'job-b']);
    planMocks.getPlanBySubscriptionId.mockResolvedValue({ ...existingPlan });
    planMocks.getPlanForUser.mockResolvedValue({ ...existingPlan });
    emailMocks.sendPlanActivatedEmail.mockResolvedValue({ success: true });
    emailMocks.sendPlanPausedEmail.mockResolvedValue({ success: true });
    emailMocks.sendPlanPaymentFailedEmail.mockResolvedValue({ success: true });
    emailMocks.sendPlanLinkPendingEmail.mockResolvedValue({ success: true });
});

describe('checkout.session.completed in subscription mode — plan activation', () => {
    it('attaches by client_reference_id, resumes posts, emails, returns 200 — and never activates a job', async () => {
        const { res, json } = await post(subscriptionCheckout());

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'activated' });

        expect(prisma.userProfile.findFirst).toHaveBeenCalledWith({
            where: { supabaseId: 'user-1', role: 'employer' },
            select: { supabaseId: true },
        });
        expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1');
        expect(planMocks.upsertPlan).toHaveBeenCalledWith({
            userId: 'user-1',
            email: EMAIL,
            status: 'active',
            currentPeriodEnd: PERIOD_END,
            priceCents: 39900,
            stripeCustomerId: 'cus_1',
            stripeSubscriptionId: 'sub_1',
            source: 'stripe',
            lastStripeEventAt: new Date(1_790_000_000 * 1000),
        });
        expect(planMocks.resumePlanPosts).toHaveBeenCalledWith('user-1');
        expect(emailMocks.sendPlanActivatedEmail).toHaveBeenCalledWith(EMAIL, { slots: 5, currentPeriodEnd: PERIOD_END });
        expect(prisma.emailSend.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ dedupeKey: 'plan-activated:cs_sub_1', emailType: 'plan_activated' }),
        }));
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();

        // Never the per-post path: no publish flip, no ledger row, no dedupe rollback.
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(prisma.jobCharge.create).not.toHaveBeenCalled();
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('also accepts metadata.userId as the account reference', async () => {
        await post(subscriptionCheckout({ client_reference_id: null, metadata: { userId: 'user-1' } }));
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
    });

    it('reads the period from the subscription item when the root field is absent (newer Stripe API shape)', async () => {
        stripeMocks.subscriptionsRetrieve.mockResolvedValue({
            id: 'sub_1', status: 'trialing', metadata: {},
            items: { data: [{ current_period_end: PERIOD_END_UNIX, price: PLAN_PRICE }] },
        });

        const { res } = await post(subscriptionCheckout());

        expect(res.status).toBe(200);
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', currentPeriodEnd: PERIOD_END }));
    });

    it('falls back to customer_email when customer_details is missing', async () => {
        const { res } = await post(subscriptionCheckout({ customer_details: null, customer_email: 'billing@clinic.example' }));
        expect(res.status).toBe(200);
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ email: 'billing@clinic.example' }));
    });

    it('NEVER attaches by a typed checkout email: an employer-matching email with no account reference stays unattached and pages a human', async () => {
        vi.mocked(prisma.userProfile.findFirst).mockImplementation((async (args: { where: Record<string, unknown> }) =>
            ('email' in args.where ? { supabaseId: 'victim-user' } : null)) as never);

        const { res, json } = await post(subscriptionCheckout({ client_reference_id: null }));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'unmatched' });
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ userId: null, email: EMAIL, stripeSubscriptionId: 'sub_1' }));
        expect(planMocks.resumePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanActivatedEmail).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanLinkPendingEmail).toHaveBeenCalledWith(EMAIL);
        expect(discordText()).toContain('plan checkout matched no employer');
        expect(discordText()).toContain('emailMatchesEmployer=yes');
        // PII discipline: the raw email never reaches the alert channels.
        expect(discordText()).not.toContain(EMAIL);
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('ignores a client_reference_id that does not resolve to an employer profile', async () => {
        vi.mocked(prisma.userProfile.findFirst).mockResolvedValue(null as never);
        const { json } = await post(subscriptionCheckout({ client_reference_id: 'candidate-user' }));
        expect(json.plan).toBe('unmatched');
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    });

    it("stores an UNPAID session as 'pending' — no posts resumed, no welcome email (delayed payment methods)", async () => {
        stripeMocks.subscriptionsRetrieve.mockResolvedValue(liveSubscription({ status: 'incomplete' }));

        const { res, json } = await post(subscriptionCheckout({ payment_status: 'unpaid' }));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'pending_payment' });
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', userId: 'user-1' }));
        expect(planMocks.resumePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanActivatedEmail).not.toHaveBeenCalled();
    });

    it("stores an 'incomplete' subscription as 'pending' even when the session reads paid (SCA abandoned)", async () => {
        stripeMocks.subscriptionsRetrieve.mockResolvedValue(liveSubscription({ status: 'incomplete' }));
        const { json } = await post(subscriptionCheckout());
        expect(json.plan).toBe('pending_payment');
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
        expect(emailMocks.sendPlanActivatedEmail).not.toHaveBeenCalled();
    });

    it('async_payment_succeeded promotes a pending plan and sends the welcome email under the subscription-scoped key', async () => {
        planMocks.getPlanBySubscriptionId.mockResolvedValue({ ...existingPlan, status: 'pending' });

        const { json } = await post(subscriptionCheckout({}, 'checkout.session.async_payment_succeeded', 'evt_async_ok'));

        expect(json).toEqual({ received: true, plan: 'activated' });
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
        expect(planMocks.resumePlanPosts).toHaveBeenCalledWith('user-1');
        expect(prisma.emailSend.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ dedupeKey: 'plan-activated:sub:sub_1' }),
        }));
        expect(emailMocks.sendPlanActivatedEmail).toHaveBeenCalledOnce();
    });

    it('async_payment_failed closes a pending plan with no paid time and alerts', async () => {
        planMocks.getPlanBySubscriptionId.mockResolvedValue({ ...existingPlan, status: 'pending' });

        const { json } = await post(subscriptionCheckout({ payment_status: 'unpaid' }, 'checkout.session.async_payment_failed', 'evt_async_fail'));

        expect(json).toEqual({ received: true, plan: 'closed' });
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', stripeSubscriptionId: 'sub_1' }));
        const written = planMocks.upsertPlan.mock.calls[0][0] as { currentPeriodEnd: Date };
        expect(written.currentPeriodEnd.getTime()).toBeLessThanOrEqual(Date.now());
        expect(planMocks.resumePlanPosts).not.toHaveBeenCalled();
        expect(discordText()).toContain('delayed payment failed');
    });

    it('does not fulfil a subscription for any price other than the Employer plan', async () => {
        stripeMocks.subscriptionsRetrieve.mockResolvedValue(liveSubscription({
            items: { data: [{ price: { id: 'price_other', lookup_key: 'something_else', unit_amount: 100, metadata: {} } }] },
        }));

        const { res, json } = await post(subscriptionCheckout());

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'not_plan' });
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
        expect(discordText()).toContain('not the Employer plan');
    });

    it("stores the price Stripe actually charges, not the config constant", async () => {
        stripeMocks.subscriptionsRetrieve.mockResolvedValue(liveSubscription({
            items: { data: [{ price: { ...PLAN_PRICE, unit_amount: 29900 } }] },
        }));
        await post(subscriptionCheckout());
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 29900 }));
    });

    it('a second live subscription for the same employer is stored DETACHED and alerted — the first is never overwritten', async () => {
        planMocks.getPlanForUser.mockResolvedValue({ ...existingPlan, stripeSubscriptionId: 'sub_A', status: 'active' });
        planMocks.upsertPlan.mockResolvedValue({ ...existingPlan, id: 'plan-dup', userId: null, stripeSubscriptionId: 'sub_1' });

        const { res, json } = await post(subscriptionCheckout());

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'duplicate_subscription' });
        expect(planMocks.upsertPlan).toHaveBeenCalledTimes(1);
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ userId: null, stripeSubscriptionId: 'sub_1' }), { detached: true });
        expect(planMocks.resumePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanActivatedEmail).not.toHaveBeenCalled();
        expect(discordText()).toContain('duplicate employer subscription');
        expect(discordText()).toContain('oldSubscriptionId=sub_A');
        expect(discordText()).toContain('newSubscriptionId=sub_1');
    });

    it('a conflict detected inside upsertPlan (unattached row with another live subscription) takes the same detached path', async () => {
        const { PlanSubscriptionConflictError } = await import('@/lib/employer-plan');
        planMocks.upsertPlan
            .mockRejectedValueOnce(new PlanSubscriptionConflictError({ ...existingPlan, stripeSubscriptionId: 'sub_A' } as never, 'sub_1'))
            .mockResolvedValueOnce({ ...existingPlan, id: 'plan-dup', userId: null });

        const { json } = await post(subscriptionCheckout({ client_reference_id: null }));

        expect(json.plan).toBe('duplicate_subscription');
        expect(planMocks.upsertPlan).toHaveBeenLastCalledWith(expect.objectContaining({ userId: null }), { detached: true });
    });

    it('records a plan bought while plan sales are closed (launch promo) but pages a human to refund', async () => {
        vi.spyOn(config, 'isPromoActive').mockReturnValue(true);

        const { res, json } = await post(subscriptionCheckout());

        expect(res.status).toBe(200);
        expect(json.plan).toBe('activated');
        expect(planMocks.upsertPlan).toHaveBeenCalledOnce();
        expect(discordText()).toContain('plan sales are closed');
    });

    it('acknowledges a session with no email (bad payload — retry cannot help) without writing a plan', async () => {
        const { res, json } = await post(subscriptionCheckout({ customer_details: null, customer_email: null }));
        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'no-email' });
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
        expect(discordMocks.sendDiscordMessage).toHaveBeenCalledOnce();
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('acknowledges a session with no subscription id without writing a plan', async () => {
        const { res, json } = await post(subscriptionCheckout({ subscription: null }));
        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'no-subscription' });
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
        expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    });

    it('500s and rolls back the dedupe row when Stripe cannot be reached (C2)', async () => {
        stripeMocks.subscriptionsRetrieve.mockRejectedValue(new Error('stripe down'));

        const { res } = await post(subscriptionCheckout());

        expect(res.status).toBe(500);
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_sub_checkout' } });
    });

    it('500s and rolls back when the subscription carries no period end (never stores a bogus window)', async () => {
        stripeMocks.subscriptionsRetrieve.mockResolvedValue({ id: 'sub_1', status: 'active', metadata: {}, items: { data: [{ price: PLAN_PRICE }] } });

        const { res } = await post(subscriptionCheckout());

        expect(res.status).toBe(500);
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_sub_checkout' } });
    });

    it('does not double-send the activation email on a Stripe redelivery (B109 claim collision)', async () => {
        vi.mocked(prisma.emailSend.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

        const { res } = await post(subscriptionCheckout());

        expect(res.status).toBe(200);
        expect(planMocks.upsertPlan).toHaveBeenCalledOnce();
        expect(emailMocks.sendPlanActivatedEmail).not.toHaveBeenCalled();
    });

    it('releases the email claim when the activation email fails, so a retry can send it', async () => {
        emailMocks.sendPlanActivatedEmail.mockRejectedValue(new Error('resend down'));

        const { res } = await post(subscriptionCheckout());

        expect(res.status).toBe(200);
        expect(prisma.emailSend.delete).toHaveBeenCalledWith({ where: { dedupeKey: 'plan-activated:cs_sub_1' } });
    });

    it('marks the dedupe claim done after a successful delivery (two-phase claim)', async () => {
        await post(subscriptionCheckout());
        expect(prisma.processedStripeEvent.create).toHaveBeenCalledWith({
            data: { eventId: 'evt_sub_checkout', eventType: 'checkout.session.completed', status: 'processing' },
        });
        expect(prisma.processedStripeEvent.updateMany).toHaveBeenCalledWith({ where: { eventId: 'evt_sub_checkout' }, data: { status: 'done' } });
    });
});

describe('customer.subscription.deleted — cancellation honours the paid period', () => {
    it('keeps posts live through the paid period, and tells the employer the date they come down', async () => {
        const { res, json } = await post(subscriptionEvent('customer.subscription.deleted', 'canceled', 'evt_del_1'));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'updated', status: 'cancelled' });
        expect(planMocks.getPlanBySubscriptionId).toHaveBeenCalledWith('sub_1');
        expect(planMocks.upsertPlan).toHaveBeenCalledWith({
            userId: 'user-1',
            email: 'owner@clinic.example',
            status: 'cancelled',
            currentPeriodEnd: PERIOD_END,
            slots: 5,
            priceCents: 39900,
            stripeCustomerId: 'cus_1',
            stripeSubscriptionId: 'sub_1',
            source: 'stripe',
            lastStripeEventAt: new Date(1_790_000_100 * 1000),
        });
        expect(planMocks.pausePlanPosts).not.toHaveBeenCalled();
        expect(planMocks.resumePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledWith('owner@clinic.example', { reason: 'cancelled', pausedCount: 0, liveUntil: PERIOD_END });
        expect(prisma.emailSend.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ dedupeKey: 'plan-paused:evt_del_1', emailType: 'plan_paused' }),
        }));
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it("forces 'cancelled' even if the payload still says active", async () => {
        await post(subscriptionEvent('customer.subscription.deleted', 'active'));
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    });

    it('pauses immediately when nothing paid is left (cancelled after failed renewals, anchor already past)', async () => {
        const anchoredPast = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        planMocks.getPlanBySubscriptionId.mockResolvedValue({ ...existingPlan, status: 'past_due', currentPeriodEnd: anchoredPast });

        await post(subscriptionEvent('customer.subscription.deleted', 'canceled', 'evt_del_pd'));

        // Never the unpaid period's end: the stored paid-through anchor wins.
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', currentPeriodEnd: anchoredPast }));
        expect(planMocks.pausePlanPosts).toHaveBeenCalledWith('user-1', expect.any(Date));
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledWith('owner@clinic.example', { reason: 'cancelled', pausedCount: 2 });
    });

    it('keeps the existing period end when the payload has none', async () => {
        await post({ id: 'evt_del_2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1' } } });
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ currentPeriodEnd: existingPlan.currentPeriodEnd }));
    });

    it('does not pause or email for an unattached (userId null) row', async () => {
        planMocks.getPlanBySubscriptionId.mockResolvedValue({ ...existingPlan, userId: null });
        const { res } = await post(subscriptionEvent('customer.subscription.deleted', 'canceled'));
        expect(res.status).toBe(200);
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ userId: null, status: 'cancelled' }));
        expect(planMocks.pausePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanPausedEmail).not.toHaveBeenCalled();
    });
});

describe('customer.subscription.updated — keep status in step with Stripe', () => {
    it("'past_due' anchors entitlement at the START of the unpaid period and pauses nothing (grace window)", async () => {
        const { res, json } = await post(subscriptionEvent('customer.subscription.updated', 'past_due'));
        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'updated', status: 'past_due' });
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'past_due', currentPeriodEnd: PERIOD_START }));
        expect(planMocks.pausePlanPosts).not.toHaveBeenCalled();
        expect(planMocks.resumePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanPausedEmail).not.toHaveBeenCalled();
    });

    it('replaying renewal events in order — updated(active, new period) then updated(past_due) — never grants the unpaid cycle', async () => {
        await post(subscriptionEvent('customer.subscription.updated', 'active', 'evt_renew_ok'));
        expect(planMocks.upsertPlan).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active', currentPeriodEnd: PERIOD_END }));

        planMocks.getPlanBySubscriptionId.mockResolvedValue({ ...existingPlan, status: 'active', currentPeriodEnd: PERIOD_END });
        await post(subscriptionEvent('customer.subscription.updated', 'past_due', 'evt_renew_fail'));

        const written = planMocks.upsertPlan.mock.calls.at(-1)?.[0] as { status: string; currentPeriodEnd: Date };
        expect(written.status).toBe('past_due');
        expect(written.currentPeriodEnd).toEqual(PERIOD_START);
        expect(written.currentPeriodEnd.getTime()).toBeLessThan(PERIOD_END.getTime());
    });

    it("'active' (payment recovered) resumes paused plan posts", async () => {
        planMocks.getPlanBySubscriptionId.mockResolvedValue({ ...existingPlan, status: 'past_due' });
        const { json } = await post(subscriptionEvent('customer.subscription.updated', 'active'));
        expect(json.status).toBe('active');
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', currentPeriodEnd: PERIOD_END }));
        expect(planMocks.resumePlanPosts).toHaveBeenCalledWith('user-1');
        expect(planMocks.pausePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanActivatedEmail).not.toHaveBeenCalled();
    });

    it("'pending' → 'active' promotes the plan and sends the welcome email once (subscription-scoped key)", async () => {
        planMocks.getPlanBySubscriptionId.mockResolvedValue({ ...existingPlan, status: 'pending' });
        await post(subscriptionEvent('customer.subscription.updated', 'active'));
        expect(planMocks.resumePlanPosts).toHaveBeenCalledWith('user-1');
        expect(prisma.emailSend.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ dedupeKey: 'plan-activated:sub:sub_1' }),
        }));
        expect(emailMocks.sendPlanActivatedEmail).toHaveBeenCalledOnce();
    });

    it('ignores an out-of-order event older than the last one applied (a stale active cannot resurrect a cancelled plan)', async () => {
        planMocks.getPlanBySubscriptionId.mockResolvedValue({
            ...existingPlan, status: 'cancelled', lastStripeEventAt: new Date(1_790_000_500 * 1000),
        });

        const { json } = await post(subscriptionEvent('customer.subscription.updated', 'active', 'evt_stale'));

        expect(json).toEqual({ received: true, plan: 'stale', status: 'cancelled' });
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
        expect(planMocks.resumePlanPosts).not.toHaveBeenCalled();
    });

    it("'canceled' via .updated behaves like .deleted (posts stay live to period end + notice)", async () => {
        await post(subscriptionEvent('customer.subscription.updated', 'canceled'));
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
        expect(planMocks.pausePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledWith('owner@clinic.example', { reason: 'cancelled', pausedCount: 0, liveUntil: PERIOD_END });
    });

    it('alerts (not just logs) on a live subscription that has no plan row', async () => {
        planMocks.getPlanBySubscriptionId.mockResolvedValue(null);
        const { res, json } = await post(subscriptionEvent('customer.subscription.updated', 'active'));
        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'no-plan' });
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
        expect(discordText()).toContain('no plan row');
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('500s and rolls back the dedupe row when the plan write fails (C2)', async () => {
        planMocks.upsertPlan.mockRejectedValue(new Error('db boom'));
        const { res } = await post(subscriptionEvent('customer.subscription.updated', 'active', 'evt_upd_9'));
        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_upd_9' } });
    });
});

describe('invoice.payment_failed — dunning while Smart Retries run', () => {
    function failedInvoice(extra: Record<string, unknown> = {}) {
        return {
            id: 'evt_inv_fail',
            type: 'invoice.payment_failed',
            data: {
                object: {
                    id: 'in_1',
                    attempt_count: 2,
                    next_payment_attempt: PERIOD_END_UNIX,
                    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } },
                    ...extra,
                },
            },
        };
    }

    it('emails the plan owner once per attempt with the next retry date', async () => {
        const { res, json } = await post(failedInvoice());

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'notified' });
        expect(planMocks.getPlanBySubscriptionId).toHaveBeenCalledWith('sub_1');
        expect(emailMocks.sendPlanPaymentFailedEmail).toHaveBeenCalledWith('owner@clinic.example', expect.objectContaining({ nextPaymentAttempt: PERIOD_END }));
        expect(prisma.emailSend.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ dedupeKey: 'plan-payment-failed:in_1:2' }),
        }));
    });

    it('reads the legacy root `subscription` field too', async () => {
        await post(failedInvoice({ parent: null, subscription: 'sub_1' }));
        expect(planMocks.getPlanBySubscriptionId).toHaveBeenCalledWith('sub_1');
    });

    it('acknowledges invoices that are not for a plan subscription', async () => {
        planMocks.getPlanBySubscriptionId.mockResolvedValue(null);
        const { res, json } = await post(failedInvoice());
        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'no-plan' });
        expect(emailMocks.sendPlanPaymentFailedEmail).not.toHaveBeenCalled();
    });
});

describe('a per-post checkout is untouched by the plan branch', () => {
    it("still 400s a payment-mode session with no jobId (the 'Missing job ID' guard is intact)", async () => {
        const { res, json } = await post({
            id: 'evt_pay_1',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_pay_1', mode: 'payment', metadata: {} } },
        });
        expect(res.status).toBe(400);
        expect(json.error).toBe('Missing job ID');
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
    });
});
