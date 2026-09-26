/**
 * GA4 attribution for the server side purchase event, end to end.
 *
 * The purchase event is sent by the Stripe webhook, which has no visitor
 * request, so before this wiring every purchase reached GA4 on a job UUID:
 * a brand new user in a brand new direct session, detached from the
 * begin_checkout the same person fired minutes earlier. The fix travels in
 * three steps, and each one is pinned here:
 *
 *   CAPTURE   /api/create-checkout (new post and resume) and
 *             /api/create-renewal-checkout read the `_ga` / `_ga_<stream>`
 *             cookies into the checkout session metadata, and ONLY when the
 *             HttpOnly consent cookie grants analytics and no browser privacy
 *             signal is present. A GA cookie outlives a withdrawn consent, so
 *             its presence proves nothing. Nothing else about the session
 *             changes; the idempotency key only gains the ids where Stripe
 *             would otherwise refuse a replay with different metadata.
 *   HAND-OFF  both trackServerPurchase call sites (activate-paid-job.ts,
 *             apply-renewal.ts) pass the stored ids through untouched;
 *             lib/analytics-server.ts stays the single validator.
 *   DELIVERY  inside a request scope the POST is handed to next/server
 *             after() so the response is not held for it; outside one it is
 *             awaited, because nothing else would keep the process alive.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type Stripe from 'stripe';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';
import { ALL_DENIED, ANALYTICS_ONLY, CONSENT_COOKIE, serializeConsent } from '@/lib/consent';
import { gaCheckoutMetadata, idempotencyKeyWithGaIds } from '@/lib/analytics-server';

const hoisted = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  sessionsRetrieve: vi.fn(),
  sessionsExpire: vi.fn(),
  invoicesRetrieve: vi.fn(),
  after: vi.fn(),
  trackServerPurchase: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: function StripeMock() {
    return {
      checkout: {
        sessions: {
          create: hoisted.sessionsCreate,
          retrieve: hoisted.sessionsRetrieve,
          expire: hoisted.sessionsExpire,
        },
      },
      invoices: { retrieve: hoisted.invoicesRetrieve },
      webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    };
  },
}));

// Only after() is replaced, so a test can play both a request scope (after
// accepts the promise) and no request scope (after throws, as Next does).
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: hoisted.after,
}));

// The capture helpers stay real; only the sender is observed.
vi.mock('@/lib/analytics-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics-server')>()),
  trackServerPurchase: hoisted.trackServerPurchase,
}));

vi.mock('@/lib/env', () => ({
  isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting'),
  getPaidPostingStatus: vi.fn(() => ({ enabled: true, stripeConfigured: true, available: true })),
  getEnv: vi.fn(() => ({})),
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 }, employer: { limit: 100, windowMs: 60_000 } },
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeJobPosting: vi.fn().mockImplementation((d: Record<string, unknown>) => d),
  sanitizeUrl: vi.fn().mockImplementation((u: string) => u),
  sanitizeEmail: vi.fn().mockImplementation((e: string) => e),
  sanitizeText: vi.fn().mockImplementation((t: string) => t),
  normalizeContentWhitespace: vi.fn().mockImplementation((s: string) => s),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: hoisted.getUser } })),
}));

vi.mock('@/lib/email-service', () => ({
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendRenewalConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendRefundConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
  sendPlanActivatedEmail: vi.fn().mockResolvedValue({ success: true }),
  sendPlanPausedEmail: vi.fn().mockResolvedValue({ success: true }),
  sendPlanPaymentFailedEmail: vi.fn().mockResolvedValue({ success: true }),
  sendPlanLinkPendingEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

const ROOT = process.cwd();
const MEASUREMENT_ID = 'G-TESTSTREAM';
const GA_CLIENT_ID = '1234567890.1699999999';
const GA_SESSION_ID = '1748000000';
const GA_IDS = { gaClientId: GA_CLIENT_ID, gaSessionId: GA_SESSION_ID };
const GA_COOKIES = `_ga=GA1.1.${GA_CLIENT_ID}; _ga_TESTSTREAM=GS2.1.s${GA_SESSION_ID}$o12$g1$t1748000100`;
const consentCookie = (categories: { analytics: boolean; marketing: boolean }) =>
  `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(categories))}`;
const CONSENTED = `${consentCookie(ANALYTICS_ONLY)}; ${GA_COOKIES}`;

const SENT = { status: 'sent', attributionSource: 'ga_cookie', clientIdSource: 'ga_cookie', sessionIdSource: 'ga_cookie' } as const;

const POST_BODY = {
  title: 'Nurse Practitioner, Telehealth',
  companyName: 'Clinic Co',
  contactEmail: 'hiring@clinic.example',
  location: 'Remote',
  mode: 'Remote',
  jobType: 'Full-Time',
  description: '<p>' + 'x'.repeat(220) + '</p>',
  applyUrl: 'https://clinic.example/apply',
};

function request(url: string, body: object, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 'returned' when `work` settles within a short real-time window, else 'blocked'. */
async function settlesPromptly(work: Promise<unknown>): Promise<'returned' | 'blocked'> {
  const blocked = new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 40));
  return Promise.race([work.then(() => 'returned' as const), blocked]);
}

