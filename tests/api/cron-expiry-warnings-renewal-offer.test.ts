/**
 * GET /api/cron/expiry-warnings — the renewal offer each email carries
 * (package RENEWAL-OFFER).
 *
 * The cron used to pass only paymentStatus to the pre-expiry warning and
 * print "Renew for $179 (save 40%)" in the post-expiry email for every promo
 * and paid row. Now, per run:
 *   - renewals are offered only when the same check behind
 *     /api/create-checkout/availability says one can be bought (read once;
 *     unreadable counts as not purchasable);
 *   - after the promo, the saving is measured against each employer's own
 *     next new-post price (intro vs. post price, 0 with a free plan slot),
 *     looked up once per (quota domain, employer);
 *   - plan rows are never offered a renewal: each runs config.durationDays
 *     and its slot is free when it ends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';

const sendExpiryWarningEmail = vi.fn();
const sendAndLog = vi.fn();
vi.mock('@/lib/email-service', () => ({
    sendExpiryWarningEmail,
    sendAndLog,
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('tok-1'),
    escapeHtml: (s: string) => s,
}));
const getPaidPostingStatus = vi.fn();
vi.mock('@/lib/env', () => ({ getPaidPostingStatus }));
const getPlanSlotStatus = vi.fn();
vi.mock('@/lib/employer-plan', () => ({ getPlanSlotStatus }));
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({ verifyCronOrAdmin: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/discord-notifier', () => ({ sendCronFailureAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/cron/track', () => ({
    withCronTracking: vi.fn(async (_name: string, body: () => Promise<{ response: unknown }>) => (await body()).response),
}));

import { logger } from '@/lib/logger';

const DURING_PROMO = new Date('2026-11-21T12:00:00.000Z');
const AFTER_PROMO = new Date('2027-03-01T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const DOMAIN_WITH_PAID_POST = 'repeat.example';
const DOMAIN_WITHOUT_PAID_POST = 'first.example';

interface RowOpts {
    status: string;
    domain?: string | null;
    userId?: string | null;
    expiresInDays: number;
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

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    sendExpiryWarningEmail.mockResolvedValue({ success: true });
    sendAndLog.mockResolvedValue({ data: { id: 'x' } });
    vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);
    vi.mocked(prisma.emailSend.findFirst).mockResolvedValue(null as never);
    getPlanSlotStatus.mockResolvedValue({ canPost: false });
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
            expect(warningOptionsFor(id)).toMatchObject({ renewalPurchasable: false, nextPostPrice: null, now: DURING_PROMO });
        }
        expect(getPlanSlotStatus).not.toHaveBeenCalled();
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it('the post-expiry email offers the free repost, not a $179 renewal', async () => {
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
        // One plan-slot lookup per employer: repeat (cached for its second post) and first.
        expect(getPlanSlotStatus.mock.calls.map((c) => c[0]).sort()).toEqual(['user-f', 'user-r']);
    });

    it('an open plan slot makes the next post free, so no saving is claimed', async () => {
        getPlanSlotStatus.mockResolvedValue({ canPost: true });
        seed([], [row('gone', { status: 'paid', domain: DOMAIN_WITH_PAID_POST, expiresInDays: -1 })]);

        await runCron();

        const html = postExpiryHtml('gone');
        expect(html).toContain(`Renew for $${config.renewalPrice} to relist it`);
        expect(html).not.toMatch(/save \d+%/i);
    });

    it('the post-expiry email names the saving against the next post price', async () => {
        seed([], [
            row('repeat', { status: 'paid', domain: DOMAIN_WITH_PAID_POST, userId: 'user-r', expiresInDays: -1 }),
            row('first', { status: 'promo', domain: DOMAIN_WITHOUT_PAID_POST, userId: 'user-f', expiresInDays: -2 }),
        ]);

        await runCron();

        expect(postExpiryHtml('repeat')).toContain(`Renew for $${config.renewalPrice} (Save 40% vs. your next new post at $${config.postingPrice})`);
        expect(postExpiryHtml('first')).toContain(`Renew for $${config.renewalPrice} (Save 10% vs. your next new post at $${config.introPrice})`);
        // A renewal only moves the end date, within the cap.
        expect(postExpiryHtml('repeat')).toContain('a renewal does not add unlocks or InMails.');
        expect(postExpiryHtml('repeat')).toContain(`Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.`);
    });

    it('a failed price lookup falls back to the named standard post price', async () => {
        getPlanSlotStatus.mockRejectedValue(new Error('db down'));
        seed([], [row('gone', { status: 'paid', expiresInDays: -1 })]);

        await runCron();

        expect(postExpiryHtml('gone')).toContain(`(Save 40% vs. the $${config.postingPrice} post price)`);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('a plan post that ended frees its slot: no renewal, post again at no extra charge', async () => {
        seed([], [row('plan', { status: 'plan', expiresInDays: -1 })]);

        await runCron();

        const html = postExpiryHtml('plan');
        expect(html).not.toContain(`$${config.renewalPrice}`);
        expect(html).toContain(`Each plan post runs ${config.durationDays} days, so this one has ended and its slot is free again. Post a job into it at no extra charge while you're subscribed.`);
        expect(html).not.toMatch(/plan slots? —|stay live while/);
    });
});

describe('after the promo with paid posting off', () => {
    it('offers nothing it cannot sell', async () => {
        vi.setSystemTime(AFTER_PROMO);
        getPaidPostingStatus.mockReturnValue({ enabled: false, stripeConfigured: true, available: false });
        seed([row('a', { status: 'paid', expiresInDays: 3 })], [row('gone', { status: 'paid', expiresInDays: -1 })]);

        await runCron();

        expect(warningOptionsFor('a')).toMatchObject({ renewalPurchasable: false, nextPostPrice: null });
        const html = postExpiryHtml('gone');
        expect(html).not.toContain(`$${config.renewalPrice}`);
        expect(html).not.toMatch(/free through/i);
        expect(html).toContain('Go to Your Dashboard');
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
