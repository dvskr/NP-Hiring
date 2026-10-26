/**
 * GET /api/cron/expiry-warnings — the renewal offer each email carries
 * (package RENEWAL-OFFER).
 *
 * The cron used to pass only paymentStatus to the pre-expiry warning and
 * print one renewal price with a list-price saving in the post-expiry email
 * for every promo and paid row. Now, per run:
 *   - renewals are offered only when the same check behind
 *     /api/create-checkout/availability says one can be bought (read once;
 *     unreadable counts as not purchasable);
 *   - after the promo, the saving is measured against each employer's own
 *     next new-post price (intro vs. post price, 0 with a usable 5-post pack
 *     credit), looked up once per (quota domain, employer);
 *   - a legacy plan row is never offered a renewal (the Employer plan is
 *     retired and its code deleted); after the promo it is offered a paid
 *     repost like any row the renewal checkout refuses;
 *   - (2027 re-price, phase 2) a 5-post pack post ('pack' row) is renewed and
 *     warned like any paid post, at the base renewal price;
 *   - (backlog 2.1) every free-posting line is judged at the run's own clock,
 *     so it stops at config.promoEndsAt with no deploy; after that a row the
 *     renewal checkout refuses is offered a paid repost at the ladder price,
 *     only while new posts can be bought;
 *   - (2027 re-price) a renewal has two prices (lib/renewal-price.ts), so each
 *     email names its OWN row's price and measures its saving from it: both
 *     queries load the row's 'new' charge, and the price rides in the
 *     warning's options (`renewalPrice`) and in the post-expiry offer.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { NEW_POST_CHARGE_SELECT } from '@/lib/pricing';
import { LADDER_PRICES } from '@/lib/pricing-copy';

const sendExpiryWarningEmail = vi.fn();
const sendAndLog = vi.fn();
vi.mock('@/lib/email-service', () => ({
    sendExpiryWarningEmail,
    sendAndLog,
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('tok-1'),
    escapeHtml: (s: string) => s,
}));
const getPaidPostingStatus = vi.fn();
// The webhook secret is set unless a test says otherwise.
const getEnv = vi.fn(() => ({ STRIPE_WEBHOOK_SECRET: 'whsec_x' as string | undefined }));
vi.mock('@/lib/env', () => ({ getPaidPostingStatus, getEnv }));
// Hoisted: lib/pricing (imported above) loads lib/post-packs before this file's own consts exist.
const { getPackCreditStatus } = vi.hoisted(() => ({ getPackCreditStatus: vi.fn() }));
vi.mock('@/lib/post-packs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/post-packs')>()),
    getPackCreditStatus,
}));
const NO_PACK_CREDIT = { usable: false, remaining: 0, total: 0, expiresAt: null };
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({ verifyCronOrAdmin: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/discord-notifier', () => ({ sendCronFailureAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/cron/track', () => ({
    withCronTracking: vi.fn(async (_name: string, body: () => Promise<{ response: unknown }>) => (await body()).response),
}));

import { logger } from '@/lib/logger';

const DURING_PROMO = new Date('2026-11-21T12:00:00.000Z');
const AFTER_PROMO = new Date('2027-03-01T12:00:00.000Z');
const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
/** Free posting offered as a current deal: never true once the promo is over. */
const FREE_REPOST = /free through|for free|at no charge|launch (period|promo)/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const DOMAIN_WITH_PAID_POST = 'repeat.example';
const DOMAIN_WITHOUT_PAID_POST = 'first.example';

interface RowOpts {
    status: string;
    domain?: string | null;
    userId?: string | null;
    expiresInDays: number;
    /** EmployerJob.pricingTier; 'pro' unless set. */
    pricingTier?: string;
    /** The row has a JobCharge of type 'new', as NEW_POST_CHARGE_SELECT loads it: a post bought at the posting price. */
    bought?: boolean;
}

