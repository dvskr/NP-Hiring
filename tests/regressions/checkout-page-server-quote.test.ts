/**
 * /post-job/checkout shows only the amount the server quoted.
 *
 * The bug: during the launch promo a stale draft reached this page, which
 * showed the "no payment needed" banner AND an active "Proceed to Payment:
 * $299" button; the amount fell back to config.postingPrice whenever the
 * quote was free or missing, while the server would have charged the $199
 * intro rung. Pins:
 *   - a free quote (promo or plan slot) renders no Pay button at all, only
 *     the way back to the preview, even while paid posting is switched off;
 *   - a paid quote shows exactly the quoted amount (intro or featured);
 *   - no quote yet: no amount, Pay disabled; no usable quote: no amount,
 *     Pay says so, and Stripe shows the amount before anything is charged;
 *   - the page carries no list-price fallback for the amount.
 *
 * The page is a client component whose state arrives through effects, which
 * do not run under renderToStaticMarkup, so each case seeds the page's
 * useState values directly (see renderPage for the order).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import CheckoutPage from '@/app/post-job/checkout/page';

const seeded = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: (initial: unknown) => {
            const i = seeded.index++;
            const value = i < seeded.values.length
                ? seeded.values[i]
                : typeof initial === 'function' ? (initial as () => unknown)() : initial;
            return [value, () => undefined];
        },
    };
});

vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return {
        default: ({ href, className, children }: { href: string; className?: string; children?: React.ReactNode }) =>
            createElement('a', { href, className }, children),
    };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ trackBeginCheckout: vi.fn() }));

const JOB = {
    title: 'Nurse Practitioner, Telehealth',
    companyName: 'Clinic Co',
    contactEmail: 'hiring@clinic.example',
    location: 'Remote',
    mode: 'Remote',
    jobType: 'Full-Time',
    description: '<p>Role</p>',
    applyUrl: 'https://clinic.example/apply',
    pricingTier: 'pro',
};

const PROMO = { eligible: true, mode: 'promo', tier: 'pro', willBeFree: true, price: 0, priceCents: 0 };
const PLAN = { eligible: true, mode: 'plan', tier: 'plan', willBeFree: true, price: 0, priceCents: 0 };
const INTRO = { eligible: true, mode: 'intro', tier: 'intro', willBeFree: false, price: config.introPrice, priceCents: config.stripeIntroPriceInCents };
const FEATURED = { eligible: true, mode: 'paid', tier: 'pro', willBeFree: false, price: config.postingPrice, priceCents: config.stripePriceInCents };

interface PageState {
    quoteFetch: 'loading' | 'loaded' | 'failed';
    quote?: object | null;
    /** GET /api/create-checkout/availability; null while unknown. */
    paidPostingAvailable?: boolean | null;
}

function renderPage(state: PageState): string {
    // The page's useState calls, in order: jobData, loading, error,
    // paidPostingAvailable, quote, quoteFetch.
    seeded.values = [JOB, false, null, state.paidPostingAvailable ?? true, state.quote ?? null, state.quoteFetch];
    seeded.index = 0;
    return renderToStaticMarkup(React.createElement(CheckoutPage));
}

const INTRO_AMOUNT = `$${config.introPrice}`;
const FEATURED_AMOUNT = `$${config.postingPrice}`;

describe('a free quote renders no Pay button', () => {
    it('launch promo: the way back to the preview, no Pay, no amount', () => {
        const html = renderPage({ quoteFetch: 'loaded', quote: PROMO });

        expect(html).not.toContain('Proceed to Payment');
        expect(html).not.toContain('By clicking Pay');
        expect(html).toContain('<a href="/post-job/preview"');
        expect(html).toContain('Go back to the preview to post it');
        expect(html).toContain(`every post is free through ${config.promoEndsLabel}`);
        expect(html).toContain('Free');
        expect(html).not.toContain(INTRO_AMOUNT);
        expect(html).not.toContain(FEATURED_AMOUNT);
    });

    it('launch promo while paid posting is off: still the free path, not the coming-soon state', () => {
        const html = renderPage({ quoteFetch: 'loaded', quote: PROMO, paidPostingAvailable: false });

        expect(html).not.toContain('Paid posting is coming soon');
        expect(html).not.toContain('Proceed to Payment');
        expect(html).toContain('Go back to the preview to post it');
    });

    it('Employer plan slot: no Pay button either', () => {
        const html = renderPage({ quoteFetch: 'loaded', quote: PLAN });

        expect(html).toContain('it uses a slot on your Employer plan');
        expect(html).not.toContain('Proceed to Payment');
        expect(html).not.toContain(FEATURED_AMOUNT);
    });
});

describe('a paid quote shows exactly the quoted amount', () => {
    it('intro rung: the intro amount on the summary and the Pay button', () => {
        const html = renderPage({ quoteFetch: 'loaded', quote: INTRO });

        expect(html).toContain(`Proceed to Payment: ${INTRO_AMOUNT}`);
        expect(html).not.toContain(`Proceed to Payment: ${FEATURED_AMOUNT}`);
        expect(html).toContain('Intro Job Post');
        expect(html).toContain('one-time');
    });

    it('featured rung: the featured amount', () => {
        const html = renderPage({ quoteFetch: 'loaded', quote: FEATURED });

        expect(html).toContain(`Proceed to Payment: ${FEATURED_AMOUNT}`);
        expect(html).toContain('Featured Job Post');
        expect(html).not.toContain('Go back to the preview to post it');
    });

    it('paid posting off: the coming-soon state, unchanged', () => {
        const html = renderPage({ quoteFetch: 'loaded', quote: FEATURED, paidPostingAvailable: false });

        expect(html).toContain('Paid posting is coming soon');
        expect(html).not.toContain('Proceed to Payment');
    });
});

describe('no amount is ever guessed', () => {
    it('while the quote loads: no amount and Pay is disabled', () => {
        const html = renderPage({ quoteFetch: 'loading' });

        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Checking your price\.\.\.<\/button>/);
        expect(html).not.toContain('Proceed to Payment');
        expect(html).not.toContain(INTRO_AMOUNT);
        expect(html).not.toContain(FEATURED_AMOUNT);
    });

    it.each([
        ['the quote request failed', { quoteFetch: 'failed' as const }],
        ['the quote said the employer is not eligible', { quoteFetch: 'loaded' as const, quote: { eligible: false, reason: 'server-error' } }],
        ['a paid quote carried no amount', { quoteFetch: 'loaded' as const, quote: { eligible: true, mode: 'paid', willBeFree: false } }],
    ])('when %s: Pay carries no amount and Stripe shows it before payment', (_label, state) => {
        const html = renderPage(state);

        expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Proceed to Payment<\/button>/);
        expect(html).toContain('Stripe shows the exact amount before you pay.');
        expect(html).not.toContain(INTRO_AMOUNT);
        expect(html).not.toContain(FEATURED_AMOUNT);
    });

    it('the page source has no list-price fallback for the amount', () => {
        const src = fs.readFileSync(path.join(process.cwd(), 'app/post-job/checkout/page.tsx'), 'utf8');
        expect(src).not.toContain('config.stripePriceInCents');
        expect(src).not.toMatch(/:\s*config\.postingPrice\b/);
        expect(src).not.toContain('quotedPrice');
    });
});
