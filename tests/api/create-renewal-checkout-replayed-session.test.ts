/**
 * POST /api/create-renewal-checkout — the checkout it hands out can be paid.
 *
 * Stripe answers a reused idempotency key with its cached first response:
 * the session as it was when it was created ('open', with its URL), whatever
 * happened to it since. This route itself expires sessions, so a replay can
 * be a dead checkout. The bug: two browsers with different GA state (so two
 * keys) renew one post inside one ten minute window. A gets S_A. B's request
 * mints S_B and expires S_A. A's Stripe page says expired, so A clicks Renew
 * again: A's key replays the cached S_A, the route expires S_B as "this
 * window's other session" and returns S_A's dead URL. Both checkouts are
 * dead, and every retry replays a dead one until the window rolls over.
 *
 * Pins, against a Stripe double that replays idempotency keys the way Stripe
 * does:
 *   - A, B, A: A's retry is handed a live session, minted under a key derived
 *     from the dead one, and only then is B's session closed. One payable
 *     session remains, and it is the one whose URL was returned;
 *   - every later click from the same browser replays that replacement; it
 *     walks on when the replacement was closed in turn;
 *   - a replayed session that was completed (a payment went through, or is
 *     settling) is refused, and nothing else is closed;
 *   - a replayed session whose state cannot be read is refused the same way;
 *   - a browser that keeps being handed dead sessions is refused after a
 *     bounded number of replacements;
 *   - a session minted by this very request is not read back (no extra call).
 *
 * And the key itself: it carries a fingerprint of the create parameters, so
 * a parameter that changes inside a window (the title is edited between two
 * clicks) gets a key of its own instead of an idempotency error from Stripe.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ANALYTICS_ONLY, CONSENT_COOKIE, serializeConsent } from '@/lib/consent';

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

const WINDOW_START_MS = 1_790_000_400_000; // a multiple of the 10 minute window
const DAY_MS = 24 * 60 * 60 * 1000;
const VISIBLE_DASH = /[–—]|\s-\s/;

/** Browser A never accepted analytics cookies; browser B did. Same post, same window, two keys. */
const BROWSER_A = '';
const BROWSER_B = `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(ANALYTICS_ONLY))}; _ga=GA1.1.1234567890.1699999999; _ga_TESTSTREAM=GS2.1.s1748000000$o12$g1$t1748000100`;

interface FakeSession {
  id: string;
  status: 'open' | 'expired' | 'complete';
  payment_status: 'unpaid' | 'paid';
  created: number;
  expires_at: number;
  url: string;
  metadata: Record<string, string>;
}

function asyncList<T>(items: T[]) {
  return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

/**
 * Checkout Sessions as Stripe keeps them. `create` under a key it has seen
 * answers with the response it cached the first time, never with the
 * session's current state.
 */
function fakeStripe() {
  const sessions = new Map<string, FakeSession>();
  const firstResponseByKey = new Map<string, FakeSession>();
  stripeMocks.create.mockImplementation(async (params: { expires_at: number; metadata: Record<string, string> }, options: { idempotencyKey: string }) => {
    const cached = firstResponseByKey.get(options.idempotencyKey);
    if (cached) return { ...cached };
    const id = `cs_${sessions.size + 1}`;
    const minted: FakeSession = {
      id,
      status: 'open',
      payment_status: 'unpaid',
      created: Math.floor(Date.now() / 1000),
      expires_at: params.expires_at,
      url: `https://checkout.stripe.test/${id}`,
      metadata: params.metadata,
    };
    sessions.set(id, minted);
    firstResponseByKey.set(options.idempotencyKey, { ...minted });
    return { ...minted };
  });
  stripeMocks.list.mockImplementation((params: { status?: string }) =>
    asyncList([...sessions.values()].filter((s) => !params.status || s.status === params.status).map((s) => ({ ...s }))));
  stripeMocks.expire.mockImplementation(async (id: string) => {
    const current = sessions.get(id);
    if (!current || current.status !== 'open') throw new Error('This Checkout Session is not open');
    sessions.set(id, { ...current, status: 'expired' });
    return { id, status: 'expired' };
  });
  stripeMocks.retrieve.mockImplementation(async (id: string) => {
    const current = sessions.get(id);
    if (!current) throw new Error(`No such checkout.session: ${id}`);
    return { ...current };
  });
  return {
    statusOf: (id: string) => sessions.get(id)?.status,
    openIds: () => [...sessions.values()].filter((s) => s.status === 'open').map((s) => s.id),
    complete: (id: string) => sessions.set(id, { ...sessions.get(id)!, status: 'complete' }),
    keyOf: (id: string) => [...firstResponseByKey.entries()].find(([, s]) => s.id === id)?.[0],
  };
}

/** The post as the route loads it; `changed` is what the employer edited since the last click. */
function employerJobRow(changed: { title?: string; employer?: string; contactEmail?: string } = {}) {
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    id: 'ej-1',
    jobId: 'job-1',
    editToken: 'edit-1',
    contactEmail: changed.contactEmail ?? 'owner@clinic.example',
    paymentStatus: 'paid',
    pricingTier: 'pro',
    job: {
      id: 'job-1',
      title: changed.title ?? 'Nurse Practitioner',
      employer: changed.employer ?? 'Clinic Co',
      location: 'Remote',
      expiresAt: null,
      createdAt: new Date(WINDOW_START_MS - 30 * DAY_MS),
      archivedAt: null,
    },
  } as never);
}

