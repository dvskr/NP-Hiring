/**
 * A paid checkout never puts an archived post back on the board.
 *
 * The dashboard requires a restore before any republish (toggle-publish 409s
 * an archived post), and the chargeback-won path in
 * app/api/webhooks/stripe/route.ts already skips archived rows. Two payment
 * paths could still publish one: a renewal paid for a post archived after
 * its checkout opened (app/api/webhooks/stripe/apply-renewal.ts), and a new
 * post's checkout paid after the pending post was archived
 * (app/api/webhooks/stripe/activate-paid-job.ts).
 *
 * Pins, through the webhook with Prisma and Stripe mocked:
 *   - renewal: the payment is ledgered, the row turns 'paid' and the expiry
 *     moves as usual, but nothing sets isPublished. The archived check reads
 *     the row inside the transaction, after the extension write that holds
 *     the row lock, so an archive cannot land between the check and the
 *     write. No "live again" email and no search engine ping, on a replay
 *     either; the purchase event still goes out; a warning names the post;
 *   - new post: the claim and the ledger row happen as usual; the publish
 *     carries archivedAt: null in its WHERE, so the check and the write are
 *     one statement, and an archived post gets only the verified flag, no
 *     "your listing is live" email and no ping;
 *   - a post that is not archived is published exactly as before.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { sendConfirmationEmail, sendRenewalConfirmationEmail } from '@/lib/email-service';
import { trackServerPurchase } from '@/lib/analytics-server';
import { pingSearchEnginesForJobPage } from '@/lib/job-page-indexing';

const stripeMocks = vi.hoisted(() => ({ list: vi.fn(), expire: vi.fn(), retrieve: vi.fn() }));
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
    checkout: { sessions: stripeMocks },
  })),
}));
vi.mock('@/lib/email-service', () => ({
  sendConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendRenewalConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendRefundConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
  sendPlanActivatedEmail: vi.fn().mockResolvedValue({ success: true }),
  sendPlanPausedEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/job-page-indexing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/job-page-indexing')>()),
  pingSearchEnginesForJobPage: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

const NOW_S = Math.floor(Date.now() / 1000);
const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVED_AT = new Date(Date.now() - 60 * 60 * 1000);
const CURRENT_EXPIRY = new Date(Date.now() + 3 * DAY_MS);

function paidSession(id: string, metadata: Record<string, string>, amountTotal: number) {
  return {
    id,
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: `pi_${id}`,
    amount_total: amountTotal,
    currency: 'usd',
    invoice: null,
    created: NOW_S - 600,
    expires_at: NOW_S - 600 + 55 * 60,
    metadata,
  };
}

const RENEWAL_SESSION = paidSession('cs_renewal', { jobId: 'job1', type: 'renewal', tier: 'pro' }, 17900);
const NEW_POST_SESSION = paidSession('cs_new_post', { jobId: 'job2', pricing: 'pro' }, 29900);

function asyncList<T>(items: T[]) {
  return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

async function deliver(eventId: string, session: object) {
  const { POST } = await import('@/app/api/webhooks/stripe/route');
  const res = await POST(new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    body: JSON.stringify({ id: eventId, type: 'checkout.session.completed', data: { object: session } }),
  }) as never);
  return { res, json: await res.json() };
}

async function stripeClient(): Promise<Stripe> {
  const { getStripe } = await import('@/lib/stripe');
  return getStripe() as Stripe;
}

let logSpies: Array<{ mockRestore: () => void }> = [];

// Load the webhook route graph once, outside any single test's time budget (a
// cold import under a loaded full suite run can outlast vitest's 5 second default).
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
  vi.mocked(prisma.jobCharge.create).mockReset();
  vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
  // No other renewal charge for the post on the ledger.
  vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);
  vi.mocked(prisma.job.update).mockReset();
  vi.mocked(prisma.job.findUnique).mockReset();
  vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
  vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'utok' } as never);
  vi.mocked(prisma.jobDraft.deleteMany).mockResolvedValue({ count: 0 } as never);
  stripeMocks.list.mockImplementation(() => asyncList([]));
});

afterEach(() => {
  for (const spy of logSpies) spy.mockRestore();
});

describe('a renewal paid for a post archived after its checkout opened', () => {
  /**
   * The renewal transaction's own client, apart from the global one, so a
   * test can tell a read inside the transaction from a read outside it.
   */
  function renewalTransaction(archivedAt: Date | null) {
    const tx = {
      jobCharge: { create: vi.fn().mockResolvedValue({}) },
      employerJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      job: {
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ archivedAt }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
    return tx;
  }

  /** The job row outside the transaction: its eligibility columns, or archivedAt when that is what is asked. */
  function jobRowOutsideTransaction(archivedAt: Date | null) {
    vi.mocked(prisma.job.findUnique).mockImplementation((async (args: { select?: Record<string, boolean> }) => (
      args.select?.archivedAt
        ? { archivedAt }
        : { expiresAt: CURRENT_EXPIRY, createdAt: new Date(Date.now() - 57 * DAY_MS), title: 'Nurse Practitioner', slug: 'nurse-practitioner-job1' }
    )) as never);
  }

  beforeEach(() => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      id: 'ej1', jobId: 'job1', paymentStatus: 'paid', contactEmail: 'owner@clinic.example', dashboardToken: 'tok',
    } as never);
  });

  it('records the payment and moves the expiry, but leaves the post unpublished and archived', async () => {
    const tx = renewalTransaction(ARCHIVED_AT);
    jobRowOutsideTransaction(ARCHIVED_AT);

    const { res, json } = await deliver('evt_renew_archived', RENEWAL_SESSION);

    expect(res.status).toBe(200);
    // The acknowledgement says so, for whoever reads the delivery in Stripe.
    expect(json).toEqual({ received: true, leftArchived: true });
    // The ledger row and the status write, as for any renewal.
    expect(tx.jobCharge.create).toHaveBeenCalledWith({ data: expect.objectContaining({ stripeSessionId: 'cs_renewal', type: 'renewal', employerJobId: 'ej1' }) });
    expect(tx.employerJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { paymentStatus: 'paid', pricingTier: 'pro', expiryWarningSentAt: null },
    }));
    // The expiry moves on from the current one...
    expect(tx.job.update).toHaveBeenCalledTimes(1);
    const [extension] = tx.job.update.mock.calls[0] as [{ where: object; data: Record<string, unknown> }];
    expect(extension.where).toEqual({ id: 'job1' });
    expect((extension.data.expiresAt as Date).getTime()).toBeGreaterThan(CURRENT_EXPIRY.getTime());
    // ...and nothing publishes the post.
    expect(extension.data).not.toHaveProperty('isPublished');
    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
    // Not live: no "live again" email and no ping. The purchase still counts.
    expect(sendRenewalConfirmationEmail).not.toHaveBeenCalled();
    expect(pingSearchEnginesForJobPage).not.toHaveBeenCalled();
    expect(trackServerPurchase).toHaveBeenCalledTimes(1);
    // A warning names the post, so the employer can be pointed to the restore.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('archived'),
      expect.objectContaining({ jobId: 'job1', employerJobId: 'ej1', sessionId: 'cs_renewal' }),
    );
    // Acknowledged: nothing for Stripe to retry.
    expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
  });

  it('reads archivedAt inside the transaction, after the extension write that locks the row', async () => {
    const tx = renewalTransaction(ARCHIVED_AT);
    jobRowOutsideTransaction(ARCHIVED_AT);

    await deliver('evt_renew_archived_order', RENEWAL_SESSION);

    expect(tx.job.findUnique).toHaveBeenCalledWith({ where: { id: 'job1' }, select: { archivedAt: true } });
    expect(tx.job.update.mock.invocationCallOrder[0]).toBeLessThan(tx.job.findUnique.mock.invocationCallOrder[0]);
    // Outside the transaction, only the read of the columns the renewal needs.
    expect(prisma.job.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.job.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ select: { archivedAt: true } }));
  });

  it('a post that is not archived is put back live in the same transaction, after the check', async () => {
    const tx = renewalTransaction(null);
    jobRowOutsideTransaction(null);

    const { res, json } = await deliver('evt_renew_live', RENEWAL_SESSION);

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(tx.job.update).toHaveBeenCalledTimes(2);
    expect(tx.job.update.mock.calls[1][0]).toEqual({ where: { id: 'job1' }, data: { isPublished: true } });
    const [extensionOrder, publishOrder] = tx.job.update.mock.invocationCallOrder;
    const checkOrder = tx.job.findUnique.mock.invocationCallOrder[0];
    expect(extensionOrder).toBeLessThan(checkOrder);
    expect(checkOrder).toBeLessThan(publishOrder);
    expect(sendRenewalConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(pingSearchEnginesForJobPage).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('archived'), expect.anything());
  });

  it('a replay of a renewal left archived sends no "live again" email either', async () => {
    const tx = renewalTransaction(ARCHIVED_AT);
    tx.jobCharge.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    jobRowOutsideTransaction(ARCHIVED_AT);

    const { res } = await deliver('evt_renew_replay', RENEWAL_SESSION);

    expect(res.status).toBe(200);
    expect(tx.job.update).not.toHaveBeenCalled();
    expect(prisma.job.findUnique).toHaveBeenCalledWith({ where: { id: 'job1' }, select: { archivedAt: true } });
    expect(prisma.emailSend.create).not.toHaveBeenCalled();
    expect(sendRenewalConfirmationEmail).not.toHaveBeenCalled();
  });

  it('tells every caller (webhook, verify page, sweep) that the post was left archived', async () => {
    renewalTransaction(ARCHIVED_AT);
    jobRowOutsideTransaction(ARCHIVED_AT);
    const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');

    const result = await applyRenewalCheckout(await stripeClient(), RENEWAL_SESSION as unknown as Stripe.Checkout.Session);

    expect(result).toEqual({ outcome: 'applied', jobId: 'job1', leftArchived: true });
  });
});

