/**
 * Payment reconciliation sweep — F32 layer 2 (missed-webhook recovery).
 *
 * A paid job post is created with paymentStatus='pending' and only the
 * `checkout.session.completed` webhook activates it. If webhook delivery
 * fails past Stripe's ~3-day retry window, the employer's money is taken and
 * the job never publishes — and nothing ever noticed. This daily sweep:
 *
 *   1. Finds EmployerJob rows stuck 'pending' for >2h.
 *   2. Lists recent Stripe Checkout Sessions (Checkout Sessions are not
 *      covered by Stripe's Search API) and matches them on `metadata.jobId`
 *      (set by /api/create-checkout).
 *   3. Session paid → runs the same shared activation the webhook runs
 *      (atomic pending→paid claim inside prevents double-apply) and alerts
 *      Discord: a paid-but-pending row means webhook delivery is broken.
 *   4. Session unpaid/expired/missing and the row is >24h old (Stripe
 *      checkout sessions hard-expire after 24h) → marks the row 'expired'
 *      so abandoned checkouts stop accumulating as 'pending'. EXCEPT a
 *      session that is 'complete' with a delayed payment (ACH and similar)
 *      still outstanding: its PaymentIntent is 'processing' (the debit is
 *      settling) or 'requires_action' (ACH microdeposit verification, which
 *      Stripe keeps open for up to 10 days before the payment fails), and
 *      checkout.session.async_payment_succeeded can land days later. That
 *      row stays 'pending' so the activation can claim it; expiring it would
 *      turn the paid post into a 'duplicate_payment' refund alert. A delayed
 *      payment that failed (intent back to 'requires_payment_method', or
 *      'canceled') expires as before.
 *   5. RENEWALS: a renewal is bought against an already-live row, so it is
 *      invisible to steps 1–4. Every paid `metadata.type === 'renewal'`
 *      session older than 2h with no JobCharge for its session id is
 *      fulfilled through the webhook's shared applyRenewalCheckout (its
 *      JobCharge-first transaction prevents a double extension) and reported
 *      in the same alert as "renewal recovered".
 *
 * ('upgrade' sessions are skipped: nothing in the app creates them any more.)
 *
 * Without STRIPE_SECRET_KEY (paid posting not launched) nothing can be
 * reconciled, so the sweep logs a skip and returns instead of failing every
 * day with retries; pending rows are left untouched. With a key it always
 * scans Stripe, even when no row is pending, because the renewal arm (5)
 * has no database trace to look for first.
 *
 * Runs on Inngest (NOT vercel.json cron — per audit constraints) and is
 * registered in app/api/inngest/route.ts.
 */

import { getStripe } from '@/lib/stripe';
import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/sentry';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sanitizeForDiscord } from '@/lib/sanitize-for-discord';
import { activatePaidJobCheckout } from '@/app/api/webhooks/stripe/activate-paid-job';
import { applyRenewalCheckout } from '@/app/api/webhooks/stripe/apply-renewal';

const PENDING_MIN_AGE_MS = 2 * 60 * 60 * 1000;   // ignore rows younger than 2h — webhook may still be in flight
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;    // Stripe checkout sessions hard-expire 24h after creation
const RENEWAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // past Stripe's ~3-day webhook retry window, with margin
const MAX_ROWS_PER_SWEEP = 100;
const MAX_RENEWALS_PER_SWEEP = 100;
const MAX_SESSIONS_SCANNED = 2000;
const SESSION_LIST_MARGIN_SECONDS = 3600;        // list from 1h before the oldest pending row

interface SessionMatch {
    sessionId: string;
    paymentStatus: string;
    status: string | null;
    createdMs: number;
}

interface SessionScan {
    byJobId: Record<string, SessionMatch>;
    /** Paid renewal sessions old enough that the webhook should have landed. */
    paidRenewals: Array<{ sessionId: string; jobId: string }>;
}

interface ActivationStepResult {
    outcome: 'activated' | 'already_active' | 'employer_job_missing' | 'duplicate_payment' | 'skipped-unpaid' | 'error';
    error?: string;
}