function row(id: string, opts: RowOpts) {
    return {
        id,
        title: `Role ${id}`,
        expiresAt: new Date(Date.now() + opts.expiresInDays * DAY_MS),
        viewCount: 10,
        applyClickCount: 2,
        employerJobs: {
            id: `ej-${id}`,
            contactEmail: `hr@${opts.domain ?? 'clinic.example'}`,
            paymentStatus: opts.status,
            pricingTier: opts.pricingTier ?? 'pro',
            jobCharges: opts.bought ? [{ id: `jc-${id}` }] : [],
            quotaDomain: opts.domain === undefined ? 'clinic.example' : opts.domain,
            userId: opts.userId === undefined ? 'user-1' : opts.userId,
            dashboardToken: `dash-${id}`,
            editToken: `edit-${id}`,
        },
    };
}

/** First findMany = pre-expiry candidates, second = recently expired. */
function seed(expiring: ReturnType<typeof row>[], expired: ReturnType<typeof row>[] = []) {
    vi.mocked(prisma.job.findMany)
        .mockResolvedValueOnce(expiring as never)
        .mockResolvedValueOnce(expired as never);
}

async function runCron() {
    const { GET } = await import('@/app/api/cron/expiry-warnings/route');
    const res = (await GET(new Request('https://example.com/api/cron/expiry-warnings') as never)) as Response;
    return res.json();
}

/** The options object the pre-expiry warning was sent with, by job id. */
function warningOptionsFor(jobId: string): Record<string, unknown> {
    const call = sendExpiryWarningEmail.mock.calls.find((c) => c[1] === `Role ${jobId}`);
    expect(call, `warning for ${jobId}`).toBeDefined();
    return call![7] as Record<string, unknown>;
}

function postExpiryHtml(jobId: string): string {
    const call = sendAndLog.mock.calls.find((c) => (c[2] as { jobId?: string }).jobId === jobId);
    expect(call, `post-expiry email for ${jobId}`).toBeDefined();
    return (call![0] as { html: string }).html;
}

