/**
 * app/api/webhooks/stripe/apply-renewal.ts — a renewal paid for a post at
 * its renewal cap (config.renewalCapDays after the post was created).
 *
 * /api/create-renewal-checkout refuses to sell a renewal that adds no full
 * day (tests/api/create-renewal-checkout-cap.test.ts), but the cap can be
 * reached after a checkout opened: a delayed payment settles days later, or
 * two payments were made and the first took the post to its cap. The
 * fulfilment used to write min(base + 60 days, createdAt + cap) all the
 * same: the unchanged expiry, or a date already past, with the post set
 * published and the "your listing is renewed" email sent for it.
 *
 * Pins, through the webhook with Prisma and Stripe mocked:
 *   - at or past the cap the payment is recorded on the ledger and alerted
 *     for a refund with its payment intent; the expiry, the status and
 *     isPublished are untouched; no confirmation email, no purchase event;
 *     the webhook acknowledges, since a retry cannot help;
 *   - the post's other open renewal sessions are closed all the same, and no
 *     second "two paid renewals" alert invites a refund of the payment that
 *     did extend the post;
 *   - a replay of a renewal that WAS applied, and took the post to its cap,
 *     is still 'already_applied': nothing new on the ledger, no alert;
 *   - near the cap the renewal is applied with the days that are left, and
 *     the shortfall is logged.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/sentry';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sendRenewalConfirmationEmail } from '@/lib/email-service';
import { trackServerPurchase } from '@/lib/analytics-server';

const stripeMocks = vi.hoisted(() => ({ list: vi.fn(), expire: vi.fn(), retrieve: vi.fn() }));
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
    checkout: { sessions: stripeMocks },
  })),
}));
vi.mock('@/lib/email-service', () => ({
  sendRenewalConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendRefundConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
  sendPlanActivatedEmail: vi.fn().mockResolvedValue({ success: true }),
  sendPlanPausedEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-10-01T12:00:00.000Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);
const fromNow = (days: number) => new Date(NOW.getTime() + days * DAY_MS);
const CAP_ALERT = 'Renewal paid for a posting at its renewal limit, refund required';

const PAID = {
  id: 'cs_paid',
  object: 'checkout.session',
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  payment_intent: 'pi_paid',
  amount_total: 17900,
  currency: 'usd',
  invoice: null,
  created: NOW_S - 120,
  expires_at: NOW_S - 120 + 55 * 60,
  metadata: { jobId: 'job1', type: 'renewal', tier: 'pro' },
};

function asyncList<T>(items: T[]) {
  return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

/** The post as the renewal reads it: created `createdDaysAgo` days ago, expiring in `expiresInDays` days. */
function jobRow(createdDaysAgo: number, expiresInDays: number) {
  vi.mocked(prisma.job.findUnique).mockResolvedValue({
    expiresAt: fromNow(expiresInDays),
    createdAt: fromNow(-createdDaysAgo),
    title: 'Nurse Practitioner',
    slug: null,
  } as never);
}

async function deliver(eventId: string) {
  const { POST } = await import('@/app/api/webhooks/stripe/route');
  const res = await POST(new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    body: JSON.stringify({ id: eventId, type: 'checkout.session.completed', data: { object: PAID } }),
  }) as never);
  return { res, json: await res.json() };
}

const alerts = () => JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);

let logSpies: Array<{ mockRestore: () => void }> = [];

// Load the webhook route graph once, outside any single test's time budget (a
// cold import under a loaded full suite run can outlast vitest's 5 second default).
beforeAll(async () => {
  await import('@/app/api/webhooks/stripe/route');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
  logSpies = [
    vi.spyOn(logger, 'error').mockImplementation(() => undefined),
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
    vi.spyOn(logger, 'info').mockImplementation(() => undefined),
  ];
  vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    id: 'ej1', jobId: 'job1', paymentStatus: 'paid', contactEmail: 'e@x.com', dashboardToken: 'tok',
  } as never);
  vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
  vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.job.update).mockResolvedValue({} as never);
  vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
  vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'utok' } as never);
  // Interactive transaction: run the callback against the mocked client.
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
  stripeMocks.list.mockImplementation(() => asyncList([PAID]));
  stripeMocks.expire.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  for (const spy of logSpies) spy.mockRestore();
});

