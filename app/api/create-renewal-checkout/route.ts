/**
 * POST /api/create-renewal-checkout — $config.renewalPrice for
 * +config.durationDays on an existing post.
 *
 * Eligible rows: 'promo' (launch-free post, renewable at the normal price)
 * and 'paid' (intro / pro). Blocked with 409:
 *   'pending'  — checkout never completed; resume the original instead
 *   'free'     — legacy free-quota rows (unchanged message)
 *   'refunded' — pulled by refund/moderation; must not relist at a discount
 *   'disputed' — charged back; a renewal must not re-publish it or erase the
 *                dispute marker (the renewal webhook re-checks this too)
 *   'plan'     — plan posts stay live while the plan is active; the employer
 *                posts again from a plan slot rather than buying a renewal
 * Everything else (legacy 'free_renewed' / 'free_upgraded', 'expired')
 * keeps today's behaviour and falls through to Checkout.
 */
import { getStripe } from '@/lib/stripe';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config, PricingTier } from '@/lib/config';
import { asPaidTier } from '@/lib/pricing';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getBaseUrl, isFeatureEnabled } from '@/lib/env';
import { gaCheckoutMetadata, idempotencyKeyWithGaIds } from '@/lib/analytics-server';

/**
 * Idempotency window for renewal session creation: a double-click or client
 * retry inside the same window reuses one session; a genuine later renewal
 * attempt (next window, or after the expiry moved) gets a fresh one.
 */
const RENEWAL_IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

interface RenewalCheckoutBody {
  jobId: string;
  editToken: string;
  tier?: PricingTier; // ignored — single tier model
}

