/**
 * Backlog 2.4: same-second Stripe subscription events.
 *
 * Stripe does not guarantee delivery order and stamps `event.created` in
 * whole seconds, so the webhook could not order two subscription events from
 * the same second: whichever arrived last was applied, even when its payload
 * held the older state. The webhook now re-reads the subscription and applies
 * the LIVE state, stamped with the time the read was sent
 * (app/api/webhooks/stripe/plan-subscription.ts#applySubscriptionEvent).
 *
 * Pins:
 *   - a same-second pair ends in the live state in either arrival order: a
 *     renewal that failed (or recovered) within the second, and a .deleted
 *     with a same-second .updated(active), which never resurrects the plan;
 *   - a cancellation re-applied to a cancelled row keeps the paid-through
 *     date it was anchored to and is not announced again (every event now
 *     re-applies the live state, so late events reach the row too); a pause
 *     the first application still owes (it failed after its row write) is
 *     finished by the redelivery, which tells the employer once;
 *   - a transient retrieve failure answers 500 and drops the dedupe claim
 *     (never marked done), and Stripe's redelivery applies the event;
 *   - Stripe no longer has the subscription: .deleted applies the payload's
 *     cancellation under the stamp of the read that found it gone (never the
 *     event's whole-second `created`), .updated is alerted and acknowledged
 *     with nothing written;
 *   - the reconciliation sweep's replay is unchanged: handleSubscriptionChange
 *     applies the subscription it is handed, with no second read;
 *   - two deliveries processed at once, where the older live read reaches
 *     the write last: the write is refused (upsertPlan's compare-and-set),
 *     the delivery answers 'stale', and the fresher state and its side
 *     effects stand;
 *   - the stamp is the time a read was SENT, not the time its answer came
 *     back: a slow answer carrying the older state cannot outrank the
 *     fresher read, whichever of the two reaches the row first.
 *
 * The plan row and the ProcessedStripeEvent table are simulated in memory so
 * a sequence of deliveries sees its own writes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { StalePlanWriteError, isPlanEntitled } from '@/lib/employer-plan';

const stripeMocks = vi.hoisted(() => ({ subscriptionsRetrieve: vi.fn() }));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: {
            constructEvent: vi.fn().mockImplementation((rawBody: string) => JSON.parse(rawBody)),
        },
        subscriptions: { retrieve: stripeMocks.subscriptionsRetrieve },
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
}));
vi.mock('@/lib/employer-plan', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/employer-plan')>();
    // Keep the real status mapping + entitlement rule; stub the DB-touching helpers.
    return { ...actual, ...planMocks };
});

vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
const discordMocks = vi.hoisted(() => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/discord-notifier', () => discordMocks);

// Dates relative to the run, so entitlement reads the same on any day.
const DAY_S = 24 * 60 * 60;
const NOW_S = Math.floor(Date.now() / 1000);
// The renewal period began two days ago (inside the past_due grace window).
const PERIOD_START = new Date((NOW_S - 2 * DAY_S) * 1000);
const PERIOD_END = new Date((NOW_S + 28 * DAY_S) * 1000);
// Both events of a pair carry this `created`: Stripe's one-second resolution.
const SAME_SECOND = NOW_S - 60;
const PLAN_PRICE = { id: 'price_plan', lookup_key: 'np_hiring_employer_plan_monthly', unit_amount: 39900, metadata: {} };

type SubscriptionEventType = 'customer.subscription.updated' | 'customer.subscription.deleted';

function subscription(status: string) {
    return {
        id: 'sub_1',
        status,
        customer: 'cus_1',
        current_period_start: PERIOD_START.getTime() / 1000,
        current_period_end: PERIOD_END.getTime() / 1000,
        items: { data: [{ price: PLAN_PRICE }] },
        metadata: {},
    };
}

/** What stripe.subscriptions.retrieve answers from now on: the state Stripe holds. */
function stripeHolds(status: string) {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription(status));
}

