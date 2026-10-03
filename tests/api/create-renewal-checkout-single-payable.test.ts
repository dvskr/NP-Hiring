/**
 * POST /api/create-renewal-checkout — one payable renewal session per post
 * (backlog 2.5).
 *
 * The bug: the idempotency key rolls every ten minutes and older open
 * sessions lived Stripe's default 24 hours, so an employer who started a
 * renewal, came back ten or more minutes later and started another could pay
 * both. Pins, with Stripe mocked:
 *
 *   - an open renewal session for the post from an earlier window (or from
 *     before sessions carried expires_at) is expired BEFORE the create;
 *     sessions of other posts and the post's new-post sessions are not
 *     touched;
 *   - the session a double click replays is never expired, and the two
 *     clicks send identical create parameters (idempotency safe);
 *   - a session from this window under another key (the GA ids changed
 *     between clicks) is expired after the create, before the URL leaves;
 *   - a list or expire failure refuses with a retryable 503 and never hands
 *     out a second payable session: nothing is created when the failure
 *     comes first, and the new session's URL is withheld when it comes after;
 *   - expires_at is at least Stripe's 30 minute minimum ahead, and closes
 *     before the renewal session cookie the response sets;
 *   - a renewal payment already in flight for the post refuses a new session
 *     with 409 before anything is listed open, expired or created: a paid
 *     session the webhook has not applied yet (no ledger row), or a completed
 *     session whose delayed payment is still processing or awaiting bank
 *     verification. A failed lookup refuses with the retryable 503;
 *   - a paid session nobody applied is applied right there, through the
 *     shared fulfilment, and the employer is told it has been applied. The
 *     refusal used to say "we are applying it now, refresh in a minute" while
 *     nothing on that path applied anything: with the webhook lost, every
 *     click repeated it until the daily sweep ran. When it cannot be applied
 *     the wording promises no minute.
 *
 * tests/api/create-renewal-checkout-replayed-session.test.ts pins what the
 * route does when the key replays a session that is no longer payable.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  RENEWAL_IDEMPOTENCY_WINDOW_MS,
  RENEWAL_SESSION_COOKIE_MAX_AGE_S,
  RENEWAL_SETTLEMENT_LOOKBACK_MS,
  STRIPE_MAX_SESSION_LIFETIME_MS,
  renewalIdempotencyWindow,
  renewalSessionExpiresAt,
} from '@/lib/renewal-checkout-sessions';

const stripeMocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), expire: vi.fn(), retrieve: vi.fn() }));
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({ checkout: { sessions: stripeMocks } })),
}));

vi.mock('@/lib/env', () => ({
  isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting'),
  getPaidPostingStatus: vi.fn(() => ({ enabled: true, stripeConfigured: true, available: true })),
  getEnv: vi.fn(() => ({})),
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));

// The shared renewal fulfilment, which the route runs for a paid renewal
// nobody applied (tests/api/apply-renewal-*.test.ts cover what it does).
const applyRenewalCheckout = vi.hoisted(() => vi.fn());
vi.mock('@/app/api/webhooks/stripe/apply-renewal', () => ({ applyRenewalCheckout }));

/** Stripe: expires_at must be at least 30 minutes after the session is created. */
const STRIPE_MIN_LEAD_MS = 30 * 60 * 1000;
const WINDOW_START_MS = 1_790_000_400_000; // a multiple of the 10 minute window
const NOW_MS = WINDOW_START_MS + 3 * 60 * 1000;
const THIS_WINDOW = renewalIdempotencyWindow(NOW_MS);

const DAY_MS = 24 * 60 * 60 * 1000;

