/**
 * The subscription path's stale guard is a compare-and-set, not a
 * read-then-write.
 *
 * handleSubscriptionChange (app/api/webhooks/stripe/plan-subscription.ts)
 * reads the plan row, compares its lastStripeEventAt with the time its own
 * live read was sent, then writes through upsertPlan in a separate query. Two
 * deliveries processed at once could both pass the read and the older live
 * read could still land last. With upsertPlan's rejectStale option the stamp
 * check sits in the WHERE of the write itself.
 *
 * Pins, with Prisma mocked (no database):
 *   - upsertPlan with rejectStale updates an existing row with ONE updateMany
 *     whose WHERE requires lastStripeEventAt to be null or not later than the
 *     incoming stamp; a zero row result writes nothing else and throws
 *     StalePlanWriteError carrying the row as it now stands;
 *   - without rejectStale (every other caller), or with no stamp to compare,
 *     the write is the unconditional update it always was; creates are
 *     unchanged;
 *   - handleSubscriptionChange (and so the webhook's applySubscriptionEvent
 *     and the reconciliation sweep) writes through the guard, and a write the
 *     guard refuses comes back 'stale' with no posts resumed or paused and no
 *     email sent;
 *   - the stamp the webhook's guard compares is the time its read was SENT,
 *     not the time the answer came back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';

const db = vi.hoisted(() => ({
  employerPlan: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  emailSend: { create: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: db }));

const planSideEffects = vi.hoisted(() => ({ resumePlanPosts: vi.fn(), pausePlanPosts: vi.fn() }));
vi.mock('@/lib/employer-plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/employer-plan')>()),
  ...planSideEffects,
}));

vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

import { StalePlanWriteError, upsertPlan } from '@/lib/employer-plan';
import { applySubscriptionEvent, handleSubscriptionChange } from '@/app/api/webhooks/stripe/plan-subscription';
import { sendPlanActivatedEmail, sendPlanPausedEmail } from '@/lib/email-service';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.now();
const EARLIER_READ = new Date(NOW_MS - 60_000);
const THIS_READ = new Date(NOW_MS - 30_000);
const FRESHER_READ = new Date(NOW_MS - 10_000);
const PERIOD_START_S = Math.floor((NOW_MS - 2 * DAY_MS) / 1000);
const PERIOD_END_S = Math.floor((NOW_MS + 28 * DAY_MS) / 1000);
const PLAN_PRICE = { id: 'price_plan', lookup_key: 'np_hiring_employer_plan_monthly', unit_amount: 39900, metadata: {} };

const ROW = {
  id: 'plan-1',
  userId: 'user-1',
  email: 'owner@clinic.example',
  status: 'past_due',
  slots: 5,
  priceCents: 39900,
  currentPeriodEnd: new Date(PERIOD_START_S * 1000),
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  source: 'stripe',
  lastStripeEventAt: EARLIER_READ as Date | null,
  createdAt: new Date(NOW_MS - 90 * DAY_MS),
  updatedAt: EARLIER_READ,
};

/** The guard every subscription write must carry for a read taken at `stamp`. */
function staleGuard(stamp: Date) {
  return { id: 'plan-1', OR: [{ lastStripeEventAt: null }, { lastStripeEventAt: { lte: stamp } }] };
}

function subscription(status: string) {
  return {
    id: 'sub_1',
    status,
    customer: 'cus_1',
    current_period_start: PERIOD_START_S,
    current_period_end: PERIOD_END_S,
    items: { data: [{ price: PLAN_PRICE }] },
    metadata: {},
  } as unknown as Stripe.Subscription;
}

