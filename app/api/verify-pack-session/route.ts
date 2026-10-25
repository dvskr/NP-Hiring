/**
 * GET /api/verify-pack-session?session_id=cs_... — what the 5-post pack's
 * success page (/employer/post-pack?session_id=...) is told about the
 * purchase (2027 re-price, phase 2).
 *
 *   { status: 'paid', pack: { creditsTotal, creditsRemaining, expiresAt } }
 *   { status: 'paid', pack: null }       paid, the pack not on the books yet
 *   { status: 'processing', pack: null } completed, a delayed payment settling
 *   { status: 'unpaid', pack: null }     open or expired
 *
 * Ownership: the caller must be signed in (401 otherwise, before Stripe is
 * asked), and the session's metadata.userId (else client_reference_id,
 * both set to the buying account by /api/create-pack-checkout) must be that
 * account (403 otherwise). A session id seen in a URL, a referer or a log
 * reveals nothing to anyone else.
 *
 * Self-heal: a paid session with no pack row (the webhook was lost or has
 * not landed) is fulfilled here with the webhook's own fulfilPostPackCheckout,
 * whose create on the unique stripeSessionId makes a race with a late
 * webhook harmless. A failure there never breaks the answer: the webhook's
 * retries and the daily sweep still record the pack.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { captureException } from '@/lib/sentry';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { stringField } from '@/lib/request-body';
import { config } from '@/lib/config';
import { POST_PACK_CHECKOUT_TYPE } from '@/lib/post-pack-sale';
import { fulfilPostPackCheckout } from '@/app/api/webhooks/stripe/post-pack-checkout';

/** A Checkout Session id as Stripe mints them; anything else is refused before Stripe is asked. */
const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]+$/;

const PACK_SELECT = { creditsTotal: true, creditsRemaining: true, expiresAt: true } as const;

type PackView = { creditsTotal: number; creditsRemaining: number; expiresAt: string } | null;

async function packFor(sessionId: string): Promise<PackView> {
  const pack = await prisma.employerPostPack.findUnique({ where: { stripeSessionId: sessionId }, select: PACK_SELECT });
  return pack ? { creditsTotal: pack.creditsTotal, creditsRemaining: pack.creditsRemaining, expiresAt: pack.expiresAt.toISOString() } : null;
}

export async function GET(request: NextRequest) {
  // Proxies the Stripe API: rate-limited so it cannot burn the Stripe quota or probe session ids in bulk.
  const limited = await rateLimit(request, 'verify-pack-session', RATE_LIMITS.employer);
  if (limited) return limited;

  try {
    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: 'We could not check your purchase right now. Please check your dashboard.' }, { status: 503 });
    }

    const sessionId = stringField(request.nextUrl.searchParams.get('session_id'), 255);
    if (!sessionId || !CHECKOUT_SESSION_ID.test(sessionId)) {
      return NextResponse.json({ error: 'This link is missing its checkout details.' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Sign in to see this purchase.' }, { status: 401 });
    }

    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'resource_missing') {
        return NextResponse.json({ error: 'We could not find this checkout.' }, { status: 404 });
      }
      throw err;
    }

    if (session.metadata?.type !== POST_PACK_CHECKOUT_TYPE) {
      return NextResponse.json({ error: `This link is not for a ${config.packPosts}-post pack checkout.` }, { status: 400 });
    }
    const buyer = session.metadata?.userId || session.client_reference_id;
    if (buyer !== user.id) {
      logger.warn('[VerifyPack] Signed-in caller does not own this pack checkout', { sessionId, userId: user.id });
      return NextResponse.json({ error: 'This purchase belongs to a different account.' }, { status: 403 });
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ status: session.status === 'complete' ? 'processing' : 'unpaid', pack: null });
    }

    let pack = await packFor(session.id);
    if (!pack) {
      try {
        const result = await fulfilPostPackCheckout(stripe, session, { eventId: 'verify-pack-session' });
        logger.info('[VerifyPack] Self-heal ran for a paid pack checkout with no pack row', { sessionId, outcome: result.outcome });
        pack = await packFor(session.id);
      } catch (healError) {
        logger.error('[VerifyPack] Self-heal failed', healError, { sessionId });
        captureException(healError, { tags: { area: 'verify-pack-session' }, extra: { sessionId, reason: 'pack self-heal failed' } });
      }
    }
    return NextResponse.json({ status: 'paid', pack });
  } catch (error) {
    logger.error('Error verifying 5-post pack session', error);
    return NextResponse.json({ error: 'We could not check your purchase.' }, { status: 500 });
  }
}