interface RenewalStepResult {
    outcome: 'applied' | 'already_applied' | 'revoked_posting' | 'employer_job_missing' | 'has-charge' | 'skipped-unpaid' | 'error';
    error?: string;
}

function requireStripe() {
    const stripe = getStripe();
    if (!stripe) throw new Error('STRIPE_SECRET_KEY not configured — cannot reconcile checkouts');
    return stripe;
}

/**
 * PaymentIntent states of a completed, unpaid session whose delayed payment
 * can still succeed: 'processing' while the debit settles, 'requires_action'
 * while the employer has yet to verify ACH microdeposits (up to 10 days,
 * after which Stripe fails the payment and the intent reverts to
 * 'requires_payment_method').
 */
const OUTSTANDING_INTENT_STATUSES: ReadonlySet<string> = new Set(['processing', 'requires_action']);

/**
 * True when an unpaid row must NOT be expired yet: its newest session is
 * 'complete' and Stripe still owes an answer on the money (the PaymentIntent
 * of a delayed payment method is 'processing', or 'requires_action' while
 * microdeposit verification is pending), or the session was paid since the
 * scan (the next run activates it). When Stripe cannot be asked, the row is
 * held for the next run: holding a row a day costs nothing, expiring a paid
 * one loses the post.
 */
async function isPaymentStillSettling(sessionId: string): Promise<boolean> {
    try {
        const stripe = requireStripe();
        const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
        if (session.payment_status === 'paid') return true;
        if (session.status !== 'complete' || session.payment_status !== 'unpaid') return false;
        const intent = session.payment_intent;
        return !!intent && typeof intent === 'object' && OUTSTANDING_INTENT_STATUSES.has(intent.status);
    } catch (err) {
        if ((err as { code?: string } | null)?.code === 'resource_missing') return false;
        logger.error('[PaymentReconciliation] Could not check a completed session before expiry; holding the row', err, { sessionId });
        return true;
    }
}

