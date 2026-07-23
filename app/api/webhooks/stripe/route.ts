import Stripe from 'stripe';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { sendRenewalConfirmationEmail, sendRefundConfirmationEmail, getOrCreateUnsubToken } from '@/lib/email-service';
import { config, PricingTier } from '@/lib/config';
import { renewalExpiresAt } from '@/lib/expires-at';
import { logger } from '@/lib/logger';
import { pingAllSearchEngines } from '@/lib/search-indexing';
import { trackServerPurchase } from '@/lib/analytics-server';
import { captureException } from '@/lib/sentry';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sanitizeForDiscord } from '@/lib/sanitize-for-discord';
import { activatePaidJobCheckout, fetchInvoiceData } from './activate-paid-job';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

/**
 * V8: payment-webhook failures must reach a human. Every cron in this repo
 * alerts Discord on failure, but the payments webhook — the one place where
 * money has been taken — previously only wrote logger.error to Vercel logs.
 * If Stripe exhausts its ~3-day retry window against a persistent failure,
 * the money is taken, the job stays unpublished, and nobody is told.
 *
 * Sends to Sentry (captureException) AND Discord. Best-effort: alerting can
 * never make a failing webhook fail harder.
 */
async function alertWebhookFailure(
  reason: string,
  err: unknown,
  extras: Record<string, string | number | undefined>,
): Promise<void> {
  try {
    captureException(err instanceof Error ? err : new Error(`${reason}${err ? `: ${String(err)}` : ''}`), {
      tags: { area: 'stripe-webhook' },
      extra: { reason, ...extras },
    });
    const rawMessage = err instanceof Error ? err.message : err ? String(err) : reason;
    const detail = Object.entries(extras)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(' · ');
    await sendDiscordMessage('', [{
      title: `🚨 Stripe webhook: ${reason}`,
      description: '```\n' + sanitizeForDiscord(rawMessage).slice(0, 400) + '\n```'
        + (detail ? `\n${sanitizeForDiscord(detail).slice(0, 300)}` : ''),
      color: 0xFF0000,
    }]);
  } catch (alertErr) {
    logger.error('[Stripe] Failed to deliver webhook failure alert', alertErr, { reason });
  }
}

/**
 * B109: atomically claim a webhook-triggered email send via the EmailSend
 * dedupe key (unique). The whole-event dedupe (ProcessedStripeEvent) is
 * rolled back on partial failure so Stripe retries — which would re-run
 * side effects that DID succeed, like an email send. Insert-then-send:
 * a P2002 on the key means an earlier delivery already sent (or is
 * sending) this exact email, so the retry skips it.
 *
 * Fails OPEN on unexpected errors: a broken guard must not block a
 * legitimate email — worst case is the pre-B109 duplicate-send behavior.
 */
async function claimEmailSend(dedupeKey: string, to: string, emailType: string): Promise<boolean> {
  try {
    await prisma.emailSend.create({
      data: {
        dedupeKey,
        to,
        subject: `[claim] ${emailType}`,
        emailType,
        status: 'claimed',
        metadata: { guard: 'stripe-webhook' },
      },
    });
    return true;
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'P2002') return false;
    logger.error('[Stripe] Email-send claim failed — proceeding without dedupe', err, { dedupeKey });
    return true;
  }
}

/** Release a claim after a FAILED send so a later retry can send it. Best-effort. */
async function releaseEmailClaim(dedupeKey: string): Promise<void> {
  try {
    await prisma.emailSend.delete({ where: { dedupeKey } });
  } catch (err) {
    logger.error('[Stripe] Failed to release email-send claim after failed send', err, { dedupeKey });
  }
}

