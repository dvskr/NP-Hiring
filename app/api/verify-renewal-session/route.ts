import { getStripe } from '@/lib/stripe';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { slugify } from '@/lib/utils';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { captureException } from '@/lib/sentry';
import { applyRenewalCheckout } from '@/app/api/webhooks/stripe/apply-renewal';

/**
 * B114: resolve the authenticated Supabase user, if any. Null on any
 * failure — auth infra hiccups must not 500 the renewal success page;
 * the cookie binding remains the primary ownership proof.
 */
async function getAuthedUser(): Promise<{ id: string; email: string | null } | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    // B114: this endpoint proxies the Stripe API — rate-limit it so it can't
    // be used to burn our Stripe quota or probe session ids in bulk.
    const rateLimitResult = await rateLimit(request, 'verify-renewal-session', RATE_LIMITS.employer);
    if (rateLimitResult) return rateLimitResult;

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
    }

    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('session_id');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing session ID' },
        { status: 400 }
      );
    }

    // B114: callers must prove ownership before anything is revealed —
    // either the httpOnly cookie binding set by /api/create-renewal-checkout
    // (same browser that started the renewal) or an authenticated session
    // matched against the EmployerJob row below. Anonymous replays of a
    // session_id from referer logs / browser history get a 401 before any
    // Stripe call happens.
    const renewalCookie = request.cookies.get('pmhnp_renewal_session')?.value;
    const cookieMatches = renewalCookie === sessionId;
    const authedUser = cookieMatches ? null : await getAuthedUser();
    if (!cookieMatches && !authedUser) {
      return NextResponse.json(
        { error: 'Sign in (or return from checkout in the same browser) to verify this session. Your renewal confirmation was also emailed to you.' },
        { status: 401 }
      );
    }

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || session.payment_status !== 'paid') {
      return NextResponse.json(
        { error: 'Invalid or unpaid session' },
        { status: 400 }
      );
    }

    // Get job ID from metadata
    const jobId = session.metadata?.jobId;
    const type = session.metadata?.type;
    const tier = session.metadata?.tier;

    if (!jobId || type !== 'renewal') {
      return NextResponse.json(
        { error: 'Invalid renewal session' },
        { status: 400 }
      );
    }

    // Get job and employer details
    const employerJob = await prisma.employerJob.findFirst({
      where: { jobId },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            archivedAt: true,
          },
        },
      },
    });

    if (!employerJob) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // B114: cookie-less callers must be the employer who owns this renewal —
    // being signed in is NOT enough (any account could otherwise probe
    // session ids for job titles). Match the authed identity against the
    // EmployerJob row: userId when the posting is account-linked;
    // contactEmail covers legacy rows with no linked account. Mirrors the
    // ownership check in /api/verify-checkout-session.
    if (!cookieMatches && authedUser) {
      const ownsRenewal =
        (employerJob.userId !== null && employerJob.userId === authedUser.id) ||
        (authedUser.email !== null &&
          employerJob.contactEmail.toLowerCase() === authedUser.email.toLowerCase());
      if (!ownsRenewal) {
        logger.warn('Verify renewal session: authed caller does not own this session', {
          sessionId,
          userId: authedUser.id,
        });
        return NextResponse.json(
          { error: 'This renewal session belongs to a different account' },
          { status: 403 }
        );
      }
    }

    // Self-heal (missed-webhook recovery for renewals): Stripe says this
    // renewal is PAID (checked above) and the caller owns it, but no ledger
    // row exists for the session — the webhook was lost or has not landed.
    // Run the same fulfilment the webhook runs; its JobCharge-first
    // transaction guarantees a concurrently arriving webhook can never
    // extend the expiry twice. Never breaks the response.
    try {
      const charge = await prisma.jobCharge.findUnique({
        where: { stripeSessionId: session.id },
        select: { id: true },
      });
      if (!charge) {
        const result = await applyRenewalCheckout(stripe, session);
        logger.info('[VerifyRenewal] Self-heal ran for paid renewal with no ledger row', {
          jobId, sessionId, outcome: result.outcome,
        });
        if (result.outcome === 'revoked_posting' || result.outcome === 'employer_job_missing') {
          captureException(new Error(`Renewal self-heal: ${result.outcome}`), {
            tags: { area: 'verify-renewal-session' },
            extra: { jobId, sessionId, status: result.revokedStatus },
          });
        }
      }
    } catch (healError) {
      logger.error('[VerifyRenewal] Self-heal failed', healError, { jobId, sessionId });
      captureException(healError, {
        tags: { area: 'verify-renewal-session' },
        extra: { jobId, sessionId, reason: 'renewal self-heal failed' },
      });
    }

    // Sec3 fix (2026-06-01): cookie-bind the dashboardToken. The new-post
    // /api/verify-checkout-session was patched against this same leak
    // ages ago (H1) but renewal was missed. session_id appears in URLs,
    // referer headers, and browser histories — anyone who learns one
    // could call this endpoint and harvest the management token (which
    // grants edit + unpublish access to the renewed posting). Cookie
    // is set by /api/create-renewal-checkout. The confirmation email
    // sent by the webhook is the authoritative delivery channel.
    return NextResponse.json({
      jobTitle: employerJob.job.title,
      jobSlug: slugify(employerJob.job.title, employerJob.job.id),
      tier: tier || 'pro',
      // A renewal never puts an archived post back live (apply-renewal.ts):
      // the payment is applied and the expiry moves, and the post stays
      // unpublished until the employer restores it. The success page reads
      // this so it does not tell them the job is live.
      archivedAt: employerJob.job.archivedAt?.toISOString() ?? null,
      ...(cookieMatches
        ? { dashboardToken: employerJob.dashboardToken }
        : { tokenDeliveredViaEmail: true }),
    });
  } catch (error) {
    logger.error('Error verifying renewal session:', error);
    return NextResponse.json(
      { error: 'Failed to verify session' },
      { status: 500 }
    );
  }
}

