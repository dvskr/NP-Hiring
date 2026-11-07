import type Stripe from 'stripe';

/**
 * What a check that reads one payment intent needs from Stripe. The Stripe
 * client satisfies it, and so does cachedPaymentIntentReader.
 */
export interface PaymentIntentReader {
    readonly paymentIntents: {
        retrieve(id: string): Promise<Stripe.PaymentIntent>;
    };
}

/**
 * A reader that asks Stripe once per payment intent and hands every later
 * caller the same answer, failures included. Made per webhook event, so the
 * 5-post pack check and the guide check of one refund or dispute share a
 * single read (app/api/webhooks/stripe/route.ts#retryUntilSaleRecorded).
 */
export function cachedPaymentIntentReader(stripe: PaymentIntentReader): PaymentIntentReader {
    const reads = new Map<string, Promise<Stripe.PaymentIntent>>();
    return {
        paymentIntents: {
            retrieve(id: string): Promise<Stripe.PaymentIntent> {
                const known = reads.get(id);
                if (known) return known;
                const read = stripe.paymentIntents.retrieve(id);
                reads.set(id, read);
                return read;
            },
        },
    };
}