function asyncList<T>(items: T[]) {
  return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

/** What Stripe lists for each status the route asks for (open sessions, completed ones). */
function stripeLists(byStatus: { open?: unknown[]; complete?: unknown[] }) {
  stripeMocks.list.mockImplementation((params: { status?: string }) => {
    if (params.status === 'open') return asyncList(byStatus.open ?? []);
    if (params.status === 'complete') return asyncList(byStatus.complete ?? []);
    return asyncList([]);
  });
}

/** A completed renewal session for the post, created `daysAgo` days before the request. */
function completeSession(id: string, opts: { paymentStatus?: string; jobId?: string; metadata?: Record<string, string>; daysAgo?: number } = {}) {
  const created = Math.floor((NOW_MS - (opts.daysAgo ?? 1) * DAY_MS) / 1000);
  return {
    id,
    status: 'complete',
    payment_status: opts.paymentStatus ?? 'paid',
    payment_intent: `pi_${id}`,
    created,
    expires_at: created + 55 * 60,
    metadata: opts.metadata ?? { jobId: opts.jobId ?? 'job-1', type: 'renewal', tier: 'pro' },
  };
}

/** sessions.retrieve(id, { expand: ['payment_intent'] }) of a completed, unpaid session. */
function intentIs(status: string) {
  stripeMocks.retrieve.mockImplementation(async (id: string) => ({
    ...completeSession(id, { paymentStatus: 'unpaid' }),
    payment_intent: { id: `pi_${id}`, object: 'payment_intent', status },
  }));
}

function openSession(id: string, opts: { jobId?: string; windowIndex?: number; metadata?: Record<string, string>; expiresAt?: number } = {}) {
  const windowIndex = opts.windowIndex ?? THIS_WINDOW;
  return {
    id,
    status: 'open',
    payment_status: 'unpaid',
    created: Math.floor((windowIndex * RENEWAL_IDEMPOTENCY_WINDOW_MS) / 1000) + 30,
    expires_at: opts.expiresAt ?? renewalSessionExpiresAt(windowIndex),
    metadata: opts.metadata ?? { jobId: opts.jobId ?? 'job-1', type: 'renewal', tier: 'pro' },
  };
}

function makeReq(): NextRequest {
  return new NextRequest('https://test.local/api/create-renewal-checkout', {
    method: 'POST',
    body: JSON.stringify({ jobId: 'job-1', editToken: 'edit-1' }),
    headers: { 'content-type': 'application/json' },
  });
}

async function post() {
  const { POST } = await import('@/app/api/create-renewal-checkout/route');
  const res = await POST(makeReq());
  return { res, json: await res.json() };
}

const VISIBLE_DASH = /[–—]|\s-\s/;

let nowSpy: ReturnType<typeof vi.spyOn>;
let logSpies: Array<{ mockRestore: () => void }> = [];

// Load the route graph once, outside any single test's time budget (a cold
// import under a loaded full suite run can outlast vitest's 5 second default).
beforeAll(async () => {
  await import('@/app/api/create-renewal-checkout/route');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  logSpies = [
    vi.spyOn(logger, 'error').mockImplementation(() => undefined),
    vi.spyOn(logger, 'info').mockImplementation(() => undefined),
  ];
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    id: 'ej-1',
    jobId: 'job-1',
    editToken: 'edit-1',
    contactEmail: 'owner@clinic.example',
    paymentStatus: 'paid',
    pricingTier: 'pro',
    job: { id: 'job-1', title: 'Nurse Practitioner', employer: 'Clinic Co', location: 'Remote', expiresAt: null, createdAt: new Date(NOW_MS - 30 * DAY_MS) },
  } as never);
  stripeMocks.list.mockImplementation(() => asyncList([]));
  // `created`: stamped by this request, so the route need not read it back.
  stripeMocks.create.mockImplementation(async () => ({ id: 'cs_new', url: 'https://checkout.stripe.test/cs_new', created: Math.floor(Date.now() / 1000) }));
  stripeMocks.expire.mockResolvedValue({});
  // Implementations a test sets would otherwise outlive it (clearAllMocks keeps them).
  stripeMocks.retrieve.mockReset();
  vi.mocked(prisma.jobCharge.findMany).mockReset();
  vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
  applyRenewalCheckout.mockReset();
  applyRenewalCheckout.mockResolvedValue({ outcome: 'applied', jobId: 'job-1' });
});

afterEach(() => {
  nowSpy.mockRestore();
  for (const spy of logSpies) spy.mockRestore();
});