export async function POST(request: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(request, 'renewal-checkout', RATE_LIMITS.postJob);
    if (rateLimitResult) return rateLimitResult;

  try {
    // F3: master switch first — see app/api/create-checkout/route.ts for the
    // rationale behind the two distinct machine-readable 503 codes.
    if (!isFeatureEnabled('paidPosting')) {
      return NextResponse.json(
        { error: 'Paid job posting is not available yet', code: 'PAID_POSTING_DISABLED' },
        { status: 503 }
      );
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: 'Paid checkout is currently unavailable', code: 'STRIPE_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    const body: RenewalCheckoutBody = await request.json();
    const { jobId, editToken } = body;

    // Validate required fields
    if (!jobId || !editToken) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Find the employer job and verify edit token
    const employerJob = await prisma.employerJob.findFirst({
      where: {
        jobId,
        editToken,
      },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            employer: true,
            location: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!employerJob) {
      return NextResponse.json(
        { error: 'Invalid job ID or edit token' },
        { status: 404 }
      );
    }

    // Audit #11: don't allow renewing a posting that was never paid in the first
    // place. 'pending' = checkout abandoned. Legacy 'free' = the old free-quota
    // path; renewing one via the renewal flow would let it sneak past that quota.
    // Both should re-enter the appropriate flow rather than buying a renewal.
    // ('promo' rows are deliberately NOT blocked — launch-promo posts renew at
    // the normal renewal price, see file header.)
    if (employerJob.paymentStatus === 'pending') {
      return NextResponse.json(
        { error: 'This job posting was never completed. Please complete the original checkout instead of renewing.' },
        { status: 409 }
      );
    }
    if (employerJob.paymentStatus === 'free') {
      return NextResponse.json(
        { error: 'Free posts cannot be renewed at the discounted rate. Post a new job at the regular price instead.' },
        { status: 409 }
      );
    }
    // A refunded posting was pulled (refund/moderation). The renewal webhook
    // unconditionally re-publishes + flips paymentStatus to 'paid', which would
    // bypass the refund-unpublish moderation gate (toggle-publish 402s these).
    // Block renewal so a refunded post can't quietly relist at the discount.
    if (employerJob.paymentStatus === 'refunded') {
      return NextResponse.json(
        { error: 'This posting was refunded and is no longer eligible for renewal. Please contact support or create a new posting.' },
        { status: 409 }
      );
    }
    // A charged-back posting was revoked when the dispute opened. Renewing it
    // would re-publish it as 'paid' and erase the dispute marker.
    if (employerJob.paymentStatus === 'disputed') {
      return NextResponse.json(
        { error: 'This posting is under a payment dispute and is not eligible for renewal. Please contact support.' },
        { status: 409 }
      );
    }
    // Plan posts are not renewed per-post: they stay live while the plan is
    // active (and for their config.durationDays window), and the employer
    // re-posts from a plan slot afterwards. Buying a renewal here would
    // convert the row to 'paid' and confuse both the slot count and billing.
    if (employerJob.paymentStatus === 'plan') {
      return NextResponse.json(
        { error: 'Plan posts stay live while your Employer plan is active and do not need a renewal. To relist this role, post it again from a plan slot.' },
        { status: 409 }
      );
    }

    // Renewal price is flat for every renewable rung.
    const price = config.stripeRenewalPriceInCents;
    // Carry the row's own rung through metadata so the renewal webhook
    // (which writes pricingTier = metadata.tier) doesn't rewrite an 'intro'
    // row as 'pro'. Never 'plan' — blocked above.
    const tier: PricingTier = asPaidTier(employerJob.pricingTier);

    // GA attribution for the renewal purchase event the webhook sends later;
    // only this request can read the GA cookies. Empty unless the visitor
    // granted analytics consent (lib/analytics-server.ts#gaCheckoutMetadata).
    const gaMetadata = gaCheckoutMetadata(request);

    // Payment methods follow the Dashboard settings (see create-checkout).
    const baseUrl = getBaseUrl();
    const expiryMarker = employerJob.job.expiresAt ? employerJob.job.expiresAt.getTime() : 'none';
    // The GA ids are folded into the key because this key is reused for a
    // whole window, and the ids can change inside it (the cookie banner is
    // accepted between two clicks, or GA starts a new session). The second
    // create would then send different metadata under the same key, which
    // Stripe refuses outright; see idempotencyKeyWithGaIds. Without GA ids
    // the key is unchanged.
    const idempotencyKey = idempotencyKeyWithGaIds(
      `renewal-${employerJob.id}-${expiryMarker}-${Math.floor(Date.now() / RENEWAL_IDEMPOTENCY_WINDOW_MS)}`,
      gaMetadata,
    );
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Job Renewal - ${employerJob.job.title}`,
              description: `Renew for ${config.durationDays} more days - ${employerJob.job.employer}`,
            },
            unit_amount: price,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${baseUrl}/employer/renewal-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/employer/dashboard`,
      customer_email: employerJob.contactEmail,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      // Force Stripe receipt regardless of dashboard toggle — see comment in
      // /api/create-checkout for rationale.
      payment_intent_data: {
        receipt_email: employerJob.contactEmail,
      },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `Job Renewal: ${employerJob.job.title} — ${employerJob.job.employer}`,
          metadata: {
            jobId,
            employerJobId: employerJob.id,
            type: 'renewal',
          },
          rendering_options: { amount_tax_display: 'exclude_tax' },
        },
      },
      metadata: {
        jobId,
        type: 'renewal',
        tier,
        ...gaMetadata,
      },
    }, { idempotencyKey });

    if (!session.url) {
      return NextResponse.json(
        { error: 'Checkout session created but URL is missing' },
        { status: 502 }
      );
    }

    // Sec3 fix (2026-06-01): same cookie-binding pattern as
    // /api/create-checkout. /api/verify-renewal-session now requires
    // this cookie before handing out the dashboardToken. Without it,
    // anyone who learned a session_id (browser history, referer
    // headers) could harvest the management token for a renewed job.
    const response = NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
    response.cookies.set('pmhnp_renewal_session', session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60,
    });
    return response;
  } catch (error) {
    console.error('Error creating renewal checkout session:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}

