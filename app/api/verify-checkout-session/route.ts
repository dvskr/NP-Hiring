import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/sentry';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { activatePaidJobCheckout } from '@/app/api/webhooks/stripe/activate-paid-job';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

// Shared select for the success-page payload — used for the initial read and
// the re-read after a self-heal activation. userId/contactEmail feed the
// B114 ownership check, never the response body.
const EMPLOYER_JOB_SELECT = {
  dashboardToken: true,
  paymentStatus: true,
  contactEmail: true,
  userId: true,
  job: { select: { title: true, slug: true, isPublished: true } },
} as const;

/**
 * B114: resolve the authenticated Supabase user, if any. Null on any
 * failure — auth infra hiccups must not 500 a payment-verification poll;
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

/**
 * GET /api/verify-checkout-session?session_id=cs_xxx
 *
 * Verifies a Stripe checkout session for a NEW job post (not renewal — that has
 * its own /api/verify-renewal-session endpoint). Used by /success to confirm
 * payment actually completed before showing the success state. Audit #1.
 *
 * Returns 200 with `{ paid: true, jobTitle, jobSlug, dashboardToken, isPublished }`
 * on success, or appropriate error codes:
 *   400 — missing session_id, or session is for a renewal/upgrade
 *   404 — job not found in DB
 *   402 — Stripe says session is unpaid (webhook not yet fired, or never will)
 *   503 — Stripe not configured
 */