export const paymentReconciliationSweep = inngest.createFunction(
    {
        id: 'payment-reconciliation-sweep',
        name: 'Payments: reconcile pending checkouts against Stripe',
        triggers: [{ cron: 'TZ=UTC 30 6 * * *' }], // daily 06:30 UTC
        retries: 2,
    },
    async ({ step }) => {
        const stalePending = await step.run('find-stale-pending', async () => {
            const rows = await prisma.employerJob.findMany({
                where: {
                    paymentStatus: 'pending',
                    createdAt: { lt: new Date(Date.now() - PENDING_MIN_AGE_MS) },
                },
                select: { id: true, jobId: true, createdAt: true },
                orderBy: { createdAt: 'asc' },
                take: MAX_ROWS_PER_SWEEP,
            });
            return rows.map((r) => ({ id: r.id, jobId: r.jobId, createdAtMs: r.createdAt.getTime() }));
        });

        // No Stripe key: nothing can be checked, activated or recovered, and
        // expiring rows unchecked could retire one that was paid. Skip the run
        // (a thrown error would fail it, and its retries, every day).
        if (!getStripe()) {
            const skip = { checked: 0, activated: 0, expired: 0, settling: 0, failures: 0, skipped: 'stripe_not_configured' as const };
            if (stalePending.length > 0) {
                logger.warn('[PaymentReconciliation] Stripe is not configured; pending checkouts left unreconciled', { pendingRows: stalePending.length });
            } else {
                logger.info('[PaymentReconciliation] Stripe is not configured; nothing to reconcile, skipping');
            }
            return skip;
        }

        const scan = await step.run('map-stripe-sessions', async (): Promise<SessionScan> => {
            const stripe = requireStripe();

            // Cover the oldest pending row AND the renewal lookback window.
            const renewalFromMs = Date.now() - RENEWAL_LOOKBACK_MS;
            const oldestMs = stalePending.length > 0 ? Math.min(stalePending[0].createdAtMs, renewalFromMs) : renewalFromMs;
            const byJobId: Record<string, SessionMatch> = {};
            const paidRenewals: SessionScan['paidRenewals'] = [];
            const renewalCutoffMs = Date.now() - PENDING_MIN_AGE_MS;
            let scanned = 0;

            for await (const s of stripe.checkout.sessions.list({
                created: { gte: Math.floor(oldestMs / 1000) - SESSION_LIST_MARGIN_SECONDS },
                limit: 100,
            })) {
                scanned += 1;
                const matchedJobId = s.metadata?.jobId;
                const sessionType = s.metadata?.type;
                if (matchedJobId && sessionType === 'renewal') {
                    if (s.payment_status === 'paid' && s.created * 1000 < renewalCutoffMs) {
                        paidRenewals.push({ sessionId: s.id, jobId: matchedJobId });
                    }
                } else if (matchedJobId && sessionType !== 'upgrade') {
                    // Renewal/upgrade sessions carry jobId too but must never
                    // feed the NEW-post activation path.
                    const candidate: SessionMatch = {
                        sessionId: s.id,
                        paymentStatus: s.payment_status,
                        status: s.status ?? null,
                        createdMs: s.created * 1000,
                    };
                    const existing = byJobId[matchedJobId];
                    // Prefer a paid session; otherwise keep the newest.
                    if (
                        !existing ||
                        (existing.paymentStatus !== 'paid' &&
                            (candidate.paymentStatus === 'paid' || candidate.createdMs > existing.createdMs))
                    ) {
                        byJobId[matchedJobId] = candidate;
                    }
                }
                if (scanned >= MAX_SESSIONS_SCANNED) break;
            }

            logger.info('[PaymentReconciliation] Stripe session scan complete', {
                scanned,
                matched: Object.keys(byJobId).length,
                pendingRows: stalePending.length,
                paidRenewals: paidRenewals.length,
            });
            return { byJobId, paidRenewals: paidRenewals.slice(0, MAX_RENEWALS_PER_SWEEP) };
        });

        const sessionsByJobId = scan.byJobId;
        const recovered: Array<{ jobId: string; sessionId: string; activation: string }> = [];
        const failures: Array<{ jobId: string; sessionId?: string; error: string }> = [];
        let expired = 0;
        let settling = 0;

        for (const row of stalePending) {
            const match = sessionsByJobId[row.jobId];

            if (match && match.paymentStatus === 'paid') {
                // PAID BUT PENDING — the webhook was missed. Activate now.
                const result = await step.run(`activate-${row.id}`, async (): Promise<ActivationStepResult> => {
                    const stripe = requireStripe();
                    try {
                        // Re-retrieve so activation sees the full, fresh session
                        // (amount, invoice, metadata) rather than the slim map entry.
                        const session = await stripe.checkout.sessions.retrieve(match.sessionId);
                        if (session.payment_status !== 'paid') {
                            return { outcome: 'skipped-unpaid' };
                        }
                        const activation = await activatePaidJobCheckout(stripe, session);
                        return { outcome: activation.outcome };
                    } catch (err) {
                        // Contain per-row failures so one broken row can't abort
                        // the whole sweep; surfaced via the Discord alert below.
                        logger.error('[PaymentReconciliation] Activation failed', err, {
                            jobId: row.jobId,
                            sessionId: match.sessionId,
                        });
                        captureException(err, {
                            tags: { area: 'payment-reconciliation' },
                            extra: { jobId: row.jobId, sessionId: match.sessionId },
                        });
                        return { outcome: 'error', error: err instanceof Error ? err.message : String(err) };
                    }
                });

                if (result.outcome === 'error') {
                    failures.push({ jobId: row.jobId, sessionId: match.sessionId, error: result.error ?? 'unknown' });
                } else if (result.outcome !== 'skipped-unpaid') {
                    recovered.push({ jobId: row.jobId, sessionId: match.sessionId, activation: result.outcome });
                }
            } else {
                // B78: the dashboard's resume-payment action mints a NEW
                // session for an old row, so age the abandonment check on the
                // newest matched session when Stripe has one — otherwise a
                // just-resumed checkout would be re-expired mid-payment. No
                // session at all falls back to row age (original behavior).
                const abandonedSinceMs = match ? match.createdMs : row.createdAtMs;
                if (Date.now() - abandonedSinceMs > ABANDON_AFTER_MS) {
                    // A completed session is not abandoned while its delayed
                    // payment is still settling: keep the row 'pending' so
                    // async_payment_succeeded can still activate it.
                    if (match?.status === 'complete') {
                        const holdRow = await step.run(`check-settling-${row.id}`, () => isPaymentStillSettling(match.sessionId));
                        if (holdRow) {
                            settling += 1;
                            continue;
                        }
                    }
                    // Unpaid and past Stripe's 24h session lifetime — the
                    // checkout was abandoned. Guarded update so a concurrent
                    // activation can never be overwritten.
                    const didExpire = await step.run(`expire-${row.id}`, async () => {
                        const res = await prisma.employerJob.updateMany({
                            where: { id: row.id, paymentStatus: 'pending' },
                            data: { paymentStatus: 'expired' },
                        });
                        return res.count > 0;
                    });
                    if (didExpire) expired += 1;
                }
            }
        }

        // Renewal arm: paid renewal sessions with no ledger row.
        for (const renewal of scan.paidRenewals) {
            const result = await step.run(`renewal-${renewal.sessionId}`, async (): Promise<RenewalStepResult> => {
                try {
                    const charge = await prisma.jobCharge.findUnique({
                        where: { stripeSessionId: renewal.sessionId },
                        select: { id: true },
                    });
                    if (charge) return { outcome: 'has-charge' };
                    const stripe = requireStripe();
                    const session = await stripe.checkout.sessions.retrieve(renewal.sessionId);
                    if (session.payment_status !== 'paid') return { outcome: 'skipped-unpaid' };
                    const applied = await applyRenewalCheckout(stripe, session);
                    return { outcome: applied.outcome };
                } catch (err) {
                    logger.error('[PaymentReconciliation] Renewal recovery failed', err, renewal);
                    captureException(err, { tags: { area: 'payment-reconciliation' }, extra: { ...renewal, kind: 'renewal' } });
                    return { outcome: 'error', error: err instanceof Error ? err.message : String(err) };
                }
            });

            if (result.outcome === 'error') {
                failures.push({ jobId: renewal.jobId, sessionId: renewal.sessionId, error: `RENEWAL ${result.error ?? 'unknown'}` });
            } else if (result.outcome !== 'has-charge' && result.outcome !== 'skipped-unpaid') {
                const label = result.outcome === 'applied' ? 'renewal recovered' : `renewal ${result.outcome}`;
                recovered.push({ jobId: renewal.jobId, sessionId: renewal.sessionId, activation: label });
            }
        }

        if (recovered.length > 0 || failures.length > 0) {
            // A paid-but-pending row means webhook delivery is broken — this
            // must reach a human even when the sweep successfully recovered it.
            await step.run('alert-paid-but-pending', async () => {
                const lines = [
                    ...recovered.map((r) =>
                        `job ${r.jobId} · session ${r.sessionId} · ${r.activation === 'activated' ? 'recovered (activated now)' : r.activation}`),
                    ...failures.map((f) =>
                        `job ${f.jobId}${f.sessionId ? ` · session ${f.sessionId}` : ''} · ACTIVATION FAILED: ${f.error}`),
                ];
                await sendDiscordMessage('', [{
                    title: `🚨 Paid-but-pending checkouts (${recovered.length + failures.length}) — Stripe webhook delivery may be broken`,
                    description: '```\n' + sanitizeForDiscord(lines.join('\n')).slice(0, 1800) + '\n```',
                    color: 0xFF0000,
                }]);
                return { alerted: lines.length };
            });
        }

        logger.info('[PaymentReconciliation] Sweep complete', {
            checked: stalePending.length,
            recovered: recovered.length,
            failures: failures.length,
            expired,
            settling,
        });

        return {
            checked: stalePending.length,
            activated: recovered.length,
            expired,
            settling,
            failures: failures.length,
        };
    },
);

export const paymentReconciliationFunctions = [paymentReconciliationSweep] as const;
