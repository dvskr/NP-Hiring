/**
 * One webhook event checks an unmatched refund or dispute against the 5-post
 * pack and then the guides store; both read the same payment intent, so a
 * per-event cached reader asks Stripe once (register 2.35).
 */
import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { cachedPaymentIntentReader } from '@/lib/payment-intent-reader';

function stripeWith(retrieve: (id: string) => Promise<Stripe.PaymentIntent>) {
    return { paymentIntents: { retrieve: vi.fn(retrieve) } };
}

describe('cachedPaymentIntentReader', () => {
    it('asks Stripe once per payment intent and gives every caller the same answer', async () => {
        const stripe = stripeWith(async (id) => ({ id, metadata: { type: 'guide' } }) as unknown as Stripe.PaymentIntent);
        const reader = cachedPaymentIntentReader(stripe);
        const [first, second] = await Promise.all([reader.paymentIntents.retrieve('pi_1'), reader.paymentIntents.retrieve('pi_1')]);
        expect(first).toBe(second);
        await reader.paymentIntents.retrieve('pi_2');
        expect(stripe.paymentIntents.retrieve.mock.calls).toEqual([['pi_1'], ['pi_2']]);
    });

    it('hands a failure to every caller without asking again', async () => {
        const missing = Object.assign(new Error('No such payment_intent'), { code: 'resource_missing' });
        const stripe = stripeWith(async () => {
            throw missing;
        });
        const reader = cachedPaymentIntentReader(stripe);
        await expect(reader.paymentIntents.retrieve('pi_1')).rejects.toBe(missing);
        await expect(reader.paymentIntents.retrieve('pi_1')).rejects.toBe(missing);
        expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
    });

    it('starts empty for each event', async () => {
        const stripe = stripeWith(async (id) => ({ id }) as unknown as Stripe.PaymentIntent);
        await cachedPaymentIntentReader(stripe).paymentIntents.retrieve('pi_1');
        await cachedPaymentIntentReader(stripe).paymentIntents.retrieve('pi_1');
        expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(2);
    });
});