function subscriptionEvent(type: SubscriptionEventType, payloadStatus: string, id: string, created = SAME_SECOND) {
    return { id, type, created, data: { object: subscription(payloadStatus) } };
}

const STARTING_ROW = {
    id: 'plan-1',
    userId: 'user-1' as string | null,
    email: 'owner@clinic.example',
    status: 'active',
    slots: 5,
    priceCents: 39900,
    // Paid through the start of the current period: the renewal is in flight.
    currentPeriodEnd: PERIOD_START,
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    source: 'stripe',
    lastStripeEventAt: new Date((SAME_SECOND - DAY_S) * 1000) as Date | null,
};
type PlanRowState = typeof STARTING_ROW;

let row: PlanRowState;

/** The plan row as the database would hold it: every read sees the last write. */
function planRowStartsAs(overrides: Partial<PlanRowState> = {}) {
    row = { ...STARTING_ROW, ...overrides };
    planMocks.getPlanBySubscriptionId.mockImplementation(async () => ({ ...row }));
    planMocks.upsertPlan.mockImplementation(async (input: Partial<PlanRowState>) => {
        row = { ...row, ...input };
        return { ...row };
    });
}

/**
 * The row as Postgres keeps it under upsertPlan's rejectStale: a write whose
 * stamp is older than the row's is refused, as the real updateMany WHERE
 * refuses it (pinned in tests/lib/employer-plan-stale-write.test.ts).
 */
function guardedWrite(input: Partial<PlanRowState>, options?: { rejectStale?: boolean }) {
    const stamp = input.lastStripeEventAt;
    if (options?.rejectStale && stamp && row.lastStripeEventAt && row.lastStripeEventAt.getTime() > stamp.getTime()) {
        throw new StalePlanWriteError(row.id, stamp, { ...row } as never);
    }
    row = { ...row, ...input };
    return { ...row };
}

/** A promise settled by the test, to hold a delivery at a chosen point. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

/**
 * ProcessedStripeEvent as a table: the claim is unique (P2002 on a second
 * insert), a 500 path deletes it, a delivery that succeeded marks it done.
 */
function dedupeTable(): Map<string, string> {
    const claims = new Map<string, string>();
    vi.mocked(prisma.processedStripeEvent.create).mockImplementation((async ({ data }: { data: { eventId: string; status: string } }) => {
        if (claims.has(data.eventId)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        claims.set(data.eventId, data.status);
        return data;
    }) as never);
    vi.mocked(prisma.processedStripeEvent.delete).mockImplementation((async ({ where }: { where: { eventId: string } }) => {
        claims.delete(where.eventId);
        return {};
    }) as never);
    vi.mocked(prisma.processedStripeEvent.updateMany).mockImplementation((async (
        { where, data }: { where: { eventId: string; status?: string }; data: { status?: string } },
    ) => {
        // The reclaim of a stale 'processing' claim: none of these deliveries died mid-flight.
        if (where.status === 'processing') return { count: 0 };
        if (!claims.has(where.eventId) || !data.status) return { count: 0 };
        claims.set(where.eventId, data.status);
        return { count: 1 };
    }) as never);
    return claims;
}

async function post(body: object) {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify(body),
    }) as never);
    return { res, json: await res.json() };
}

function discordText(): string {
    return JSON.stringify(discordMocks.sendDiscordMessage.mock.calls);
}