describe('other open renewal sessions for the post', () => {
  it('are expired before the create; other posts and new-post sessions are left alone', async () => {
    stripeMocks.list.mockImplementation(() => asyncList([
      openSession('cs_earlier', { windowIndex: THIS_WINDOW - 2 }),
      openSession('cs_other_post', { jobId: 'job-2', windowIndex: THIS_WINDOW - 2 }),
      openSession('cs_new_post_checkout', { metadata: { jobId: 'job-1', pricing: 'pro' }, windowIndex: THIS_WINDOW - 2 }),
      // A renewal session minted before sessions carried expires_at: 24 hour default.
      openSession('cs_legacy', { windowIndex: THIS_WINDOW - 30, expiresAt: Math.floor(NOW_MS / 1000) + 20 * 3600 }),
    ]));

    const { res, json } = await post();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ sessionId: 'cs_new', url: 'https://checkout.stripe.test/cs_new' });
    expect(stripeMocks.expire.mock.calls.map(([id]) => id)).toEqual(['cs_earlier', 'cs_legacy']);
    const createdAt = stripeMocks.create.mock.invocationCallOrder[0];
    for (const order of stripeMocks.expire.mock.invocationCallOrder) expect(order).toBeLessThan(createdAt);
    // Open sessions only, bounded by Stripe's longest session lifetime.
    expect(stripeMocks.list).toHaveBeenCalledWith({
      status: 'open',
      created: { gte: Math.floor((NOW_MS - STRIPE_MAX_SESSION_LIFETIME_MS) / 1000) },
      limit: 100,
    });
  });

  it('a double click in one window sends identical create parameters and never expires the session it replays', async () => {
    const first = await post();
    // The second click finds the session the first one created, still open.
    stripeLists({ open: [openSession('cs_new')] });
    nowSpy.mockReturnValue(NOW_MS + 4 * 60 * 1000); // still the same window
    const second = await post();

    expect(first.json.url).toBe('https://checkout.stripe.test/cs_new');
    expect(second.json.url).toBe('https://checkout.stripe.test/cs_new');
    expect(stripeMocks.create).toHaveBeenCalledTimes(2);
    // Same key, same parameters: Stripe replays instead of refusing.
    expect(stripeMocks.create.mock.calls[1]).toEqual(stripeMocks.create.mock.calls[0]);
    expect(stripeMocks.expire).not.toHaveBeenCalled();
  });

  it('a later window gets a new key and a later expires_at, and the earlier session is closed first', async () => {
    await post();
    const [firstParams, firstOptions] = stripeMocks.create.mock.calls[0];

    nowSpy.mockReturnValue(NOW_MS + 12 * 60 * 1000); // the employer comes back 12 minutes later
    stripeMocks.list.mockImplementation(() => asyncList([openSession('cs_new')]));
    stripeMocks.create.mockResolvedValue({ id: 'cs_newer', url: 'https://checkout.stripe.test/cs_newer', created: Math.floor((NOW_MS + 12 * 60 * 1000) / 1000) });
    const { json } = await post();
    const [secondParams, secondOptions] = stripeMocks.create.mock.calls[1];

    expect(secondOptions.idempotencyKey).not.toBe(firstOptions.idempotencyKey);
    expect(secondParams.expires_at).toBeGreaterThan(firstParams.expires_at);
    expect(stripeMocks.expire).toHaveBeenCalledWith('cs_new');
    expect(stripeMocks.expire.mock.invocationCallOrder[0]).toBeLessThan(stripeMocks.create.mock.invocationCallOrder[1]);
    expect(json.url).toBe('https://checkout.stripe.test/cs_newer');
  });

  it("a session from this window under another key (GA ids changed between clicks) is expired after the create, before the URL leaves", async () => {
    stripeMocks.list.mockImplementation(() => asyncList([openSession('cs_same_window_other_key')]));

    const { res, json } = await post();

    expect(res.status).toBe(200);
    expect(json.url).toBe('https://checkout.stripe.test/cs_new');
    expect(stripeMocks.expire).toHaveBeenCalledTimes(1);
    expect(stripeMocks.expire).toHaveBeenCalledWith('cs_same_window_other_key');
    expect(stripeMocks.create.mock.invocationCallOrder[0]).toBeLessThan(stripeMocks.expire.mock.invocationCallOrder[0]);
  });

  it('an earlier session that expired on its own meanwhile does not block the new one', async () => {
    stripeMocks.list.mockImplementation(() => asyncList([openSession('cs_earlier', { windowIndex: THIS_WINDOW - 3 })]));
    stripeMocks.expire.mockRejectedValue(new Error('This Checkout Session is not open'));
    stripeMocks.retrieve.mockResolvedValue({ id: 'cs_earlier', status: 'expired' });

    const { res } = await post();

    expect(res.status).toBe(200);
    expect(stripeMocks.create).toHaveBeenCalledTimes(1);
  });
});