export async function POST(request: NextRequest) {
  // C2 fix (2026-06-01): tracks whether the idempotency row was committed
  // so the outer catch can roll it back. Without this, an uncaught exception
  // after the dedupe row was written leaves Stripe's retry permanently
  // blocked (P2002 → "deduped"), losing money silently.
  let dedupedEventId: string | null = null;
  try {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !webhookSecret) {
      logger.error('Stripe webhook called but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is missing', null);
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }

    // Get raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('stripe-signature')!;

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret
      );
    } catch (err) {
      logger.error('Webhook signature verification failed', err);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }

    // Audit #3: Idempotency dedupe. Stripe redelivers events on transient
    // failures; without this we'd double-send confirmation emails and re-run
    // state writes. We insert-then-process; on unique-violation (event already
    // processed) we return 200 so Stripe stops retrying.
    //
    // C2 fix (2026-06-01): the previous version wrote the dedupe row
    // BEFORE processing and never rolled it back on failure. A transient
    // hiccup mid-processing would leave the job unpublished, no charge
    // recorded, no receipt sent, AND Stripe's retry would hit P2002
    // ("already processed") and be silently dropped — money taken,
    // nothing delivered. Fix: any 500-returning path must first delete
    // the dedupe row so Stripe's retry can succeed. `cleanupDedupe()`
    // is called from every error path below.
    try {
      await prisma.processedStripeEvent.create({
        data: { eventId: event.id, eventType: event.type },
      });
      dedupedEventId = event.id;  // C2: enable outer-catch rollback
    } catch (dedupeErr) {
      // Prisma P2002 = unique constraint violation → already processed.
      // Any other error → log and bail conservatively (Stripe will retry).
      const code = (dedupeErr as { code?: string } | null)?.code;
      if (code === 'P2002') {
        logger.info('Stripe webhook event already processed; skipping', { eventId: event.id, eventType: event.type });
        return NextResponse.json({ received: true, deduped: true });
      }
      logger.error('Failed to record processed Stripe event', dedupeErr, { eventId: event.id });
      await alertWebhookFailure('Idempotency check failed', dedupeErr, { eventId: event.id, eventType: event.type });
      return NextResponse.json({ error: 'Idempotency check failed' }, { status: 500 });
    }

    // Helper: remove the dedupe row so Stripe will redeliver. Used on every
    // 500-returning code path so a transient failure can self-heal.
    // If the deletion itself fails we log and proceed; worst case Stripe's
    // retry hits P2002 and we land where we'd be without this fix.
    const cleanupDedupe = async (): Promise<void> => {
      try {
        await prisma.processedStripeEvent.delete({ where: { eventId: event.id } });
      } catch (cleanupErr) {
        logger.error('[Stripe] Failed to roll back dedupe row before 500 — Stripe retry may be silently dropped', cleanupErr, { eventId: event.id });
        // V8: this is the worst case — the retry is about to be silently
        // swallowed by P2002. It MUST reach a human.
        await alertWebhookFailure('Dedupe rollback failed — Stripe retry may be silently dropped', cleanupErr, { eventId: event.id, eventType: event.type });
      }
    };

    // NOTE: fetchInvoiceData moved to ./activate-paid-job.ts (shared with the
    // verify-checkout-session self-heal and the reconciliation sweep).

    // Handle checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      const jobId = session.metadata?.jobId;
      const type = session.metadata?.type;
      const tier = session.metadata?.tier;

      if (!jobId) {
        logger.error('No job ID in session metadata', null, { sessionId: session.id });
        // 400 is intentional — bad payload won't get better on retry.
        // Keep dedupe in place so Stripe stops bothering us about this event.
        return NextResponse.json(
          { error: 'Missing job ID' },
          { status: 400 }
        );
      }

      // Handle renewal payment
      if (type === 'renewal') {
        try {
          const renewalTier = (tier || 'pro') as PricingTier;

          // Audit #8: surface a loud failure if the EmployerJob row is
          // missing — previously we silently extended the job without
          // recording payment status or sending the receipt email.
          const employerJob = await prisma.employerJob.findFirst({
            where: { jobId: jobId },
          });

          if (!employerJob) {
            logger.error('Renewal webhook: EmployerJob not found for paid job', null, {
              jobId,
              sessionId: session.id,
              tier: renewalTier,
            });
            await alertWebhookFailure('EmployerJob missing for paid renewal', null, {
              eventId: event.id, jobId, sessionId: session.id,
            });
            await cleanupDedupe();  // C2: let Stripe retry self-heal read-after-write lag
            return NextResponse.json(
              { error: 'EmployerJob record missing for renewed job' },
              { status: 500 }
            );
          }

          const existingJob = await prisma.job.findUnique({
            where: { id: jobId },
            select: { expiresAt: true, createdAt: true, title: true, slug: true },
          });
          if (!existingJob) {
            // Caught by the branch catch below → alert + dedupe rollback + 500.
            throw new Error(`Renewal webhook: Job ${jobId} not found`);
          }

          // B109: per-session idempotency for the renewal STATE writes.
          // The JobCharge row (unique on stripeSessionId) doubles as the
          // "applied" marker because it commits in the SAME transaction as
          // the expiry extension. A Stripe retry after a partial failure
          // therefore either sees no charge row (nothing committed — safe
          // to redo everything) or the charge row (state fully applied —
          // skip to the email guard). Previously each retry re-extended
          // expiresAt from the already-extended value, compounding the
          // renewal until the 365-day cap.
          const existingCharge = await prisma.jobCharge.findUnique({
            where: { stripeSessionId: session.id },
            select: { id: true },
          });
          const isFirstApplication = existingCharge === null;

          // Audit #2: the JobCharge records the actual amount paid ($179
          // renewal vs $199 new post). Audit #28: persist payment_intent so
          // the refund webhook can match `charge.refunded` back to this row.
          // Fetched once — reused by the ledger write and the email below.
          const renewalInvoiceData = await fetchInvoiceData(stripe, session);

          let newExpiresAt: Date;
          if (isFirstApplication) {
            // Calculate new expiry via renewalExpiresAt (UTC math, capped at
            // 365 days from createdAt to prevent indefinite stacking):
            //   - Extends from existing expiresAt if still in the future (audit #22)
            //   - Otherwise extends from now (late renewers don't bank dead time)
            newExpiresAt = renewalExpiresAt({
              currentExpiry: existingJob.expiresAt,
              originalCreatedAt: existingJob.createdAt,
              durationDays: config.getDurationDays(renewalTier),
            });

            await prisma.$transaction([
              prisma.job.update({
                where: { id: jobId },
                data: {
                  expiresAt: newExpiresAt,
                  isPublished: true,
                  isVerifiedEmployer: true,
                  ...(config.isFeaturedTier(renewalTier) && { isFeatured: true }),
                },
              }),
              prisma.employerJob.update({
                where: { id: employerJob.id },
                // Reset expiryWarningSentAt so the renewed posting (new, later
                // expiresAt) gets its own 5-day-out warning. Without this, a job
                // warned once is permanently excluded from the expiry-warnings cron.
                data: { paymentStatus: 'paid', pricingTier: renewalTier, expiryWarningSentAt: null },
              }),
              prisma.jobCharge.create({
                data: {
                  employerJobId: employerJob.id,
                  stripeSessionId: session.id,
                  stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
                  amountCents: session.amount_total ?? config.stripeRenewalPriceInCents,
                  currency: session.currency ?? 'usd',
                  type: 'renewal',
                  ...renewalInvoiceData,
                },
              }),
            ]);
          } else {
            // Retry after the state transaction already committed — do NOT
            // re-extend. The job row already carries the renewed expiry.
            newExpiresAt = existingJob.expiresAt ?? new Date();
            logger.info('Renewal state already applied for this session — skipping to email guard', {
              jobId,
              sessionId: session.id,
            });
          }

          // Get or create email lead for unsubscribe token
          let emailLead = await prisma.emailLead.findUnique({
            where: { email: employerJob.contactEmail },
          });

          if (!emailLead) {
            emailLead = await prisma.emailLead.create({
              data: { email: employerJob.contactEmail },
            });
          }

          // Send renewal confirmation email, guarded by an EmailSend dedupe
          // claim (B109) so a Stripe redelivery can never double-send it.
          // Same stable-URL pattern as the new-post flow — link to our
          // dashboard endpoint so the recipient always gets the latest
          // "Paid"-stamped PDF, not the open-state PDF captured before
          // invoice.paid fires.
          const renewalEmailKey = `renewal-confirmation:${session.id}`;
          const emailClaimed = await claimEmailSend(
            renewalEmailKey,
            employerJob.contactEmail,
            'renewal_confirmation',
          );
          if (emailClaimed) {
            const renewalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
            const stableRenewalInvoiceUrl = renewalBaseUrl
              ? `${renewalBaseUrl}/api/employer/invoice?jobId=${jobId}&token=${employerJob.dashboardToken}`
              : null;

            try {
              await sendRenewalConfirmationEmail(
                employerJob.contactEmail,
                existingJob.title,
                newExpiresAt,
                employerJob.dashboardToken,
                emailLead.unsubscribeToken,
                {
                  invoicePdfUrl: stableRenewalInvoiceUrl,
                  hostedInvoiceUrl: renewalInvoiceData.hostedInvoiceUrl,
                  invoiceNumber: renewalInvoiceData.invoiceNumber,
                }
              );
            } catch (emailError) {
              logger.error('Failed to send renewal confirmation email', emailError, { jobId });
              // Don't throw - job already renewed. Release the claim so a
              // future redelivery can attempt the send again.
              await releaseEmailClaim(renewalEmailKey);
            }
          } else {
            logger.info('Renewal confirmation email already sent for this session — skipping duplicate', {
              jobId,
              sessionId: session.id,
            });
          }

          logger.info('Job renewed', { jobId, tier });

          if (isFirstApplication) {
            // P7: server-side purchase event (fire-and-forget). Only on the
            // first application — a webhook retry must not double-count the
            // purchase (B109).
            trackServerPurchase({
              clientId: jobId,
              sessionId: session.id,
              amountCents: session.amount_total ?? config.stripeRenewalPriceInCents,
              currency: session.currency ?? 'usd',
              type: 'renewal',
              tier: renewalTier,
              jobId,
            }).catch(() => { /* logged inside */ });

            // Ping search engines for renewed job (fire-and-forget)
            if (existingJob.slug) {
              pingAllSearchEngines(`${brand.baseUrl}/jobs/${existingJob.slug}`).catch((err) =>
                logger.error('[Stripe] Background indexing ping failed (renewal)', err)
              );
            }
          }
        } catch (prismaError) {
          logger.error('Error renewing job in database', prismaError, { jobId });
          await alertWebhookFailure('Renewal processing failed', prismaError, {
            eventId: event.id, jobId, sessionId: session.id,
          });
          await cleanupDedupe();  // C2: let Stripe retry succeed
          return NextResponse.json(
            { error: 'Failed to renew job' },
            { status: 500 }
          );
        }
      } else {
        // Original flow: new job posting. F32: the publish/charge/email logic
        // lives in ./activate-paid-job.ts, shared with the
        // verify-checkout-session self-heal and the daily reconciliation
        // sweep so the three paths can never drift. Cross-path idempotency
        // is an atomic pending→paid claim inside the shared function; this
        // webhook additionally keeps its ProcessedStripeEvent dedupe above.
        try {
          const activation = await activatePaidJobCheckout(stripe, session);

          if (activation.outcome === 'employer_job_missing') {
            // C3 fix: a missing EmployerJob row must not be skipped silently.
            // Returning 500 makes Stripe redeliver the event so the condition
            // (e.g. transient DB read-after-write lag) can self-heal.
            logger.error('[Stripe] EmployerJob not found for paid checkout — returning 500 so Stripe retries', undefined, {
              jobId,
              sessionId: session.id,
            });
            await alertWebhookFailure('EmployerJob missing for paid checkout', null, {
              eventId: event.id, jobId, sessionId: session.id,
            });
            await cleanupDedupe();  // C2: roll back dedupe so Stripe retry actually replays
            return NextResponse.json(
              { error: 'EmployerJob not found for paid session' },
              { status: 500 },
            );
          }

          if (activation.outcome === 'already_active') {
            // The verify-page self-heal or the reconciliation sweep beat this
            // webhook to it. Nothing to redo — acknowledge the event.
            logger.info('[Stripe] Checkout already activated by another path', { jobId, sessionId: session.id });
          }
        } catch (prismaError) {
          logger.error('Error updating job in database', prismaError, { jobId });
          await alertWebhookFailure('New-post activation failed', prismaError, {
            eventId: event.id, jobId, sessionId: session.id,
          });
          await cleanupDedupe();  // C2: roll back dedupe so Stripe retry actually replays
          return NextResponse.json(
            { error: 'Failed to update job' },
            { status: 500 }
          );
        }
      }
    }

    // 2026-05-15: invoice.paid handler — refreshes the JobCharge's
    // invoicePdfUrl / hostedInvoiceUrl. We initially capture these URLs
    // during `checkout.session.completed`, but at that exact moment the
    // invoice is in `open` status — the PDF says "Pay online" and lists
    // an amount "due", not "Paid". Stripe regenerates the PDF when the
    // invoice transitions to `paid` (a few hundred ms later). Re-fetching
    // here and updating the ledger ensures the downloadable PDF always
    // shows the paid state.
    if (event.type === 'invoice.paid') {
      try {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceId = invoice.id;
        if (!invoiceId) {
          logger.warn('invoice.paid: invoice has no id', { eventId: event.id });
          return NextResponse.json({ received: true });
        }

        const jobCharge = await prisma.jobCharge.findFirst({
          where: { stripeInvoiceId: invoiceId },
          select: { id: true },
        });

        if (!jobCharge) {
          // Not all invoices belong to a JobCharge (e.g. one-off invoices
          // sent outside the post-job flow). Safe to ignore.
          logger.info('invoice.paid: no matching JobCharge — skipping', { invoiceId });
          return NextResponse.json({ received: true });
        }

        await prisma.jobCharge.update({
          where: { id: jobCharge.id },
          data: {
            invoicePdfUrl: invoice.invoice_pdf ?? null,
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            invoiceNumber: invoice.number ?? null,
          },
        });

        logger.info('JobCharge invoice URLs refreshed after invoice.paid', {
          jobChargeId: jobCharge.id,
          invoiceId,
        });
      } catch (invErr) {
        logger.error('Error handling invoice.paid webhook', invErr);
        await alertWebhookFailure('invoice.paid handler failed', invErr, { eventId: event.id });
        await cleanupDedupe();  // C2
        return NextResponse.json({ error: 'Failed to refresh invoice URLs' }, { status: 500 });
      }
    }

    // Audit #28: charge.refunded handler — runs when admin issues a refund
    // from the Stripe Dashboard. Updates the JobCharge ledger, flips
    // EmployerJob.paymentStatus to 'refunded', unpublishes the job (full
    // refund only), and sends the customer a confirmation email.
    if (event.type === 'charge.refunded') {
      try {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;

        if (!paymentIntentId) {
          logger.warn('charge.refunded webhook with no payment_intent — cannot match to JobCharge', { chargeId: charge.id });
          return NextResponse.json({ received: true, note: 'no payment_intent' });
        }

        const jobCharge = await prisma.jobCharge.findUnique({
          where: { stripePaymentIntentId: paymentIntentId },
        });

        if (!jobCharge) {
          // Pre-audit-#28 charges don't have payment_intent persisted, OR
          // the refund is for a charge that originated outside our flow.
          logger.warn('charge.refunded: no matching JobCharge — pre-#28 row or external charge', { paymentIntentId, chargeId: charge.id });
          return NextResponse.json({ received: true, note: 'no matching JobCharge' });
        }

        const refundedAmount = charge.amount_refunded ?? 0;
        const isPartial = refundedAmount > 0 && refundedAmount < jobCharge.amountCents;
        const isFullRefund = refundedAmount >= jobCharge.amountCents;

        // Pull a refund reason from the latest refund object on the charge if available.
        const latestRefund = charge.refunds?.data?.[0];
        const refundReason = latestRefund?.reason ?? null;

        // Update the ledger
        await prisma.jobCharge.update({
          where: { id: jobCharge.id },
          data: {
            refundedAt: new Date(),
            refundedAmountCents: refundedAmount,
            refundReason,
          },
        });

        // Flip the EmployerJob paymentStatus + (if full refund) unpublish the
        // job. B112: employerJobId is nullable now (FK ON DELETE SET NULL) —
        // a null means the posting was deleted after payment; the ledger row
        // survives for accounting but there is no entitlement to revoke.
        const employerJob = jobCharge.employerJobId
          ? await prisma.employerJob.findUnique({
              where: { id: jobCharge.employerJobId },
              include: { job: { select: { id: true, title: true } } },
            })
          : null;

        if (employerJob) {
          // Only a FULL refund revokes entitlement. A partial/goodwill refund
          // must leave paymentStatus='paid' — otherwise the customer keeps a
          // live job but permanently loses invoice/receipt downloads (those
          // 400 unless 'paid') and can never republish. The ledger row above
          // already records refundedAmountCents for accounting either way.
          if (isFullRefund) {
            await prisma.employerJob.update({
              where: { id: employerJob.id },
              data: { paymentStatus: 'refunded' },
            });
            await prisma.job.update({
              where: { id: employerJob.jobId },
              data: { isPublished: false },
            });
          } else if (isPartial) {
            logger.info('charge.refunded: partial refund — entitlement retained', {
              employerJobId: employerJob.id,
              refundedAmount,
              totalCents: jobCharge.amountCents,
            });
          }

          // Best-effort refund-confirmation email (don't fail the webhook on
          // email errors), guarded by an EmailSend dedupe claim (B109). Keyed
          // on the refund id when available so each distinct partial refund
          // gets its own email, but a redelivery of the same refund event
          // can never double-send.
          const refundEmailKey = `refund-confirmation:${latestRefund?.id ?? `${charge.id}:${refundedAmount}`}`;
          const refundEmailClaimed = await claimEmailSend(
            refundEmailKey,
            employerJob.contactEmail,
            'refund_confirmation',
          );
          if (refundEmailClaimed) {
            try {
              const unsubToken = await getOrCreateUnsubToken(employerJob.contactEmail);
              await sendRefundConfirmationEmail(
                employerJob.contactEmail,
                employerJob.job?.title ?? 'your job posting',
                refundedAmount,
                isPartial,
                unsubToken,
              );
            } catch (emailErr) {
              logger.error('Failed to send refund confirmation email', emailErr, { jobChargeId: jobCharge.id });
              await releaseEmailClaim(refundEmailKey);
            }
          } else {
            logger.info('Refund confirmation email already sent for this refund — skipping duplicate', {
              jobChargeId: jobCharge.id,
            });
          }
        } else {
          logger.warn('charge.refunded: JobCharge has no matching EmployerJob — orphaned ledger row', { jobChargeId: jobCharge.id });
        }

        logger.info('Refund processed', {
          jobChargeId: jobCharge.id,
          refundedAmount,
          isPartial,
          isFullRefund,
          paymentIntentId,
        });
      } catch (refundErr) {
        logger.error('Error handling charge.refunded webhook', refundErr);
        await alertWebhookFailure('charge.refunded handler failed', refundErr, { eventId: event.id });
        await cleanupDedupe();  // C2
        return NextResponse.json({ error: 'Failed to handle refund' }, { status: 500 });
      }
    }

    // Chargeback / dispute: when a customer disputes a charge the bank pulls the
    // funds and Stripe does NOT emit charge.refunded — so without this the
    // disputed posting stayed live with paymentStatus='paid'. Revoke entitlement
    // (unpublish + mark 'disputed', which the invoice/receipt routes and
    // toggle-publish already treat as non-paid).
    // NOTE: requires `charge.dispute.created` to be enabled on the Stripe webhook
    // endpoint's event list.
    if (event.type === 'charge.dispute.created') {
      try {
        const dispute = event.data.object as Stripe.Dispute;
        const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
        if (!paymentIntentId) {
          logger.warn('charge.dispute.created with no payment_intent — cannot match to JobCharge', { disputeId: dispute.id });
          return NextResponse.json({ received: true, note: 'no payment_intent' });
        }

        const jobCharge = await prisma.jobCharge.findUnique({
          where: { stripePaymentIntentId: paymentIntentId },
        });
        if (!jobCharge) {
          logger.warn('charge.dispute.created: no matching JobCharge', { paymentIntentId, disputeId: dispute.id });
          return NextResponse.json({ received: true, note: 'no matching JobCharge' });
        }

        // B112: employerJobId nullable (FK ON DELETE SET NULL) — see the
        // charge.refunded handler above.
        const employerJob = jobCharge.employerJobId
          ? await prisma.employerJob.findUnique({
              where: { id: jobCharge.employerJobId },
              include: { job: { select: { id: true, title: true } } },
            })
          : null;

        if (employerJob) {
          await prisma.employerJob.update({
            where: { id: employerJob.id },
            data: { paymentStatus: 'disputed' },
          });
          await prisma.job.update({
            where: { id: employerJob.jobId },
            data: { isPublished: false },
          });
          logger.warn('Chargeback: revoked posting on dispute', {
            employerJobId: employerJob.id,
            disputeId: dispute.id,
            amount: dispute.amount,
          });
        } else {
          logger.warn('charge.dispute.created: JobCharge has no matching EmployerJob', { jobChargeId: jobCharge.id });
        }
      } catch (disputeErr) {
        logger.error('Error handling charge.dispute.created webhook', disputeErr);
        await alertWebhookFailure('charge.dispute.created handler failed', disputeErr, { eventId: event.id });
        await cleanupDedupe();  // C2
        return NextResponse.json({ error: 'Failed to handle dispute' }, { status: 500 });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error('Webhook error', error);
    await alertWebhookFailure('Unhandled webhook error', error, { eventId: dedupedEventId ?? undefined });
    // C2: roll back the idempotency row so Stripe's retry actually runs.
    // Without this, an uncaught exception leaves the event marked
    // "processed" while the side-effects (charge ledger, email, publish
    // flip) silently never happened.
    if (dedupedEventId) {
      try {
        await prisma.processedStripeEvent.delete({ where: { eventId: dedupedEventId } });
      } catch (cleanupErr) {
        logger.error('[Stripe] Failed to roll back dedupe row in outer catch — Stripe retry may be silently dropped', cleanupErr, { eventId: dedupedEventId });
        await alertWebhookFailure('Dedupe rollback failed in outer catch — Stripe retry may be silently dropped', cleanupErr, { eventId: dedupedEventId });
      }
    }
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