function paidSession(metadata: Record<string, string>): Stripe.Checkout.Session {
  return {
    id: 'cs_paid_1',
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 29900,
    currency: 'usd',
    invoice: null,
    metadata,
  } as unknown as Stripe.Checkout.Session;
}

const stripeClient = { invoices: { retrieve: hoisted.invoicesRetrieve } } as unknown as Stripe;

let loggerSpies: Array<{ mockRestore: () => void }> = [];

function mockNewPostActivation(): void {
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    id: 'ej-1', contactEmail: 'owner@clinic.example', dashboardToken: 'dash-1', quotaDomain: null,
  } as never);
  vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);
  vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1', title: 'T', slug: null } as never);
  vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
  vi.mocked(prisma.jobDraft.deleteMany).mockResolvedValue({ count: 0 } as never);
}

function mockRenewalFulfilment(): void {
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    id: 'ej-1', paymentStatus: 'paid', contactEmail: 'owner@clinic.example', dashboardToken: 'dash-1',
  } as never);
  vi.mocked(prisma.job.findUnique).mockResolvedValue({
    expiresAt: new Date(Date.now() + 5 * 86_400_000),
    createdAt: new Date(Date.now() - 20 * 86_400_000),
    title: 'T',
    slug: null,
  } as never);
  vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
  vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.job.update).mockResolvedValue({} as never);
  vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
  vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'u' } as never);
}

beforeEach(() => {
  vi.stubEnv('GA_MEASUREMENT_ID', MEASUREMENT_ID);
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
  for (const fn of Object.values(hoisted)) fn.mockReset();
  // Default: no request scope, exactly what Next does in a unit test.
  hoisted.after.mockImplementation(() => {
    throw new Error('`after` was called outside a request scope.');
  });
  hoisted.trackServerPurchase.mockResolvedValue(SENT);
  hoisted.sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
  hoisted.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@clinic.example' } }, error: null });
  vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ supabaseId: 'user-1', role: 'employer', email: 'owner@clinic.example' } as never);
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
  vi.mocked(prisma.job.create).mockResolvedValue({ id: 'job-1' } as never);
  vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1', slug: 'slug-job-1' } as never);
  vi.mocked(prisma.employerJob.create).mockResolvedValue({ id: 'ej-1', dashboardToken: 'dash-1' } as never);
  vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
  loggerSpies = [
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
    vi.spyOn(logger, 'info').mockImplementation(() => undefined),
    // /api/create-checkout refuses every paid post during the launch promo
    // (tests/api/create-checkout-tier.test.ts); the capture runs past it.
    vi.spyOn(config, 'isPromoActive').mockReturnValue(false),
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Only the spies above (logger, promo clock) are restored. vi.restoreAllMocks in Vitest 2 would
  // also strip the implementations the vi.mock factories above rely on.
  for (const spy of loggerSpies) spy.mockRestore();
});

