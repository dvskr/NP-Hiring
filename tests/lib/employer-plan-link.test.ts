/**
 * lib/employer-plan-link.ts — who may be sent to the $399/month Payment Link,
 * and with which account reference.
 *
 * Pins:
 *   - only a real https://buy.stripe.com/ link is ever used (fail closed);
 *   - plan sales are closed while ENABLE_PAID_POSTING is off or the launch
 *     promo runs — the kill switch covers the subscription too;
 *   - a signed-in employer's link carries client_reference_id (their account
 *     id) and prefilled_email, URL-encoded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '@/lib/config';

const envMocks = vi.hoisted(() => ({ getEnv: vi.fn(), isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/env', () => envMocks);

import { buildPlanPaymentLink, isPlanSaleOpen, isValidPlanPaymentLink, planPaymentLinkBase } from '@/lib/employer-plan-link';

const LINK = 'https://buy.stripe.com/test_abc123';
const AFTER_PROMO = new Date('2027-02-01T00:00:00Z');
const DURING_PROMO = new Date('2026-10-01T00:00:00Z');

beforeEach(() => {
    vi.clearAllMocks();
    envMocks.getEnv.mockReturnValue({ STRIPE_PLAN_PAYMENT_LINK: LINK });
    envMocks.isFeatureEnabled.mockImplementation((flag: string) => flag === 'paidPosting');
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
    it('is open with a link, the flag on, and the promo over', () => {
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
        envMocks.getEnv.mockReturnValue({});
        expect(isPlanSaleOpen(AFTER_PROMO)).toBe(false);
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