describe('a failure never leaves a second payable session (refuse, retryable)', () => {
  function expectRetryableRefusal(res: Response, json: { error: string; code: string; url?: string }, code: string) {
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(json.code).toBe(code);
    expect(json.url).toBeUndefined();
    expect(json.error).not.toMatch(VISIBLE_DASH);
    expect(res.headers.get('set-cookie')).toBeNull();
  }

  it('the open sessions cannot be listed: refused, nothing created', async () => {
    stripeMocks.list.mockImplementation((params: { status?: string }) => {
      if (params.status === 'open') throw new Error('stripe unavailable');
      return asyncList([]);
    });

    const { res, json } = await post();

    expectRetryableRefusal(res, json, 'RENEWAL_CHECK_UNAVAILABLE');
    expect(stripeMocks.create).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Could not list open renewal sessions'), expect.any(Error), { jobId: 'job-1' });
  });

  it('a list that fails part way (a later page) is refused the same way', async () => {
    stripeMocks.list.mockImplementation((params: { status?: string }) => (params.status !== 'open' ? asyncList([]) : {
      async *[Symbol.asyncIterator]() {
        yield openSession('cs_earlier', { windowIndex: THIS_WINDOW - 2 });
        throw new Error('page 2 failed');
      },
    }));

    const { res, json } = await post();

    expectRetryableRefusal(res, json, 'RENEWAL_CHECK_UNAVAILABLE');
    expect(stripeMocks.expire).not.toHaveBeenCalled();
    expect(stripeMocks.create).not.toHaveBeenCalled();
  });

  it.each(['open', 'complete'])('an earlier session cannot be expired (now %s): refused, nothing created', async (status) => {
    stripeMocks.list.mockImplementation(() => asyncList([openSession('cs_earlier', { windowIndex: THIS_WINDOW - 2 })]));
    stripeMocks.expire.mockRejectedValue(new Error('expire failed'));
    stripeMocks.retrieve.mockResolvedValue({ id: 'cs_earlier', status });

    const { res, json } = await post();

    expectRetryableRefusal(res, json, 'PREVIOUS_RENEWAL_CHECKOUT_OPEN');
    expect(stripeMocks.create).not.toHaveBeenCalled();
    // The employer is told not to pay twice if the earlier checkout just went through.
    expect(json.error).toMatch(/If you already paid/);
  });

  it("this window's other session cannot be expired: the new session's URL is withheld, and a retry recovers", async () => {
    stripeMocks.list.mockImplementation(() => asyncList([openSession('cs_same_window_other_key')]));
    stripeMocks.expire.mockRejectedValueOnce(new Error('expire failed'));
    stripeMocks.retrieve.mockResolvedValueOnce({ id: 'cs_same_window_other_key', status: 'open' });

    const refused = await post();

    expectRetryableRefusal(refused.res, refused.json, 'PREVIOUS_RENEWAL_CHECKOUT_OPEN');
    expect(stripeMocks.create).toHaveBeenCalledTimes(1);

    // The retry replays the new session (same key) and closes the other one this time.
    stripeMocks.list.mockImplementation(() => asyncList([openSession('cs_new'), openSession('cs_same_window_other_key')]));
    const retried = await post();

    expect(retried.res.status).toBe(200);
    expect(retried.json.url).toBe('https://checkout.stripe.test/cs_new');
    expect(stripeMocks.expire.mock.calls.map(([id]) => id)).toEqual(['cs_same_window_other_key', 'cs_same_window_other_key']);
  });
});

function expectInFlightRefusal(res: Response, json: { error: string; code: string; url?: string }) {
  expect(res.status).toBe(409);
  expect(json.code).toBe('RENEWAL_PAYMENT_PROCESSING');
  expect(json.url).toBeUndefined();
  expect(json.error).not.toMatch(VISIBLE_DASH);
  expect(res.headers.get('set-cookie')).toBeNull();
  expect(stripeMocks.create).not.toHaveBeenCalled();
  expect(stripeMocks.expire).not.toHaveBeenCalled();
  // The refusal comes before the open sessions are even listed.
  expect(stripeMocks.list).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
}

