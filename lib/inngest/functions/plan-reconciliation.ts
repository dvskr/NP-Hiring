/**
 * Employer plan reconciliation sweep — missed-webhook recovery for the
 * $399/month subscription (the per-post flow has its own sweep in
 * payment-reconciliation.ts).
 *
 * Plan state is written only by webhook events, so a lost event leaves
 * entitlement wrong with no ledger to notice it. Daily:
 *
 *   1. MISSING ROWS — Employer plan subscriptions created in the last 7 days
 *      with no EmployerPlan row (a lost checkout.session.completed): find
 *      the subscription's Checkout Session and run the webhook's own
 *      handlePlanCheckout on it.
 *   2. DRIFT — every EmployerPlan row that tracks a Stripe subscription is
 *      compared with the live subscription. A different status or
 *      paid-through date is re-applied through the webhook's own
 *      handleSubscriptionChange (a lost .updated/.deleted), and a row whose
 *      subscription no longer exists in Stripe is reported as orphaned.
 *
 * Any finding means webhook delivery is broken, so it always alerts Discord.
 * Runs on Inngest (NOT vercel.json) and is registered in app/api/inngest/route.ts.
 *
 * Without STRIPE_SECRET_KEY (paid posting not launched) there is nothing to
 * compare against, so the sweep logs a skip and returns instead of failing
 * every day with retries. The skip is a warning when plan rows that track a
 * Stripe subscription exist, because those can no longer be reconciled.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/sentry';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sanitizeForDiscord } from '@/lib/sanitize-for-discord';
import { getPlanBySubscriptionId } from '@/lib/employer-plan';
import { handlePlanCheckout, isEmployerPlanSubscription } from '@/app/api/webhooks/stripe/plan-checkout';
import { handleSubscriptionChange, isMissingStripeResource, planStateFromSubscription } from '@/app/api/webhooks/stripe/plan-subscription';

const NEW_SUBSCRIPTION_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
const MIN_SUBSCRIPTION_AGE_SECONDS = 2 * 60 * 60; // the webhook may still be in flight
const MAX_SUBSCRIPTIONS_SCANNED = 500;
const MAX_PLANS_PER_RUN = 200;
const PERIOD_DRIFT_TOLERANCE_MS = 60 * 1000;

interface Finding {
    subscriptionId: string;
    kind: 'created-missing-row' | 'missing-row-unrecoverable' | 'drift-applied' | 'orphaned-row' | 'error';
    detail: string;
}

function requireStripe(): Stripe {
    const stripe = getStripe();
    if (!stripe) throw new Error('STRIPE_SECRET_KEY not configured — cannot reconcile employer plans');
    return stripe;
}

export const planReconciliationSweep = inngest.createFunction(
    {
        id: 'employer-plan-reconciliation-sweep',
        name: 'Employer plans: reconcile plan rows against Stripe subscriptions',
        triggers: [{ cron: 'TZ=UTC 45 6 * * *' }], // daily 06:45 UTC, before the 07:00 lapse sweep
        retries: 2,
        concurrency: 1,
    },
    async ({ step }) => {
        if (!getStripe()) {
            const trackedRows = await step.run('count-stripe-plan-rows', () =>
                prisma.employerPlan.count({ where: { stripeSubscriptionId: { not: null } } }),
            );
            if (trackedRows > 0) {
                logger.warn('[PlanReconciliation] Stripe is not configured; plan rows tracking a subscription left unreconciled', { trackedRows });
            } else {
                logger.info('[PlanReconciliation] Stripe is not configured; nothing to reconcile, skipping');
            }
            return { missingRows: 0, checkedRows: 0, findings: 0, skipped: 'stripe_not_configured' as const };
        }

        const missing = await step.run('find-subscriptions-without-plan-row', async (): Promise<string[]> => {
            const stripe = requireStripe();
            const nowSec = Math.floor(Date.now() / 1000);
            const ids: string[] = [];
            let scanned = 0;
            for await (const sub of stripe.subscriptions.list({
                status: 'all',
                created: { gte: nowSec - NEW_SUBSCRIPTION_LOOKBACK_SECONDS, lte: nowSec - MIN_SUBSCRIPTION_AGE_SECONDS },
                limit: 100,
            })) {
                scanned += 1;
                if (isEmployerPlanSubscription(sub) && sub.status !== 'incomplete_expired' && !(await getPlanBySubscriptionId(sub.id))) {
                    ids.push(sub.id);
                }
                if (scanned >= MAX_SUBSCRIPTIONS_SCANNED) break;
            }
            return ids;
        });

        const findings: Finding[] = [];

        for (const subscriptionId of missing) {
            const finding = await step.run(`recover-${subscriptionId}`, async (): Promise<Finding> => {
                try {
                    const stripe = requireStripe();
                    const sessions = await stripe.checkout.sessions.list({ subscription: subscriptionId, limit: 1 });
                    const session = sessions.data[0];
                    if (!session) {
                        return { subscriptionId, kind: 'missing-row-unrecoverable', detail: 'no Checkout Session found for the subscription' };
                    }
                    const result = await handlePlanCheckout(stripe, session, { eventId: `plan-reconciliation:${subscriptionId}` });
                    return { subscriptionId, kind: 'created-missing-row', detail: `plan checkout replayed: ${result.outcome}` };
                } catch (err) {
                    logger.error('[PlanReconciliation] missing-row recovery failed', err, { subscriptionId });
                    captureException(err, { tags: { area: 'plan-reconciliation' }, extra: { subscriptionId } });
                    return { subscriptionId, kind: 'error', detail: err instanceof Error ? err.message : String(err) };
                }
            });
            findings.push(finding);
        }

        const rows = await step.run('list-stripe-plan-rows', async () => {
            const plans = await prisma.employerPlan.findMany({
                where: { stripeSubscriptionId: { not: null } },
                select: { id: true, stripeSubscriptionId: true },
                orderBy: { updatedAt: 'asc' },
                take: MAX_PLANS_PER_RUN,
            });
            return plans.flatMap((p) => (p.stripeSubscriptionId ? [{ id: p.id, subscriptionId: p.stripeSubscriptionId }] : []));
        });

        for (const row of rows) {
            const finding = await step.run(`sync-${row.id}`, async (): Promise<Finding | null> => {
                try {
                    const stripe = requireStripe();
                    // Stamped before the request goes out, like the webhook's
                    // read (plan-subscription.ts#applySubscriptionEvent): stamped
                    // on arrival, a slow answer would outrank a webhook that
                    // read the subscription after this did.
                    const observedAt = new Date();
                    let subscription: Stripe.Subscription;
                    try {
                        subscription = await stripe.subscriptions.retrieve(row.subscriptionId);
                    } catch (err) {
                        if (isMissingStripeResource(err)) {
                            return { subscriptionId: row.subscriptionId, kind: 'orphaned-row', detail: `plan ${row.id} tracks a subscription Stripe does not have` };
                        }
                        throw err;
                    }
                    const plan = await getPlanBySubscriptionId(row.subscriptionId);
                    if (!plan) return null;
                    const expected = planStateFromSubscription(subscription, 'customer.subscription.updated', plan);
                    const statusDrift = expected.status !== plan.status;
                    const periodDrift = Math.abs(expected.currentPeriodEnd.getTime() - plan.currentPeriodEnd.getTime()) > PERIOD_DRIFT_TOLERANCE_MS;
                    // A 'pending' row is promoted by the checkout/async path; a
                    // cancelled row's anchored date is intentionally not the
                    // live period end — only a status change counts there.
                    if (!statusDrift && (!periodDrift || plan.status === 'cancelled')) return null;
                    const result = await handleSubscriptionChange(subscription, 'customer.subscription.updated', {
                        eventId: `plan-reconciliation:${row.id}`,
                        observedAt,
                    });
                    // A webhook wrote a fresher state between this read and the
                    // write: nothing was applied here, and a delivery that just
                    // landed is no sign of broken webhook delivery.
                    if (result.outcome === 'stale') {
                        logger.info('[PlanReconciliation] drift already corrected by a fresher webhook write; nothing applied', { planId: row.id });
                        return null;
                    }
                    return {
                        subscriptionId: row.subscriptionId,
                        kind: 'drift-applied',
                        detail: `plan ${row.id}: ${plan.status} → ${result.status ?? expected.status}${periodDrift ? ' (period end corrected)' : ''}`,
                    };
                } catch (err) {
                    logger.error('[PlanReconciliation] plan sync failed', err, { planId: row.id });
                    captureException(err, { tags: { area: 'plan-reconciliation' }, extra: { planId: row.id } });
                    return { subscriptionId: row.subscriptionId, kind: 'error', detail: err instanceof Error ? err.message : String(err) };
                }
            });
            if (finding) findings.push(finding);
        }

        if (findings.length > 0) {
            await step.run('alert-plan-drift', async () => {
                const lines = findings.map((f) => `${f.kind} · ${f.subscriptionId} · ${f.detail}`);
                await sendDiscordMessage('', [{
                    title: `🚨 Employer plan reconciliation (${findings.length}) — Stripe webhook delivery may be broken`,
                    description: '```\n' + sanitizeForDiscord(lines.join('\n')).slice(0, 1800) + '\n```',
                    color: 0xFF0000,
                }]);
                return { alerted: lines.length };
            });
        }

        logger.info('[PlanReconciliation] sweep complete', {
            missingRows: missing.length,
            checkedRows: rows.length,
            findings: findings.length,
        });
        return { missingRows: missing.length, checkedRows: rows.length, findings: findings.length };
    },
);

export const planReconciliationFunctions = [planReconciliationSweep] as const;