// The first import of the route is a cold transform of its whole module
// graph. Paid for once here, with its own budget: inside the first test it
// outran the 5s default on a loaded machine, and the late run then consumed
// the rows the next test had seeded.
beforeAll(async () => {
    await import('@/app/api/cron/expiry-warnings/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    sendExpiryWarningEmail.mockResolvedValue({ success: true });
    sendAndLog.mockResolvedValue({ data: { id: 'x' } });
    vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);
    vi.mocked(prisma.emailSend.findFirst).mockResolvedValue(null as never);
    getPackCreditStatus.mockResolvedValue(NO_PACK_CREDIT);
    // Paid posts already bought per domain (lib/pricing#getNextPaidTier).
    vi.mocked(prisma.employerJob.count).mockImplementation((async (args: { where: { quotaDomain?: string } }) =>
        (args.where.quotaDomain === DOMAIN_WITH_PAID_POST ? 1 : 0)) as never);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('during the launch promo with paid posting off (production today)', () => {
    it('offers no renewal and looks up no prices', async () => {
        vi.setSystemTime(DURING_PROMO);
        getPaidPostingStatus.mockReturnValue({ enabled: false, stripeConfigured: true, available: false });
        seed([row('a', { status: 'promo', expiresInDays: 4 }), row('b', { status: 'paid', expiresInDays: 2 })]);

        const body = await runCron();

        expect(body.warningsSent).toBe(2);
        for (const id of ['a', 'b']) {
            expect(warningOptionsFor(id)).toMatchObject({ renewalPurchasable: false, postingPurchasable: false, nextPostPrice: null, now: DURING_PROMO });
        }
        expect(getPackCreditStatus).not.toHaveBeenCalled();
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it('the post-expiry email offers the free repost, not a renewal', async () => {
        vi.setSystemTime(DURING_PROMO);
        getPaidPostingStatus.mockReturnValue({ enabled: false, stripeConfigured: false, available: false });
        seed([], [row('gone', { status: 'promo', expiresInDays: -1 })]);

        await runCron();

        const html = postExpiryHtml('gone');
        expect(html).not.toContain(`$${config.renewalPrice}`);
        expect(html).not.toMatch(/save \d+%/i);
        expect(html).toContain(`Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge.`);
        expect(html).toContain('/post-job');
        const subject = (sendAndLog.mock.calls[0][0] as { subject: string }).subject;
        expect(subject).not.toMatch(/[–—]/);
    });

    it('with paid posting on, the renewal is offered but no saving is claimed', async () => {
        vi.setSystemTime(DURING_PROMO);
        getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: true, available: true });
        seed([row('a', { status: 'promo', expiresInDays: 4 })], [row('gone', { status: 'paid', expiresInDays: -1 })]);

        await runCron();

        expect(warningOptionsFor('a')).toMatchObject({ renewalPurchasable: true, nextPostPrice: null });
        const html = postExpiryHtml('gone');
        expect(html).toContain(`Renew for $${config.renewalPrice} to relist it`);
        expect(html).not.toMatch(/save \d+%/i);
        expect(html).toContain(`Or post this role again as a fresh listing, free through ${config.promoEndsLabel}.`);
    });
});

describe('after the promo with paid posting on', () => {
    beforeEach(() => {
        vi.setSystemTime(AFTER_PROMO);
        getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: true, available: true });
    });

    it("measures each renewal against that employer's own next new post, once per employer", async () => {
        seed([
            row('repeat-1', { status: 'paid', domain: DOMAIN_WITH_PAID_POST, userId: 'user-r', expiresInDays: 3 }),
            row('repeat-2', { status: 'paid', domain: DOMAIN_WITH_PAID_POST, userId: 'user-r', expiresInDays: 4 }),
            row('first', { status: 'promo', domain: DOMAIN_WITHOUT_PAID_POST, userId: 'user-f', expiresInDays: 2 }),
            row('plan', { status: 'plan', domain: DOMAIN_WITHOUT_PAID_POST, userId: 'user-p', expiresInDays: 2 }),
            row('nodomain', { status: 'paid', domain: null, userId: null, expiresInDays: 1 }),
        ]);

        await runCron();

        expect(warningOptionsFor('repeat-1')).toMatchObject({ renewalPurchasable: true, nextPostPrice: config.postingPrice });
        expect(warningOptionsFor('repeat-2')).toMatchObject({ renewalPurchasable: true, nextPostPrice: config.postingPrice });
        expect(warningOptionsFor('first')).toMatchObject({ renewalPurchasable: true, nextPostPrice: config.introPrice });
        expect(warningOptionsFor('plan')).toMatchObject({ paymentStatus: 'plan', renewalPurchasable: false, nextPostPrice: null });
        // No quota domain: unknown, so the email names the standard post price.
        expect(warningOptionsFor('nodomain')).toMatchObject({ renewalPurchasable: true, nextPostPrice: null });
        // One pack-credit lookup per employer: repeat (cached for its second post) and first.
        expect(getPackCreditStatus.mock.calls.map((c) => c[0]).sort()).toEqual(['user-f', 'user-r']);
    });

    it('a usable pack credit makes the next post free, so no saving is claimed', async () => {
        getPackCreditStatus.mockResolvedValue({ usable: true, remaining: 3, total: config.packPosts, expiresAt: new Date('2027-12-31T00:00:00.000Z') });
        seed([], [row('gone', { status: 'paid', domain: DOMAIN_WITH_PAID_POST, expiresInDays: -1 })]);

        await runCron();

        const html = postExpiryHtml('gone');
        expect(html).toContain(`Renew for $${config.renewalPrice} to relist it`);
        expect(html).not.toMatch(/save \d+%/i);
        expect(getPackCreditStatus).toHaveBeenCalledWith('user-1', AFTER_PROMO);
    });

    it("a 5-post pack post is renewed and warned like a paid post, at the base renewal", async () => {
        seed(
            [row('pack-live', { status: 'pack', pricingTier: 'pack', domain: DOMAIN_WITH_PAID_POST, userId: 'user-r', expiresInDays: 3 })],
            [row('pack-gone', { status: 'pack', pricingTier: 'pack', domain: DOMAIN_WITH_PAID_POST, userId: 'user-r', expiresInDays: -1 })],
        );

        await runCron();

        expect(warningOptionsFor('pack-live')).toMatchObject({ paymentStatus: 'pack', renewalPurchasable: true, renewalPrice: config.renewalPrice, nextPostPrice: config.postingPrice });
        expect(postExpiryHtml('pack-gone')).toContain(`Renew for $${config.renewalPrice} (Save 42% vs. your next new post at $${config.postingPrice})`);
        // The post-expiry pass selects 'pack' rows among the notifiable statuses.
        const where = vi.mocked(prisma.job.findMany).mock.calls[1][0]?.where as { employerJobs: { paymentStatus: { in: string[] } } };
        expect(where.employerJobs.paymentStatus.in).toContain('pack');
    });

    it('the post-expiry email names the saving against the next post price', async () => {
        seed([], [
            row('repeat', { status: 'paid', domain: DOMAIN_WITH_PAID_POST, userId: 'user-r', expiresInDays: -1 }),
            row('first', { status: 'promo', domain: DOMAIN_WITHOUT_PAID_POST, userId: 'user-f', expiresInDays: -2 }),
        ]);

        await runCron();

        // $199 against the $349 post price is 42.98%, against the $249 intro price 20.08%.
        expect(postExpiryHtml('repeat')).toContain(`Renew for $${config.renewalPrice} (Save 42% vs. your next new post at $${config.postingPrice})`);
        expect(postExpiryHtml('first')).toContain(`Renew for $${config.renewalPrice} (Save 20% vs. your next new post at $${config.introPrice})`);
        // A renewal only moves the end date, within the cap.
        expect(postExpiryHtml('repeat')).toContain('carry over. A renewal does not add unlocks or InMails.');
        expect(postExpiryHtml('repeat')).toContain(`Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.`);
    });

    it('a failed price lookup falls back to the named standard post price', async () => {
        getPackCreditStatus.mockRejectedValue(new Error('db down'));
        seed([], [row('gone', { status: 'paid', expiresInDays: -1 })]);

        await runCron();

        expect(postExpiryHtml('gone')).toContain(`(Save 42% vs. the $${config.postingPrice} post price)`);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('a legacy plan post that ended (the plan is retired) is offered a paid repost, never a renewal or a plan slot', async () => {
        seed([], [row('plan', { status: 'plan', pricingTier: 'plan', expiresInDays: -1 })]);

        await runCron();

        const html = postExpiryHtml('plan');
        expect(html).not.toContain(`$${config.renewalPrice}`);
        expect(html).toContain(`You can post this role again as a fresh ${config.durationDays}-day listing. ${LADDER_PRICES} Your stats and applicants stay attached to the expired posting.`);
        expect(html).not.toMatch(/plan post|Employer plan|slot|subscribed/i);
        // Still a published row, so the post-expiry pass still selects it.
        const where = vi.mocked(prisma.job.findMany).mock.calls[1][0]?.where as { employerJobs: { paymentStatus: { in: string[] } } };
        expect(where.employerJobs.paymentStatus.in).toContain('plan');
    });
});

describe("each email names its own row's renewal price (a post bought at the posting price renews for more)", () => {
    const BOUGHT = { status: 'paid', pricingTier: 'pro', bought: true } as const;

    beforeEach(() => {
        vi.setSystemTime(AFTER_PROMO);
        getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: true, available: true });
    });

    it('loads the row\'s new charge with the post, in the warning query and in the post-expiry query', async () => {
        seed([row('a', { status: 'promo', expiresInDays: 3 })], [row('gone', { status: 'promo', expiresInDays: -1 })]);

        await runCron();

        expect(prisma.job.findMany).toHaveBeenCalledTimes(2);
        for (const [args] of vi.mocked(prisma.job.findMany).mock.calls) {
            expect(args?.include).toEqual({ employerJobs: { include: NEW_POST_CHARGE_SELECT } });
        }
    });

    it("passes each warning its row's price: the pro renewal only for a post that was bought at the posting price", async () => {
        seed([
            row('promo', { status: 'promo', expiresInDays: 3 }),
            row('renewed-promo', { status: 'paid', pricingTier: 'pro', expiresInDays: 3 }),
            row('intro', { status: 'paid', pricingTier: 'intro', bought: true, expiresInDays: 3 }),
            row('bought', { ...BOUGHT, expiresInDays: 3 }),
            row('legacy', { status: 'paid', pricingTier: 'pro', expiresInDays: 3, domain: null, userId: null }),
        ]);

        await runCron();

        expect(warningOptionsFor('promo')).toMatchObject({ renewalPrice: config.renewalPrice });
        expect(warningOptionsFor('renewed-promo')).toMatchObject({ renewalPrice: config.renewalPrice });
        expect(warningOptionsFor('intro')).toMatchObject({ renewalPrice: config.renewalPrice });
        expect(warningOptionsFor('bought')).toMatchObject({ renewalPrice: config.proRenewalPrice });
        expect(warningOptionsFor('legacy')).toMatchObject({ renewalPrice: config.renewalPrice });
    });

    it('a row loaded without its charges is reported and left unwarned, never quoted the base renewal', async () => {
        // Its price cannot be told (review 2.28 M1). The row is not stamped,
        // so the next run warns it once the query loads the charges again.
        const noCharges = row('bare', { ...BOUGHT, expiresInDays: 3 });
        delete (noCharges.employerJobs as { jobCharges?: unknown }).jobCharges;
        seed([noCharges]);

        const body = await runCron();

        expect(body.warningsSent).toBe(0);
        expect(body.errors).toEqual([expect.stringMatching(/^Job bare: .*NEW_POST_CHARGE_SELECT/)]);
        expect(sendExpiryWarningEmail).not.toHaveBeenCalled();
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
    });

    it('also hands the price over during the promo, where the renewal is offered with no saving', async () => {
        vi.setSystemTime(DURING_PROMO);
        seed([row('bought', { ...BOUGHT, expiresInDays: 3 })]);

        await runCron();

        expect(warningOptionsFor('bought')).toMatchObject({ renewalPurchasable: true, nextPostPrice: null, renewalPrice: config.proRenewalPrice });
    });

    it('the post-expiry email names the pro renewal and measures the saving from it', async () => {
        seed([], [
            row('bought', { ...BOUGHT, domain: DOMAIN_WITH_PAID_POST, userId: 'user-r', expiresInDays: -1 }),
            row('promo', { status: 'promo', domain: DOMAIN_WITH_PAID_POST, userId: 'user-r', expiresInDays: -2 }),
        ]);

        await runCron();

        // $249 against the $349 post price is 28.65%; $199 against it is 42.98%.
        const bought = postExpiryHtml('bought');
        expect(bought).toContain(`Renew for $${config.proRenewalPrice} (Save 28% vs. your next new post at $${config.postingPrice})`);
        expect(bought).not.toContain(`Renew for $${config.renewalPrice}`);
        expect(postExpiryHtml('promo')).toContain(`Renew for $${config.renewalPrice} (Save 42% vs. your next new post at $${config.postingPrice})`);
    });

    it('claims no saving when the next post costs no more than the renewal', async () => {
        // The pro renewal equals the intro price, so against an intro-priced next post there is nothing to claim.
        seed([], [row('bought', { ...BOUGHT, domain: DOMAIN_WITHOUT_PAID_POST, userId: 'user-f', expiresInDays: -1 })]);

        await runCron();

        const html = postExpiryHtml('bought');
        expect(html).toContain(`Renew for $${config.proRenewalPrice} to relist it`);
        expect(html).not.toMatch(/save \d+%/i);
    });

    it('a failed price lookup falls back to the named post price, measured from the row\'s own renewal price', async () => {
        getPackCreditStatus.mockRejectedValue(new Error('db down'));
        seed([], [row('bought', { ...BOUGHT, expiresInDays: -1 })]);

        await runCron();

        expect(postExpiryHtml('bought')).toContain(`Renew for $${config.proRenewalPrice} (Save 28% vs. the $${config.postingPrice} post price)`);
    });
});

