/**
 * POST /api/employer/billing-portal
 *
 * Opens a Stripe Customer Portal session for the calling employer's Employer
 * plan so they can cancel (at period end, per the portal configuration),
 * update the card, or download invoices without contacting support.
 *
 * The Stripe customer is ALWAYS read from the employer's own plan row —
 * never accepted from the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { brand } from '@/config/brand';
import { requireEmployerApi } from '@/lib/auth/require-employer-api';
import { verifyCsrf } from '@/lib/csrf';
import { getPlanForUser } from '@/lib/employer-plan';
import { getStripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitResult = await rateLimit(request, 'billing-portal', RATE_LIMITS.employer);
  if (rateLimitResult) return rateLimitResult;

  // Defence in depth — middleware.ts already gates every /api/* mutation.
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const auth = await requireEmployerApi();
  if (auth.error) return auth.error;

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'Billing is currently unavailable', code: 'STRIPE_NOT_CONFIGURED' }, { status: 503 });
  }

  try {
    const plan = await getPlanForUser(auth.user.id);
    if (!plan?.stripeCustomerId) {
      return NextResponse.json({ error: 'No Stripe billing account is linked to your Employer plan.', code: 'NO_BILLING_ACCOUNT' }, { status: 400 });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: plan.stripeCustomerId,
      return_url: `${brand.baseUrl}/employer/dashboard`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    logger.error('[Employer Billing Portal] session creation failed', err, { userId: auth.user.id });
    return NextResponse.json({ error: 'Could not open billing. Please try again or contact support.' }, { status: 500 });
  }
}
