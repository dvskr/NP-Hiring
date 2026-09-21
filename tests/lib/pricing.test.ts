/**
 * lib/pricing.ts — which ladder rung the next post lands on (2026-09-12
 * launch promo + 2027 ladder).
 *
 * Pins the three rules the money depends on:
 *   - the intro allowance is consumed ONLY by rows that were actually paid
 *     for (paymentStatus 'paid') — promo / plan / legacy free / pending rows
 *     never count, so a launch-promo poster still gets the intro price in 2027;
 *   - resolvePostingMode's order is promo → plan → intro → paid, and the
 *     promo / plan short-circuits never touch the database;
 *   - quoteForMode returns exactly the shape the wizard, the preview and
 *     /api/employer/free-quota-status render from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import {
    FREE_EMAIL_DOMAINS,
    asPaidTier,
    countActivePlanPostsForUser,
    countActivePromoPostsForDomain,
    countPaidPostsForDomain,
    domainOf,
    getNextPaidTier,
    isFreeEmailDomain,
    paidPostWhere,
    quoteForMode,
    resolvePostingMode,
} from '@/lib/pricing';

const DOMAIN = 'clinic.example';
/**
 * The exact intro-allowance predicate. Spelled out (not imported) so a change
 * to lib/pricing.ts that quietly widens or narrows what counts as a "paid
 * post" fails here first. The OR is what keeps a renewed promo post — flipped
 * to 'paid' by the renewal webhook with only a 'renewal' JobCharge — from
 * burning the domain's intro price.
 */
const PAID_POST_WHERE = (quotaDomain: string) => ({
    quotaDomain,
    paymentStatus: 'paid',
    OR: [
        { jobCharges: { some: { type: 'new' } } },
        { jobCharges: { none: {} } },
    ],
});
const DURING_PROMO = new Date('2026-10-01T12:00:00.000Z');
const AFTER_PROMO = new Date('2027-03-01T12:00:00.000Z');

/** A transaction-client stand-in so "reads through the caller's client" is observable. */
function fakeTx(count: number) {
    return { employerJob: { count: vi.fn().mockResolvedValue(count) } };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getNextPaidTier / countPaidPostsForDomain', () => {
    it("counts only rows with paymentStatus 'paid' that were bought as a post at the domain", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        await countPaidPostsForDomain(DOMAIN);
        // Exact clause: promo, plan, legacy free and abandoned pending rows must
        // never consume the intro allowance — nor may a promo post that was
        // later renewed (status 'paid', but its only charge is type 'renewal').
        // Legacy paid rows with no ledger entry still count: they were bought.
        expect(prisma.employerJob.count).toHaveBeenCalledWith({
            where: PAID_POST_WHERE(DOMAIN),
        });
    });

    it('exposes the same predicate as paidPostWhere so callers cannot drift from it', () => {
        expect(paidPostWhere(DOMAIN)).toEqual(PAID_POST_WHERE(DOMAIN));
    });

    it("quotes 'intro' while the domain has no paid post", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        expect(await getNextPaidTier(DOMAIN)).toBe('intro');
    });

    it("quotes 'pro' once a single paid post exists — and stays there", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(1 as never);
        expect(await getNextPaidTier(DOMAIN)).toBe('pro');
        vi.mocked(prisma.employerJob.count).mockResolvedValue(7 as never);
        expect(await getNextPaidTier(DOMAIN)).toBe('pro');
    });

    it('reads through the caller-supplied client (transaction snapshot), not the global one', async () => {
        const tx = fakeTx(1);
        expect(await getNextPaidTier(DOMAIN, tx as never)).toBe('pro');
        expect(tx.employerJob.count).toHaveBeenCalledOnce();
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });
});

describe('countActivePromoPostsForDomain — the launch-promo abuse cap', () => {
    it("counts live, unexpired 'promo' rows at the domain as of `now`", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(3 as never);
        expect(await countActivePromoPostsForDomain(DOMAIN, prisma, DURING_PROMO)).toBe(3);
        expect(prisma.employerJob.count).toHaveBeenCalledWith({
            where: {
                quotaDomain: DOMAIN,
                paymentStatus: 'promo',
                job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: DURING_PROMO } }] },
            },
        });
    });

    it('reads through the supplied client', async () => {
        const tx = fakeTx(2);
        expect(await countActivePromoPostsForDomain(DOMAIN, tx as never, DURING_PROMO)).toBe(2);
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });
});

describe('countActivePlanPostsForUser — plan slot re-check inside the posting transaction', () => {
    it("counts live 'plan' rows for the user through the supplied client", async () => {
        const tx = fakeTx(4);
        expect(await countActivePlanPostsForUser('user-1', tx as never, AFTER_PROMO)).toBe(4);
        expect(tx.employerJob.count).toHaveBeenCalledWith({
            where: {
                userId: 'user-1',
                paymentStatus: 'plan',
                job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: AFTER_PROMO } }] },
            },
        });
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });
});