describe('after the promo with paid posting off', () => {
    it('offers nothing it cannot sell', async () => {
        vi.setSystemTime(AFTER_PROMO);
        getPaidPostingStatus.mockReturnValue({ enabled: false, stripeConfigured: true, available: false });
        seed([row('a', { status: 'paid', expiresInDays: 3 })], [row('gone', { status: 'paid', expiresInDays: -1 })]);

        await runCron();

        expect(warningOptionsFor('a')).toMatchObject({ renewalPurchasable: false, postingPurchasable: false, nextPostPrice: null });
        const html = postExpiryHtml('gone');
        expect(html).not.toContain(`$${config.renewalPrice}`);
        expect(html).not.toMatch(/free through/i);
        expect(html).toContain('Go to Your Dashboard');
    });
});

// Register 2.26: the renewal and post checkouts refuse while STRIPE_WEBHOOK_SECRET
// is unset (the webhook could not record the sale), so no email may offer either.
describe('after the promo with paid posting on but no webhook secret', () => {
    it('offers nothing the checkout would refuse', async () => {
        vi.setSystemTime(AFTER_PROMO);
        getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: true, available: true });
        getEnv.mockReturnValueOnce({ STRIPE_WEBHOOK_SECRET: undefined });
        seed([row('a', { status: 'paid', expiresInDays: 3 })], [row('gone', { status: 'paid', expiresInDays: -1 })]);

        await runCron();

        expect(warningOptionsFor('a')).toMatchObject({ renewalPurchasable: false, postingPurchasable: false });
        // The price is searched with its dollar sign: the bare number is also
        // in the XHTML namespace URL (w3.org/1999/xhtml) every email opens with.
        const html = postExpiryHtml('gone');
        expect(html).not.toContain(`$${config.renewalPrice}`);
        expect(html).not.toContain('Renew for');
        expect(html).toContain('Go to Your Dashboard');
    });
});

