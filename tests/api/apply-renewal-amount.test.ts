/**
 * app/api/webhooks/stripe/apply-renewal.ts — the amount a renewal records
 * (2027 re-price).
 *
 * A renewal costs the base or the pro price depending on the post
 * (lib/renewal-price.ts), so nothing downstream may assume one price. The
 * amount the ledger row, the GA purchase event and the confirmation email
 * carry is the same number, decided once:
 *   - what Stripe charged (session.amount_total), whatever it was: a coupon or
 *     a manual price override must not be rewritten to a list price;
 *   - only when Stripe sent no total, the price of the rung the checkout sold
 *     the renewal at (metadata.renewalRung); a session minted before rungs
 *     existed carries none, and every renewal then cost the base price;
 *   - never a constant: the old fallback was the one renewal price there was.
 *
 * The confirmation email prints that amount (it printed config.renewalPrice
 * whatever was charged). The ledger-first idempotency, the refused statuses
 * and the renewal cap are pinned in apply-renewal-cap.test.ts and
 * webhooks-stripe-refund-dispute.test.ts.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
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

type SessionOverrides = Partial<Omit<Stripe.Checkout.Session, 'metadata'>> & { metadata?: Record<string, string> };

/** A paid renewal session. Pass `amount_total: null` for a session Stripe sent without a total. */
function renewalSession(overrides: SessionOverrides = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_paid',
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: 'pi_paid',
    amount_total: config.stripeRenewalPriceInCents,
    currency: 'usd',
    invoice: null,
    created: NOW_S - 120,
    expires_at: NOW_S - 120 + 55 * 60,
    metadata: { jobId: 'job1', type: 'renewal', tier: 'pro', renewalRung: 'base' },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

async function renew(session: Stripe.Checkout.Session) {
  const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');
  const { getStripe } = await import('@/lib/stripe');
  return applyRenewalCheckout(getStripe() as Stripe, session);
}

/** The amount each of the three consumers was given. */
function recordedAmounts() {
  const ledger = vi.mocked(prisma.jobCharge.create).mock.calls.map(([args]) => (args as { data: { amountCents: number } }).data.amountCents);
  const analytics = vi.mocked(trackServerPurchase).mock.calls.map(([params]) => params.amountCents);
  const email = vi.mocked(sendRenewalConfirmationEmail).mock.calls.map((call) => (call[5] as { amountCents: number }).amountCents);
  return { ledger, analytics, email };
}

let logSpies: Array<{ mockRestore: () => void }> = [];

// Load the webhook route graph once, outside any single test's time budget (a
// cold import under a loaded full suite run can outlast vitest's 5 second default).
beforeAll(async () => {
  await import('@/app/api/webhooks/stripe/apply-renewal');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  logSpies = [
    vi.spyOn(logger, 'error').mockImplementation(() => undefined),
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
    vi.spyOn(logger, 'info').mockImplementation(() => undefined),
  ];
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    id: 'ej1', jobId: 'job1', paymentStatus: 'paid', contactEmail: 'e@x.com', dashboardToken: 'tok',
  } as never);
  vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
  vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
  // A post well inside its renewal cap, expiring in three days.
  vi.mocked(prisma.job.findUnique).mockResolvedValue({
    expiresAt: new Date(NOW.getTime() + 3 * DAY_MS),
    createdAt: new Date(NOW.getTime() - 57 * DAY_MS),
    title: 'Nurse Practitioner',
    slug: null,
  } as never);
  vi.mocked(prisma.job.update).mockResolvedValue({} as never);
  vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
  vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'utok' } as never);
  // Interactive transaction: run the callback against the mocked client.
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
  stripeMocks.list.mockImplementation(() => ({ async *[Symbol.asyncIterator]() { /* no other renewal session */ } }));
  stripeMocks.expire.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  for (const spy of logSpies) spy.mockRestore();
});

