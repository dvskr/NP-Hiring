/**
 * lib/pricing.ts — which ladder rung the next post lands on (2026-09-12
 * launch promo + 2027 ladder).
 *
 * Pins the three rules the money depends on:
 *   - the intro allowance is consumed ONLY by a post that was actually paid
 *     for (paymentStatus 'paid') or a paid 5-post pack bought through Stripe
 *     at the domain: promo / pack / plan / legacy free / pending rows never
 *     count, nor do refunded, disputed or admin-comped packs, so a
 *     launch-promo poster still gets the intro price in 2027;
 *   - resolvePostingMode's order is promo → pack credit → intro → paid, and
 *     the promo / pack short-circuits never touch the database (the plan mode
 *     went in phase 2 of the 2027 re-price: no plan row exists);
 *   - quoteForMode returns exactly the shape the wizard, the preview and
 *     /api/employer/free-quota-status render from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import {
    FREE_EMAIL_DOMAINS,
    asPaidTier,
    countActivePromoPostsForDomain,
    countPaidPostsForDomain,
    domainOf,
    getNextPaidTier,
    isFreeEmailDomain,
    nextNewPostPrice,
    paidPostWhere,
    quoteForMode,
    resolvePostingMode,
} from '@/lib/pricing';
import * as pricing from '@/lib/pricing';

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
function fakeTx(count: number, packs = 0) {
    return {
        employerJob: { count: vi.fn().mockResolvedValue(count) },
        employerPostPack: { count: vi.fn().mockResolvedValue(packs) },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    // No pack at the domain unless a test says so (tests/setup.ts default).
    vi.mocked(prisma.employerPostPack.count).mockResolvedValue(0 as never);
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

describe('getNextPaidTier: a paid Stripe pack is the company paid purchase (owner decision 2026-10-24)', () => {
    it("quotes 'pro' once the domain bought a pack, though it has no paid post", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        vi.mocked(prisma.employerPostPack.count).mockResolvedValue(1 as never);

        expect(await getNextPaidTier(DOMAIN)).toBe('pro');
        // Only paid packs bought through Stripe at the domain count: a refunded,
        // disputed or admin-comped pack never uses the intro price up.
        expect(prisma.employerPostPack.count).toHaveBeenCalledWith({ where: { quotaDomain: DOMAIN, status: 'paid', source: 'stripe' } });
    });

    it("stays 'intro' while the domain has neither a paid post nor a paid pack", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        vi.mocked(prisma.employerPostPack.count).mockResolvedValue(0 as never);

        expect(await getNextPaidTier(DOMAIN)).toBe('intro');
    });

    it('reads both counts through the caller-supplied client', async () => {
        const tx = fakeTx(0, 1);

        expect(await getNextPaidTier(DOMAIN, tx as never)).toBe('pro');
        expect(tx.employerPostPack.count).toHaveBeenCalledOnce();
        expect(prisma.employerPostPack.count).not.toHaveBeenCalled();
    });

    it('a pack post never counts as a paid post: its row is written with paymentStatus pack', () => {
        // paidPostWhere selects paymentStatus 'paid' only; a renewed pack post
        // carries only a 'renewal' charge, which the OR excludes.
        expect(paidPostWhere(DOMAIN).paymentStatus).toBe('paid');
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

describe('the plan posting path is gone (phase 2: no plan row exists in production)', () => {
    it('lib/pricing no longer counts plan posts, and resolvePostingMode never answers plan', async () => {
        expect('countActivePlanPostsForUser' in pricing).toBe(false);
        vi.mocked(prisma.employerJob.count).mockResolvedValue(1 as never);
        for (const hasPackCredit of [true, false]) {
            const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPackCredit, now: AFTER_PROMO });
            expect(quote.mode).not.toBe('plan');
            expect(quote.tier).not.toBe('plan');
        }
    });
});

describe('quoteForMode — the shape every surface renders from', () => {
    it("'promo' is free, written as a 'pro' row, for the full duration", () => {
        expect(quoteForMode('promo')).toEqual({
            mode: 'promo', tier: 'pro', price: 0, priceCents: 0, willBeFree: true, durationDays: config.durationDays,
        });
    });

    it("'pack' is free now (the pack was the payment), written as a 'pack' row", () => {
        expect(quoteForMode('pack')).toEqual({
            mode: 'pack', tier: 'pack', price: 0, priceCents: 0, willBeFree: true, durationDays: config.durationDays,
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
        for (const mode of ['promo', 'pack', 'intro', 'paid'] as const) {
            expect(quoteForMode(mode).durationDays).toBe(config.durationDays);
        }
    });

    it('keeps cents and dollars in lockstep so Stripe and the UI cannot disagree', () => {
        for (const mode of ['promo', 'pack', 'intro', 'paid'] as const) {
            const q = quoteForMode(mode);
            expect(q.priceCents).toBe(q.price * 100);
            expect(q.willBeFree).toBe(q.price === 0);
        }
    });
});

describe('resolvePostingMode — promo → pack credit → intro → paid', () => {
    it('the launch promo wins while it runs, even with a pack credit, without a DB read', async () => {
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPackCredit: true, now: DURING_PROMO });
        expect(quote.mode).toBe('promo');
        expect(quote.willBeFree).toBe(true);
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.count).not.toHaveBeenCalled();
    });

    it('a usable pack credit wins after the promo, ahead of the intro price, without a DB read', async () => {
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPackCredit: true, now: AFTER_PROMO });
        expect(quote).toMatchObject({ mode: 'pack', tier: 'pack', price: 0, willBeFree: true });
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.count).not.toHaveBeenCalled();
    });

    it("'intro' when the domain has no paid post after the promo", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPackCredit: false, now: AFTER_PROMO });
        expect(quote).toMatchObject({ mode: 'intro', tier: 'intro', price: config.introPrice, willBeFree: false });
    });

    it("'paid' once the domain already has a paid post", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(1 as never);
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPackCredit: false, now: AFTER_PROMO });
        expect(quote).toMatchObject({ mode: 'paid', tier: 'pro', price: config.postingPrice, willBeFree: false });
    });

    it("'paid' once the domain bought a pack, whose credits are all spent or expired", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        vi.mocked(prisma.employerPostPack.count).mockResolvedValue(1 as never);
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPackCredit: false, now: AFTER_PROMO });
        expect(quote).toMatchObject({ mode: 'paid', tier: 'pro', price: config.postingPrice });
    });

    it('a promo post never consumed the intro price: the paid count decides, not history of free rows', async () => {
        // Simulates a domain that posted for free during the promo (those rows
        // are 'promo', so the 'paid'-only count is still zero in 2027).
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPackCredit: false, now: AFTER_PROMO });
        expect(quote.mode).toBe('intro');
        expect(prisma.employerJob.count).toHaveBeenCalledWith({ where: PAID_POST_WHERE(DOMAIN) });
    });

    it('passes the supplied db client through to the paid-post count', async () => {
        const tx = fakeTx(1);
        const quote = await resolvePostingMode({ quotaDomain: DOMAIN, hasPackCredit: false, now: AFTER_PROMO, db: tx as never });
        expect(quote.mode).toBe('paid');
        expect(tx.employerJob.count).toHaveBeenCalledOnce();
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });
});

describe('nextNewPostPrice: the price a renewal saving is measured against', () => {
    it('is 0 with a usable pack credit after the promo: no saving is ever claimed against it', async () => {
        expect(await nextNewPostPrice({ quotaDomain: DOMAIN, hasPackCredit: true, now: AFTER_PROMO })).toBe(0);
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });
});

describe('asPaidTier — narrowing untrusted metadata / pricingTier', () => {
    it("keeps 'intro'", () => {
        expect(asPaidTier('intro')).toBe('intro');
    });

    it("maps everything else — including 'plan' and 'pack' — to 'pro' so nothing under-charges", () => {
        for (const value of ['pro', 'plan', 'pack', undefined, null, '', 'starter', 'INTRO', 42]) {
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