const INPUT = {
  userId: 'user-1',
  email: 'Owner@Clinic.Example',
  status: 'active' as const,
  currentPeriodEnd: new Date(PERIOD_END_S * 1000),
  slots: 5,
  priceCents: 39900,
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  source: 'stripe' as const,
  lastStripeEventAt: THIS_READ,
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(db.employerPlan)) fn.mockReset();
  // Found by subscription id, wherever the row is looked up.
  db.employerPlan.findUnique.mockResolvedValue({ ...ROW });
  db.employerPlan.updateMany.mockResolvedValue({ count: 1 });
  db.employerPlan.update.mockImplementation(async ({ data }: { data: object }) => ({ ...ROW, ...data }));
  db.emailSend.create.mockResolvedValue({});
  planSideEffects.resumePlanPosts.mockResolvedValue([]);
  planSideEffects.pausePlanPosts.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('upsertPlan with rejectStale: compare-and-set on lastStripeEventAt', () => {
  it('writes with one updateMany whose WHERE carries the stamp check', async () => {
    const written = await upsertPlan(INPUT, { rejectStale: true });

    expect(db.employerPlan.updateMany).toHaveBeenCalledTimes(1);
    expect(db.employerPlan.updateMany).toHaveBeenCalledWith({
      where: staleGuard(THIS_READ),
      data: expect.objectContaining({ status: 'active', currentPeriodEnd: INPUT.currentPeriodEnd, lastStripeEventAt: THIS_READ, email: 'owner@clinic.example' }),
    });
    expect(db.employerPlan.update).not.toHaveBeenCalled();
    expect(db.employerPlan.create).not.toHaveBeenCalled();
    // The row as this write left it.
    expect(written).toMatchObject({ id: 'plan-1', status: 'active', lastStripeEventAt: THIS_READ, slots: 5 });
  });

  it('a write that matches no row writes nothing and throws StalePlanWriteError with the row as it now stands', async () => {
    const fresher = { ...ROW, status: 'cancelled', lastStripeEventAt: FRESHER_READ };
    db.employerPlan.updateMany.mockResolvedValue({ count: 0 });
    db.employerPlan.findUnique
      .mockResolvedValueOnce({ ...ROW }) // the lookup, before the write
      .mockResolvedValueOnce(fresher); // after the refused write

    const failure = await upsertPlan(INPUT, { rejectStale: true }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(StalePlanWriteError);
    expect(failure).toMatchObject({ planId: 'plan-1', current: fresher });
    expect(db.employerPlan.findUnique).toHaveBeenLastCalledWith({ where: { id: 'plan-1' } });
    expect(db.employerPlan.update).not.toHaveBeenCalled();
    expect(db.employerPlan.create).not.toHaveBeenCalled();
  });

  it('without rejectStale (every other caller) the update is unconditional, as before', async () => {
    await upsertPlan(INPUT);

    expect(db.employerPlan.update).toHaveBeenCalledWith({ where: { id: 'plan-1' }, data: expect.objectContaining({ lastStripeEventAt: THIS_READ }) });
    expect(db.employerPlan.updateMany).not.toHaveBeenCalled();
  });

  it('with no stamp on the input there is nothing to compare, so the update is unconditional', async () => {
    await upsertPlan({ ...INPUT, lastStripeEventAt: undefined }, { rejectStale: true });

    expect(db.employerPlan.update).toHaveBeenCalledWith({ where: { id: 'plan-1' }, data: expect.not.objectContaining({ lastStripeEventAt: expect.anything() }) });
    expect(db.employerPlan.updateMany).not.toHaveBeenCalled();
  });

  it('a new row is created as before', async () => {
    db.employerPlan.findUnique.mockResolvedValue(null);
    db.employerPlan.findFirst.mockResolvedValue(null);
    db.employerPlan.create.mockImplementation(async ({ data }: { data: object }) => ({ ...ROW, ...data }));

    await upsertPlan(INPUT, { rejectStale: true });

    expect(db.employerPlan.create).toHaveBeenCalledWith({ data: expect.objectContaining({ stripeSubscriptionId: 'sub_1', lastStripeEventAt: THIS_READ }) });
    expect(db.employerPlan.updateMany).not.toHaveBeenCalled();
  });
});

describe('handleSubscriptionChange writes through the guard', () => {
  it('a read older than a write that landed after this read of the row comes back stale, with nothing sent, resumed or paused', async () => {
    // The row read before the write still holds the earlier stamp, so the
    // read-time check passes; a delivery that read Stripe later wrote first.
    const fresher = { ...ROW, status: 'cancelled', lastStripeEventAt: FRESHER_READ };
    db.employerPlan.updateMany.mockResolvedValue({ count: 0 });
    db.employerPlan.findUnique
      .mockResolvedValueOnce({ ...ROW }) // getPlanBySubscriptionId
      .mockResolvedValueOnce({ ...ROW }) // upsertPlan's own lookup
      .mockResolvedValueOnce(fresher); // after the refused write

    const result = await handleSubscriptionChange(subscription('active'), 'customer.subscription.updated', {
      eventId: 'evt_older_read',
      observedAt: THIS_READ,
    });

    expect(result).toEqual({ outcome: 'stale', status: 'cancelled' });
    expect(db.employerPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: staleGuard(THIS_READ) }));
    expect(db.employerPlan.update).not.toHaveBeenCalled();
    expect(planSideEffects.resumePlanPosts).not.toHaveBeenCalled();
    expect(planSideEffects.pausePlanPosts).not.toHaveBeenCalled();
    expect(sendPlanActivatedEmail).not.toHaveBeenCalled();
    expect(sendPlanPausedEmail).not.toHaveBeenCalled();
    expect(db.emailSend.create).not.toHaveBeenCalled();
  });

  it('a read no older than the row applies through the same guarded write, then resumes the posts', async () => {
    const result = await handleSubscriptionChange(subscription('active'), 'customer.subscription.updated', {
      eventId: 'evt_fresh_read',
      observedAt: THIS_READ,
    });

    expect(result).toEqual({ outcome: 'updated', status: 'active', pausedCount: 0 });
    expect(db.employerPlan.updateMany).toHaveBeenCalledWith({
      where: staleGuard(THIS_READ),
      data: expect.objectContaining({ status: 'active', lastStripeEventAt: THIS_READ }),
    });
    expect(planSideEffects.resumePlanPosts).toHaveBeenCalledWith('user-1');
  });

  it('the webhook entry point stamps its live read with the time the read was sent, and writes through the guard', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const READ_SENT = new Date(NOW_MS - 5_000);
    vi.setSystemTime(READ_SENT);
    const stripe = {
      subscriptions: {
        retrieve: vi.fn().mockImplementation(async () => {
          // The answer takes a quarter of a second to come back.
          vi.setSystemTime(READ_SENT.getTime() + 250);
          return subscription('active');
        }),
      },
    } as unknown as Stripe;

    const result = await applySubscriptionEvent(stripe, subscription('past_due'), 'customer.subscription.updated', { eventId: 'evt_webhook' });

    expect(result).toMatchObject({ outcome: 'updated', status: 'active' });
    // The guard compares, and the row then holds, the send time: a stamp taken
    // on arrival would let a slow answer outrank a read sent after it.
    expect(db.employerPlan.updateMany).toHaveBeenCalledWith({
      where: staleGuard(READ_SENT),
      data: expect.objectContaining({ status: 'active', lastStripeEventAt: READ_SENT }),
    });
  });
});