describe('CAPTURE: consent decides, the GA cookie does not', () => {
  const capture = (headers: Record<string, string>) =>
    gaCheckoutMetadata(new NextRequest('https://test.local/api/create-checkout', { headers }));

  it('captures both ids when the consent cookie grants analytics', () => {
    expect(capture({ cookie: CONSENTED })).toEqual(GA_IDS);
  });

  it('captures nothing when no choice was recorded, even though GA cookies are present', () => {
    expect(capture({ cookie: GA_COOKIES })).toEqual({});
  });

  it('captures nothing after consent was withdrawn: the GA cookie outlives it', () => {
    expect(capture({ cookie: `${consentCookie(ALL_DENIED)}; ${GA_COOKIES}` })).toEqual({});
  });

  it('marketing consent alone is not analytics consent', () => {
    expect(capture({ cookie: `${consentCookie({ analytics: false, marketing: true })}; ${GA_COOKIES}` })).toEqual({});
  });

  it('treats a consent record from an older policy version as no consent', () => {
    const stale = encodeURIComponent(JSON.stringify({ categories: ANALYTICS_ONLY, version: '0', ts: 1 }));
    expect(capture({ cookie: `${CONSENT_COOKIE}=${stale}; ${GA_COOKIES}` })).toEqual({});
  });

  it.each([['sec-gpc'], ['dnt']])('a %s privacy signal overrides a recorded accept, as the banner does', (header) => {
    expect(capture({ cookie: CONSENTED, [header]: '1' })).toEqual({});
  });

  it('adds only the keys it can fill, so an absent id never becomes an empty metadata value', () => {
    expect(capture({ cookie: `${consentCookie(ANALYTICS_ONLY)}; _ga=GA1.1.${GA_CLIENT_ID}` })).toEqual({ gaClientId: GA_CLIENT_ID });
  });
});

describe('CAPTURE: idempotency keys stay valid when GA ids ride along', () => {
  it('returns the base key unchanged without GA ids', () => {
    expect(idempotencyKeyWithGaIds('renewal-ej-1-none-42', {})).toBe('renewal-ej-1-none-42');
  });

  it('folds the ids in, deterministically, when they are present', () => {
    const key = idempotencyKeyWithGaIds('renewal-ej-1-none-42', GA_IDS);
    expect(key).toBe(`renewal-ej-1-none-42-ga-${GA_CLIENT_ID}-${GA_SESSION_ID}`);
    expect(idempotencyKeyWithGaIds('renewal-ej-1-none-42', { ...GA_IDS })).toBe(key);
  });
});

describe('CAPTURE: /api/create-checkout', () => {
  async function createPost(cookie?: string) {
    const { POST } = await import('@/app/api/create-checkout/route');
    const res = await POST(request('https://test.local/api/create-checkout', POST_BODY, cookie ? { cookie } : {}));
    expect(res.status).toBe(200);
    return hoisted.sessionsCreate.mock.calls.at(-1) as [Record<string, unknown>, { idempotencyKey: string }];
  }

  it('stores the GA ids in the session metadata when the visitor consented', async () => {
    const [params, options] = await createPost(CONSENTED);
    expect(params.metadata).toEqual({ jobId: 'job-1', pricing: 'intro', ...GA_IDS });
    expect(options).toEqual({ idempotencyKey: 'new-post-ej-1' });
  });

  it('stores nothing without consent, although the GA cookies are sent', async () => {
    const [params] = await createPost(GA_COOKIES);
    expect(params.metadata).toEqual({ jobId: 'job-1', pricing: 'intro' });
  });

  it('changes no other checkout parameter: price, line items, invoice metadata and URLs are identical', async () => {
    const [without] = await createPost(GA_COOKIES);
    const [withIds] = await createPost(CONSENTED);
    const { metadata: metadataWithout, ...restWithout } = without;
    const { metadata: metadataWith, ...restWith } = withIds;
    expect(restWith).toEqual(restWithout);
    expect(metadataWith).toEqual({ ...(metadataWithout as object), ...GA_IDS });
  });

  describe('resume path (B78)', () => {
    beforeEach(() => {
      vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
        id: 'ej-9', jobId: 'job-9', paymentStatus: 'pending', pricingTier: 'pro', userId: 'user-1',
        contactEmail: 'owner@clinic.example', dashboardToken: 'd', stripeCheckoutSessionId: 'cs_old',
        job: { id: 'job-9', title: 't', employer: 'e', location: 'l', archivedAt: null },
      } as never);
      hoisted.sessionsRetrieve.mockResolvedValue({ id: 'cs_old', status: 'expired' });
    });

    async function resume(cookie: string) {
      const { POST } = await import('@/app/api/create-checkout/route');
      const res = await POST(request('https://test.local/api/create-checkout', { resumeJobId: 'job-9' }, { cookie }));
      expect(res.status).toBe(200);
      return hoisted.sessionsCreate.mock.calls.at(-1) as [Record<string, unknown>, { idempotencyKey: string }];
    }

    it('carries the GA ids and folds them into the replay key', async () => {
      const [params, options] = await resume(CONSENTED);
      expect(params.metadata).toEqual({ jobId: 'job-9', pricing: 'pro', ...GA_IDS });
      expect(options.idempotencyKey).toBe(`resume-ej-9-pro-cs_old-ga-${GA_CLIENT_ID}-${GA_SESSION_ID}`);
    });

    it('keeps metadata and key exactly as before without consent', async () => {
      const [params, options] = await resume(GA_COOKIES);
      expect(params.metadata).toEqual({ jobId: 'job-9', pricing: 'pro' });
      expect(options.idempotencyKey).toBe('resume-ej-9-pro-cs_old');
    });
  });
});

