/**
 * POST /api/create-renewal-checkout — a renewal costs what the post cost
 * (2027 re-price).
 *
 * The renewal has two prices (lib/config.ts): the base price for promo,
 * intro, pack and legacy posts, and the pro price for a post BOUGHT at the
 * posting price. Which one a row pays is lib/renewal-price.ts; this suite pins
 * that the checkout applies it:
 *   - the query loads the row's 'new' charge (NEW_POST_CHARGE_SELECT), the one
 *     fact that tells a bought post from a renewed promo post, because both
 *     read ('paid', 'pro');
 *   - unit_amount comes from the rung, and metadata.renewalRung carries it to
 *     the webhook, which records what Stripe charged and falls back to the
 *     rung's price when a session has no total;
 *   - the rung is decided after every refusal, so a row the checkout refuses
 *     (plan, archived, at its renewal cap) is refused whatever it paid;
 *   - the rung is read from the STORED pricingTier, not the 'intro' | 'pro'
 *     narrowing that goes into metadata.tier;
 *   - the idempotency key carries a fingerprint of the parameters, price
 *     included, so a row whose price changes inside a window gets a session of
 *     its own instead of an idempotency error;
 *   - a row loaded without its charges is never sold at a guessed price: the
 *     checkout answers a logged 500 before any Stripe call (review 2.28 M1).
 *
 * tests/lib/renewal-price.test.ts pins the rule itself.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config, type RenewalRung } from '@/lib/config';
import { logger } from '@/lib/logger';
import { NEW_POST_CHARGE_SELECT } from '@/lib/pricing';

const sessionsCreate = vi.fn();
const sessionsList = vi.fn();
const sessionsExpire = vi.fn();
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        checkout: { sessions: { create: sessionsCreate, list: sessionsList, expire: sessionsExpire } },
    })),
}));

vi.mock('@/lib/env', () => ({
    isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting'),
    getPaidPostingStatus: vi.fn(() => ({ enabled: true, stripeConfigured: true, available: true })),
    // Checkout opens only with the webhook secret set (tests/regressions/paid-posting-checkout-gate.test.ts).
    getEnv: vi.fn(() => ({ STRIPE_WEBHOOK_SECRET: 'whsec_x' })),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = 1_790_000_400_000 + 3 * 60 * 1000;

interface RowOptions {
    paymentStatus?: string;
    pricingTier?: string;
    /** The row has a JobCharge of type 'new', as NEW_POST_CHARGE_SELECT loads it. */
    bought?: boolean;
    /** Leave jobCharges off the row, as a query without the select returns it. */
    withoutCharges?: boolean;
    archivedAt?: Date | null;
    /** Days ago the post was created; the renewal cap is config.renewalCapDays. */
    createdDaysAgo?: number;
}

function row({
    paymentStatus = 'paid',
    pricingTier = 'pro',
    bought = false,
    withoutCharges = false,
    archivedAt = null,
    createdDaysAgo = 30,
}: RowOptions = {}) {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
        id: 'ej-1',
        jobId: 'job-1',
        editToken: 'edit-1',
        contactEmail: 'owner@clinic.example',
        paymentStatus,
        pricingTier,
        ...(withoutCharges ? {} : { jobCharges: bought ? [{ id: 'jc-new' }] : [] }),
        job: {
            id: 'job-1',
            title: 'PMHNP',
            employer: 'Clinic Co',
            location: 'Remote',
            archivedAt,
            expiresAt: null,
            createdAt: new Date(NOW_MS - createdDaysAgo * DAY_MS),
        },
    } as never);
}

async function post() {
    const { POST } = await import('@/app/api/create-renewal-checkout/route');
    const res = await POST(new NextRequest('https://test.local/api/create-renewal-checkout', {
        method: 'POST',
        body: JSON.stringify({ jobId: 'job-1', editToken: 'edit-1' }),
        headers: { 'content-type': 'application/json' },
    }));
    return { res, json: await res.json() };
}

const createdParams = () => sessionsCreate.mock.calls[0][0];
const unitAmount = (): number => createdParams().line_items[0].price_data.unit_amount;

let nowSpy: ReturnType<typeof vi.spyOn>;