describe('what Stripe charged is what the ledger, GA and the email carry', () => {
  it('the pro renewal: $249 on all three', async () => {
    const result = await renew(renewalSession({
      amount_total: config.stripeProRenewalPriceInCents,
      metadata: { jobId: 'job1', type: 'renewal', tier: 'pro', renewalRung: 'pro' },
    }));

    expect(result.outcome).toBe('applied');
    expect(recordedAmounts()).toEqual({ ledger: [24900], analytics: [24900], email: [24900] });
  });

  it('the base renewal: $199 on all three', async () => {
    const result = await renew(renewalSession());

    expect(result.outcome).toBe('applied');
    expect(recordedAmounts()).toEqual({ ledger: [19900], analytics: [19900], email: [19900] });
  });

  it('a total that is neither price (a coupon) is recorded as charged, never rewritten to a list price', async () => {
    await renew(renewalSession({ amount_total: 17910, metadata: { jobId: 'job1', type: 'renewal', tier: 'pro', renewalRung: 'pro' } }));

    expect(recordedAmounts()).toEqual({ ledger: [17910], analytics: [17910], email: [17910] });
  });

  it('the email is told the amount in the receipt it prints, beside the invoice links', async () => {
    await renew(renewalSession({ amount_total: 24900, metadata: { jobId: 'job1', type: 'renewal', tier: 'pro', renewalRung: 'pro' } }));

    expect(sendRenewalConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendRenewalConfirmationEmail).mock.calls[0][5]).toMatchObject({
      hostedInvoiceUrl: null,
      invoiceNumber: null,
      amountCents: 24900,
    });
  });
});

describe('a session without a total falls back to the price of the rung it was sold at', () => {
  it("rung 'pro': $249", async () => {
    await renew(renewalSession({ amount_total: null, metadata: { jobId: 'job1', type: 'renewal', tier: 'pro', renewalRung: 'pro' } }));

    expect(recordedAmounts()).toEqual({ ledger: [24900], analytics: [24900], email: [24900] });
  });

  it("rung 'base': $199", async () => {
    await renew(renewalSession({ amount_total: null, metadata: { jobId: 'job1', type: 'renewal', tier: 'pro', renewalRung: 'base' } }));

    expect(recordedAmounts()).toEqual({ ledger: [19900], analytics: [19900], email: [19900] });
  });

  it('a session minted before rungs existed has no renewalRung: $199', async () => {
    await renew(renewalSession({ amount_total: null, metadata: { jobId: 'job1', type: 'renewal', tier: 'pro' } }));

    expect(recordedAmounts()).toEqual({ ledger: [19900], analytics: [19900], email: [19900] });
  });

  it('an unrecognised rung reads as the base price', async () => {
    await renew(renewalSession({ amount_total: null, metadata: { jobId: 'job1', type: 'renewal', tier: 'pro', renewalRung: 'gold' } }));

    expect(recordedAmounts()).toEqual({ ledger: [19900], analytics: [19900], email: [19900] });
  });

  it('the old constant is gone: the fallback is the rung price, not stripeRenewalPriceInCents for everyone', async () => {
    await renew(renewalSession({ amount_total: null, metadata: { jobId: 'job1', type: 'renewal', tier: 'pro', renewalRung: 'pro' } }));

    expect(recordedAmounts().ledger).not.toContain(config.stripeRenewalPriceInCents);
  });
});

describe('a renewal that is only ledgered records the same amount', () => {
  it.each(['refunded', 'disputed'])("a payment on a '%s' posting: the ledger row carries the rung price when Stripe sent no total", async (status) => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      id: 'ej1', jobId: 'job1', paymentStatus: status, contactEmail: 'e@x.com', dashboardToken: 'tok',
    } as never);

    const result = await renew(renewalSession({ amount_total: null, metadata: { jobId: 'job1', type: 'renewal', tier: 'pro', renewalRung: 'pro' } }));

    expect(result.outcome).toBe('revoked_posting');
    expect(recordedAmounts().ledger).toEqual([24900]);
    expect(sendRenewalConfirmationEmail).not.toHaveBeenCalled();
    expect(trackServerPurchase).not.toHaveBeenCalled();
  });
});