describe('CAPTURE: /api/create-renewal-checkout', () => {
  beforeEach(() => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      id: 'ej-1', jobId: 'job-1', editToken: 'edit-1', contactEmail: 'owner@clinic.example',
      paymentStatus: 'paid', pricingTier: 'pro',
      job: { id: 'job-1', title: 'T', employer: 'Clinic Co', location: 'Remote', expiresAt: null },
    } as never);
  });

  async function renew(cookie: string) {
    const { POST } = await import('@/app/api/create-renewal-checkout/route');
    const res = await POST(request('https://test.local/api/create-renewal-checkout', { jobId: 'job-1', editToken: 'edit-1' }, { cookie }));
    expect(res.status).toBe(200);
    return hoisted.sessionsCreate.mock.calls.at(-1) as [Record<string, unknown>, { idempotencyKey: string }];
  }

  it('stores the GA ids in the session metadata when the visitor consented', async () => {
    const [params] = await renew(CONSENTED);
    expect(params.metadata).toEqual({ jobId: 'job-1', type: 'renewal', tier: 'pro', ...GA_IDS });
  });

  it('keeps metadata and key exactly as before without consent', async () => {
    const [params, options] = await renew(GA_COOKIES);
    expect(params.metadata).toEqual({ jobId: 'job-1', type: 'renewal', tier: 'pro' });
    expect(options.idempotencyKey).toMatch(/^renewal-ej-1-none-\d+$/);
  });

  it('changes no other checkout parameter', async () => {
    const [without] = await renew(GA_COOKIES);
    const [withIds] = await renew(CONSENTED);
    const { metadata: metadataWithout, ...restWithout } = without;
    const { metadata: metadataWith, ...restWith } = withIds;
    expect(restWith).toEqual(restWithout);
    expect(metadataWith).toEqual({ ...(metadataWithout as object), ...GA_IDS });
  });

  it('a consent change between two clicks never reuses a key with different metadata, a double click still does', async () => {
    const [, first] = await renew(GA_COOKIES);
    const [, afterAccept] = await renew(CONSENTED);
    const [, doubleClick] = await renew(CONSENTED);
    expect(afterAccept.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(afterAccept.idempotencyKey.startsWith(first.idempotencyKey)).toBe(true);
    expect(doubleClick.idempotencyKey).toBe(afterAccept.idempotencyKey);
  });
});

