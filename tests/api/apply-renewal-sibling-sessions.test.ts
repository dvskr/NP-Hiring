/**
 * app/api/webhooks/stripe/apply-renewal.ts — the post's other renewal
 * sessions once a renewal is applied (backlog 2.5).
 *
 * Pins, with Stripe mocked:
 *   - through the webhook: after the ledger row and the extension, every
 *     other OPEN renewal session for the post is expired; sessions of other
 *     posts, the post's new-post sessions and closed sessions are not;
 *   - a second PAID renewal for the post whose payable window overlapped
 *     this one raises the refund alert (Sentry and Discord) with both
 *     payment intents; nothing is refunded automatically and the webhook
 *     still acknowledges, since a retry cannot help;
 *   - a paid renewal whose window closed before this one began (an earlier,
 *     separate renewal) raises nothing;
 *   - the ledger is a second net for that alert: another renewal charge for
 *     the posting, ledgered since this session could first be paid, raises it
 *     even when Stripe cannot be listed. One already refunded in full does
 *     not, and a payment both nets report is named once;
 *   - the alert says what a refund does, so the operator is not left to find
 *     out (tests/api/webhooks-stripe-refund-dispute.test.ts pins that a
 *     refund of one of the two leaves the posting live);
 *   - a Stripe failure in this step is logged and never fails the webhook;
 *   - a replay ('already_applied') still runs the step, and a renewal refused
 *     on a revoked posting does not.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/sentry';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sendRenewalConfirmationEmail } from '@/lib/email-service';
import { trackServerPurchase } from '@/lib/analytics-server';
import { STRIPE_MAX_SESSION_LIFETIME_MS } from '@/lib/renewal-checkout-sessions';

const stripeMocks = vi.hoisted(() => ({ list: vi.fn(), expire: vi.fn(), retrieve: vi.fn(), refundsCreate: vi.fn() }));
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
    checkout: { sessions: { list: stripeMocks.list, expire: stripeMocks.expire, retrieve: stripeMocks.retrieve } },
    refunds: { create: stripeMocks.refundsCreate },
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

const NOW_S = Math.floor(Date.now() / 1000);
const CREATED = NOW_S - 120;
const LIFETIME_S = 55 * 60;

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
  created: CREATED,
  expires_at: CREATED + LIFETIME_S,
  metadata: { jobId: 'job1', type: 'renewal', tier: 'pro' },
};

function sibling(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'open',
    payment_status: 'unpaid',
    payment_intent: null,
    created: CREATED - 15 * 60,
    expires_at: CREATED - 15 * 60 + LIFETIME_S,
    metadata: { jobId: 'job1', type: 'renewal', tier: 'pro' },
    ...overrides,
  };
}

function asyncList<T>(items: T[]) {
  return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

function webhookRequest(eventId: string): Request {
  return new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    body: JSON.stringify({ id: eventId, type: 'checkout.session.completed', data: { object: PAID } }),
  });
}

async function deliver(eventId: string) {
  const { POST } = await import('@/app/api/webhooks/stripe/route');
  const res = await POST(webhookRequest(eventId) as never);
  return { res, json: await res.json() };
}

let logSpies: Array<{ mockRestore: () => void }> = [];

// Load the webhook route graph once, outside any single test's time budget:
// alone it takes a few seconds, and on a loaded full suite run the first test
// that paid for it ran past vitest's 5 second default.
beforeAll(async () => {
  await import('@/app/api/webhooks/stripe/route');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
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
  // No other renewal charge for the posting on the ledger.
  vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.job.findUnique).mockResolvedValue({
    expiresAt: new Date(Date.now() + 3 * 86_400_000),
    createdAt: new Date(Date.now() - 57 * 86_400_000),
    title: 'Nurse Practitioner',
    slug: null,
  } as never);
  vi.mocked(prisma.job.update).mockResolvedValue({} as never);
  vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
  vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'utok' } as never);
  // Interactive transaction: run the callback against the mocked client.
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
  stripeMocks.list.mockImplementation(() => asyncList([PAID]));
  stripeMocks.expire.mockResolvedValue({});
});

afterEach(() => {
  for (const spy of logSpies) spy.mockRestore();
});

describe('after a renewal is applied, the post has no other payable renewal session', () => {
  it("the webhook expires the post's other open renewal sessions after the ledger row and the extension", async () => {
    stripeMocks.list.mockImplementation(() => asyncList([
      PAID,
      sibling('cs_open_sibling'),
      sibling('cs_other_post', { metadata: { jobId: 'job2', type: 'renewal', tier: 'pro' } }),
      sibling('cs_new_post_checkout', { metadata: { jobId: 'job1', pricing: 'pro' } }),
      sibling('cs_already_expired', { status: 'expired' }),
    ]));

    const { res } = await deliver('evt_sibling');

    expect(res.status).toBe(200);
    expect(stripeMocks.expire.mock.calls.map(([id]) => id)).toEqual(['cs_open_sibling']);
    const expireOrder = stripeMocks.expire.mock.invocationCallOrder[0];
    expect(vi.mocked(prisma.jobCharge.create).mock.invocationCallOrder[0]).toBeLessThan(expireOrder);
    expect(vi.mocked(prisma.job.update).mock.invocationCallOrder[0]).toBeLessThan(expireOrder);
    // Last: the extra Stripe calls never hold the confirmation email or the purchase event.
    const listOrder = stripeMocks.list.mock.invocationCallOrder[0];
    expect(vi.mocked(sendRenewalConfirmationEmail).mock.invocationCallOrder[0]).toBeLessThan(listOrder);
    expect(vi.mocked(trackServerPurchase).mock.invocationCallOrder[0]).toBeLessThan(listOrder);
    // Every session that could have been payable alongside this one.
    expect(stripeMocks.list).toHaveBeenCalledWith({
      created: { gte: CREATED - STRIPE_MAX_SESSION_LIFETIME_MS / 1000 },
      limit: 100,
    });
    // An open sibling is not a payment: no alert.
    expect(sendDiscordMessage).not.toHaveBeenCalled();
  });

  it('a replay (the ledger row already exists) still closes open siblings, without extending again', async () => {
    vi.mocked(prisma.jobCharge.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    stripeMocks.list.mockImplementation(() => asyncList([PAID, sibling('cs_open_sibling')]));
    const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');
    const { getStripe } = await import('@/lib/stripe');

    const result = await applyRenewalCheckout(getStripe() as Stripe, PAID as unknown as Stripe.Checkout.Session);

    expect(result.outcome).toBe('already_applied');
    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(stripeMocks.expire).toHaveBeenCalledWith('cs_open_sibling');
  });

  it('a renewal refused on a revoked posting does not touch other sessions', async () => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      id: 'ej1', jobId: 'job1', paymentStatus: 'refunded', contactEmail: 'e@x.com', dashboardToken: 'tok',
    } as never);

    const { res, json } = await deliver('evt_revoked');

    expect(res.status).toBe(200);
    expect(json.note).toMatch(/revoked posting/);
    expect(stripeMocks.list).not.toHaveBeenCalled();
    expect(stripeMocks.expire).not.toHaveBeenCalled();
  });
});

describe('two paid renewals for one post never pass silently', () => {
  it('a second paid renewal whose window overlapped raises the refund alert with both payment intents, and nothing is refunded', async () => {
    stripeMocks.list.mockImplementation(() => asyncList([
      sibling('cs_paid_too', { status: 'complete', payment_status: 'paid', payment_intent: 'pi_paid_too', created: CREATED + 60, expires_at: CREATED + 60 + LIFETIME_S }),
      PAID,
    ]));

    const { res, json } = await deliver('evt_double');

    // Applied once (the extension, then the publish) and acknowledged: a
    // Stripe retry cannot undo a payment.
    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(prisma.job.update).toHaveBeenCalledTimes(2);
    expect(prisma.job.update).toHaveBeenLastCalledWith({ where: { id: 'job1' }, data: { isPublished: true } });
    expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    // Sentry and Discord, with what a refund needs.
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      tags: { area: 'stripe-webhook' },
      extra: expect.objectContaining({
        reason: 'Two paid renewals for one posting, refund required',
        jobId: 'job1',
        employerJobId: 'ej1',
        paymentIntentId: 'pi_paid',
        otherPaymentIntentIds: 'pi_paid_too',
        amountCents: 17900,
      }),
    }));
    const discord = JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);
    expect(discord).toContain('Two paid renewals for one posting');
    expect(discord).toContain('pi_paid_too');
    // Never an automatic refund.
    expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
    // The full session ids stay in the log, which the alert channels mask.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Two paid renewals for one posting'),
      expect.objectContaining({ sessionId: 'cs_paid', otherSessionIds: 'cs_paid_too' }),
    );
  });

  it('with production-length ids, both payment intents a refund needs fit the Discord line, and no id is masked', async () => {
    // A live Checkout Session id is long enough for the alert redaction's
    // token fallback; Stripe object ids are exempt from it
    // (lib/sanitize-for-discord.ts). Readable ids make the Discord detail
    // line longer than its cap, so the ids a refund needs must come first.
    const jobId = '0b9f8a52-6c1e-4d6b-9a8e-3f2d1c0b9a87';
    const employerJobId = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
    const metadata = { jobId, type: 'renewal', tier: 'pro' };
    const sessionId = `cs_live_${'b2C3d4E5f6'.repeat(6).slice(0, 58)}`;
    const otherSessionId = `cs_live_${'a1B2c3D4e5'.repeat(6).slice(0, 58)}`;
    const intentId = 'pi_3MtwBwLkdIwHu7ix28a3tqPa';
    const otherIntentId = 'pi_3NqZxYLkdIwHu7ix0kL1mNoP';
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      id: employerJobId, jobId, paymentStatus: 'paid', contactEmail: 'e@x.com', dashboardToken: 'tok',
    } as never);
    const paid = { ...PAID, id: sessionId, payment_intent: intentId, metadata };
    stripeMocks.list.mockImplementation(() => asyncList([
      paid,
      sibling(otherSessionId, { status: 'complete', payment_status: 'paid', payment_intent: otherIntentId, metadata }),
    ]));

    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(new Request('https://example.com/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig_test' },
      body: JSON.stringify({ id: 'evt_real_ids', type: 'checkout.session.completed', data: { object: paid } }),
    }) as never);

    expect(res.status).toBe(200);
    const discord = JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);
    expect(discord).toContain(intentId);
    expect(discord).toContain(otherIntentId);
    expect(discord).not.toContain('[REDACTED_TOKEN]');
    // Sentry keeps every id in full.
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      extra: expect.objectContaining({ paymentIntentId: intentId, otherPaymentIntentIds: otherIntentId, sessionId, otherSessionIds: otherSessionId }),
    }));
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ otherSessionIds: otherSessionId }));
  });

  it('the same alert fires when the other payment was taken first (its session was created earlier)', async () => {
    stripeMocks.list.mockImplementation(() => asyncList([
      PAID,
      sibling('cs_paid_first', { status: 'complete', payment_status: 'paid', payment_intent: 'pi_first' }),
    ]));

    await deliver('evt_double_earlier');

    expect(JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls)).toContain('pi_first');
  });

  it('an earlier, separate renewal whose session closed before this one began raises nothing', async () => {
    stripeMocks.list.mockImplementation(() => asyncList([
      PAID,
      sibling('cs_earlier_renewal', {
        status: 'complete',
        payment_status: 'paid',
        payment_intent: 'pi_earlier',
        created: CREATED - 3 * 3600,
        expires_at: CREATED - 3 * 3600 + LIFETIME_S,
      }),
    ]));

    const { res } = await deliver('evt_separate');

    expect(res.status).toBe(200);
    expect(sendDiscordMessage).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('says what a refund does: one payment refunded in full leaves the posting live', async () => {
    stripeMocks.list.mockImplementation(() => asyncList([
      PAID,
      sibling('cs_paid_too', { status: 'complete', payment_status: 'paid', payment_intent: 'pi_paid_too' }),
    ]));

    await deliver('evt_double_procedure');

    const [, context] = vi.mocked(captureException).mock.calls[0] as [unknown, { extra: Record<string, unknown> }];
    expect(context.extra.action).toMatch(/Refund one of these payments in full/);
    expect(context.extra.action).toMatch(/posting stays live/);
    const discord = JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);
    expect(discord).toMatch(/Refund one of these payments in full/);
    expect(discord).toMatch(/posting stays live/);
    // The ids a refund needs still come first on the Discord line.
    expect(discord.indexOf('pi_paid_too')).toBeLessThan(discord.indexOf('Refund one of these payments'));
  });
});

describe('the ledger is a second net for a second paid renewal', () => {
  /** Another renewal charge for the posting, as the ledger read returns it. */
  function ledgerRow(overrides: Record<string, unknown> = {}) {
    return { stripeSessionId: 'cs_first', stripePaymentIntentId: 'pi_first', amountCents: 17900, refundedAmountCents: null, ...overrides };
  }

  it('raises the alert when Stripe cannot be listed: the renewal charges ledgered since this session could first be paid', async () => {
    stripeMocks.list.mockImplementation(() => { throw new Error('stripe down'); });
    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([ledgerRow()] as never);

    const { res } = await deliver('evt_ledger_double');

    // Applied and acknowledged as before; the second payment no longer passes silently.
    expect(res.status).toBe(200);
    expect(prisma.job.update).toHaveBeenCalledTimes(2);
    expect(prisma.jobCharge.findMany).toHaveBeenCalledWith({
      where: {
        employerJobId: 'ej1',
        type: 'renewal',
        stripeSessionId: { not: 'cs_paid' },
        // The same range the Stripe listing covers: one session lifetime before this one was created.
        createdAt: { gte: new Date(CREATED * 1000 - STRIPE_MAX_SESSION_LIFETIME_MS) },
      },
      select: { stripeSessionId: true, stripePaymentIntentId: true, amountCents: true, refundedAmountCents: true },
    });
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      extra: expect.objectContaining({
        reason: 'Two paid renewals for one posting, refund required',
        paymentIntentId: 'pi_paid',
        otherPaymentIntentIds: 'pi_first',
        otherSessionIds: 'cs_first',
      }),
    }));
    const discord = JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);
    expect(discord).toContain('Two paid renewals for one posting');
    expect(discord).toContain('pi_first');
    expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
  });

  it('reads the ledger only after this renewal is on it, so the later of two payments always finds the earlier one', async () => {
    await deliver('evt_ledger_order');

    expect(vi.mocked(prisma.jobCharge.create).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.jobCharge.findMany).mock.invocationCallOrder[0]);
    expect(sendDiscordMessage).not.toHaveBeenCalled();
  });

  it('a renewal charge already refunded in full is not a second payment to chase; a partly refunded one still is', async () => {
    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([ledgerRow({ refundedAmountCents: 17900 })] as never);
    await deliver('evt_ledger_refunded');
    expect(sendDiscordMessage).not.toHaveBeenCalled();

    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([ledgerRow({ refundedAmountCents: 5000 })] as never);
    await deliver('evt_ledger_partly_refunded');
    expect(JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls)).toContain('pi_first');
  });

  it('a payment both Stripe and the ledger report is named once, in one alert', async () => {
    stripeMocks.list.mockImplementation(() => asyncList([
      PAID,
      sibling('cs_paid_too', { status: 'complete', payment_status: 'paid', payment_intent: 'pi_paid_too' }),
    ]));
    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([
      ledgerRow({ stripeSessionId: 'cs_paid_too', stripePaymentIntentId: 'pi_paid_too' }),
    ] as never);

    await deliver('evt_both_nets');

    expect(sendDiscordMessage).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      extra: expect.objectContaining({ otherPaymentIntentIds: 'pi_paid_too', otherSessionIds: 'cs_paid_too' }),
    }));
  });

  it('a ledger that cannot be read is logged, and the Stripe listing still raises the alert', async () => {
    stripeMocks.list.mockImplementation(() => asyncList([
      PAID,
      sibling('cs_paid_too', { status: 'complete', payment_status: 'paid', payment_intent: 'pi_paid_too' }),
    ]));
    vi.mocked(prisma.jobCharge.findMany).mockRejectedValue(new Error('db down'));

    const { res } = await deliver('evt_ledger_down');

    expect(res.status).toBe(200);
    expect(JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls)).toContain('pi_paid_too');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not read the post's other renewal charges"),
      expect.any(Error),
      { jobId: 'job1', sessionId: 'cs_paid' },
    );
  });
});

describe('best effort: this step never fails the webhook', () => {
  it('a failed session listing is logged and the renewal still stands', async () => {
    stripeMocks.list.mockImplementation(() => { throw new Error('stripe down'); });

    const { res } = await deliver('evt_list_down');

    expect(res.status).toBe(200);
    // The renewal stands: extended, then published.
    expect(prisma.job.update).toHaveBeenCalledTimes(2);
    expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not check the post's other renewal sessions"),
      expect.any(Error),
      { jobId: 'job1', sessionId: 'cs_paid' },
    );
  });

  it('a sibling that cannot be expired is logged with its id, and the webhook acknowledges', async () => {
    stripeMocks.list.mockImplementation(() => asyncList([PAID, sibling('cs_stuck')]));
    stripeMocks.expire.mockRejectedValue(new Error('expire failed'));
    stripeMocks.retrieve.mockResolvedValue({ id: 'cs_stuck', status: 'open' });

    const { res } = await deliver('evt_expire_fail');

    expect(res.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not expire another open renewal session'),
      null,
      expect.objectContaining({ jobId: 'job1', sessionId: 'cs_paid', failed: [expect.objectContaining({ sessionId: 'cs_stuck' })] }),
    );
  });
});