describe('a new post paid after it was archived while its checkout was open', () => {
  /** The publish matches nothing while the post is archived (Prisma P2025), as the real WHERE would. */
  function jobRow(archived: boolean) {
    vi.mocked(prisma.job.update).mockImplementation((async (args: { where: Record<string, unknown> }) => {
      if (archived && 'archivedAt' in args.where) {
        throw Object.assign(new Error('No record was found for an update.'), { code: 'P2025' });
      }
      return { id: 'job2', title: 'Nurse Practitioner', slug: 'nurse-practitioner-job2' };
    }) as never);
  }

  beforeEach(() => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      id: 'ej2', jobId: 'job2', paymentStatus: 'pending', contactEmail: 'owner@clinic.example', dashboardToken: 'tok', quotaDomain: null,
    } as never);
  });

  it('claims and ledgers the payment, but leaves the post unpublished and archived', async () => {
    jobRow(true);

    const { res, json } = await deliver('evt_new_archived', NEW_POST_SESSION);

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true, leftArchived: true });
    expect(prisma.employerJob.update).toHaveBeenCalledWith({
      where: { id: 'ej2', paymentStatus: 'pending' },
      data: { paymentStatus: 'paid', pricingTier: 'pro' },
    });
    const writes = vi.mocked(prisma.job.update).mock.calls.map(([args]) => args);
    // The publish carried the archived check in its WHERE and matched nothing...
    expect(writes[0]).toEqual({
      where: { id: 'job2', archivedAt: null },
      data: { isPublished: true, isVerifiedEmployer: true, contentChangedAt: expect.any(Date) },
    });
    // ...so the post got only the verified flag its paid listing earns.
    expect(writes[1]).toEqual({ where: { id: 'job2' }, data: { isVerifiedEmployer: true } });
    expect(writes).toHaveLength(2);
    expect(prisma.jobCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ stripeSessionId: 'cs_new_post', type: 'new', employerJobId: 'ej2' }),
    });
    // Not live: no "your listing is live" email and no ping. The purchase still counts.
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
    expect(pingSearchEnginesForJobPage).not.toHaveBeenCalled();
    expect(trackServerPurchase).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('archived'),
      expect.objectContaining({ jobId: 'job2', employerJobId: 'ej2', sessionId: 'cs_new_post' }),
    );
    expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
  });

  it('a post that is not archived is published exactly as before, the check in the same statement', async () => {
    jobRow(false);

    const { res, json } = await deliver('evt_new_live', NEW_POST_SESSION);

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(prisma.job.update).toHaveBeenCalledTimes(1);
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job2', archivedAt: null },
      data: { isPublished: true, isVerifiedEmployer: true, contentChangedAt: expect.any(Date) },
    });
    expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(pingSearchEnginesForJobPage).toHaveBeenCalledTimes(1);
  });

  it('tells every caller (webhook, verify page, sweep) that the post was left archived', async () => {
    jobRow(true);
    const { activatePaidJobCheckout } = await import('@/app/api/webhooks/stripe/activate-paid-job');

    const result = await activatePaidJobCheckout(await stripeClient(), NEW_POST_SESSION as unknown as Stripe.Checkout.Session);

    expect(result).toEqual({ outcome: 'activated', jobId: 'job2', leftArchived: true });
  });

  it('a job row that is gone is still an error the webhook retries, not a post left archived', async () => {
    vi.mocked(prisma.job.update).mockRejectedValue(Object.assign(new Error('No record was found for an update.'), { code: 'P2025' }));

    const { res } = await deliver('evt_new_gone', NEW_POST_SESSION);

    expect(res.status).toBe(500);
    expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_new_gone' } });
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('archived'), expect.anything());
  });
});