describe('HAND-OFF: every purchase call site forwards the stored ids', () => {
  it('new post: activatePaidJobCheckout passes the metadata ids to trackServerPurchase', async () => {
    mockNewPostActivation();
    const { activatePaidJobCheckout } = await import('@/app/api/webhooks/stripe/activate-paid-job');

    const result = await activatePaidJobCheckout(stripeClient, paidSession({ jobId: 'job-1', pricing: 'pro', ...GA_IDS }));

    expect(result.outcome).toBe('activated');
    expect(hoisted.trackServerPurchase).toHaveBeenCalledTimes(1);
    expect(hoisted.trackServerPurchase).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'job-1', ...GA_IDS, sessionId: 'cs_paid_1', type: 'new', tier: 'pro', amountCents: 29900,
    }));
  });

  it('renewal: applyRenewalCheckout passes the metadata ids to trackServerPurchase', async () => {
    mockRenewalFulfilment();
    const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');

    const result = await applyRenewalCheckout(stripeClient, paidSession({ jobId: 'job-1', type: 'renewal', tier: 'pro', ...GA_IDS }));

    expect(result.outcome).toBe('applied');
    expect(hoisted.trackServerPurchase).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'job-1', ...GA_IDS, type: 'renewal', tier: 'pro',
    }));
  });

  it('a session without GA ids (no consent, or created before this change) falls back to the job UUID', async () => {
    mockNewPostActivation();
    const { activatePaidJobCheckout } = await import('@/app/api/webhooks/stripe/activate-paid-job');

    await activatePaidJobCheckout(stripeClient, paidSession({ jobId: 'job-1', pricing: 'pro' }));

    const params = hoisted.trackServerPurchase.mock.calls[0][0];
    expect(params.clientId).toBe('job-1');
    expect(params.gaClientId).toBeUndefined();
    expect(params.gaSessionId).toBeUndefined();
  });

  it('passes stored values through untouched; the analytics module is the only validator', async () => {
    mockNewPostActivation();
    const { activatePaidJobCheckout } = await import('@/app/api/webhooks/stripe/activate-paid-job');

    await activatePaidJobCheckout(stripeClient, paidSession({ jobId: 'job-1', pricing: 'pro', gaClientId: 'GA1.1.garbage', gaSessionId: 'GS2.1.s1' }));

    expect(hoisted.trackServerPurchase).toHaveBeenCalledWith(expect.objectContaining({ gaClientId: 'GA1.1.garbage', gaSessionId: 'GS2.1.s1' }));
  });

  it.each([
    ['new post', { jobId: 'job-1', pricing: 'pro', ...GA_IDS }, mockNewPostActivation, 'new'],
    ['renewal', { jobId: 'job-1', type: 'renewal', tier: 'pro', ...GA_IDS }, mockRenewalFulfilment, 'renewal'],
  ] as const)('through the Stripe webhook route (%s)', async (_label, metadata, arrange, type) => {
    arrange();
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    const { POST } = await import('@/app/api/webhooks/stripe/route');

    const res = await POST(new NextRequest('https://test.local/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: JSON.stringify({ id: `evt_${type}`, type: 'checkout.session.completed', data: { object: paidSession({ ...metadata }) } }),
    }));

    expect(res.status).toBe(200);
    expect(hoisted.trackServerPurchase).toHaveBeenCalledWith(expect.objectContaining({ ...GA_IDS, type }));
  });

  it('round trip: ids captured at checkout reach GA4 as the buyer browser session', async () => {
    const { POST } = await import('@/app/api/create-checkout/route');
    await POST(request('https://test.local/api/create-checkout', POST_BODY, { cookie: CONSENTED }));
    const storedMetadata = (hoisted.sessionsCreate.mock.calls[0][0] as { metadata: Record<string, string> }).metadata;

    vi.stubEnv('GA_API_SECRET', 'test-secret');
    vi.stubEnv('GA_MP_DEBUG', '');
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const actual = await vi.importActual<typeof import('@/lib/analytics-server')>('@/lib/analytics-server');
    hoisted.trackServerPurchase.mockImplementationOnce(actual.trackServerPurchase);
    mockNewPostActivation();
    const { activatePaidJobCheckout } = await import('@/app/api/webhooks/stripe/activate-paid-job');

    await activatePaidJobCheckout(stripeClient, paidSession(storedMetadata));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(payload.client_id).toBe(GA_CLIENT_ID);
    expect(payload.events[0].params.session_id).toBe(GA_SESSION_ID);
    expect(payload.events[0].params.attribution_source).toBe('ga_cookie');
  });
});