// Load the route graph once, outside any single test's time budget (a cold
// import under a loaded full suite run can outlast vitest's 5 second default).
beforeAll(async () => {
    await import('@/app/api/create-renewal-checkout/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    // One clock reading for the whole test: the idempotency window cannot roll over between two requests.
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    // `created`: stamped by this request, so the route need not read the session back.
    sessionsCreate.mockImplementation(async () => ({ id: 'cs_r1', url: 'https://checkout.stripe.test/cs_r1', created: Math.floor(NOW_MS / 1000) }));
    sessionsList.mockImplementation(() => ({ async *[Symbol.asyncIterator]() { /* no other open renewal session */ } }));
    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
});

afterEach(() => {
    nowSpy.mockRestore();
});

interface RenewalCase {
    name: string;
    row: RowOptions;
    rung: RenewalRung;
}

const RENEWAL_CASES: readonly RenewalCase[] = [
    { name: 'a promo post', row: { paymentStatus: 'promo', pricingTier: 'pro' }, rung: 'base' },
    { name: 'a promo post that was renewed once (paid, pro, no new charge)', row: { paymentStatus: 'paid', pricingTier: 'pro' }, rung: 'base' },
    { name: 'an intro post', row: { paymentStatus: 'paid', pricingTier: 'intro', bought: true }, rung: 'base' },
    { name: 'a post bought at the posting price', row: { paymentStatus: 'paid', pricingTier: 'pro', bought: true }, rung: 'pro' },
    { name: 'a pack post', row: { paymentStatus: 'pack', pricingTier: 'pack' }, rung: 'base' },
    { name: 'a legacy paid row with no charge on the ledger', row: { paymentStatus: 'paid', pricingTier: 'pro' }, rung: 'base' },
    { name: 'a legacy free_renewed row', row: { paymentStatus: 'free_renewed', pricingTier: 'pro' }, rung: 'base' },
    { name: 'a legacy free_upgraded row', row: { paymentStatus: 'free_upgraded', pricingTier: 'pro' }, rung: 'base' },
];

describe('the renewal price follows what the post cost', () => {
    it.each(RENEWAL_CASES)('$name is charged the $rung renewal price', async ({ row: options, rung }) => {
        row(options);

        const { res, json } = await post();

        expect(res.status).toBe(200);
        expect(json).toMatchObject({ sessionId: 'cs_r1', url: 'https://checkout.stripe.test/cs_r1' });
        expect(unitAmount()).toBe(config.renewalPriceCentsFor(rung));
        expect(createdParams().metadata.renewalRung).toBe(rung);
    });

    it('a post bought at $349 renews for $249', async () => {
        row({ paymentStatus: 'paid', pricingTier: 'pro', bought: true });

        await post();

        expect(unitAmount()).toBe(24900);
        expect(unitAmount()).toBe(config.stripeProRenewalPriceInCents);
        expect(createdParams().metadata).toEqual({ jobId: 'job-1', type: 'renewal', tier: 'pro', renewalRung: 'pro' });
    });

    it('every other renewable post renews for $199', async () => {
        for (const { row: options } of RENEWAL_CASES.filter(({ rung }) => rung === 'base')) {
            sessionsCreate.mockClear();
            row(options);

            await post();

            expect(unitAmount(), JSON.stringify(options)).toBe(19900);
            expect(unitAmount(), JSON.stringify(options)).toBe(config.stripeRenewalPriceInCents);
        }
    });

    it("keeps the row's own tier in metadata beside the rung: an intro post stays intro and renews at the base price", async () => {
        row({ paymentStatus: 'paid', pricingTier: 'intro', bought: true });

        await post();

        expect(createdParams().metadata).toEqual({ jobId: 'job-1', type: 'renewal', tier: 'intro', renewalRung: 'base' });
    });

    it("keeps 'pack' for a 5-post pack post, renewed or not, at the base price (owner decision 2026-10-24)", async () => {
        for (const paymentStatus of ['pack', 'paid']) {
            sessionsCreate.mockClear();
            row({ paymentStatus, pricingTier: 'pack' });

            const { res } = await post();

            expect(res.status, paymentStatus).toBe(200);
            expect(createdParams().metadata, paymentStatus).toEqual({ jobId: 'job-1', type: 'renewal', tier: 'pack', renewalRung: 'base' });
            expect(unitAmount(), paymentStatus).toBe(config.stripeRenewalPriceInCents);
        }
    });

    it('reads the STORED tier: an unknown tier with a new charge is the base price, though metadata.tier narrows it to pro', async () => {
        // asPaidTier turns every unknown tier into 'pro' so a new post is never
        // under-charged. A renewal must not borrow that narrowing: this row was
        // never sold at the posting price.
        row({ paymentStatus: 'paid', pricingTier: 'starter', bought: true });

        await post();

        expect(createdParams().metadata).toMatchObject({ tier: 'pro', renewalRung: 'base' });
        expect(unitAmount()).toBe(config.stripeRenewalPriceInCents);
    });

    it('a row loaded without its charges is refused with a logged 500, never charged the lower price', async () => {
        const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        row({ paymentStatus: 'paid', pricingTier: 'pro', withoutCharges: true });

        const { res, json } = await post();

        expect(res.status).toBe(500);
        expect(json).toEqual({ error: 'Failed to create checkout session' });
        expect(logged).toHaveBeenCalledWith(
            'Error creating renewal checkout session',
            expect.objectContaining({ message: expect.stringMatching(/NEW_POST_CHARGE_SELECT/) }),
        );
        // Refused before Stripe is asked anything.
        expect(sessionsList).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
        logged.mockRestore();
    });

    it('the price is not part of the product text the employer reads on Checkout', async () => {
        row({ paymentStatus: 'paid', pricingTier: 'pro', bought: true });

        await post();

        const { product_data: product } = createdParams().line_items[0].price_data;
        expect(product.name).toBe('Job renewal: PMHNP');
        expect(product.description).toBe(`Clinic Co, ${config.durationDays} more days`);
    });
});

describe('the query that finds the rung', () => {
    it("loads the row's 'new' charge with the post, and keeps the lookup by job and edit token", async () => {
        row({ bought: true });

        await post();

        expect(prisma.employerJob.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.employerJob.findFirst).toHaveBeenCalledWith({
            where: { jobId: 'job-1', editToken: 'edit-1' },
            include: {
                job: { select: expect.objectContaining({ createdAt: true, expiresAt: true, archivedAt: true }) },
                ...NEW_POST_CHARGE_SELECT,
            },
        });
        expect(NEW_POST_CHARGE_SELECT.jobCharges.where).toEqual({ type: 'new' });
    });
});

describe('the rung is decided after every refusal', () => {
    it.each([
        ['plan', { paymentStatus: 'plan', pricingTier: 'plan', bought: true }, /plan slot/i],
        ['refunded', { paymentStatus: 'refunded', pricingTier: 'pro', bought: true }, /refunded/i],
        ['disputed', { paymentStatus: 'disputed', pricingTier: 'pro', bought: true }, /payment dispute/i],
        ['pending', { paymentStatus: 'pending', pricingTier: 'pro', bought: true }, /never completed/i],
    ])("a '%s' row that carries a new charge is refused with 409 and no Stripe call", async (_status, options, message) => {
        row(options);

        const { res, json } = await post();

        expect(res.status).toBe(409);
        expect(json.error).toMatch(message);
        expect(sessionsList).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('an archived post bought at $349 is told to restore it first, not quoted a price', async () => {
        row({ bought: true, archivedAt: new Date(NOW_MS - DAY_MS) });

        const { res, json } = await post();

        expect(res.status).toBe(409);
        expect(json.archived).toBe(true);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('a post bought at $349 that has reached its renewal cap is refused, not sold the pro renewal', async () => {
        row({ bought: true, createdDaysAgo: config.renewalCapDays + 35 });

        const { res, json } = await post();

        expect(res.status).toBe(409);
        expect(json.code).toBe('RENEWAL_CAP_REACHED');
        expect(sessionsCreate).not.toHaveBeenCalled();
    });
});

describe('the idempotency key carries the price', () => {
    async function keyFor(options: RowOptions): Promise<string> {
        sessionsCreate.mockClear();
        row(options);
        await post();
        return sessionsCreate.mock.calls[0][1].idempotencyKey;
    }

    it('the same post in the same window gets a different key once its rung changes', async () => {
        const base = await keyFor({ paymentStatus: 'paid', pricingTier: 'pro', bought: false });
        const pro = await keyFor({ paymentStatus: 'paid', pricingTier: 'pro', bought: true });

        const shape = /^(renewal-v2-ej-1-none-\d+)-([0-9a-f]{12})$/;
        expect(base).toMatch(shape);
        expect(pro).toMatch(shape);
        expect(base.match(shape)?.[1]).toBe(pro.match(shape)?.[1]);
        expect(base.match(shape)?.[2]).not.toBe(pro.match(shape)?.[2]);
    });

    it('the same rung in the same window keeps its key, so a double click reuses one session', async () => {
        const first = await keyFor({ paymentStatus: 'paid', pricingTier: 'pro', bought: true });
        const second = await keyFor({ paymentStatus: 'paid', pricingTier: 'pro', bought: true });

        expect(second).toBe(first);
    });
});
