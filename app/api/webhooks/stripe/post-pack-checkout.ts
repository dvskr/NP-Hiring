/**
 * 5-post pack checkout fulfilment (2027 re-price, phase 2).
 *
 * Three callers run exactly this code, like activate-paid-job.ts does for a
 * new post:
 *   1. the Stripe webhook (checkout.session.completed and
 *      checkout.session.async_payment_succeeded, metadata.type 'post_pack');
 *   2. /api/verify-pack-session (self-heal when the buyer returns before the
 *      webhook lands);
 *   3. the daily payment reconciliation sweep (a paid session whose webhook
 *      was lost).
 *
 * Idempotency across paths: one create keyed on the unique stripeSessionId.
 * The path that creates the row runs the side effects of the sale, once: the
 * purchase email (claimed through EmailSend) and the GA purchase event. A
 * session already on the books, or a P2002 from a path that got there first,
 * is 'already_fulfilled' and runs nothing.
 *
 * The payment is read before the pack is written (security review M1): a
 * fulfilment that runs late (a webhook retry, the verify page, the sweep) can
 * find the charge already refunded in full or disputed. The pack is then
 * recorded as that event would have left it: 'refunded' with its credits
 * revoked and the refund on the row, or 'disputed' (frozen, its credits still
 * counted). The refund or dispute event itself found no pack and was answered
 * 500 for Stripe to retry (./route.ts); its retry finds the pack in that state
 * and changes nothing twice. Only a pack recorded paid gets the purchase
 * email and the GA purchase event. A failed read records nothing and throws,
 * so the caller's retry reads it again.
 *
 * The money is always recorded. A pack bought while the sale was closed
 * (lib/post-pack-sale.ts#isPackSaleOpen false when the buyer opened
 * Checkout), by an account that is not an employer, with no account
 * reference, at an amount or currency the sale does not charge, or with no
 * payment intent, is still written, with the posts and the year config sells
 * (config.packPosts, config.packValidityMonths) whatever was charged, and
 * staff are alerted; a refund then revokes it (./post-pack-refunds.ts). The
 * alerts go out before the write (security review L5), so a crash after it
 * cannot lose them; a retry may send one again. Only a buyer who can spend
 * the credits (an employer account) gets the purchase email.
 *
 * The pack's year runs from the Checkout Session's creation, whichever path
 * records it and however late (code review L4).
 *
 * Callers MUST have verified payment_status === 'paid' and metadata.type ===
 * POST_PACK_CHECKOUT_TYPE; both are checked again. Errors propagate: the
 * webhook answers 500 and rolls its dedupe row back so Stripe retries.
 */
import type Stripe from 'stripe';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { domainOf } from '@/lib/pricing';
import { stringField } from '@/lib/request-body';
import { packExpiresAt, type PostPackStatus } from '@/lib/post-packs';
import { POST_PACK_CHECKOUT_TYPE, POST_PACK_SKU, isPackSaleOpen, type PackBuyer } from '@/lib/post-pack-sale';
import { sendPostPackPurchasedEmail } from '@/lib/email-service';
import { fetchInvoiceData, sendPurchaseEvent, type StripeInvoiceData } from './activate-paid-job';
import { alertWebhookFailure, claimEmailSend, prismaErrorCode, releaseEmailClaim, stripeIdOf, type AlertExtras } from './webhook-support';

export type PostPackFulfilmentOutcome = 'fulfilled' | 'already_fulfilled';

export interface PostPackFulfilment {
  outcome: PostPackFulfilmentOutcome;
  packId: string;
}

export interface PostPackContext {
  /** The Stripe event id, or the path that ran it ('verify-pack-session', 'payment-reconciliation'). */
  eventId: string;
}

/**
 * The buyer a paid session names: a PackBuyer whose references are null when
 * the session lacks them (it is still recorded, unattached), and whether the
 * account can spend the credits.
 */
interface SessionBuyer {
  /** metadata.userId, else client_reference_id: both the buying account, set by /api/create-pack-checkout. */
  userId: PackBuyer['userId'] | null;
  email: PackBuyer['email'];
  quotaDomain: PackBuyer['quotaDomain'] | null;
  isEmployer: boolean;
}