// Load the webhook's module graph once, outside any single test's budget.
beforeAll(async () => {
    await import('@/app/api/webhooks/stripe/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.processedStripeEvent.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.processedStripeEvent.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never); // B109 claim succeeds
    // clearAllMocks keeps queued one-off answers: drop any a failed test left behind.
    stripeMocks.subscriptionsRetrieve.mockReset();
    planMocks.pausePlanPosts.mockReset();
    stripeHolds('active');
    planRowStartsAs();
    planMocks.resumePlanPosts.mockResolvedValue([]);
    planMocks.pausePlanPosts.mockResolvedValue(['job-a', 'job-b']);
    emailMocks.sendPlanActivatedEmail.mockResolvedValue({ success: true });
    emailMocks.sendPlanPausedEmail.mockResolvedValue({ success: true });
});

// Several tests fake the clock to place a read's send and its answer in time.
afterEach(() => {
    vi.useRealTimers();
});

describe('same-second subscription events end in the live state, whatever the arrival order', () => {
    const pastDue = subscriptionEvent('customer.subscription.updated', 'past_due', 'evt_past_due');
    const active = subscriptionEvent('customer.subscription.updated', 'active', 'evt_active');

    describe.each([
        { holds: 'past_due', status: 'past_due', currentPeriodEnd: PERIOD_START, story: 'the renewal payment failed within the second' },
        { holds: 'active', status: 'active', currentPeriodEnd: PERIOD_END, story: 'the renewal payment went through within the second' },
    ])('Stripe holds $holds ($story)', ({ holds, status, currentPeriodEnd }) => {
        it.each([
            { order: 'past_due, then active', events: [pastDue, active] },
            { order: 'active, then past_due', events: [active, pastDue] },
        ])('delivered $order', async ({ events }) => {
            stripeHolds(holds);

            for (const event of events) {
                const { res } = await post(event);
                expect(res.status).toBe(200);
            }

            expect(row).toMatchObject({ status, currentPeriodEnd });
            expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledTimes(2);
            expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1');
            // Neither payload was written as such: each delivery applied the live read.
            for (const [input] of planMocks.upsertPlan.mock.calls) {
                expect(input).toMatchObject({ status, currentPeriodEnd });
            }
        });
    });

    it.each([
        { order: '.deleted, then .updated(active)', first: 'deleted', second: 'updated' },
        { order: '.updated(active), then .deleted', first: 'updated', second: 'deleted' },
    ] as const)('a cancellation and a same-second .updated(active), delivered $order, end cancelled with one notice', async ({ first, second }) => {
        planRowStartsAs({ currentPeriodEnd: PERIOD_END });
        stripeHolds('canceled');
        const events = {
            deleted: subscriptionEvent('customer.subscription.deleted', 'canceled', 'evt_deleted'),
            updated: subscriptionEvent('customer.subscription.updated', 'active', 'evt_updated'),
        };

        await post(events[first]);
        await post(events[second]);

        // Cancelled at the paid period end: posts stay up until then and are never resumed.
        expect(row).toMatchObject({ status: 'cancelled', currentPeriodEnd: PERIOD_END });
        expect(planMocks.resumePlanPosts).not.toHaveBeenCalled();
        expect(planMocks.pausePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledOnce();
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledWith('owner@clinic.example', { reason: 'cancelled', pausedCount: 0, liveUntil: PERIOD_END });
    });
});

describe('a cancellation re-applied to a cancelled row keeps the date it was anchored to, and finishes a pause still owed', () => {
    it.each([
        { when: 'in the same second', created: SAME_SECOND },
        { when: 'an hour older, delivered late', created: SAME_SECOND - 3600 },
    ])('after failed renewals, an .updated(past_due) $when never hands out the unpaid period', async ({ created }) => {
        // Smart Retries were running: entitled through the last paid period (plus grace).
        planRowStartsAs({ status: 'past_due', currentPeriodEnd: PERIOD_START });
        stripeHolds('canceled');
        // pausePlanPosts as the database answers it: posts taken down once stay down.
        planMocks.pausePlanPosts.mockResolvedValueOnce(['job-a', 'job-b']).mockResolvedValue([]);

        await post(subscriptionEvent('customer.subscription.deleted', 'canceled', 'evt_deleted'));
        expect(row).toMatchObject({ status: 'cancelled', currentPeriodEnd: PERIOD_START });
        expect(planMocks.pausePlanPosts).toHaveBeenCalledOnce();
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledWith('owner@clinic.example', { reason: 'cancelled', pausedCount: 2 });

        await post(subscriptionEvent('customer.subscription.updated', 'past_due', 'evt_late', created));

        // The live read says canceled again; the period end it carries is the unpaid one.
        expect(row).toMatchObject({ status: 'cancelled', currentPeriodEnd: PERIOD_START });
        expect(isPlanEntitled(row)).toBe(false);
        // The repeat looks for posts that are still live, finds none and announces nothing.
        expect(planMocks.pausePlanPosts).toHaveBeenCalledTimes(2);
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledOnce();
    });

    it('a cancellation whose pause failed is finished by its redelivery: the posts come down and the employer is told once', async () => {
        const claims = dedupeTable();
        // Cancelled after failed renewals: nothing paid is left, and the posts are still live inside the grace window.
        planRowStartsAs({ status: 'past_due', currentPeriodEnd: PERIOD_START });
        stripeHolds('canceled');
        planMocks.pausePlanPosts
            .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
            .mockResolvedValueOnce(['job-a', 'job-b'])
            .mockResolvedValue([]);
        const event = subscriptionEvent('customer.subscription.deleted', 'canceled', 'evt_deleted');

        // The row write lands, then the pause throws: 500, and the claim is dropped so Stripe redelivers.
        const first = await post(event);
        expect(first.res.status).toBe(500);
        expect(claims.has('evt_deleted')).toBe(false);
        expect(row).toMatchObject({ status: 'cancelled', currentPeriodEnd: PERIOD_START });
        expect(emailMocks.sendPlanPausedEmail).not.toHaveBeenCalled();

        // The redelivery finds the row already cancelled. It still takes the posts down and says so.
        const redelivery = await post(event);
        expect(redelivery.res.status).toBe(200);
        expect(redelivery.json).toEqual({ received: true, plan: 'updated', status: 'cancelled' });
        expect(claims.get('evt_deleted')).toBe('done');
        expect(planMocks.pausePlanPosts).toHaveBeenCalledTimes(2);
        expect(planMocks.pausePlanPosts).toHaveBeenLastCalledWith('user-1', expect.any(Date));
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledOnce();
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledWith('owner@clinic.example', { reason: 'cancelled', pausedCount: 2 });
        expect(prisma.emailSend.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ dedupeKey: 'plan-paused:evt_deleted', emailType: 'plan_paused' }),
        }));
        expect(row).toMatchObject({ status: 'cancelled', currentPeriodEnd: PERIOD_START });
        expect(planMocks.resumePlanPosts).not.toHaveBeenCalled();

        // A late event after that finds nothing live and announces nothing.
        const late = await post(subscriptionEvent('customer.subscription.updated', 'canceled', 'evt_late'));
        expect(late.res.status).toBe(200);
        expect(planMocks.pausePlanPosts).toHaveBeenCalledTimes(3);
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledOnce();
    });

    it('a plan whose first payment never arrived stays unentitled when Stripe later ends the subscription', async () => {
        planRowStartsAs({ status: 'pending', currentPeriodEnd: PERIOD_END });
        // A plan that never paid was never entitled, so it never had a live plan post.
        planMocks.pausePlanPosts.mockResolvedValue([]);

        // The delayed payment failed: the pending plan is closed with no paid time.
        await post({
            id: 'evt_async_failed',
            type: 'checkout.session.async_payment_failed',
            created: SAME_SECOND,
            data: { object: { id: 'cs_1', mode: 'subscription', payment_status: 'unpaid', subscription: 'sub_1', customer: 'cus_1', metadata: {} } },
        });
        const closedAt = row.currentPeriodEnd;
        expect(row.status).toBe('cancelled');
        expect(closedAt.getTime()).toBeLessThanOrEqual(Date.now());

        // Stripe then expires the incomplete subscription.
        stripeHolds('incomplete_expired');
        await post(subscriptionEvent('customer.subscription.deleted', 'incomplete_expired', 'evt_expired'));

        expect(row).toMatchObject({ status: 'cancelled', currentPeriodEnd: closedAt });
        expect(isPlanEntitled(row)).toBe(false);
        expect(emailMocks.sendPlanPausedEmail).not.toHaveBeenCalled();
    });
});

