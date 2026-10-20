import { NextResponse } from 'next/server';
import { getEnv, getPaidPostingStatus } from '@/lib/env';

/**
 * GET /api/create-checkout/availability
 *
 * F3: server-checked paid-posting availability signal — combines the
 * ENABLE_PAID_POSTING flag with whether Stripe is configured to take the
 * payment (STRIPE_SECRET_KEY) and to record it (STRIPE_WEBHOOK_SECRET).
 * The /post-job funnel calls this BEFORE rendering the form so an employer
 * with no free post remaining sees a "paid posting coming soon" state
 * instead of filling the whole wizard and 503ing at Pay.
 *
 * Response: { available: boolean, code?: 'PAID_POSTING_DISABLED' | 'STRIPE_NOT_CONFIGURED' }
 * `code` mirrors the stable 503 codes returned by POST /api/create-checkout
 * and POST /api/create-renewal-checkout when checkout is attempted anyway;
 * STRIPE_NOT_CONFIGURED covers either secret missing.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const status = getPaidPostingStatus();
        // Without the webhook secret POST /api/webhooks/stripe answers 503,
        // so no surface may offer a checkout the two checkout routes refuse
        // and the webhook could not record (same rule as
        // lib/employer-plan-link.ts#isPlanSaleOpen;
        // tests/regressions/paid-checkout-requires-stripe-webhook.test.ts).
        if (status.available && !!getEnv().STRIPE_WEBHOOK_SECRET) {
            return NextResponse.json({ available: true });
        }
        return NextResponse.json({
            available: false,
            code: !status.enabled ? 'PAID_POSTING_DISABLED' : 'STRIPE_NOT_CONFIGURED',
        });
    } catch (error) {
        // Env parsing should never throw here in a correctly-booted app, but
        // if it does, report unavailable — the checkout POST would fail too.
        return NextResponse.json(
            {
                available: false,
                code: 'PAID_POSTING_DISABLED',
                error: error instanceof Error ? error.message : 'unknown',
            },
            { status: 500 },
        );
    }
}
