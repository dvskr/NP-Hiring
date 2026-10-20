/**
 * lib/employer-plan-link.ts — who may be sent to the $399/month Payment Link,
 * and with which account reference.
 *
 * Pins:
 *   - only a real https://buy.stripe.com/ link is ever used (fail closed);
 *   - plan sales are closed while ENABLE_PAID_POSTING is off or the launch
 *     promo runs — the kill switch covers the subscription too;
 *   - plan sales are closed while STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET
 *     is missing: the webhook answers 503 without either, so it could not
 *     record the subscription (backlog 2.16). The same rule runs against the
 *     real lib/env and the real webhook route in
 *     tests/regressions/plan-sale-requires-stripe-webhook.test.ts;
 *   - a signed-in employer's link carries client_reference_id (their account
 *     id) and prefilled_email, URL-encoded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '@/lib/config';

const envMocks = vi.hoisted(() => ({ getEnv: vi.fn(), isFeatureEnabled: vi.fn(), getPaidPostingStatus: vi.fn() }));
vi.mock('@/lib/env', () => envMocks);

import { buildPlanPaymentLink, isPlanSaleOpen, isValidPlanPaymentLink, planPaymentLinkBase } from '@/lib/employer-plan-link';

const LINK = 'https://buy.stripe.com/test_abc123';
/** An environment in which the plan can be sold once the promo is over. */
const SELLABLE_ENV = { STRIPE_PLAN_PAYMENT_LINK: LINK, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' };
const AFTER_PROMO = new Date('2027-02-01T00:00:00Z');
const DURING_PROMO = new Date('2026-10-01T00:00:00Z');

beforeEach(() => {
    vi.clearAllMocks();
    envMocks.getEnv.mockReturnValue(SELLABLE_ENV);
    envMocks.isFeatureEnabled.mockImplementation((flag: string) => flag === 'paidPosting');
    // Built as lib/env builds it: the flag, and whether the secret key is set.
    envMocks.getPaidPostingStatus.mockImplementation(() => {
        const enabled = envMocks.isFeatureEnabled('paidPosting');
        const stripeConfigured = !!envMocks.getEnv().STRIPE_SECRET_KEY;
        return { enabled, stripeConfigured, available: enabled && stripeConfigured };
    });
});

describe('planPaymentLinkBase — fails closed on anything but a Stripe Payment Link', () => {
    it('returns a well-formed Stripe link', () => {
        expect(planPaymentLinkBase()).toBe(LINK);
    });

    it.each([
        ['unset', undefined],
        ['a foreign host', 'https://evil.example/pay'],
        ['a lookalike host', 'https://buy.stripe.com.evil.example/pay'],
        ['plain http', 'http://buy.stripe.com/test_abc'],
        ['garbage', 'not a url'],
    ])('returns null when the link is %s', (_label, value) => {
        envMocks.getEnv.mockReturnValue({ STRIPE_PLAN_PAYMENT_LINK: value });
        expect(planPaymentLinkBase()).toBeNull();
    });

    it('returns null when the environment cannot be read', () => {
        envMocks.getEnv.mockImplementation(() => { throw new Error('invalid env'); });
        expect(planPaymentLinkBase()).toBeNull();
    });

    it('isValidPlanPaymentLink agrees', () => {
        expect(isValidPlanPaymentLink(LINK)).toBe(true);
        expect(isValidPlanPaymentLink('https://buy.stripe.com.evil.example/x')).toBe(false);
    });
});

describe('isPlanSaleOpen — the ENABLE_PAID_POSTING kill switch and the promo cover the plan', () => {
    it('is open with a link, the flag on, both Stripe secrets set, and the promo over', () => {
        expect(config.isPromoActive(AFTER_PROMO)).toBe(false);
        expect(isPlanSaleOpen(AFTER_PROMO)).toBe(true);
    });

    it('is closed while the launch promo runs', () => {
        expect(config.isPromoActive(DURING_PROMO)).toBe(true);
        expect(isPlanSaleOpen(DURING_PROMO)).toBe(false);
    });

    it('is closed when ENABLE_PAID_POSTING is off', () => {
        envMocks.isFeatureEnabled.mockReturnValue(false);
        expect(isPlanSaleOpen(AFTER_PROMO)).toBe(false);
    });

    it('is closed with no link', () => {
        envMocks.getEnv.mockReturnValue({ ...SELLABLE_ENV, STRIPE_PLAN_PAYMENT_LINK: undefined });
        expect(isPlanSaleOpen(AFTER_PROMO)).toBe(false);
    });
});

describe('isPlanSaleOpen: closed while the webhook could not record the sale', () => {
    // With the flag on, a valid link and the promo over, the sale used to open
    // without either secret, while POST /api/webhooks/stripe answered 503.
    it.each([
        ['STRIPE_SECRET_KEY is unset', { STRIPE_SECRET_KEY: undefined }],
        ['STRIPE_SECRET_KEY is empty', { STRIPE_SECRET_KEY: '' }],
        ['STRIPE_WEBHOOK_SECRET is unset', { STRIPE_WEBHOOK_SECRET: undefined }],
        ['STRIPE_WEBHOOK_SECRET is empty', { STRIPE_WEBHOOK_SECRET: '' }],
        ['both secrets are unset', { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined }],
    ])('is closed, and hands out no link, when %s', (_label, missing) => {
        envMocks.getEnv.mockReturnValue({ ...SELLABLE_ENV, ...missing });
        expect(config.isPromoActive(AFTER_PROMO)).toBe(false);
        expect(isPlanSaleOpen(AFTER_PROMO)).toBe(false);
        expect(buildPlanPaymentLink({ userId: 'user-uuid-1', email: 'a@b.example' }, AFTER_PROMO)).toBeNull();
    });
});

describe('buildPlanPaymentLink', () => {
    it('adds the account id as client_reference_id and the email as prefilled_email (encoded)', () => {
        const url = new URL(buildPlanPaymentLink({ userId: 'user-uuid-1', email: 'owner+plan@clinic.example' }, AFTER_PROMO) as string);
        expect(`${url.origin}${url.pathname}`).toBe(LINK);
        expect(url.searchParams.get('client_reference_id')).toBe('user-uuid-1');
        expect(url.searchParams.get('prefilled_email')).toBe('owner+plan@clinic.example');
    });

    it('omits prefilled_email when the account has none', () => {
        const url = new URL(buildPlanPaymentLink({ userId: 'user-uuid-1', email: null }, AFTER_PROMO) as string);
        expect(url.searchParams.has('prefilled_email')).toBe(false);
    });

    it('returns null while plan sales are closed', () => {
        expect(buildPlanPaymentLink({ userId: 'user-uuid-1', email: 'a@b.example' }, DURING_PROMO)).toBeNull();
    });
});