describe('after the promo with paid posting on: a row the renewal checkout refuses', () => {
    beforeEach(() => {
        vi.setSystemTime(AFTER_PROMO);
        getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: true, available: true });
    });

    it('the pre-expiry warning is told new posts can be bought but this row cannot be renewed', async () => {
        seed([row('legacy', { status: 'free', expiresInDays: 3 })]);

        await runCron();

        expect(warningOptionsFor('legacy')).toMatchObject({
            paymentStatus: 'free',
            renewalPurchasable: false,
            postingPurchasable: true,
            nextPostPrice: null,
            now: AFTER_PROMO,
        });
    });

    it('the post-expiry email offers a paid repost at the ladder price, never a free one', async () => {
        seed([], [row('legacy', { status: 'free', expiresInDays: -1 })]);

        await runCron();

        const html = postExpiryHtml('legacy');
        expect(html).toContain(`You can post this role again as a fresh ${config.durationDays}-day listing. ${LADDER_PRICES} Your stats and applicants stay attached to the expired posting.`);
        expect(html).toMatch(/>\s*Post a New Job\s*</);
        expect(html).toContain('/post-job');
        expect(html).not.toContain(`$${config.renewalPrice}`);
        expect(html).not.toMatch(FREE_REPOST);
        // Present tense: no start date that has already passed.
        expect(html).not.toContain(config.ladderStartsLabel);
    });
});

