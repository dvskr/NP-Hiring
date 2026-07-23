/**
 * Payment reconciliation sweep — F32 layer 2 (missed-webhook recovery).
 *
 * A paid job post is created with paymentStatus='pending' and only the
 * `checkout.session.completed` webhook activates it. If webhook delivery
 * fails past Stripe's ~3-day retry window, the employer's money is taken and
 * the job never publishes — and nothing ever noticed. This daily sweep:
 *
 *   1. Finds EmployerJob rows stuck 'pending' for >2h.
 *   2. Looks up their Stripe Checkout Session. The session id was never
 *      persisted pre-payment (JobCharge rows are only written by the
 *      webhook, and EmployerJob has no session column — schema is
 *      intentionally untouched), and Checkout Sessions are not covered by
 *      Stripe's Search API, so we list recent sessions and match on
 *      `metadata.jobId` (set by /api/create-checkout).
 *   3. Session paid → runs the same shared activation the webhook runs
 *      (atomic pending→paid claim inside prevents double-apply) and alerts
 *      Discord: a paid-but-pending row means webhook delivery is broken.
 *   4. Session unpaid/expired/missing and the row is >24h old (Stripe
 *      checkout sessions hard-expire after 24h) → marks the row 'expired'
 *      so abandoned checkouts stop accumulating as 'pending'.
 *
 * Runs on Inngest (NOT vercel.json cron — per audit constraints) and is
 * registered in app/api/inngest/route.ts.
 */

import Stripe from 'stripe';
import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/sentry';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sanitizeForDiscord } from '@/lib/sanitize-for-discord';
import { activatePaidJobCheckout } from '@/app/api/webhooks/stripe/activate-paid-job';

const PENDING_MIN_AGE_MS = 2 * 60 * 60 * 1000;   // ignore rows younger than 2h — webhook may still be in flight
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;    // Stripe checkout sessions hard-expire 24h after creation
const MAX_ROWS_PER_SWEEP = 100;
const MAX_SESSIONS_SCANNED = 2000;
const SESSION_LIST_MARGIN_SECONDS = 3600;        // list from 1h before the oldest pending row

function getStripe(): Stripe | null {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    return new Stripe(key);
}

interface SessionMatch {
    sessionId: string;
    paymentStatus: string;
    status: string | null;
    createdMs: number;
}

interface ActivationStepResult {
    outcome: 'activated' | 'already_active' | 'employer_job_missing' | 'skipped-unpaid' | 'error';
    error?: string;
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

        if (stalePending.length === 0) {
            return { checked: 0, activated: 0, expired: 0, failures: 0 };
        }

        const sessionsByJobId = await step.run('map-stripe-sessions', async () => {
            const stripe = getStripe();
            if (!stripe) {
                throw new Error('STRIPE_SECRET_KEY not configured — cannot reconcile pending checkouts');
            }

            const oldestMs = stalePending[0].createdAtMs;
            const map: Record<string, SessionMatch> = {};
            let scanned = 0;

            for await (const s of stripe.checkout.sessions.list({
                created: { gte: Math.floor(oldestMs / 1000) - SESSION_LIST_MARGIN_SECONDS },
                limit: 100,
            })) {
                scanned += 1;
                const matchedJobId = s.metadata?.jobId;
                const sessionType = s.metadata?.type;
                // Renewal/upgrade sessions carry jobId too but must never feed
                // the NEW-post activation path.
                if (matchedJobId && sessionType !== 'renewal' && sessionType !== 'upgrade') {
                    const candidate: SessionMatch = {
                        sessionId: s.id,
                        paymentStatus: s.payment_status,
                        status: s.status ?? null,
                        createdMs: s.created * 1000,
                    };
                    const existing = map[matchedJobId];
                    // Prefer a paid session; otherwise keep the newest.
                    if (
                        !existing ||
                        (existing.paymentStatus !== 'paid' &&
                            (candidate.paymentStatus === 'paid' || candidate.createdMs > existing.createdMs))
                    ) {
                        map[matchedJobId] = candidate;
                    }
                }
                if (scanned >= MAX_SESSIONS_SCANNED) break;
            }

            logger.info('[PaymentReconciliation] Stripe session scan complete', {
                scanned,
                matched: Object.keys(map).length,
                pendingRows: stalePending.length,
            });
            return map;
        });

        const recovered: Array<{ jobId: string; sessionId: string; activation: string }> = [];
        const failures: Array<{ jobId: string; sessionId?: string; error: string }> = [];
        let expired = 0;

        for (const row of stalePending) {
            const match = sessionsByJobId[row.jobId];

            if (match && match.paymentStatus === 'paid') {
                // PAID BUT PENDING — the webhook was missed. Activate now.
                const result = await step.run(`activate-${row.id}`, async (): Promise<ActivationStepResult> => {
                    const stripe = getStripe();
                    if (!stripe) throw new Error('STRIPE_SECRET_KEY not configured');
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
        });

        return {
            checked: stalePending.length,
            activated: recovered.length,
            expired,
            failures: failures.length,
        };
    },
);

export const paymentReconciliationFunctions = [paymentReconciliationSweep] as const;