describe('a live read that fails is retried by Stripe, never acknowledged', () => {
    const connectionError = () => Object.assign(new Error('An error occurred with our connection to Stripe.'), { type: 'StripeConnectionError' });

    it.each([
        { kind: 'a network error', error: connectionError() },
        { kind: 'a rate limit', error: Object.assign(new Error('Request rate limit exceeded.'), { type: 'StripeRateLimitError', code: 'rate_limit', statusCode: 429 }) },
        { kind: 'a Stripe API error', error: Object.assign(new Error('An unknown error occurred.'), { type: 'StripeAPIError', statusCode: 500 }) },
    ])('$kind: 500, the dedupe claim is dropped and nothing is written', async ({ error }) => {
        const claims = dedupeTable();
        stripeMocks.subscriptionsRetrieve.mockRejectedValue(error);

        const { res } = await post(subscriptionEvent('customer.subscription.updated', 'active', 'evt_read_failed'));

        expect(res.status).toBe(500);
        expect(claims.has('evt_read_failed')).toBe(false);
        expect(prisma.processedStripeEvent.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'done' } }));
        expect(planMocks.getPlanBySubscriptionId).not.toHaveBeenCalled();
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
        expect(discordText()).toContain('customer.subscription.updated handler failed');
    });

    it("Stripe's redelivery applies the live state and completes the claim; a duplicate after that is acknowledged", async () => {
        const claims = dedupeTable();
        planRowStartsAs({ status: 'past_due', currentPeriodEnd: PERIOD_START });
        stripeMocks.subscriptionsRetrieve
            .mockRejectedValueOnce(connectionError())
            .mockResolvedValue(subscription('active'));
        const event = subscriptionEvent('customer.subscription.updated', 'active', 'evt_retried');

        expect((await post(event)).res.status).toBe(500);
        expect(row.status).toBe('past_due');

        const retry = await post(event);
        expect(retry.res.status).toBe(200);
        expect(retry.json).toEqual({ received: true, plan: 'updated', status: 'active' });
        expect(row).toMatchObject({ status: 'active', currentPeriodEnd: PERIOD_END });
        expect(claims.get('evt_retried')).toBe('done');

        const duplicate = await post(event);
        expect(duplicate.json).toEqual({ received: true, deduped: true });
        expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledTimes(2);
    });
});