describe('quoteForMode — the shape every surface renders from', () => {
    it("'promo' is free, written as a 'pro' row, for the full duration", () => {
        expect(quoteForMode('promo')).toEqual({
            mode: 'promo', tier: 'pro', price: 0, priceCents: 0, willBeFree: true, durationDays: config.durationDays,
        });
    });

    it("'plan' is free, written as a 'plan' row", () => {
        expect(quoteForMode('plan')).toEqual({
            mode: 'plan', tier: 'plan', price: 0, priceCents: 0, willBeFree: true, durationDays: config.durationDays,
        });
    });

    it("'intro' charges the intro price", () => {
        expect(quoteForMode('intro')).toEqual({
            mode: 'intro',
            tier: 'intro',
            price: config.introPrice,
            priceCents: config.stripeIntroPriceInCents,
            willBeFree: false,
            durationDays: config.durationDays,
        });
    });

    it("'paid' charges the featured price as a 'pro' row", () => {
        expect(quoteForMode('paid')).toEqual({
            mode: 'paid',
            tier: 'pro',
            price: config.postingPrice,
            priceCents: config.stripePriceInCents,
            willBeFree: false,
            durationDays: config.durationDays,
        });
    });

    it('never quotes a shorter free window — every rung runs config.durationDays', () => {
        for (const mode of ['promo', 'plan', 'intro', 'paid'] as const) {
            expect(quoteForMode(mode).durationDays).toBe(config.durationDays);
        }
    });

    it('keeps cents and dollars in lockstep so Stripe and the UI cannot disagree', () => {
        for (const mode of ['promo', 'plan', 'intro', 'paid'] as const) {
            const q = quoteForMode(mode);
            expect(q.priceCents).toBe(q.price * 100);
            expect(q.willBeFree).toBe(q.price === 0);
        }
    });
});

describe('resolvePostingMode — promo → plan → intro → paid', () => {
    it('the launch promo wins while it runs, even with a plan slot, without a DB read', async () => {
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPlanSlot: true, now: DURING_PROMO });
        expect(quote.mode).toBe('promo');
        expect(quote.willBeFree).toBe(true);
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it('a plan slot wins after the promo, without a DB read', async () => {
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPlanSlot: true, now: AFTER_PROMO });
        expect(quote.mode).toBe('plan');
        expect(quote.tier).toBe('plan');
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it("'intro' when the domain has no paid post after the promo", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPlanSlot: false, now: AFTER_PROMO });
        expect(quote).toMatchObject({ mode: 'intro', tier: 'intro', price: config.introPrice, willBeFree: false });
    });

    it("'paid' once the domain already has a paid post", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(1 as never);
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPlanSlot: false, now: AFTER_PROMO });
        expect(quote).toMatchObject({ mode: 'paid', tier: 'pro', price: config.postingPrice, willBeFree: false });
    });

    it('a promo post never consumed the intro price: the paid count decides, not history of free rows', async () => {
        // Simulates a domain that posted for free during the promo (those rows
        // are 'promo', so the 'paid'-only count is still zero in 2027).
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPlanSlot: false, now: AFTER_PROMO });
        expect(quote.mode).toBe('intro');
        expect(prisma.employerJob.count).toHaveBeenCalledWith({ where: PAID_POST_WHERE(DOMAIN) });
    });

    it('passes the supplied db client through to the paid-post count', async () => {
        const tx = fakeTx(1);
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPlanSlot: false, now: AFTER_PROMO, db: tx as never });
        expect(quote.mode).toBe('paid');
        expect(tx.employerJob.count).toHaveBeenCalledOnce();
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });
});

describe('asPaidTier — narrowing untrusted metadata / pricingTier', () => {
    it("keeps 'intro'", () => {
        expect(asPaidTier('intro')).toBe('intro');
    });

    it("maps everything else — including 'plan' — to 'pro' so nothing under-charges", () => {
        for (const value of ['pro', 'plan', undefined, null, '', 'starter', 'INTRO', 42]) {
            expect(asPaidTier(value)).toBe('pro');
        }
    });
});

describe('free email domains — the shared gate list', () => {
    it('blocks the consumer providers, case-insensitively', () => {
        expect(isFreeEmailDomain('gmail.com')).toBe(true);
        expect(isFreeEmailDomain('GMAIL.COM')).toBe(true);
        expect(isFreeEmailDomain('outlook.com')).toBe(true);
        expect(FREE_EMAIL_DOMAINS).toEqual(expect.arrayContaining(['gmail.com', 'yahoo.com', 'hotmail.com', 'icloud.com', 'protonmail.com']));
    });

    it('treats a missing domain as blocked (never lets an empty signup email post)', () => {
        expect(isFreeEmailDomain(null)).toBe(true);
        expect(isFreeEmailDomain(undefined)).toBe(true);
        expect(isFreeEmailDomain('')).toBe(true);
    });

    it('allows a company domain', () => {
        expect(isFreeEmailDomain(DOMAIN)).toBe(false);
    });

    it('domainOf lower-cases and rejects malformed addresses', () => {
        expect(domainOf('Bob@Clinic.Example')).toBe('clinic.example');
        expect(domainOf('nope')).toBeNull();
        expect(domainOf('bob@')).toBeNull();
        expect(domainOf(null)).toBeNull();
        expect(domainOf(undefined)).toBeNull();
    });
});