describe('a renewal payment already in flight for the post (409, nothing listed open, expired or created)', () => {
  it('a paid renewal the webhook has not applied yet (no ledger row) refuses a second one, even when it cannot be applied here', async () => {
    stripeLists({ complete: [completeSession('cs_paid_unapplied', { daysAgo: 0.01 })] });
    stripeMocks.retrieve.mockRejectedValue(new Error('stripe unavailable'));

    const { res, json } = await post();

    expectInFlightRefusal(res, json);
    expect(json.error).toMatch(/already received a renewal payment for this job/);
    expect(json.error).toMatch(/nothing more to pay/);
    // No promise of a minute: on this path only the daily sweep is left.
    expect(json.error).not.toMatch(/minute/);
    expect(json.error).toMatch(/within a day, please contact support/);
    expect(prisma.jobCharge.findMany).toHaveBeenCalledWith({
      where: { stripeSessionId: { in: ['cs_paid_unapplied'] } },
      select: { stripeSessionId: true },
    });
  });

  it('a paid renewal already on the ledger is history, not a payment in flight', async () => {
    stripeLists({ complete: [completeSession('cs_paid_applied')] });
    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([{ stripeSessionId: 'cs_paid_applied' }] as never);

    const { res, json } = await post();

    expect(res.status).toBe(200);
    expect(json.url).toBe('https://checkout.stripe.test/cs_new');
  });

  it.each([
    ['processing', /still processing/],
    ['requires_action', /waiting for you to verify your bank account/],
  ])('a completed renewal whose delayed payment is %s refuses a second one', async (intentStatus, message) => {
    // Six days on: past a day, so only a window wider than the session lifetime finds it.
    stripeLists({ complete: [completeSession('cs_ach', { paymentStatus: 'unpaid', daysAgo: 6 })] });
    intentIs(intentStatus);

    const { res, json } = await post();

    expectInFlightRefusal(res, json);
    expect(json.error).toMatch(message);
    expect(json.error).toMatch(/nothing more to pay now/);
    expect(json.error).toMatch(/If that payment fails, you can start a new renewal then/);
    expect(stripeMocks.retrieve).toHaveBeenCalledWith('cs_ach', { expand: ['payment_intent'] });
  });

  it('a completed session that has been paid since the listing is checked against the ledger like any paid one', async () => {
    stripeLists({ complete: [completeSession('cs_ach', { paymentStatus: 'unpaid' })] });
    stripeMocks.retrieve.mockResolvedValue({ ...completeSession('cs_ach'), payment_intent: { id: 'pi_cs_ach', status: 'succeeded' } });
    applyRenewalCheckout.mockRejectedValue(new Error('db down'));

    const { res, json } = await post();

    expectInFlightRefusal(res, json);
    expect(json.error).toMatch(/already received a renewal payment/);
    expect(prisma.jobCharge.findMany).toHaveBeenCalledWith({
      where: { stripeSessionId: { in: ['cs_ach'] } },
      select: { stripeSessionId: true },
    });
  });

  it('when several are in flight and none can be applied here, the money already taken decides the message', async () => {
    stripeLists({
      complete: [
        completeSession('cs_ach', { paymentStatus: 'unpaid', daysAgo: 3 }),
        completeSession('cs_paid_unapplied', { daysAgo: 0.01 }),
      ],
    });
    intentIs('processing');
    applyRenewalCheckout.mockRejectedValue(new Error('db down'));

    const { res, json } = await post();

    expectInFlightRefusal(res, json);
    expect(json.error).toMatch(/already received a renewal payment for this job/);
  });

  it.each(['requires_payment_method', 'canceled'])('a delayed payment that failed (intent %s) blocks nothing', async (intentStatus) => {
    stripeLists({ complete: [completeSession('cs_ach_failed', { paymentStatus: 'unpaid' })] });
    intentIs(intentStatus);

    const { res } = await post();

    expect(res.status).toBe(200);
    expect(stripeMocks.create).toHaveBeenCalledTimes(1);
  });

  it("another post's renewal and this post's new-post checkout are not this post's renewal payments", async () => {
    stripeLists({
      complete: [
        completeSession('cs_other_post', { jobId: 'job-2' }),
        completeSession('cs_new_post', { metadata: { jobId: 'job-1', pricing: 'pro' } }),
        completeSession('cs_other_post_ach', { jobId: 'job-2', paymentStatus: 'unpaid' }),
      ],
    });

    const { res } = await post();

    expect(res.status).toBe(200);
    expect(prisma.jobCharge.findMany).not.toHaveBeenCalled();
    expect(stripeMocks.retrieve).not.toHaveBeenCalled();
  });

  it('looks back far enough for a microdeposit verification, through the same capped scan', async () => {
    await post();

    const completeCall = stripeMocks.list.mock.calls.find(([params]) => params.status === 'complete');
    expect(completeCall).toBeDefined();
    const [params] = completeCall!;
    expect(params.limit).toBe(100);
    expect(params.created.gte).toBe(Math.floor((NOW_MS - RENEWAL_SETTLEMENT_LOOKBACK_MS) / 1000));
    // Stripe keeps a microdeposit verification open for up to 10 days, and a
    // session can complete up to its own lifetime after it was created.
    expect(params.created.gte).toBeLessThanOrEqual(Math.floor((NOW_MS - 10 * DAY_MS - STRIPE_MAX_SESSION_LIFETIME_MS) / 1000));
  });

  it.each([
    ['the completed sessions cannot be listed', () => {
      stripeMocks.list.mockImplementation((params: { status?: string }) => {
        if (params.status === 'complete') throw new Error('stripe down');
        return asyncList([]);
      });
    }],
    ['a completed session cannot be read back with its payment', () => {
      stripeLists({ complete: [completeSession('cs_ach', { paymentStatus: 'unpaid' })] });
      stripeMocks.retrieve.mockRejectedValue(new Error('stripe down'));
    }],
    ['the ledger cannot be read', () => {
      stripeLists({ complete: [completeSession('cs_paid')] });
      vi.mocked(prisma.jobCharge.findMany).mockRejectedValue(new Error('db down'));
    }],
  ])('%s: refused with the retryable 503, nothing created', async (_label, arrange) => {
    arrange();

    const { res, json } = await post();

    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(json.code).toBe('RENEWAL_CHECK_UNAVAILABLE');
    expect(json.error).not.toMatch(VISIBLE_DASH);
    expect(stripeMocks.create).not.toHaveBeenCalled();
    expect(stripeMocks.expire).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not check for a renewal payment in flight'),
      expect.any(Error),
      { jobId: 'job-1' },
    );
  });
});