describe('Stripe no longer has the subscription (resource_missing)', () => {
    const noSuchSubscription = () => Object.assign(new Error("No such subscription: 'sub_1'"), {
        type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404,
    });

    it(".deleted applies the payload's cancellation under the stamp of the read that found it gone, and is acknowledged", async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const READ_SENT = new Date(SAME_SECOND * 1000 + 700);
        vi.setSystemTime(READ_SENT);
        const claims = dedupeTable();
        planRowStartsAs({ currentPeriodEnd: PERIOD_END });
        stripeMocks.subscriptionsRetrieve.mockImplementation(async () => {
            // "No such subscription" takes its time to come back.
            vi.setSystemTime(READ_SENT.getTime() + 300);
            throw noSuchSubscription();
        });

        const { res, json } = await post(subscriptionEvent('customer.subscription.deleted', 'canceled', 'evt_gone_deleted'));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'updated', status: 'cancelled' });
        expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1');
        // Not the event's `created` (the start of that second), and not the time the answer arrived.
        expect(row).toMatchObject({ status: 'cancelled', currentPeriodEnd: PERIOD_END, lastStripeEventAt: READ_SENT });
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledWith('owner@clinic.example', { reason: 'cancelled', pausedCount: 0, liveUntil: PERIOD_END });
        expect(claims.get('evt_gone_deleted')).toBe('done');
    });

    it('.deleted still cancels when a read from the same second was applied before it', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const SECOND_STARTS = SAME_SECOND * 1000;
        const claims = dedupeTable();
        planRowStartsAs({ currentPeriodEnd: PERIOD_END });

        // Half a second in, the subscription is still active and an .updated applies that.
        vi.setSystemTime(SECOND_STARTS + 500);
        stripeHolds('active');
        await post(subscriptionEvent('customer.subscription.updated', 'active', 'evt_same_second'));
        expect(row).toMatchObject({ status: 'active', lastStripeEventAt: new Date(SECOND_STARTS + 500) });

        // The cancellation's event is stamped by Stripe with the START of that
        // second. By the time it is processed the subscription is gone.
        vi.setSystemTime(SECOND_STARTS + 900);
        stripeMocks.subscriptionsRetrieve.mockRejectedValue(noSuchSubscription());
        const { res, json } = await post(subscriptionEvent('customer.subscription.deleted', 'canceled', 'evt_gone_deleted', SAME_SECOND));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'updated', status: 'cancelled' });
        expect(row).toMatchObject({ status: 'cancelled', currentPeriodEnd: PERIOD_END, lastStripeEventAt: new Date(SECOND_STARTS + 900) });
        expect(claims.get('evt_gone_deleted')).toBe('done');
    });

    it('.updated is alerted and acknowledged with nothing written, like an event for an unknown plan', async () => {
        const claims = dedupeTable();
        stripeMocks.subscriptionsRetrieve.mockRejectedValue(noSuchSubscription());

        const { res, json } = await post(subscriptionEvent('customer.subscription.updated', 'past_due', 'evt_gone_updated'));

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, plan: 'subscription-missing' });
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
        expect(row.status).toBe('active');
        expect(discordText()).toContain('subscription event for a subscription Stripe does not have');
        expect(discordText()).toContain('subscriptionId=sub_1');
        expect(claims.get('evt_gone_updated')).toBe('done');
    });

    it.each([
        { error: { code: 'resource_missing', statusCode: 404 }, missing: true },
        { error: { statusCode: 404 }, missing: true },
        { error: { code: 'rate_limit', statusCode: 429 }, missing: false },
        { error: { type: 'StripeConnectionError' }, missing: false },
        { error: null, missing: false },
    ])('isMissingStripeResource($error) is $missing', async ({ error, missing }) => {
        const { isMissingStripeResource } = await import('@/app/api/webhooks/stripe/plan-subscription');
        expect(isMissingStripeResource(error)).toBe(missing);
    });
});

