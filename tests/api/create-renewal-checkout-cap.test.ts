/**
 * POST /api/create-renewal-checkout — the renewal cap, and what Checkout and
 * the invoice say.
 *
 * The cap. A renewal adds config.durationDays to the later of now and the
 * current expiry, never past config.renewalCapDays after the post was
 * created. The route used to sell a renewal without looking at that cap (it
 * did not even load createdAt): a post created 400 days ago was sold a
 * renewal whose webhook wrote an expiry 35 days in the past, and a post that
 * already ran to its cap was sold one that moved nothing. Pins:
 *   - a post that runs to its cap, one older than its cap, and one with less
 *     than a full day left are refused with 409 RENEWAL_CAP_REACHED before
 *     any Stripe call, in the words the other surfaces use for the cap;
 *   - a status that can never renew, and an archived post, keep their own
 *     message;
 *   - a post near its cap is still sold a renewal, and Checkout states the
 *     days it really adds instead of the full period.
 *
 * The copy (house style): the line item and the invoice description carry
 * no em dash, en dash or spaced hyphen.
 *
 * tests/api/apply-renewal-cap.test.ts pins the fulfilment side, for a cap
 * reached after the checkout opened.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOW_MS = 1_790_000_400_000 + 3 * 60 * 1000;
const fromNow = (days: number) => new Date(NOW_MS + days * DAY_MS);
const VISIBLE_DASH = /[–—]|\s-\s/;
const CAP_LINE = `Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted`;

interface PostFixture {
  createdAt: Date;
  expiresAt: Date | null;
  paymentStatus?: string;
  archivedAt?: Date | null;
}

function post({ createdAt, expiresAt, paymentStatus = 'paid', archivedAt = null }: PostFixture) {
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    id: 'ej-1',
    jobId: 'job-1',
    editToken: 'edit-1',
    contactEmail: 'owner@clinic.example',
    paymentStatus,
    pricingTier: 'pro',
    job: { id: 'job-1', title: 'Nurse Practitioner', employer: 'Clinic Co', location: 'Remote', expiresAt, createdAt, archivedAt },
  } as never);
}

/** A post created `createdDaysAgo` days ago that expires in `expiresInDays` days (negative: already expired). */
const postAged = (createdDaysAgo: number, expiresInDays: number, rest: Partial<PostFixture> = {}) =>
  post({ createdAt: fromNow(-createdDaysAgo), expiresAt: fromNow(expiresInDays), ...rest });

function asyncList<T>(items: T[]) {
  return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

async function renew() {
  const { POST } = await import('@/app/api/create-renewal-checkout/route');
  const res = await POST(new NextRequest('https://test.local/api/create-renewal-checkout', {
    method: 'POST',
    body: JSON.stringify({ jobId: 'job-1', editToken: 'edit-1' }),
    headers: { 'content-type': 'application/json' },
  }));
  return { res, json: await res.json() };
}

function expectNoStripeCall() {
  expect(stripeMocks.list).not.toHaveBeenCalled();
  expect(stripeMocks.expire).not.toHaveBeenCalled();
  expect(stripeMocks.create).not.toHaveBeenCalled();
}

const lineItem = () => stripeMocks.create.mock.calls[0][0].line_items[0].price_data;

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
  stripeMocks.list.mockImplementation(() => asyncList([]));
  stripeMocks.create.mockResolvedValue({ id: 'cs_new', url: 'https://checkout.stripe.test/cs_new', created: Math.floor(NOW_MS / 1000) });
  vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
});

afterEach(() => {
  nowSpy.mockRestore();
  for (const spy of logSpies) spy.mockRestore();
});