/** What had happened to the payment when the pack is recorded. */
interface PackPayment {
  status: PostPackStatus;
  paymentIntentId: string | null;
  /** Stripe's cumulative refunded amount, when any of it went back; null otherwise. */
  refundedAmountCents: number | null;
  refundReason: string | null;
}

/** One pack about to be recorded: what the alerts, the write and the side effects read. */
interface PackRecord {
  session: Stripe.Checkout.Session;
  buyer: SessionBuyer;
  payment: PackPayment;
  amountCents: number;
  purchasedAt: Date;
  expiresAt: Date;
  extras: AlertExtras;
}

/** The alert for a payment Stripe already shows refunded or disputed. */
const PAYMENT_STATE_ALERTS: Readonly<Record<Exclude<PostPackStatus, 'paid'>, string>> = {
  refunded: '5-post pack refunded in full before it was recorded: recorded refunded, its credits revoked',
  disputed: '5-post pack disputed before it was recorded: recorded frozen until the dispute closes',
};

/** The pack recorded for a session, if any. */
async function packIdFor(sessionId: string): Promise<string | null> {
  const pack = await prisma.employerPostPack.findUnique({ where: { stripeSessionId: sessionId }, select: { id: true } });
  return pack?.id ?? null;
}

async function resolveBuyer(session: Stripe.Checkout.Session): Promise<SessionBuyer> {
  const userId = stringField(session.metadata?.userId) ?? stringField(session.client_reference_id);
  const profile = userId
    ? await prisma.userProfile.findUnique({ where: { supabaseId: userId }, select: { role: true, email: true } })
    : null;
  const email = session.customer_details?.email ?? session.customer_email ?? profile?.email ?? '';
  return {
    userId,
    isEmployer: profile?.role === 'employer',
    email,
    quotaDomain: stringField(session.metadata?.quotaDomain)?.toLowerCase() ?? domainOf(email),
  };
}

/** The status a charge leaves the pack in: a full refund wins over a dispute, as it does once the pack exists. */
function statusOfCharge(charge: Stripe.Charge | null, chargedCents: number): PostPackStatus {
  const refunded = charge?.amount_refunded ?? 0;
  if (refunded > 0 && refunded >= chargedCents) return 'refunded';
  return charge?.disputed ? 'disputed' : 'paid';
}

/**
 * The payment as Stripe has it now: its intent, read with the latest charge
 * (security review M1). With no payment intent there is nothing to read, and
 * the pack is recorded paid (alertBeforeRecording says so). A Stripe error
 * propagates.
 */
async function readPackPayment(stripe: Stripe, session: Stripe.Checkout.Session): Promise<PackPayment> {
  const paymentIntentId = stripeIdOf(session.payment_intent);
  if (!paymentIntentId) return { status: 'paid', paymentIntentId: null, refundedAmountCents: null, refundReason: null };
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  const charge = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const refunded = charge?.amount_refunded ?? 0;
  return {
    status: statusOfCharge(charge, session.amount_total ?? charge?.amount ?? 0),
    paymentIntentId,
    refundedAmountCents: refunded > 0 ? refunded : null,
    refundReason: refunded > 0 ? charge?.refunds?.data?.[0]?.reason ?? null : null,
  };
}

/** When the buyer opened Checkout: the session's creation (epoch seconds), else now. */
function sessionCreatedAt(session: Stripe.Checkout.Session): Date {
  return Number.isFinite(session.created) ? new Date(session.created * 1000) : new Date();
}

async function readPackRecord(stripe: Stripe, session: Stripe.Checkout.Session, ctx: PostPackContext): Promise<PackRecord> {
  const [buyer, payment] = await Promise.all([resolveBuyer(session), readPackPayment(stripe, session)]);
  const purchasedAt = sessionCreatedAt(session);
  const amountCents = session.amount_total ?? config.stripePackPriceInCents;
  return {
    session,
    buyer,
    payment,
    amountCents,
    purchasedAt,
    expiresAt: packExpiresAt(purchasedAt),
    extras: {
      eventId: ctx.eventId,
      sessionId: session.id,
      userId: buyer.userId ?? undefined,
      paymentIntentId: payment.paymentIntentId ?? undefined,
      amountCents,
      currency: session.currency ?? undefined,
    },
  };
}

/**
 * Each alert this pack needs a human for, sent before the write (security
 * review L5): money the sale should not have taken, a charge that does not
 * match the sale (L7), a payment already reversed (M1).
 */
