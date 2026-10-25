/**
 * POST /api/create-pack-checkout — Stripe Checkout for the 5-post pack
 * (2027 re-price, phase 2): config.packPosts post credits for
 * config.packPrice, one time, used within config.packValidityMonths.
 *
 * The sale is closed while the launch promo runs. Checked in this order,
 * each before anything it guards:
 *   503 PAID_POSTING_DISABLED  ENABLE_PAID_POSTING is off
 *   503 STRIPE_NOT_CONFIGURED  the Stripe key or the webhook secret is
 *                              missing: without the secret the webhook
 *                              answers 503 and could not record the sale
 *   409 PROMO_ACTIVE           every post is free until config.promoEndsAt,
 *                              so a pack would buy nothing (owner decision)
 *   401 / 403                  signed out / not an employer account / an
 *                              email Supabase has not confirmed (security
 *                              review L1)
 *   400                        a free-email signup: /api/jobs/post-free
 *                              refuses those accounts, so the credits could
 *                              never be spent
 * The first three are lib/post-pack-sale.ts#packSaleClosedReason, the one
 * copy of the gate isPackSaleOpen reads too.
 *
 * The pack, its price and its buyer come from the server alone: the session
 * is sold to the signed-in account (customer_email, client_reference_id and
 * metadata.userId), and metadata.quotaDomain snapshots the signup domain the
 * intro rule reads. The request body is never read. The payment intent
 * carries { type: 'post_pack', userId } (payment_intent_data.metadata), so a
 * refund or dispute that reaches the webhook before the pack is recorded is
 * told from any other payment and retried (code review M2).
 *
 * One payable pack checkout per account at a time, as near as the
 * idempotency window allows (security review L6): before a session is minted,
 * the account's open pack sessions from earlier windows are expired. This
 * window's session is the one a double click replays, so it stays open. When
 * an earlier session cannot be closed (it may have just taken money) or the
 * open sessions cannot be listed, the request is refused with a retryable 503
 * and nothing is minted. Two browsers of one account inside one ten-minute
 * window still get a session each.
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
import {
  POST_PACK_CHECKOUT_TYPE,
  POST_PACK_SKU,
  packSaleClosedReason,
  type PackBuyer,
  type PackSaleClosedReason,
} from '@/lib/post-pack-sale';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getBaseUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { gaCheckoutMetadata, idempotencyKeyWithGaIds } from '@/lib/analytics-server';
import {
  STRIPE_MAX_SESSION_LIFETIME_MS,
  expireCheckoutSessions,
  renewalIdempotencyWindow,
  renewalSessionExpiresAt,
} from '@/lib/renewal-checkout-sessions';

/** Retry-After on a refusal to mint: a Stripe hiccup, or an earlier session that just took a payment, which the webhook records within seconds. */
const REFUSAL_RETRY_AFTER_S = 60;

/** Most open Checkout Sessions one scan reads (Stripe lists newest first; open sessions are few). */
const MAX_OPEN_SESSIONS_SCANNED = 500;