describe('DELIVERY: the POST leaves before the freeze, without holding the response', () => {
  it('in a request scope, sendPurchaseEvent hands the in-flight POST to after() and returns at once', async () => {
    hoisted.after.mockImplementation(() => undefined);
    const post = deferred<typeof SENT>();
    hoisted.trackServerPurchase.mockReturnValueOnce(post.promise);
    const { sendPurchaseEvent } = await import('@/app/api/webhooks/stripe/activate-paid-job');

    const delivery = sendPurchaseEvent({ clientId: 'job-1', sessionId: 'cs_1', amountCents: 1, currency: 'usd', type: 'new' });

    expect(await settlesPromptly(delivery)).toBe('returned');
    expect(await delivery).toBe('after_response');
    expect(hoisted.after).toHaveBeenCalledTimes(1);
    // What after() keeps alive is the POST itself: it settles only when the POST does.
    let kept = false;
    void (hoisted.after.mock.calls[0][0] as Promise<unknown>).then(() => { kept = true; });
    await Promise.resolve();
    expect(kept).toBe(false);
    post.resolve(SENT);
    await hoisted.after.mock.calls[0][0];
    expect(kept).toBe(true);
  });

  it('outside a request scope, sendPurchaseEvent waits for the POST, since nothing else keeps the process alive', async () => {
    const post = deferred<typeof SENT>();
    hoisted.trackServerPurchase.mockReturnValueOnce(post.promise);
    const { sendPurchaseEvent } = await import('@/app/api/webhooks/stripe/activate-paid-job');

    const delivery = sendPurchaseEvent({ clientId: 'job-1', sessionId: 'cs_1', amountCents: 1, currency: 'usd', type: 'new' });

    expect(await settlesPromptly(delivery)).toBe('blocked');
    post.resolve(SENT);
    expect(await delivery).toBe('awaited');
  });

  it('the webhook acknowledges Stripe while the purchase POST is still in flight', async () => {
    hoisted.after.mockImplementation(() => undefined);
    const post = deferred<typeof SENT>();
    hoisted.trackServerPurchase.mockReturnValueOnce(post.promise);
    mockNewPostActivation();
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    const { POST } = await import('@/app/api/webhooks/stripe/route');

    const ack = POST(new NextRequest('https://test.local/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: JSON.stringify({ id: 'evt_ack', type: 'checkout.session.completed', data: { object: paidSession({ jobId: 'job-1', pricing: 'pro', ...GA_IDS }) } }),
    }));

    expect(await settlesPromptly(ack)).toBe('returned');
    expect((await ack).status).toBe(200);
    expect(hoisted.after).toHaveBeenCalled();
    post.resolve(SENT);
  });

  it('renewal: fulfilment returns while the POST is in flight in a request scope', async () => {
    hoisted.after.mockImplementation(() => undefined);
    const post = deferred<typeof SENT>();
    hoisted.trackServerPurchase.mockReturnValueOnce(post.promise);
    mockRenewalFulfilment();
    const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');

    const fulfilment = applyRenewalCheckout(stripeClient, paidSession({ jobId: 'job-1', type: 'renewal', tier: 'pro', ...GA_IDS }));

    expect(await settlesPromptly(fulfilment)).toBe('returned');
    expect(hoisted.after).toHaveBeenCalledTimes(1);
    post.resolve(SENT);
  });

  it('a sender that breaks its never-reject contract still cannot fail a paid activation', async () => {
    hoisted.trackServerPurchase.mockRejectedValueOnce(new Error('contract broken'));
    mockNewPostActivation();
    const { activatePaidJobCheckout } = await import('@/app/api/webhooks/stripe/activate-paid-job');

    await expect(activatePaidJobCheckout(stripeClient, paidSession({ jobId: 'job-1', pricing: 'pro' }))).resolves.toMatchObject({ outcome: 'activated' });
  });
});

describe('static: no call site can bypass the hand-off or the delivery guarantee', () => {
  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(rel, acc);
      else if (/\.tsx?$/.test(entry.name)) acc.push(rel.replace(/\\/g, '/'));
    }
    return acc;
  }

  it('trackServerPurchase is only ever called from sendPurchaseEvent', () => {
    const callers = [...sourceFiles('app'), ...sourceFiles('lib')]
      .filter((rel) => rel !== 'lib/analytics-server.ts')
      .filter((rel) => /trackServerPurchase\(/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(callers).toEqual(['app/api/webhooks/stripe/activate-paid-job.ts']);
    const src = fs.readFileSync(path.join(ROOT, 'app/api/webhooks/stripe/activate-paid-job.ts'), 'utf8');
    expect(src.match(/trackServerPurchase\(/g)).toHaveLength(1);
  });

  it.each(['app/api/webhooks/stripe/activate-paid-job.ts', 'app/api/webhooks/stripe/apply-renewal.ts'])(
    '%s forwards both stored ids and awaits sendPurchaseEvent',
    (rel) => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).toContain('await sendPurchaseEvent({');
      expect(src).toContain('gaClientId: session.metadata?.gaClientId');
      expect(src).toContain('gaSessionId: session.metadata?.gaSessionId');
    },
  );
});