async function alertBeforeRecording({ session, buyer, payment, purchasedAt, extras }: PackRecord): Promise<void> {
  if (!buyer.userId) {
    await alertWebhookFailure('5-post pack checkout carries no account: recorded unattached, refund it in Stripe', null, extras);
  } else if (!buyer.isEmployer) {
    await alertWebhookFailure('5-post pack bought by an account that is not an employer: recorded, refund it in Stripe', null, extras);
  }
  if (!isPackSaleOpen(purchasedAt)) {
    await alertWebhookFailure('5-post pack bought while pack sales were closed: recorded, refund it in Stripe', null, extras);
  }
  if (session.amount_total !== config.stripePackPriceInCents || session.currency !== 'usd') {
    await alertWebhookFailure(
      `5-post pack charged an unexpected amount or currency: recorded as charged, with ${config.packPosts} posts for ${config.packValidityMonths} months`,
      null,
      extras,
    );
  }
  if (!payment.paymentIntentId) {
    await alertWebhookFailure('5-post pack paid with no payment intent: a refund or dispute of it cannot find the pack', null, extras);
  }
  if (payment.status !== 'paid') await alertWebhookFailure(PAYMENT_STATE_ALERTS[payment.status], null, extras);
}

/**
 * The pack row. The posts and the year are config's whatever was charged (a
 * mismatch is alerted); the status, the counters and the refund columns
 * follow the payment as Stripe has it now.
 */
function packRowData(record: PackRecord, invoiceData: StripeInvoiceData): Prisma.EmployerPostPackUncheckedCreateInput {
  const { session, buyer, payment } = record;
  const revoked = payment.status === 'refunded' ? config.packPosts : 0;
  return {
    userId: buyer.userId,
    email: buyer.email,
    quotaDomain: buyer.quotaDomain,
    status: payment.status,
    source: 'stripe',
    creditsTotal: config.packPosts,
    creditsRemaining: config.packPosts - revoked,
    creditsRevoked: revoked,
    amountCents: record.amountCents,
    currency: session.currency ?? 'usd',
    purchasedAt: record.purchasedAt,
    expiresAt: record.expiresAt,
    stripeSessionId: session.id,
    stripePaymentIntentId: payment.paymentIntentId,
    ...(payment.refundedAmountCents !== null && {
      refundedAt: new Date(),
      refundedAmountCents: payment.refundedAmountCents,
      refundReason: payment.refundReason,
    }),
    ...invoiceData,
  };
}

/** The one write, keyed on the unique session id. `raced` when a path that got there first had already recorded it. */
async function createPackOnce(record: PackRecord, invoiceData: StripeInvoiceData): Promise<{ packId: string; raced: boolean }> {
  try {
    const created = await prisma.employerPostPack.create({ data: packRowData(record, invoiceData), select: { id: true } });
    return { packId: created.id, raced: false };
  } catch (err) {
    // A path that got here first already recorded this session: no side effect runs twice.
    if (prismaErrorCode(err) !== 'P2002') throw err;
    const raced = await packIdFor(record.session.id);
    if (!raced) throw err;
    return { packId: raced, raced: true };
  }
}

async function sendPurchasedEmailOnce(
  session: Stripe.Checkout.Session,
  buyer: SessionBuyer,
  expiresAt: Date,
  invoice: Pick<StripeInvoiceData, 'hostedInvoiceUrl' | 'invoiceNumber'>,
): Promise<void> {
  if (!buyer.isEmployer || !buyer.email) return;
  const key = purchasedEmailKey(session.id);
  if (!(await claimEmailSend(key, buyer.email, 'post_pack_purchased'))) {
    logger.info('5-post pack purchase email already sent for this session; skipping', { sessionId: session.id });
    return;
  }
  const result = await sendPostPackPurchasedEmail(buyer.email, {
    posts: config.packPosts,
    expiresAt,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    invoiceNumber: invoice.invoiceNumber,
  });
  if (!result.success) {
    // The pack is recorded; release the claim so sendPurchasedEmailIfUnsent
    // (the buyer's next visit to /api/verify-pack-session) can send it.
    logger.error('Failed to send the 5-post pack purchase email', result.error ?? null, { sessionId: session.id });
    await releaseEmailClaim(key);
  }
}