async function post(cookie: string) {
  const { POST } = await import('@/app/api/create-renewal-checkout/route');
  const res = await POST(new NextRequest('https://test.local/api/create-renewal-checkout', {
    method: 'POST',
    body: JSON.stringify({ jobId: 'job-1', editToken: 'edit-1' }),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  }));
  return { res, json: await res.json() };
}

let nowMs = WINDOW_START_MS;
let nowSpy: ReturnType<typeof vi.spyOn>;
let logSpies: Array<{ mockRestore: () => void }> = [];
let stripe: ReturnType<typeof fakeStripe>;

/** Time passes between clicks, inside the same ten minute window. */
function later(seconds: number) {
  nowMs += seconds * 1000;
}

// Load the route graph once, outside any single test's time budget (a cold
// import under a loaded full suite run can outlast vitest's 5 second default).
beforeAll(async () => {
  await import('@/app/api/create-renewal-checkout/route');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GA_MEASUREMENT_ID', 'G-TESTSTREAM');
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  nowMs = WINDOW_START_MS + 60_000;
  nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
  logSpies = [
    vi.spyOn(logger, 'error').mockImplementation(() => undefined),
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
    vi.spyOn(logger, 'info').mockImplementation(() => undefined),
  ];
  employerJobRow();
  vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
  stripe = fakeStripe();
});

afterEach(() => {
  vi.unstubAllEnvs();
  nowSpy.mockRestore();
  for (const spy of logSpies) spy.mockRestore();
});