describe('two deliveries processed at once: the older live read never lands last', () => {
    it("the delivery that read Stripe first but wrote last is refused at the write, and answers 'stale'", async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const OLDER_READ = new Date(SAME_SECOND * 1000 + 100);
        const FRESHER_READ = new Date(SAME_SECOND * 1000 + 200);
        planRowStartsAs({ status: 'past_due', currentPeriodEnd: PERIOD_START });
        const olderRetrieve = deferred<ReturnType<typeof subscription>>();
        const fresherRetrieve = deferred<ReturnType<typeof subscription>>();
        stripeMocks.subscriptionsRetrieve
            .mockImplementationOnce(() => olderRetrieve.promise)
            .mockImplementationOnce(() => fresherRetrieve.promise);
        // The older delivery has read the row and reached its write; it is
        // held there until the fresher delivery has written.
        const olderAtWrite = deferred<void>();
        const fresherWrote = deferred<void>();
        let writes = 0;
        planMocks.upsertPlan.mockImplementation(async (input: Partial<PlanRowState>, options?: { rejectStale?: boolean }) => {
            writes += 1;
            if (writes === 1) {
                olderAtWrite.resolve();
                await fresherWrote.promise;
                return guardedWrite(input, options);
            }
            const written = guardedWrite(input, options);
            fresherWrote.resolve();
            return written;
        });

        vi.setSystemTime(OLDER_READ);
        const older = post(subscriptionEvent('customer.subscription.updated', 'past_due', 'evt_older_read'));
        olderRetrieve.resolve(subscription('past_due'));
        await olderAtWrite.promise;
        vi.setSystemTime(FRESHER_READ);
        const fresher = post(subscriptionEvent('customer.subscription.updated', 'active', 'evt_fresher_read'));
        fresherRetrieve.resolve(subscription('active'));
        const [olderResult, fresherResult] = await Promise.all([older, fresher]);

        expect(fresherResult.json).toEqual({ received: true, plan: 'updated', status: 'active' });
        expect(olderResult.res.status).toBe(200);
        expect(olderResult.json).toEqual({ received: true, plan: 'stale', status: 'active' });
        // The fresher state stands; the older read passed the check on the row
        // as it read it, and only the guard in the write refused it.
        expect(row).toMatchObject({ status: 'active', currentPeriodEnd: PERIOD_END, lastStripeEventAt: FRESHER_READ });
        expect(planMocks.upsertPlan).toHaveBeenCalledTimes(2);
        for (const call of planMocks.upsertPlan.mock.calls) expect(call[1]).toEqual({ rejectStale: true });
        // Only the delivery that wrote ran the side effects.
        expect(planMocks.resumePlanPosts).toHaveBeenCalledOnce();
        expect(planMocks.pausePlanPosts).not.toHaveBeenCalled();
    });
});

