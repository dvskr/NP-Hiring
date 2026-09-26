/**
 * Renewal offer truth (package RENEWAL-OFFER).
 *
 * The dashboard, the edit page, the expiry warning email and the post-expiry
 * email all used to print round((1 - renewalPrice / postingPrice) * 100) = 40
 * and claim a $179 renewal "saves 40% vs. a new post". That is false during
 * the launch promo (a new post is free), false by a wide margin for a domain
 * whose next post is the $199 intro price, and false outright for an
 * employer with a free Employer plan slot. It also offered the renewal while
 * the renewal checkout answers 503 (paid posting off).
 *
 * lib/pricing.ts now decides the claim in one place:
 *   - no saving unless a renewal can be bought AND the promo is over AND the
 *     renewal is cheaper than the price it is compared with;
 *   - the comparison is the reader's own next new post when known
 *     ('next-post'), otherwise the standard post price, named as such
 *     ('list-price');
 *   - the percent rounds DOWN so the claim never overstates.
 * The dashboard mirrors the rule client side (it cannot import the Prisma
 * backed module); the parity block below keeps the two from drifting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import {
    nextNewPostPrice,
    renewalSavings,
    renewalSavingsLabel,
    resolveRenewalOffer,
} from '@/lib/pricing';

const DURING_PROMO = new Date('2026-11-21T12:00:00.000Z');
const LAST_PROMO_INSTANT = new Date(Date.parse(config.promoEndsAt) - 1);
const AFTER_PROMO = new Date('2027-03-01T12:00:00.000Z');
const DOMAIN = 'clinic.example';
const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

beforeEach(() => {
    vi.clearAllMocks();
});

describe('renewalSavings: only a real, rounded-down saving', () => {
    it('against the standard post price', () => {
        expect(renewalSavings(config.postingPrice, 'list-price')).toEqual({
            dollars: config.postingPrice - config.renewalPrice,
            percent: Math.floor(((config.postingPrice - config.renewalPrice) / config.postingPrice) * 100),
            comparedWith: config.postingPrice,
            basis: 'list-price',
        });
    });

    it('against the intro price the saving is small, not the list-price 40%', () => {
        const savings = renewalSavings(config.introPrice, 'next-post');
        expect(savings?.dollars).toBe(config.introPrice - config.renewalPrice);
        expect(savings?.percent).toBe(Math.floor(((config.introPrice - config.renewalPrice) / config.introPrice) * 100));
        expect(savings?.percent).toBeLessThan(Math.round((1 - config.renewalPrice / config.postingPrice) * 100));
    });

    it('never claims a saving when the renewal is not cheaper', () => {
        expect(renewalSavings(0, 'next-post')).toBeNull();
        expect(renewalSavings(config.renewalPrice, 'next-post')).toBeNull();
        expect(renewalSavings(config.renewalPrice - 1, 'next-post')).toBeNull();
    });

    it('never claims "save 0%" for a sub-1% difference, nor anything for a non-number', () => {
        expect(renewalSavings(config.renewalPrice + 1, 'next-post')).toBeNull();
        expect(renewalSavings(Number.NaN, 'next-post')).toBeNull();
    });

    it('rounds down so the claim never overstates', () => {
        // 179 vs 299 is 40.13%; 179 vs 199 is 10.05%: both floor, never round up.
        const s = renewalSavings(1000, 'list-price', 555);
        expect(s?.percent).toBe(44); // 44.5% floors to 44
    });
});

describe('resolveRenewalOffer: when a saving may be claimed', () => {
    it('during the promo: no saving, even when a renewal can be bought', () => {
        for (const now of [DURING_PROMO, LAST_PROMO_INSTANT]) {
            const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.postingPrice, now });
            expect(offer).toEqual({ purchasable: true, promoActive: true, price: config.renewalPrice, savings: null });
        }
    });

    it('while no renewal can be bought: no saving, promo or not', () => {
        expect(resolveRenewalOffer({ purchasable: false, now: DURING_PROMO }).savings).toBeNull();
        expect(resolveRenewalOffer({ purchasable: false, nextPostPrice: config.postingPrice, now: AFTER_PROMO }).savings).toBeNull();
        expect(resolveRenewalOffer({ purchasable: false, now: AFTER_PROMO }).purchasable).toBe(false);
    });

    it("after the promo: measured against the reader's own next new post", () => {
        const intro = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.introPrice, now: AFTER_PROMO });
        expect(intro.promoActive).toBe(false);
        expect(intro.savings).toMatchObject({ basis: 'next-post', comparedWith: config.introPrice });
        const pro = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.postingPrice, now: AFTER_PROMO });
        expect(pro.savings).toMatchObject({ basis: 'next-post', comparedWith: config.postingPrice });
    });

    it('a free plan slot (next post costs 0) gets no saving', () => {
        expect(resolveRenewalOffer({ purchasable: true, nextPostPrice: 0, now: AFTER_PROMO }).savings).toBeNull();
    });

    it('an unknown next-post price compares with the standard post price and says so', () => {
        for (const nextPostPrice of [null, undefined]) {
            const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice, now: AFTER_PROMO });
            expect(offer.savings).toMatchObject({ basis: 'list-price', comparedWith: config.postingPrice });
        }
    });
});

describe('renewalSavingsLabel: names the price it is measured against', () => {
    it('next-post and list-price wording, house style', () => {
        const next = renewalSavingsLabel(renewalSavings(config.introPrice, 'next-post')!);
        const list = renewalSavingsLabel(renewalSavings(config.postingPrice, 'list-price')!);
        expect(next).toBe(`Save 10% vs. your next new post at $${config.introPrice}`);
        expect(list).toBe(`Save 40% vs. the $${config.postingPrice} post price`);
        for (const label of [next, list]) {
            expect(label).not.toMatch(/[–—]|\s-\s/);
            expect(label).not.toContain('a new post');
        }
    });
});

describe('nextNewPostPrice: the reader-specific comparison price', () => {
    it('is unknown without a quota domain, and reads nothing', async () => {
        expect(await nextNewPostPrice({ quotaDomain: null, hasPlanSlot: false, now: AFTER_PROMO })).toBeNull();
        expect(await nextNewPostPrice({ quotaDomain: undefined, hasPlanSlot: false, now: AFTER_PROMO })).toBeNull();
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it('is 0 during the promo and with a free plan slot, without a DB read', async () => {
        expect(await nextNewPostPrice({ quotaDomain: DOMAIN, hasPlanSlot: false, now: DURING_PROMO })).toBe(0);
        expect(await nextNewPostPrice({ quotaDomain: DOMAIN, hasPlanSlot: true, now: AFTER_PROMO })).toBe(0);
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it("is the intro price for a domain's first paid post, the post price after that", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValueOnce(0 as never);
        expect(await nextNewPostPrice({ quotaDomain: DOMAIN, hasPlanSlot: false, now: AFTER_PROMO })).toBe(config.introPrice);
        vi.mocked(prisma.employerJob.count).mockResolvedValueOnce(2 as never);
        expect(await nextNewPostPrice({ quotaDomain: DOMAIN, hasPlanSlot: false, now: AFTER_PROMO })).toBe(config.postingPrice);
    });
});

describe('client surfaces mirror the server rule', () => {
    it('the dashboard savings line agrees with lib/pricing for every price and date', async () => {
        const { renewalSavingsLine } = await import('@/components/employer/EmployerDashboardClient');
        const prices: (number | null)[] = [null, 0, config.renewalPrice - 1, config.renewalPrice, config.renewalPrice + 1, config.introPrice, config.postingPrice];
        for (const now of [DURING_PROMO, LAST_PROMO_INSTANT, AFTER_PROMO]) {
            for (const nextPostPrice of prices) {
                const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice, now });
                const expected = offer.savings ? renewalSavingsLabel(offer.savings) : null;
                expect(renewalSavingsLine(nextPostPrice, now), `${now.toISOString()} / ${nextPostPrice}`).toBe(expected);
            }
        }
    }, 30_000);

    it('no surface computes the old list-price-only discount any more', () => {
        const oldFormula = /1 - config\.renewalPrice \/ config\.postingPrice/;
        for (const rel of [
            'components/employer/EmployerDashboardClient.tsx',
            'app/jobs/edit/[token]/page.tsx',
            'lib/email-service.ts',
            'app/api/cron/expiry-warnings/route.ts',
        ]) {
            const src = read(rel);
            expect(src, rel).not.toMatch(oldFormula);
            expect(src, rel).not.toMatch(/vs\. a new post/);
        }
    });

    it('both pages learn availability from the existing endpoint and sell a renewal only when it is on', () => {
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        expect(dashboard).toContain("readJson<{ available?: boolean }>('/api/create-checkout/availability')");
        expect(dashboard).toContain("readJson<{ eligible?: boolean; price?: number }>('/api/employer/free-quota-status')");
        expect(dashboard).toContain('const renewalPurchasable = paidPostingAvailable === true;');
        // The Renew action appears only once availability is known, and only with something to offer.
        expect(dashboard).toContain('const canOfferRenewAction = paidPostingAvailable !== null && (renewalPurchasable || promoActive);');
        expect(dashboard).toContain('{mounted && shouldShowRenew(job) && canOfferRenewAction && (');
        // Both renewal modals need a purchasable renewal; otherwise the free repost modal opens.
        expect(dashboard).toContain("{showRenewModal && selectedJob && renewalPurchasable && selectedJob.paymentStatus === 'free' && (");
        expect(dashboard).toContain("{showRenewModal && selectedJob && renewalPurchasable && selectedJob.paymentStatus !== 'free' && (");
        expect(dashboard).toContain('{showRenewModal && selectedJob && !renewalPurchasable && (');
        expect(dashboard).toContain('if (!selectedJob || !renewalPurchasable) return;');

        const edit = read('app/jobs/edit/[token]/page.tsx');
        expect(edit).toContain("fetch('/api/create-checkout/availability')");
        expect(edit).toContain('const offerRenewal = canRenew && renewalPurchasable;');
        expect(edit).toContain("{showRenewModal && job && renewalPurchasable && employerJob?.paymentStatus === 'free' && (");
        expect(edit).toContain("{showRenewModal && job && employerJob?.paymentStatus !== 'free' && offerRenewal && (");
        expect(edit).toContain('if (!job || !renewalPurchasable) return;');
    });

    it('during the promo the pages offer the free repost, dated with the promo end', () => {
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        expect(dashboard).toContain('`Renewal is not available yet. Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge.`');
        const edit = read('app/jobs/edit/[token]/page.tsx');
        expect(edit).toContain('` Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge.`');
        for (const src of [dashboard, edit]) {
            expect(src).toContain('Or post this role again as a fresh listing, free through {config.promoEndsLabel}.');
        }
    });

    it('the renewal modals describe a renewal as the webhook applies it', () => {
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        const edit = read('app/jobs/edit/[token]/page.tsx');
        expect(dashboard).toContain('It does not add unlocks or InMails. Renewals can extend a post to at most {config.renewalCapDays} days after it was first posted.');
        expect(edit).toContain('<li>Does not add unlocks or InMails</li>');
        expect(edit).toContain('<li>Renewals can extend a post to at most {config.renewalCapDays} days after it was first posted</li>');
        expect(edit).not.toContain('(top of list)');
        for (const src of [dashboard, edit]) expect(src).not.toContain('new bucket of');
    });

    it('plan wording on both pages: each post runs its days, then post again into the free slot', () => {
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        const edit = read('app/jobs/edit/[token]/page.tsx');
        expect(dashboard).toContain('Each plan post runs {config.durationDays} days and isn&apos;t renewed. When this one ends, post again into the free slot at no extra charge while you&apos;re subscribed.');
        expect(edit).toContain("When it ends, post again into the free slot at no extra charge while you're subscribed.");
        for (const src of [dashboard, edit]) {
            expect(src).not.toContain('from a plan slot');
            expect(src).not.toMatch(/live while (the|your) (Employer )?plan/);
        }
    });

    it('the edit page (no quota domain) claims only against the named post price, never during the promo', () => {
        const src = read('app/jobs/edit/[token]/page.tsx');
        const fn = src.slice(src.indexOf('function listPriceSavingsLine'), src.indexOf('const workModes'));
        expect(fn).toContain('if (config.isPromoActive(now)) return null;');
        expect(fn).toContain('if (comparedWith <= config.renewalPrice) return null;');
        expect(fn).toContain('Math.floor(');
        expect(fn).toContain('`Save ${percent}% vs. the $${comparedWith} post price`');
    });
});
