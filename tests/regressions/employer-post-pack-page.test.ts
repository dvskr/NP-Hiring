/**
 * /employer/post-pack — where an employer buys the 5-post pack and sees the
 * packs it holds (2027 re-price, phase 3; plan sections 3.3 and 3.9).
 *
 * A server page behind requireEmployer, noindex like the rest of /employer.
 * Pins, rendering the real page at fixed instants with the sale gate mocked:
 *   - the offer, priced from config: "$1,245 for 5 posts", "$249 a post, to
 *     use within 12 months", the full package, the $199 renewal, the intro
 *     price a pack uses up, the one comparison the owner allowed, all sales
 *     final; never a saving;
 *   - while the promo runs: the price dated from the ladder's start and no
 *     way to buy; once the ladder is live: the Buy button while the sale is
 *     open, the support email while it is closed, and the company email
 *     requirement for a free-email signup;
 *   - the account's own packs: posts left of the total and the date to use
 *     them by, "5 of 5 posts used" for a used-up pack, the state of a
 *     refunded one, and Stripe's hosted invoice link;
 *   - the return from Checkout (?session_id=cs_...) is handed to the client
 *     check of /api/verify-pack-session, and nothing else is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { PACK_COMPARISON, packUseByLabel } from '@/lib/pricing-copy';
import { MAX_PACKS_LISTED, POST_PACK_VIEW_SELECT } from '@/lib/post-pack-view';

const auth = vi.hoisted(() => ({ email: 'owner@clinic.example', role: 'employer' }));
const requireEmployer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/protect', () => ({ requireEmployer }));
const sale = vi.hoisted(() => ({ open: false }));
vi.mock('@/lib/post-pack-sale', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/post-pack-sale')>();
    return { ...actual, isPackSaleOpen: () => sale.open };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return { default: ({ href, children }: { href: string; children?: React.ReactNode }) => createElement('a', { href }, children) };
});
vi.mock('@/lib/analytics', () => ({ trackBeginCheckout: vi.fn() }));

import PostPackPage, * as postPackPage from '@/app/employer/post-pack/page';

const DURING_PROMO = new Date('2026-12-01T12:00:00.000Z');
const LADDER_LIVE = new Date('2027-06-01T12:00:00.000Z');
const EXPIRES = new Date('2028-03-01T12:00:00.000Z');
const PACK_PRICE = config.formatDollars(config.packPrice);
const BUY = `Buy ${config.packPosts} posts · ${PACK_PRICE}`;

function pack(overrides: Record<string, unknown> = {}) {
    return {
        id: 'pack-1',
        status: 'paid',
        creditsTotal: config.packPosts,
        creditsRemaining: 3,
        creditsRevoked: 0,
        amountCents: config.stripePackPriceInCents,
        currency: 'usd',
        purchasedAt: new Date('2027-03-01T12:00:00.000Z'),
        expiresAt: EXPIRES,
        hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc',
        invoicePdfUrl: null,
        invoiceNumber: 'INV-0042',
        ...overrides,
    };
}

async function render(now: Date, searchParams: Record<string, string> = {}): Promise<string> {
    vi.setSystemTime(now);
    return renderToStaticMarkup(await PostPackPage({ searchParams: Promise.resolve(searchParams) }));
}

const text = (html: string): string =>
    html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    sale.open = false;
    auth.email = 'owner@clinic.example';
    auth.role = 'employer';
    requireEmployer.mockImplementation(async () => ({ user: { id: 'user-1', email: auth.email }, profile: { role: auth.role } }));
    vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([] as never);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the page', () => {
    it('is noindex, behind requireEmployer, and renders per request', async () => {
        expect(postPackPage.metadata.robots).toEqual({ index: false, follow: false });
        expect(postPackPage.dynamic).toBe('force-dynamic');
        await render(LADDER_LIVE);
        expect(requireEmployer).toHaveBeenCalledWith('/employer/post-pack');
    });

    it("reads only the signed-in account's packs, bounded", async () => {
        await render(LADDER_LIVE);

        expect(prisma.employerPostPack.findMany).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            orderBy: { purchasedAt: 'desc' },
            take: MAX_PACKS_LISTED,
            select: POST_PACK_VIEW_SELECT,
        });
    });
});

describe('the offer', () => {
    it('is priced from config, states the terms, and names no saving', async () => {
        for (const now of [DURING_PROMO, LADDER_LIVE]) {
            const page = text(await render(now));
            expect(page).toContain(`${config.packPosts}-post pack`);
            expect(page).toContain(`${PACK_PRICE} for ${config.packPosts} posts`);
            expect(page).toContain(`${config.formatDollars(config.packPrice / config.packPosts)} a post, to use within ${config.packValidityMonths} months`);
            expect(page).toContain(`${config.limits.candidateUnlocksPerPosting} candidate unlocks`);
            expect(page).toContain(`The posts belong to this account and renew for $${config.renewalPrice}.`);
            expect(page).toContain(`Buying a pack uses your company's intro price, so single posts after it are $${config.postingPrice}.`);
            expect(page).toContain(PACK_COMPARISON);
            expect(page).toContain('All sales are final');
            expect(page).not.toMatch(/\bsav(?:e|es|ing)\b|\$500|discount/i);
        }
    });

    it('while the promo runs: the price dated from the ladder start, and no way to buy', async () => {
        sale.open = true;
        const html = await render(DURING_PROMO);

        expect(text(html)).toContain(`From ${config.ladderStartsLabel}, a ${config.packPosts}-post pack is ${PACK_PRICE}.`);
        expect(html).not.toContain(BUY);
        expect(html).not.toContain(`mailto:${brand.email.support}`);
    });

    it('once the ladder is live, with the sale open: the Buy button', async () => {
        sale.open = true;
        const html = await render(LADDER_LIVE);

        expect(text(html)).toContain(BUY);
        expect(html).not.toContain('Ask about the pack');
    });

    it('with the sale closed: the support email', async () => {
        const html = await render(LADDER_LIVE);

        expect(html).toContain(`href="mailto:${brand.email.support}"`);
        expect(text(html)).toContain('Ask about the pack');
        expect(html).not.toContain(BUY);
    });

    it('a free-email signup is told the company email requirement, and offered no Buy button', async () => {
        sale.open = true;
        auth.email = 'someone@gmail.com';
        const html = await render(LADDER_LIVE);

        expect(text(html)).toContain('Packs are sold to employer accounts with a company email address.');
        expect(html).not.toContain(BUY);
    });
});

describe("the account's packs", () => {
    it('lists each pack: bought, the posts left and the date to use them by, its invoice', async () => {
        vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([pack()] as never);
        const html = await render(LADDER_LIVE);
        const page = text(html);

        expect(page).toContain('Your packs');
        expect(page).toContain(`3 of ${config.packPosts} posts left`);
        expect(page).toContain(`Use by ${packUseByLabel(EXPIRES)}`);
        expect(page).toContain('Bought March 1, 2027');
        expect(html).toContain('href="https://invoice.stripe.test/i/abc"');
        expect(html).toContain('href="/post-job"');
    });

    it('a used-up pack reads "5 of 5 posts used", and a refunded one says so', async () => {
        vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([
            pack({ creditsRemaining: 0 }),
            pack({ id: 'pack-0', status: 'refunded', creditsRemaining: 0, creditsRevoked: 5, hostedInvoiceUrl: null }),
        ] as never);
        const page = text(await render(LADDER_LIVE));

        expect(page).toContain(`${config.packPosts} of ${config.packPosts} posts used`);
        expect(page).toContain('Refunded');
    });

    it('shows no list without a pack', async () => {
        expect(text(await render(LADDER_LIVE))).not.toContain('Your packs');
    });
});

describe('the return from Checkout', () => {
    it('hands a checkout session id to the purchase check', async () => {
        expect(text(await render(LADDER_LIVE, { session_id: 'cs_test_a1B2' }))).toContain('Checking your purchase');
    });

    it('ignores anything that is not a checkout session id', async () => {
        for (const session_id of ['', 'not-a-session', 'cs_<script>', `cs_${'x'.repeat(300)}`]) {
            expect(text(await render(LADDER_LIVE, { session_id })), session_id).not.toContain('Checking your purchase');
        }
    });
});