describe('the stamp is the time a read was sent, not the time its answer came back', () => {
    // Stripe does not answer reads in the order it evaluated them. T0 is when
    // the read that will carry the OLDER state goes out: Stripe evaluates it,
    // the subscription changes just after, and its answer is the last to arrive.
    const T0 = SAME_SECOND * 1000;

    it.each([
        {
            story: "a stale 'active' does not resurrect a plan cancelled meanwhile",
            slowAnswer: 'active',
            fresh: { type: 'customer.subscription.deleted', holds: 'canceled', eventId: 'evt_cancelled' },
            ends: { status: 'cancelled', currentPeriodEnd: PERIOD_START },
            resumes: 0,
            pauses: 1,
        },
        {
            story: "a stale 'past_due' does not downgrade a plan whose payment recovered meanwhile",
            slowAnswer: 'past_due',
            fresh: { type: 'customer.subscription.updated', holds: 'active', eventId: 'evt_recovered' },
            ends: { status: 'active', currentPeriodEnd: PERIOD_END },
            resumes: 1,
            pauses: 0,
        },
    ] as const)('a slow answer cannot land after the fresher state: $story', async ({ slowAnswer, fresh, ends, resumes, pauses }) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        planRowStartsAs({ status: 'past_due', currentPeriodEnd: PERIOD_START });
        planMocks.upsertPlan.mockImplementation(async (input: Partial<PlanRowState>, options?: { rejectStale?: boolean }) => guardedWrite(input, options));
        const slowReadSent = deferred<void>();
        const slowReadAnswer = deferred<ReturnType<typeof subscription>>();
        stripeMocks.subscriptionsRetrieve
            .mockImplementationOnce(() => { slowReadSent.resolve(); return slowReadAnswer.promise; })
            .mockImplementationOnce(async () => subscription(fresh.holds));

        // The read whose answer will come back last goes out first, before the change.
        vi.setSystemTime(T0);
        const slow = post(subscriptionEvent('customer.subscription.updated', slowAnswer, 'evt_slow_answer'));
        await slowReadSent.promise;

        // The subscription changes, and the delivery for that change reads it and applies it.
        vi.setSystemTime(T0 + 200);
        const applied = await post(subscriptionEvent(fresh.type, fresh.holds, fresh.eventId));
        expect(applied.json).toEqual({ received: true, plan: 'updated', status: ends.status });

        // Only now does the first read's answer arrive, still carrying the state from before the change.
        vi.setSystemTime(T0 + 500);
        slowReadAnswer.resolve(subscription(slowAnswer));
        const late = await slow;

        expect(late.res.status).toBe(200);
        expect(late.json).toEqual({ received: true, plan: 'stale', status: ends.status });
        expect(row).toMatchObject({ ...ends, lastStripeEventAt: new Date(T0 + 200) });
        expect(planMocks.upsertPlan).toHaveBeenCalledTimes(1);
        expect(planMocks.resumePlanPosts).toHaveBeenCalledTimes(resumes);
        expect(planMocks.pausePlanPosts).toHaveBeenCalledTimes(pauses);
    });

    it('a slow answer that reaches the row first does not make the fresher delivery stale', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        planRowStartsAs({ status: 'past_due', currentPeriodEnd: PERIOD_START });
        const slowReadSent = deferred<void>();
        const slowReadAnswer = deferred<ReturnType<typeof subscription>>();
        const freshReadSent = deferred<void>();
        const freshReadAnswer = deferred<ReturnType<typeof subscription>>();
        stripeMocks.subscriptionsRetrieve
            .mockImplementationOnce(() => { slowReadSent.resolve(); return slowReadAnswer.promise; })
            .mockImplementationOnce(() => { freshReadSent.resolve(); return freshReadAnswer.promise; });
        // The fresher delivery has read the row and reached its write; it is
        // held there until the delivery carrying the older state has written.
        const freshAtWrite = deferred<void>();
        const slowWrote = deferred<void>();
        let writes = 0;
        planMocks.upsertPlan.mockImplementation(async (input: Partial<PlanRowState>, options?: { rejectStale?: boolean }) => {
            writes += 1;
            if (writes === 1) {
                freshAtWrite.resolve();
                await slowWrote.promise;
                return guardedWrite(input, options);
            }
            const written = guardedWrite(input, options);
            slowWrote.resolve();
            return written;
        });

        // Sent at T0 and evaluated by Stripe while the subscription is still active.
        vi.setSystemTime(T0);
        const slow = post(subscriptionEvent('customer.subscription.updated', 'active', 'evt_slow_answer'));
        await slowReadSent.promise;
        // The subscription is cancelled, and the .deleted delivery sends its read at T0 + 100.
        vi.setSystemTime(T0 + 100);
        const fresh = post(subscriptionEvent('customer.subscription.deleted', 'canceled', 'evt_cancelled'));
        await freshReadSent.promise;
        // That answer is back at T0 + 200, and the delivery gets as far as its write.
        vi.setSystemTime(T0 + 200);
        freshReadAnswer.resolve(subscription('canceled'));
        await freshAtWrite.promise;
        // The older state's answer arrives at T0 + 500 and is written first.
        vi.setSystemTime(T0 + 500);
        slowReadAnswer.resolve(subscription('active'));
        const [slowResult, freshResult] = await Promise.all([slow, fresh]);

        // Stamped on arrival, the older state would hold T0 + 500 against the
        // cancellation's T0 + 200: the cancellation would be refused as stale,
        // acknowledged, and never redelivered.
        expect(slowResult.json).toEqual({ received: true, plan: 'updated', status: 'active' });
        expect(freshResult.res.status).toBe(200);
        expect(freshResult.json).toEqual({ received: true, plan: 'updated', status: 'cancelled' });
        expect(row).toMatchObject({ status: 'cancelled', currentPeriodEnd: PERIOD_START, lastStripeEventAt: new Date(T0 + 100) });
        expect(planMocks.pausePlanPosts).toHaveBeenCalledOnce();
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledOnce();
    });
});

describe('the reconciliation sweep replay is unchanged', () => {
    it('handleSubscriptionChange applies the subscription it is handed, with no second read', async () => {
        const { handleSubscriptionChange } = await import('@/app/api/webhooks/stripe/plan-subscription');
        const observedAt = new Date();

        const result = await handleSubscriptionChange(subscription('past_due') as never, 'customer.subscription.updated', {
            eventId: 'plan-reconciliation:plan-1',
            observedAt,
        });

        expect(result).toEqual({ outcome: 'updated', status: 'past_due', pausedCount: 0 });
        expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
        expect(row).toMatchObject({ status: 'past_due', currentPeriodEnd: PERIOD_START, lastStripeEventAt: observedAt });
    });
});