describe('a paid renewal nobody applied is applied right here (409, nothing more to pay)', () => {
  /** The paid session as Stripe returns it when the route reads it back to apply it. */
  function paidSessionReadsBack(id: string) {
    stripeLists({ complete: [completeSession(id, { daysAgo: 0.01 })] });
    stripeMocks.retrieve.mockImplementation(async (sessionId: string) => completeSession(sessionId, { daysAgo: 0.01 }));
  }

  function expectAppliedAnswer(res: Response, json: { error: string; code: string; url?: string }) {
    expect(res.status).toBe(409);
    expect(json.code).toBe('RENEWAL_ALREADY_PAID');
    expect(json.url).toBeUndefined();
    expect(json.error).toMatch(/have now applied it/);
    expect(json.error).toMatch(/nothing more to pay/);
    expect(json.error).toMatch(/Refresh your dashboard/);
    expect(json.error).not.toMatch(VISIBLE_DASH);
    expect(res.headers.get('set-cookie')).toBeNull();
    // They have paid: no checkout is opened, closed or even looked for.
    expect(stripeMocks.create).not.toHaveBeenCalled();
    expect(stripeMocks.expire).not.toHaveBeenCalled();
    expect(stripeMocks.list).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
  }

  it('runs the shared fulfilment on the session read back from Stripe, and says it has been applied', async () => {
    paidSessionReadsBack('cs_paid_unapplied');

    const { res, json } = await post();

    expectAppliedAnswer(res, json);
    expect(stripeMocks.retrieve).toHaveBeenCalledWith('cs_paid_unapplied');
    expect(applyRenewalCheckout).toHaveBeenCalledTimes(1);
    expect(applyRenewalCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ checkout: expect.anything() }),
      expect.objectContaining({ id: 'cs_paid_unapplied', payment_status: 'paid', metadata: expect.objectContaining({ jobId: 'job-1', type: 'renewal' }) }),
    );
  });

  it('a webhook that landed first is the same answer: the renewal is on the books', async () => {
    paidSessionReadsBack('cs_paid_unapplied');
    applyRenewalCheckout.mockResolvedValue({ outcome: 'already_applied', jobId: 'job-1' });

    const { res, json } = await post();

    expectAppliedAnswer(res, json);
  });

  it('applies every paid session it found, and says applied only when all of them are', async () => {
    stripeLists({ complete: [completeSession('cs_paid_a', { daysAgo: 0.01 }), completeSession('cs_paid_b', { daysAgo: 0.02 })] });
    stripeMocks.retrieve.mockImplementation(async (sessionId: string) => completeSession(sessionId));
    applyRenewalCheckout
      .mockResolvedValueOnce({ outcome: 'applied', jobId: 'job-1' })
      .mockRejectedValueOnce(new Error('db down'));

    const { res, json } = await post();

    expect(applyRenewalCheckout).toHaveBeenCalledTimes(2);
    expectInFlightRefusal(res, json);
    expect(json.error).toMatch(/already received a renewal payment for this job/);
  });

  it.each(['revoked_posting', 'cap_reached', 'employer_job_missing'])(
    "a fulfilment that answers '%s' applied nothing: the employer is not told it was applied, and the outcome is logged",
    async (outcome) => {
      paidSessionReadsBack('cs_paid_unapplied');
      applyRenewalCheckout.mockResolvedValue({ outcome, jobId: 'job-1' });

      const { res, json } = await post();

      expectInFlightRefusal(res, json);
      expect(json.error).not.toMatch(/have now applied it/);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('was not applied'),
        null,
        expect.objectContaining({ jobId: 'job-1', sessionId: 'cs_paid_unapplied', outcome }),
      );
    },
  );

  it('a session that no longer reads as a paid renewal of this post is never handed to the fulfilment', async () => {
    stripeLists({ complete: [completeSession('cs_paid_unapplied', { daysAgo: 0.01 })] });
    stripeMocks.retrieve.mockResolvedValue(completeSession('cs_paid_unapplied', { jobId: 'job-2' }));

    const { res, json } = await post();

    expect(applyRenewalCheckout).not.toHaveBeenCalled();
    expectInFlightRefusal(res, json);
  });

  it('a delayed payment still settling is not applied: there is no money yet', async () => {
    stripeLists({ complete: [completeSession('cs_ach', { paymentStatus: 'unpaid', daysAgo: 2 })] });
    intentIs('processing');

    const { res, json } = await post();

    expect(applyRenewalCheckout).not.toHaveBeenCalled();
    expectInFlightRefusal(res, json);
    expect(json.error).toMatch(/still processing/);
  });
});

describe('expires_at', () => {
  it.each([
    ['at the start of a window', WINDOW_START_MS],
    ['in the last second of a window', WINDOW_START_MS + RENEWAL_IDEMPOTENCY_WINDOW_MS - 1_000],
  ])('a request %s gets a session Stripe accepts that closes before the cookie the response sets', async (_label, requestMs) => {
    nowSpy.mockReturnValue(requestMs);

    const { res } = await post();

    const leadMs = stripeMocks.create.mock.calls[0][0].expires_at * 1000 - requestMs;
    expect(leadMs).toBeGreaterThanOrEqual(STRIPE_MIN_LEAD_MS);
    expect(leadMs).toBeLessThanOrEqual(RENEWAL_SESSION_COOKIE_MAX_AGE_S * 1000 + RENEWAL_IDEMPOTENCY_WINDOW_MS);
    expect(leadMs).toBeLessThan(RENEWAL_SESSION_COOKIE_MAX_AGE_S * 1000);
    expect(res.headers.get('set-cookie')).toContain(`Max-Age=${RENEWAL_SESSION_COOKIE_MAX_AGE_S}`);
  });
});