export async function GET(request: NextRequest) {
  try {
    // B114: this endpoint proxies the Stripe API — rate-limit it so it can't
    // be used to burn our Stripe quota or probe session ids in bulk. 30/min
    // per IP comfortably covers the success page's ~6-poll retry loop.
    const rateLimitResult = await rateLimit(request, 'verify-checkout-session', RATE_LIMITS.employer);
    if (rateLimitResult) return rateLimitResult;

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
    }

    const sessionId = request.nextUrl.searchParams.get('session_id');
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    // B114: callers must prove they own this checkout before we reveal
    // anything about it. Two accepted proofs:
    //   1. The httpOnly cookie binding set by /api/create-checkout (same
    //      browser that started the checkout), or
    //   2. An authenticated Supabase session (create-checkout requires
    //      auth, so the paying employer always has one) whose identity is
    //      matched against the EmployerJob row further below.
    // Anonymous callers replaying a session_id from a referer header or
    // browser history get a 401 before any Stripe call happens.
    const checkoutCookie = request.cookies.get('pmhnp_checkout_session')?.value;
    const cookieMatches = checkoutCookie === sessionId;
    const authedUser = cookieMatches ? null : await getAuthedUser();
    if (!cookieMatches && !authedUser) {
      return NextResponse.json(
        { error: 'Sign in (or return from checkout in the same browser) to verify this session' },
        { status: 401 }
      );
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // This route is for NEW job-post checkouts only. Renewal flow has a
    // different verify endpoint and writes type='renewal' on its sessions.
    if (session.metadata?.type === 'renewal' || session.metadata?.type === 'upgrade') {
      return NextResponse.json(
        { error: 'Wrong verify endpoint for this session type' },
        { status: 400 }
      );
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json(
        {
          paid: false,
          error: 'Payment not yet complete',
          paymentStatus: session.payment_status,
        },
        { status: 402 }
      );
    }

    const jobId = session.metadata?.jobId;
    if (!jobId) {
      logger.error('Verify checkout session: paid session has no jobId metadata', null, { sessionId });
      return NextResponse.json({ error: 'Session metadata missing jobId' }, { status: 400 });
    }

    let employerJob = await prisma.employerJob.findFirst({
      where: { jobId },
      select: EMPLOYER_JOB_SELECT,
    });

    if (!employerJob) {
      // Stripe says paid but our DB has no record yet. Most likely: the webhook
      // for `checkout.session.completed` hasn't fired/processed yet. Tell the
      // client to retry instead of pretending all is well. (Ownership can't be
      // DB-verified before the row exists; the caller already passed the
      // cookie-or-authed gate above and this response carries no job data.)
      return NextResponse.json(
        {
          paid: true,
          processing: true,
          error: 'Payment recorded by Stripe but job not yet activated. Please refresh in a few seconds.',
        },
        { status: 202 }
      );
    }

    // B114: cookie-less callers must be the employer who owns this checkout —
    // match the authed identity against the EmployerJob row (userId is set by
    // /api/create-checkout; contactEmail covers pre-userId legacy rows).
    if (!cookieMatches && authedUser) {
      const ownsCheckout =
        (employerJob.userId !== null && employerJob.userId === authedUser.id) ||
        (authedUser.email !== null &&
          employerJob.contactEmail.toLowerCase() === authedUser.email.toLowerCase());
      if (!ownsCheckout) {
        logger.warn('Verify checkout session: authed caller does not own this session', {
          sessionId,
          userId: authedUser.id,
        });
        return NextResponse.json(
          { error: 'This checkout session belongs to a different account' },
          { status: 403 }
        );
      }
    }

    // F32 self-heal: Stripe says this session is PAID (checked above) but the
    // row is still 'pending' — the checkout.session.completed webhook was
    // lost (endpoint disabled, secret rotated, retries exhausted). Previously
    // this endpoint just told the user to refresh forever; now it runs the
    // exact activation the webhook would have run. The shared function's
    // atomic pending→paid claim guarantees a concurrently-arriving webhook
    // can't double-apply (whichever path loses the claim no-ops), and the
    // webhook's ProcessedStripeEvent dedupe is untouched.
    if (employerJob.paymentStatus === 'pending') {
      try {
        const activation = await activatePaidJobCheckout(stripe, session);
        logger.info('[VerifyCheckout] Self-heal activation ran for paid-but-pending job', {
          jobId,
          sessionId,
          outcome: activation.outcome,
        });
        const refreshed = await prisma.employerJob.findFirst({
          where: { jobId },
          select: EMPLOYER_JOB_SELECT,
        });
        if (refreshed) {
          employerJob = refreshed;
        }
      } catch (healError) {
        // Non-fatal: fall through to the normal "processing" response so the
        // success page keeps polling; the daily reconciliation sweep is the
        // backstop. But this state means money was taken with no webhook —
        // make sure it reaches Sentry.
        logger.error('[VerifyCheckout] Self-heal activation failed', healError, { jobId, sessionId });
        captureException(healError, {
          tags: { area: 'verify-checkout-session' },
          extra: { jobId, sessionId, reason: 'self-heal activation failed' },
        });
      }
    }

    // SECURITY (H1): the dashboardToken grants edit/unpublish on the job.
    // session_id is not secret — it lives in URLs, referer headers, and
    // browser histories — so this endpoint must NOT hand the token to any
    // caller who happens to know a valid session_id. The cookie binding
    // (checked at the top, B114) stays the ONLY channel that returns the
    // token; verified account owners without the cookie still get a
    // "check your email" hint instead, because email is the authoritative
    // token-delivery channel.
    return NextResponse.json({
      paid: true,
      processing: employerJob.paymentStatus !== 'paid',
      jobTitle: employerJob.job.title,
      jobSlug: employerJob.job.slug,
      isPublished: employerJob.job.isPublished,
      // Token is only returned when the cookie binding matches. The
      // confirmation email (sent by the webhook) always includes the
      // token-bearing dashboard link as the secure delivery channel.
      ...(cookieMatches
        ? { dashboardToken: employerJob.dashboardToken }
        : { tokenDeliveredViaEmail: true }),
    });
  } catch (error) {
    logger.error('Error verifying checkout session', error);
    return NextResponse.json(
      { error: 'Failed to verify checkout session' },
      { status: 500 }
    );
  }
}