/** The EmailSend claim key of a pack's purchase email. */
function purchasedEmailKey(sessionId: string): string {
  return `post-pack-purchased:${sessionId}`;
}

/** A pack recorded paid: the purchase email to an employer buyer, and the GA purchase event, priced as charged. */
async function runSaleSideEffects(record: PackRecord, packId: string, invoiceData: StripeInvoiceData): Promise<void> {
  const { session } = record;
  await sendPurchasedEmailOnce(session, record.buyer, record.expiresAt, invoiceData);
  // The GA ids are the ones /api/create-pack-checkout stored when the buyer
  // had granted analytics consent; trackServerPurchase validates both.
  await sendPurchaseEvent({
    clientId: packId,
    gaClientId: session.metadata?.gaClientId,
    gaSessionId: session.metadata?.gaSessionId,
    sessionId: session.id,
    amountCents: record.amountCents,
    currency: session.currency ?? 'usd',
    type: 'pack',
    tier: 'pack',
    itemId: POST_PACK_SKU,
  });
}

/**
 * Record a PAID 5-post pack checkout: config.packPosts credits for the
 * buying account, usable until packExpiresAt(the session's creation), in
 * the state its payment is in now (see the file header).
 */
export async function fulfilPostPackCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  ctx: PostPackContext,
): Promise<PostPackFulfilment> {
  if (session.metadata?.type !== POST_PACK_CHECKOUT_TYPE) {
    throw new Error(`Checkout session ${session.id} is not a 5-post pack checkout`);
  }
  if (session.payment_status !== 'paid') {
    throw new Error(`fulfilPostPackCheckout called for session ${session.id} with payment_status=${session.payment_status}`);
  }
  const recorded = await packIdFor(session.id);
  if (recorded) return { outcome: 'already_fulfilled', packId: recorded };

  const record = await readPackRecord(stripe, session, ctx);
  await alertBeforeRecording(record);
  const invoiceData = await fetchInvoiceData(stripe, session);
  const { packId, raced } = await createPackOnce(record, invoiceData);
  if (raced) return { outcome: 'already_fulfilled', packId };

  if (record.payment.status === 'paid') await runSaleSideEffects(record, packId, invoiceData);
  logger.info('[Stripe] 5-post pack recorded', { packId, sessionId: session.id, status: record.payment.status, userId: record.buyer.userId ?? undefined, via: ctx.eventId });
  return { outcome: 'fulfilled', packId };
}

/**
 * The purchase email for a pack already recorded paid whose send never went
 * out (code review L1). A failed send releases its claim, and a replayed
 * event finds the pack recorded and runs no side effect, so nothing else
 * would send it: /api/verify-pack-session calls this when the buyer comes
 * back. The EmailSend claim keeps it to one email; a claim already taken
 * (sent, or being sent) skips it before anything else is read. Never throws.
 */
export async function sendPurchasedEmailIfUnsent(session: Stripe.Checkout.Session): Promise<void> {
  try {
    const claimed = await prisma.emailSend.findFirst({ where: { dedupeKey: purchasedEmailKey(session.id) }, select: { id: true } });
    if (claimed) return;
    const pack = await prisma.employerPostPack.findUnique({
      where: { stripeSessionId: session.id },
      select: { status: true, expiresAt: true, hostedInvoiceUrl: true, invoiceNumber: true },
    });
    if (pack?.status !== 'paid') return;
    await sendPurchasedEmailOnce(session, await resolveBuyer(session), pack.expiresAt, pack);
  } catch (err) {
    logger.error('Could not retry the 5-post pack purchase email', err, { sessionId: session.id });
  }
}

/**
 * invoice.paid for a pack: refresh its invoice links once Stripe has issued
 * the paid PDF (the session fulfilled while the invoice was still open).
 * True when a pack carried the invoice.
 */
export async function refreshPackInvoice(invoice: Stripe.Invoice): Promise<boolean> {
  if (!invoice.id) return false;
  const { count } = await prisma.employerPostPack.updateMany({
    where: { stripeInvoiceId: invoice.id },
    data: {
      invoicePdfUrl: invoice.invoice_pdf ?? null,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoiceNumber: invoice.number ?? null,
    },
  });
  return count > 0;
}