export async function POST(request: NextRequest) {
  const rateLimitResult = await rateLimit(request, 'pack-checkout', RATE_LIMITS.postJob);
  if (rateLimitResult) return rateLimitResult;

  try {
    // One clock reading for the gate, the idempotency window and expires_at.
    const nowMs = Date.now();
    const closed = packSaleClosedReason(new Date(nowMs));
    const stripe = closed ? null : getStripe();
    if (closed || !stripe) return saleClosed(closed ?? 'STRIPE_NOT_CONFIGURED');

    const buyer = await resolveBuyer();
    if (buyer instanceof NextResponse) return buyer;

    const windowIndex = renewalIdempotencyWindow(nowMs);
    const expiresAt = renewalSessionExpiresAt(windowIndex);
    const refusal = await closeEarlierPackSessions(stripe, buyer.userId, expiresAt, nowMs);
    if (refusal) return refusal;

    const gaMetadata = gaCheckoutMetadata(request);
    const params = packSessionParams(buyer, expiresAt);
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

/** The answer while the pack cannot be sold. */
function saleClosed(reason: PackSaleClosedReason): NextResponse {
  if (reason === 'PROMO_ACTIVE') {
    // Only config.isPromoActive(now) gives this reason (packSaleClosedReason).
    return NextResponse.json(
      { error: `The ${config.packPosts}-post pack goes on sale on ${config.ladderStartsLabel}. Every post is free until then.`, code: reason },
      { status: 409 },
    );
  }
  if (reason === 'STRIPE_NOT_CONFIGURED') {
    logger.error('5-post pack checkout attempted but Stripe or its webhook secret is not configured', null);
  }
  const error = reason === 'PAID_POSTING_DISABLED' ? 'Paid job posting is not available yet' : 'Paid checkout is currently unavailable';
  return NextResponse.json({ error, code: reason }, { status: 503 });
}

/** The signed-in employer with a confirmed, company signup email, or the refusal. */
async function resolveBuyer(): Promise<PackBuyer | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!user.email_confirmed_at) {
    return NextResponse.json({ error: `Confirm your email address to buy a ${config.packPosts}-post pack.` }, { status: 403 });
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
 * Expire the account's open pack sessions from earlier windows (see the file
 * header); a 503 when one may still take money or the listing fails, else
 * null. An earlier window's session carries another expires_at, and is never
 * the one this window's key replays.
 */
async function closeEarlierPackSessions(stripe: Stripe, userId: string, expiresAt: number, nowMs: number): Promise<NextResponse | null> {
  let earlier: string[];
  try {
    earlier = await openPackSessionsFromEarlierWindows(stripe, userId, expiresAt, nowMs);
  } catch (err) {
    logger.error('[PackCheckout] Could not list open pack sessions; refused to start another', err, { userId });
    return retryableRefusal('We could not check your earlier checkout. Please try again in a minute.', 'PACK_CHECK_UNAVAILABLE');
  }
  if (earlier.length === 0) return null;
  const { expired, failed } = await expireCheckoutSessions(stripe, earlier);
  if (failed.length > 0) {
    logger.error('[PackCheckout] Could not expire an earlier open pack session; refused to start another', null, { userId, failed, expired });
    return retryableRefusal(
      `An earlier checkout for a ${config.packPosts}-post pack could not be closed, so a new one was not started. If you already paid, your posts will show on this page shortly. Otherwise, please try again in a minute.`,
      'PREVIOUS_PACK_CHECKOUT_OPEN',
    );
  }
  logger.info('[PackCheckout] Expired earlier open pack sessions for the account', { userId, sessionIds: expired });
  return null;
}

/** The account's open pack sessions whose expires_at is not this window's. Stripe errors propagate. */
async function openPackSessionsFromEarlierWindows(stripe: Stripe, userId: string, expiresAt: number, nowMs: number): Promise<string[]> {
  const found: string[] = [];
  let scanned = 0;
  for await (const session of stripe.checkout.sessions.list({
    status: 'open',
    created: { gte: Math.floor((nowMs - STRIPE_MAX_SESSION_LIFETIME_MS) / 1000) },
    limit: 100,
  })) {
    if (scanned >= MAX_OPEN_SESSIONS_SCANNED) {
      logger.error('[PackCheckout] Open session scan stopped at the cap; older open sessions were not checked', null, { userId, cap: MAX_OPEN_SESSIONS_SCANNED });
      break;
    }
    scanned += 1;
    const isAccountsPack = session.metadata?.type === POST_PACK_CHECKOUT_TYPE && session.metadata?.userId === userId;
    if (isAccountsPack && session.expires_at !== expiresAt) found.push(session.id);
  }
  return found;
}

/** 503 with Retry-After: nothing payable was handed out, and trying again is safe. */
function retryableRefusal(error: string, code: string): NextResponse {
  return NextResponse.json({ error, code }, { status: 503, headers: { 'Retry-After': String(REFUSAL_RETRY_AFTER_S) } });
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
    payment_intent_data: {
      receipt_email: buyer.email,
      // How the refund and dispute handlers know a pack payment whose pack is not recorded yet.
      metadata: { type: POST_PACK_CHECKOUT_TYPE, userId: buyer.userId },
    },
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
