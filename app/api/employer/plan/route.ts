/**
 * GET /api/employer/plan
 *
 * The calling employer's Employer plan ($399/month, config.planPrice): the
 * row if one exists, whether it currently entitles posting, and slot usage.
 * The employer dashboard's plan widget reads this to show "slots used", the
 * subscribe link and — for a Stripe-billed plan — a "Manage billing" action.
 *
 * `paymentLinkUrl` is built server-side (lib/employer-plan-link.ts): it
 * carries this employer's account id as `client_reference_id` (the only key
 * the webhook attaches a plan by) and is null whenever plan sales are closed
 * (link unset or not a Stripe link, ENABLE_PAID_POSTING off, launch promo) —
 * the widget then shows its contact fallback.
 *
 * Read-only, and cheap (one plan lookup + one count), so no rate limit
 * beyond the auth gate — same reasoning as /api/employer/ai-jd/usage.
 * `price` is the config token so the widget never hardcodes the number.
 */
import { NextResponse } from 'next/server';
import { requireEmployerApi } from '@/lib/auth/require-employer-api';
import { getPlanSlotStatus } from '@/lib/employer-plan';
import { buildPlanPaymentLink } from '@/lib/employer-plan-link';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireEmployerApi();
  if (auth.error) return auth.error;

  try {
    const status = await getPlanSlotStatus(auth.user.id);
    return NextResponse.json({
      plan: status.plan
        ? {
            status: status.plan.status,
            slots: status.plan.slots,
            currentPeriodEnd: status.plan.currentPeriodEnd.toISOString(),
            source: status.plan.source,
            // The Customer Portal needs a Stripe customer; the id itself is
            // never sent to the client.
            canManageBilling: !!status.plan.stripeCustomerId,
          }
        : null,
      entitled: status.entitled,
      slots: status.slots,
      used: status.used,
      remaining: status.remaining,
      price: config.planPrice,
      paymentLinkUrl: buildPlanPaymentLink({ userId: auth.user.id, email: auth.user.email ?? null }),
    });
  } catch (err) {
    logger.error('[Employer Plan] GET failed', err, { userId: auth.user.id });
    return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
  }
}
