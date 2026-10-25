/**
 * POST /api/create-pack-checkout — Stripe Checkout for the 5-post pack
 * (2027 re-price, phase 2): config.packPosts post credits for
 * config.packPrice, one time, used within config.packValidityMonths.
 *
 * Shipped dark: nothing links here yet, and the sale is closed while the
 * launch promo runs. Checked in this order, each before anything it guards:
 *   503 PAID_POSTING_DISABLED  ENABLE_PAID_POSTING is off
 *   503 STRIPE_NOT_CONFIGURED  the Stripe key or the webhook secret is
 *                              missing: without the secret the webhook
 *                              answers 503 and could not record the sale
 *   409 PROMO_ACTIVE           every post is free until config.promoEndsAt,
 *                              so a pack would buy nothing (owner decision)
 *   401 / 403                  signed out / not an employer account
 *   400                        a free-email signup: /api/jobs/post-free
 *                              refuses those accounts, so the credits could
 *                              never be spent
 * These are lib/post-pack-sale.ts#isPackSaleOpen's conditions, each with
 * its own code.
 *
 * The pack, its price and its buyer come from the server alone: the session
 * is sold to the signed-in account (customer_email, client_reference_id and
 * metadata.userId), and metadata.quotaDomain snapshots the signup domain the
 * intro rule reads. No field of the request body is used; it is parsed
 * through lib/request-body.ts, so a malformed one is not a 500 and none of
 * it can reach Prisma or Stripe.
 *
 * The webhook fulfils the session (app/api/webhooks/stripe/post-pack-checkout.ts),
 * so does /api/verify-pack-session when the buyer returns first, and so does
 * the daily reconciliation sweep for one whose webhook was lost.
 */
import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { config } from '@/lib/config';
import { domainOf, isFreeEmailDomain } from '@/lib/pricing';
import { POST_PACK_CHECKOUT_TYPE, POST_PACK_SKU } from '@/lib/post-pack-sale';
import { readJsonObject } from '@/lib/request-body';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getBaseUrl, getEnv, isFeatureEnabled } from '@/lib/env';
import { logger } from '@/lib/logger';
import { gaCheckoutMetadata, idempotencyKeyWithGaIds } from '@/lib/analytics-server';
import { renewalIdempotencyWindow, renewalSessionExpiresAt } from '@/lib/renewal-checkout-sessions';

/** The account a pack is sold to. */
interface PackBuyer {
  userId: string;
  email: string;
  quotaDomain: string;
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await rateLimit(request, 'pack-checkout', RATE_LIMITS.postJob);
  if (rateLimitResult) return rateLimitResult;

  try {
    if (!isFeatureEnabled('paidPosting')) {
      return NextResponse.json(
        { error: 'Paid job posting is not available yet', code: 'PAID_POSTING_DISABLED' },
        { status: 503 },
      );
    }
    const stripe = getStripe();
    if (!stripe || !getEnv().STRIPE_WEBHOOK_SECRET) {
      logger.error('5-post pack checkout attempted but Stripe or its webhook secret is not configured', null);
      return NextResponse.json(
        { error: 'Paid checkout is currently unavailable', code: 'STRIPE_NOT_CONFIGURED' },
        { status: 503 },
      );
    }

    // One clock reading for the promo check, the idempotency window and expires_at.
    const nowMs = Date.now();
    if (config.isPromoActive(new Date(nowMs))) {
      return NextResponse.json(
        { error: `The ${config.packPosts}-post pack goes on sale on ${config.ladderStartsLabel}. Every post is free until then.`, code: 'PROMO_ACTIVE' },
        { status: 409 },
      );
    }

    await readJsonObject(request);

    const buyer = await resolveBuyer();
    if (buyer instanceof NextResponse) return buyer;

    const gaMetadata = gaCheckoutMetadata(request);
    const windowIndex = renewalIdempotencyWindow(nowMs);
    const params = packSessionParams(buyer, renewalSessionExpiresAt(windowIndex));
    // One key per account and ten-minute window: a double click replays one
    // session. expires_at is a function of the window (the renewal checkout's
    // helpers), so a replay sends the same parameters, which Stripe requires;
    // the digest gives a deploy that changes them a key of its own. Two real
    // purchases in two windows make two packs, which is what was paid for.
    const idempotencyKey = idempotencyKeyWithGaIds(
      `post-pack-v1-${buyer.userId}-${windowIndex}-${digest(JSON.stringify(params))}`,
      gaMetadata,
    );
    const session = await stripe.checkout.sessions.create(
      { ...params, metadata: { ...params.metadata, ...gaMetadata } },
      { idempotencyKey },
    );
    if (!session.url) {
      logger.error('Stripe returned a 5-post pack checkout session without a URL', null, { sessionId: session.id });
      return NextResponse.json({ error: 'Checkout session created but URL is missing' }, { status: 502 });
    }
    logger.info('5-post pack checkout session created', { userId: buyer.userId, sessionId: session.id });
    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    logger.error('Error creating 5-post pack checkout session', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}

/** The signed-in employer with a company signup email, or the refusal. */
async function resolveBuyer(): Promise<PackBuyer | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const profile = await prisma.userProfile.findUnique({ where: { supabaseId: user.id }, select: { role: true } });
  if (profile?.role !== 'employer') {
    return NextResponse.json({ error: `Only employer accounts can buy a ${config.packPosts}-post pack.` }, { status: 403 });
  }
  const quotaDomain = domainOf(user.email);
  if (!quotaDomain || isFreeEmailDomain(quotaDomain)) {
    return NextResponse.json(
      {
        error: 'Company email required',
        message: 'Job posts require a company email account (not Gmail, Yahoo, etc.). Please sign up with your company email.',
      },
      { status: 400 },
    );
  }
  return { userId: user.id, email: user.email, quotaDomain };
}

/**
 * The Checkout Session parameters, without the GA ids. Payment methods
 * follow the Dashboard settings, as on every checkout; a delayed method is
 * safe because fulfilment waits for payment_status 'paid'.
 */
function packSessionParams(buyer: PackBuyer, expiresAt: number): Stripe.Checkout.SessionCreateParams & { metadata: Record<string, string> } {
  const baseUrl = getBaseUrl();
  const name = `${config.packPosts}-post pack`;
  const description = `${config.packPosts} job posts, each a ${config.durationDays}-day Featured listing, to use within ${config.packValidityMonths} months`;
  return {
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name, description },
          unit_amount: config.stripePackPriceInCents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    expires_at: expiresAt,
    customer_email: buyer.email,
    client_reference_id: buyer.userId,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    payment_intent_data: { receipt_email: buyer.email },
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: `${name}: ${description}`,
        metadata: { type: POST_PACK_CHECKOUT_TYPE, sku: POST_PACK_SKU, userId: buyer.userId },
        rendering_options: { amount_tax_display: 'exclude_tax' },
      },
    },
    success_url: `${baseUrl}/employer/post-pack?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/employer/post-pack`,
    metadata: {
      type: POST_PACK_CHECKOUT_TYPE,
      sku: POST_PACK_SKU,
      userId: buyer.userId,
      quotaDomain: buyer.quotaDomain,
      posts: String(config.packPosts),
    },
  };
}

/** A short, stable digest for an idempotency key: 12 hex characters of SHA-256. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
