/**
 * docs/pricing-system.md, section 1d, tells the owner what paid checkout
 * needs besides ENABLE_PAID_POSTING, and why the Stripe key and the webhook
 * secret go in before the flag. Backlog 2.16 made plan sales wait for both
 * secrets (lib/employer-plan-link.ts#isPlanSaleOpen). A sibling change made
 * POST /api/create-checkout, POST /api/create-renewal-checkout and
 * GET /api/create-checkout/availability refuse without the webhook secret
 * too (tests/regressions/paid-checkout-requires-stripe-webhook.test.ts), and
 * the section went on telling the owner that "the two checkout routes do not
 * check the webhook secret". Nothing failed:
 * docs-pricing-system-matches-code.test.ts pins only the plan half of that
 * bullet.
 *
 * As in that suite, the fact comes from the code (whether the three routes
 * read STRIPE_WEBHOOK_SECRET outside comments) and the document has to say
 * the same, in either direction: if either change is reverted, this fails
 * until section 1d and the 2c diagram say so.
 */
import { describe, it, expect } from 'vitest';
import { between, lineWith, readRepo, withoutComments } from '../support/docs-vs-code';

const doc = readRepo('docs/pricing-system.md');
const section1d = between(doc, '### 1d. What happens', '## 2. End-to-end flows');
const section2c = between(doc, '### 2c. Intro / Featured checkout', '### 2d. Renewal');

/** The two checkout routes, and the signal the pages read before they offer Pay or Renew. */
const CHECKOUT_SURFACES = [
    'app/api/create-checkout/route.ts',
    'app/api/create-renewal-checkout/route.ts',
    'app/api/create-checkout/availability/route.ts',
] as const;

const readsWebhookSecret = (file: string): boolean => /\bSTRIPE_WEBHOOK_SECRET\b/.test(withoutComments(readRepo(file)));

describe('section 1d and the 2c diagram: what paid checkout needs besides the flag', () => {
    it('state the webhook secret as the checkout routes treat it', () => {
        const reads = Object.fromEntries(CHECKOUT_SURFACES.map((file) => [file, readsWebhookSecret(file)]));
        // The bullet states one rule for every surface, so they must agree first.
        expect(new Set(Object.values(reads)).size, `the checkout surfaces disagree on STRIPE_WEBHOOK_SECRET: ${JSON.stringify(reads)}`).toBe(1);

        const flagBullet = lineWith(section1d, '`ENABLE_PAID_POSTING=true`');
        const stripeGate = lineWith(section2c, 'Lazy Stripe client');
        if (reads[CHECKOUT_SURFACES[0]]) {
            expect(flagBullet, 'checkout now refuses without the webhook secret: drop the warning from section 1d').not.toContain('do not check the webhook secret');
            expect(flagBullet).toContain('With the flag on but `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` missing, both routes answer 503 `STRIPE_NOT_CONFIGURED`');
            expect(flagBullet).toContain("`/api/create-checkout/availability` reports `{ available: false, code: 'STRIPE_NOT_CONFIGURED' }`");
            expect(stripeGate, 'the 2c diagram lists why the checkout answers 503').toContain('STRIPE_WEBHOOK_SECRET');
        } else {
            expect(flagBullet, 'checkout takes payment without the webhook secret: section 1d must warn the owner').toContain('the two checkout routes do not check the webhook secret');
            expect(stripeGate).not.toContain('STRIPE_WEBHOOK_SECRET');
        }
    });
});