describe('a reused idempotency key can replay a session this route already expired', () => {
  it('A, B, A: the retry gets a live checkout, and one payable session remains', async () => {
    const a1 = await post(BROWSER_A);
    later(30);
    const b1 = await post(BROWSER_B);
    // B's session replaced A's: one payable renewal per post.
    expect(stripe.statusOf(a1.json.sessionId)).toBe('expired');
    expect(stripe.openIds()).toEqual([b1.json.sessionId]);

    later(30);
    const a2 = await post(BROWSER_A);

    expect(a2.res.status).toBe(200);
    // Not the dead session Stripe replayed for A's key...
    expect(a2.json.sessionId).not.toBe(a1.json.sessionId);
    expect(a2.json.url).not.toBe(a1.json.url);
    // ...but one that can be paid, and the only one that can.
    expect(stripe.statusOf(a2.json.sessionId)).toBe('open');
    expect(a2.json.url).toBe(`https://checkout.stripe.test/${a2.json.sessionId}`);
    expect(stripe.openIds()).toEqual([a2.json.sessionId]);
    expect(a2.res.headers.get('set-cookie')).toContain(`_renewal_session=${a2.json.sessionId}`);
    // The replacement was minted under a key derived from A's own, so a
    // double click replays it; and under the same parameters.
    const firstKey = stripe.keyOf(a1.json.sessionId)!;
    expect(stripe.keyOf(a2.json.sessionId)).toMatch(new RegExp(`^${firstKey}-after-[0-9a-f]{12}$`));
    const [replayParams, replacementParams] = stripeMocks.create.mock.calls.slice(-2).map(([params]) => params);
    expect(replacementParams).toEqual(replayParams);
  });

  it('closes the other session only once a live one is in hand', async () => {
    await post(BROWSER_A);
    later(30);
    const b1 = await post(BROWSER_B);
    stripeMocks.create.mockClear();
    stripeMocks.expire.mockClear();
    stripeMocks.retrieve.mockClear();

    later(30);
    const a2 = await post(BROWSER_A);

    expect(stripeMocks.create).toHaveBeenCalledTimes(2); // the replay, then the replacement
    expect(stripeMocks.expire.mock.calls.map(([id]) => id)).toEqual([b1.json.sessionId]);
    expect(stripeMocks.create.mock.invocationCallOrder[1]).toBeLessThan(stripeMocks.expire.mock.invocationCallOrder[0]);
    expect(stripe.statusOf(a2.json.sessionId)).toBe('open');
  });

  it("a second retry from the same browser replays the replacement: one session, not a new one per click", async () => {
    await post(BROWSER_A);
    later(30);
    await post(BROWSER_B);
    later(30);
    const a2 = await post(BROWSER_A);
    later(5);
    const a3 = await post(BROWSER_A);

    expect(a3.res.status).toBe(200);
    expect(a3.json.sessionId).toBe(a2.json.sessionId);
    expect(stripe.openIds()).toEqual([a2.json.sessionId]);
  });

  it('walks on when the replacement was closed in turn: each click still ends on a live session', async () => {
    await post(BROWSER_A);
    later(20);
    await post(BROWSER_B);
    later(20);
    await post(BROWSER_A);
    later(20);
    const b2 = await post(BROWSER_B);
    later(20);
    const a3 = await post(BROWSER_A);

    expect(b2.res.status).toBe(200);
    expect(a3.res.status).toBe(200);
    expect(stripe.statusOf(b2.json.sessionId)).toBe('expired');
    expect(stripe.statusOf(a3.json.sessionId)).toBe('open');
    expect(stripe.openIds()).toEqual([a3.json.sessionId]);
  });

  it('a replayed session that was completed is refused: a payment went through on it, and nothing else is closed', async () => {
    const a1 = await post(BROWSER_A);
    later(30);
    const b1 = await post(BROWSER_B);
    // A's session shows as completed although it was closed for B's (a
    // payment landed as it was being expired).
    stripe.complete(a1.json.sessionId);
    stripeMocks.expire.mockClear();

    later(30);
    const a2 = await post(BROWSER_A);

    expect(a2.res.status).toBe(503);
    expect(a2.res.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(a2.json.code).toBe('PREVIOUS_RENEWAL_CHECKOUT_OPEN');
    expect(a2.json.url).toBeUndefined();
    expect(a2.json.error).toMatch(/If you already paid/);
    expect(a2.json.error).not.toMatch(VISIBLE_DASH);
    expect(a2.res.headers.get('set-cookie')).toBeNull();
    expect(stripeMocks.expire).not.toHaveBeenCalled();
    expect(stripe.statusOf(b1.json.sessionId)).toBe('open');
  });

  it('a replayed session that cannot be read back is refused, and the live session is left alone', async () => {
    await post(BROWSER_A);
    later(30);
    const b1 = await post(BROWSER_B);
    stripeMocks.retrieve.mockRejectedValue(new Error('stripe unavailable'));
    stripeMocks.expire.mockClear();

    later(30);
    const a2 = await post(BROWSER_A);

    expect(a2.res.status).toBe(503);
    expect(a2.json.code).toBe('RENEWAL_CHECK_UNAVAILABLE');
    expect(a2.json.url).toBeUndefined();
    expect(a2.json.error).not.toMatch(VISIBLE_DASH);
    expect(stripeMocks.expire).not.toHaveBeenCalled();
    expect(stripe.statusOf(b1.json.sessionId)).toBe('open');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not read back a replayed renewal session'),
      expect.any(Error),
      expect.objectContaining({ jobId: 'job-1' }),
    );
  });

  it('gives up after a bounded number of replacements instead of walking forever', async () => {
    // Every session Stripe hands back, new or replayed, reads as expired.
    stripeMocks.create.mockImplementation(async (_params: unknown, options: { idempotencyKey: string }) => ({
      id: `cs_dead_${options.idempotencyKey.length}_${stripeMocks.create.mock.calls.length}`,
      status: 'open',
      url: 'https://checkout.stripe.test/dead',
      created: Math.floor(nowMs / 1000) - 120,
    }));
    stripeMocks.retrieve.mockResolvedValue({ status: 'expired' });

    const { res, json } = await post(BROWSER_A);

    expect(res.status).toBe(503);
    expect(json.code).toBe('RENEWAL_CHECK_UNAVAILABLE');
    expect(json.url).toBeUndefined();
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(stripeMocks.create.mock.calls.length).toBeLessThanOrEqual(6);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('kept replaying expired renewal sessions'),
      null,
      expect.objectContaining({ jobId: 'job-1' }),
    );
  });

  it('does not read back a session this request minted, or one the open listing just showed', async () => {
    await post(BROWSER_A);
    later(5);
    await post(BROWSER_A); // a double click: the replay is in the open listing

    expect(stripeMocks.retrieve).not.toHaveBeenCalled();
    expect(stripe.openIds()).toHaveLength(1);
  });

  it('reads back a session whose creation stamp is missing rather than trusting it', async () => {
    stripeMocks.create.mockResolvedValue({ id: 'cs_unstamped', status: 'open', url: 'https://checkout.stripe.test/cs_unstamped' });
    stripeMocks.retrieve.mockResolvedValue({ id: 'cs_unstamped', status: 'open' });

    const { res, json } = await post(BROWSER_A);

    expect(res.status).toBe(200);
    expect(json.sessionId).toBe('cs_unstamped');
    expect(stripeMocks.retrieve).toHaveBeenCalledWith('cs_unstamped');
  });
});