describe('a renewal paid for a post at its renewal cap extends nothing, so nothing is applied', () => {
  it.each([
    ['a live post that already runs to its cap', config.renewalCapDays - 15, 15],
    ['an expired post older than its cap', config.renewalCapDays + 35, -340],
  ])('%s: the payment is ledgered and alerted for a refund, and the post is left exactly as it was', async (_label, createdDaysAgo, expiresInDays) => {
    jobRow(createdDaysAgo, expiresInDays);

    const { res, json } = await deliver('evt_cap');

    // Acknowledged: a Stripe retry cannot make the renewal add anything.
    expect(res.status).toBe(200);
    expect(json.note).toMatch(/renewal limit/);
    expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    // The money is on the ledger, so the refund can be matched to it...
    expect(prisma.jobCharge.create).toHaveBeenCalledTimes(1);
    expect(prisma.jobCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ stripeSessionId: 'cs_paid', stripePaymentIntentId: 'pi_paid', type: 'renewal', employerJobId: 'ej1', amountCents: 17900 }),
    });
    // ...and nothing else moved: no expiry in the past, no republish, no status write.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.employerJob.update).not.toHaveBeenCalled();
    // The employer is not told the listing was renewed, and GA books no purchase.
    expect(sendRenewalConfirmationEmail).not.toHaveBeenCalled();
    expect(trackServerPurchase).not.toHaveBeenCalled();
    // A human hears about it, with what a refund needs.
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      tags: { area: 'stripe-webhook' },
      extra: expect.objectContaining({ reason: CAP_ALERT, paymentIntentId: 'pi_paid', amountCents: 17900, jobId: 'job1', employerJobId: 'ej1', sessionId: 'cs_paid' }),
    }));
    expect(alerts()).toContain(CAP_ALERT);
    expect(alerts()).toContain('pi_paid');
  });

  it("closes the post's other open renewal sessions, and raises no second alert about the payment that did extend the post", async () => {
    jobRow(config.renewalCapDays - 15, 15);
    stripeMocks.list.mockImplementation(() => asyncList([
      PAID,
      { ...PAID, id: 'cs_open', status: 'open', payment_status: 'unpaid', payment_intent: null },
      { ...PAID, id: 'cs_applied_first', payment_intent: 'pi_applied_first', created: PAID.created - 60 },
    ]));
    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([
      { stripeSessionId: 'cs_applied_first', stripePaymentIntentId: 'pi_applied_first', amountCents: 17900, refundedAmountCents: null },
    ] as never);

    const { res } = await deliver('evt_cap_siblings');

    expect(res.status).toBe(200);
    expect(stripeMocks.expire.mock.calls.map(([id]) => id)).toEqual(['cs_open']);
    // One alert: refund THIS payment. The other one is what the post runs on.
    expect(sendDiscordMessage).toHaveBeenCalledTimes(1);
    expect(alerts()).toContain(CAP_ALERT);
    expect(alerts()).not.toContain('Two paid renewals');
    expect(alerts()).not.toContain('pi_applied_first');
  });

  it("tells every caller (webhook, verify page, sweep, checkout route) with outcome 'cap_reached'", async () => {
    jobRow(config.renewalCapDays - 15, 15);
    const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');
    const { getStripe } = await import('@/lib/stripe');

    const result = await applyRenewalCheckout(getStripe() as Stripe, PAID as unknown as Stripe.Checkout.Session);

    expect(result).toEqual({ outcome: 'cap_reached', jobId: 'job1' });
  });

  it('a replay of a renewal that was applied, and took the post to its cap, stays already_applied: no refund alert', async () => {
    // The first delivery extended the post to its cap; the row now reads as a
    // post with nothing left to add, and this session is on the ledger.
    jobRow(config.renewalCapDays - 15, 15);
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: 'jc-1' } as never);
    vi.mocked(prisma.jobCharge.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');
    const { getStripe } = await import('@/lib/stripe');

    const result = await applyRenewalCheckout(getStripe() as Stripe, PAID as unknown as Stripe.Checkout.Session);

    expect(result.outcome).toBe('already_applied');
    expect(prisma.jobCharge.findUnique).toHaveBeenCalledWith({ where: { stripeSessionId: 'cs_paid' }, select: { id: true } });
    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(sendDiscordMessage).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('a renewal near the cap is applied with the days that are left', () => {
  it('moves the expiry to the cap, sends the confirmation with that date, and logs the shortfall', async () => {
    const daysToCap = 15;
    jobRow(config.renewalCapDays - daysToCap, -1);

    const { res, json } = await deliver('evt_near_cap');

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(prisma.job.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job1' },
      data: expect.objectContaining({ expiresAt: fromNow(daysToCap) }),
    }));
    expect(sendRenewalConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendRenewalConfirmationEmail).mock.calls[0][2]).toEqual(fromNow(daysToCap));
    expect(sendDiscordMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('fewer days than the posting period'),
      expect.objectContaining({ jobId: 'job1', sessionId: 'cs_paid', daysAdded: daysToCap, durationDays: config.durationDays }),
    );
  });

  it('a renewal with the full period ahead of it logs no shortfall', async () => {
    jobRow(57, 3);

    const { res } = await deliver('evt_full_period');

    expect(res.status).toBe(200);
    expect(prisma.job.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expiresAt: fromNow(3 + config.durationDays) }),
    }));
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('fewer days than the posting period'), expect.anything());
  });
});