describe('a renewal that would add no full day is not sold (409, no Stripe call)', () => {
  function expectCapRefusal(res: Response, json: { error: string; code: string; url?: string }) {
    expect(res.status).toBe(409);
    expect(json.code).toBe('RENEWAL_CAP_REACHED');
    expect(json.url).toBeUndefined();
    // The cap in the words every other surface uses for it, then what to do instead.
    expect(json.error).toContain(CAP_LINE);
    expect(json.error).toMatch(/this post has reached that limit/);
    expect(json.error).toMatch(/post it again as a new listing/);
    expect(json.error).not.toMatch(VISIBLE_DASH);
    expect(res.headers.get('set-cookie')).toBeNull();
    expectNoStripeCall();
  }

  it('a live post that already runs to its cap: the expiry would not move', async () => {
    postAged(config.renewalCapDays - 15, 15);
    const { res, json } = await renew();
    expectCapRefusal(res, json);
  });

  it('an expired post older than its cap: the capped expiry is already in the past', async () => {
    postAged(config.renewalCapDays + 35, -340);
    const { res, json } = await renew();
    expectCapRefusal(res, json);
  });

  it('a post with less than one full day before its cap', async () => {
    post({ createdAt: new Date(NOW_MS - config.renewalCapDays * DAY_MS + 5 * HOUR_MS), expiresAt: fromNow(-200) });
    const { res, json } = await renew();
    expectCapRefusal(res, json);
  });

  it('loads createdAt with the post, so the cap is computed from the stored value', async () => {
    postAged(30, 3);
    const { res } = await renew();
    expect(res.status).toBe(200);
    expect(prisma.employerJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: { job: { select: expect.objectContaining({ createdAt: true, expiresAt: true }) } },
    }));
  });

  it('a status that can never renew keeps its own message at the cap', async () => {
    postAged(config.renewalCapDays + 35, -340, { paymentStatus: 'refunded' });
    const { res, json } = await renew();
    expect(res.status).toBe(409);
    expect(json.error).toMatch(/refunded/i);
    expect(json.code).toBeUndefined();
  });

  it('an archived post at its cap is told to restore it first, as before', async () => {
    postAged(config.renewalCapDays - 15, 15, { archivedAt: fromNow(-1) });
    const { res, json } = await renew();
    expect(res.status).toBe(409);
    expect(json.archived).toBe(true);
    expect(json.code).toBeUndefined();
  });
});

describe('near the cap a renewal is sold for the days it really adds', () => {
  it('an expired post with 15 days to its cap: Checkout says 15 more days, at the renewal price', async () => {
    postAged(config.renewalCapDays - 15, -5);

    const { res, json } = await renew();

    expect(res.status).toBe(200);
    expect(json.url).toBe('https://checkout.stripe.test/cs_new');
    expect(lineItem().product_data.description).toBe('Clinic Co, 15 more days');
    expect(lineItem().product_data.description).not.toContain(`${config.durationDays} more days`);
    expect(lineItem().unit_amount).toBe(config.stripeRenewalPriceInCents);
  });

  it('exactly one day left reads as one day', async () => {
    postAged(config.renewalCapDays - 1, -200);
    const { res } = await renew();
    expect(res.status).toBe(200);
    expect(lineItem().product_data.description).toBe('Clinic Co, 1 more day');
  });

  it.each([
    ['an expired post well inside its cap', 100, -40],
    ['a live post about to expire', 57, 3],
  ])('%s gets the full period', async (_label, createdDaysAgo, expiresInDays) => {
    postAged(createdDaysAgo, expiresInDays);
    const { res } = await renew();
    expect(res.status).toBe(200);
    expect(lineItem().product_data.description).toBe(`Clinic Co, ${config.durationDays} more days`);
  });
});

describe('what Checkout and the invoice say (house style)', () => {
  it('the line item and the invoice description carry no dash', async () => {
    postAged(57, 3);

    await renew();

    const params = stripeMocks.create.mock.calls[0][0];
    const visible = [
      params.line_items[0].price_data.product_data.name,
      params.line_items[0].price_data.product_data.description,
      params.invoice_creation.invoice_data.description,
    ];
    expect(visible).toEqual([
      'Job renewal: Nurse Practitioner',
      `Clinic Co, ${config.durationDays} more days`,
      'Job renewal: Nurse Practitioner, Clinic Co',
    ]);
    for (const text of visible) expect(text).not.toMatch(VISIBLE_DASH);
  });
});