describe('the idempotency key carries a fingerprint of the create parameters', () => {
  const keyOfCall = (index: number) => (stripeMocks.create.mock.calls[index][1] as { idempotencyKey: string }).idempotencyKey;

  it('same parameters, same key: a double click is one session', async () => {
    await post(BROWSER_A);
    later(5);
    await post(BROWSER_A);

    expect(keyOfCall(0)).toMatch(/^renewal-v2-ej-1-none-\d+-[0-9a-f]{12}$/);
    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it('a title edited between two clicks gets its own key and session, and the earlier one is closed', async () => {
    const first = await post(BROWSER_A);
    later(60);
    employerJobRow({ title: 'Nurse Practitioner, Telehealth' });
    const second = await post(BROWSER_A);

    // Under the old key Stripe would have refused the changed parameters,
    // and the route would have answered 500 for the rest of the window.
    expect(second.res.status).toBe(200);
    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
    expect(second.json.sessionId).not.toBe(first.json.sessionId);
    expect(stripe.openIds()).toEqual([second.json.sessionId]);
  });

  it.each([
    ['the employer name', { employer: 'Clinic Group' }],
    ['the contact email', { contactEmail: 'billing@clinic.example' }],
  ])('%s is part of the fingerprint too', async (_label, changed) => {
    await post(BROWSER_A);
    later(60);
    employerJobRow(changed);
    const second = await post(BROWSER_A);

    expect(second.res.status).toBe(200);
    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
  });

  it('the GA ids still ride on the end of the key, readable', async () => {
    await post(BROWSER_A);
    later(5);
    await post(BROWSER_B);

    expect(keyOfCall(1)).toBe(`${keyOfCall(0)}-ga-1234567890.1699999999-1748000000`);
  });
});