describe('the free repost line stops exactly at config.promoEndsAt', () => {
    async function postExpiryAt(now: Date): Promise<string> {
        vi.setSystemTime(now);
        sendAndLog.mockClear();
        seed([], [row('gone', { status: 'promo', expiresInDays: -1 })]);
        await runCron();
        return postExpiryHtml('gone');
    }

    it('paid posting off (production today): free repost in the last promo second, no offer from the next instant', async () => {
        getPaidPostingStatus.mockReturnValue({ enabled: false, stripeConfigured: true, available: false });

        const last = await postExpiryAt(LAST_PROMO_SECOND);
        expect(last).toContain(`Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge.`);
        expect(last).toMatch(/>\s*Post a New Job for Free\s*</);

        const first = await postExpiryAt(LADDER_START);
        expect(first).not.toMatch(FREE_REPOST);
        expect(first).not.toContain('Post a New Job for Free');
        expect(first).toContain('Go to Your Dashboard');
    });

    it('paid posting on: the renewal drops its free alternative at the same instant', async () => {
        getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: true, available: true });

        const last = await postExpiryAt(LAST_PROMO_SECOND);
        expect(last).toContain(`Or post this role again as a fresh listing, free through ${config.promoEndsLabel}.`);

        const first = await postExpiryAt(LADDER_START);
        expect(first).toContain(`Renew for $${config.renewalPrice}`);
        expect(first).not.toMatch(FREE_REPOST);
    });
});

describe('an unreadable paid-posting flag fails closed', () => {
    it('withholds every renewal offer and logs why', async () => {
        vi.setSystemTime(AFTER_PROMO);
        getPaidPostingStatus.mockImplementation(() => { throw new Error('env invalid'); });
        seed([row('a', { status: 'paid', expiresInDays: 3 })]);

        const body = await runCron();

        expect(body.warningsSent).toBe(1);
        expect(warningOptionsFor('a')).toMatchObject({ renewalPurchasable: false });
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('renewal offers withheld'), expect.any(Error));
    });
});
