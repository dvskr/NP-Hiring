/**
 * Employer plan lapse sweep.
 *
 * A plan entitles posting while status is 'active' or 'past_due' AND
 * currentPeriodEnd + config.planGraceDays is in the future (see
 * lib/employer-plan.ts isPlanEntitled). Two paths leave live 'plan' posts
 * behind after entitlement ends:
 *
 *   1. Stripe's `customer.subscription.updated` flips the row to past_due
 *      but never to canceled (Smart Retries exhausted, subscription left
 *      unpaid). The grace window runs out with no further webhook.
 *   2. An admin-granted plan's period end simply passes — there is no
 *      Stripe event for those rows at all.
 *
 * Cancellation via webhook pauses immediately; this daily sweep covers the
 * rest. For every lapsed, attached plan that still has live plan posts it
 * unpublishes them (`pausePlanPosts` — rows are kept, resumable) and emails
 * the employer once (a later run finds nothing live and sends nothing).
 *
 * Runs on Inngest — NOT vercel.json (at the 40-entry Pro limit) — and is
 * registered in app/api/inngest/route.ts.
 */

import { inngest } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';
import { findLapsedPlans, pausePlanPosts } from '@/lib/employer-plan';
import { sendPlanPausedEmail } from '@/lib/email-service';

/** Hard bound per run — the sweep is daily, a backlog resumes tomorrow. */
const MAX_PLANS_PER_RUN = 200;

interface LapsedPlanRef {
    id: string;
    userId: string;
    email: string;
    status: string;
}

interface PauseStepResult {
    pausedCount: number;
    emailed: boolean;
    error?: string;
}

export const planLapseSweep = inngest.createFunction(
    {
        id: 'employer-plan-lapse-sweep',
        name: 'Employer plans: pause posts on lapsed plans',
        triggers: [{ cron: 'TZ=UTC 0 7 * * *' }], // daily 07:00 UTC, after the 06:30 payment reconciliation
        retries: 2,
        concurrency: 1,
    },
    async ({ step }) => {
        const lapsed = await step.run('find-lapsed-plans', async (): Promise<LapsedPlanRef[]> => {
            const rows = await findLapsedPlans();
            return rows
                .filter((r): r is typeof r & { userId: string } => r.userId !== null)
                .slice(0, MAX_PLANS_PER_RUN)
                .map((r) => ({ id: r.id, userId: r.userId, email: r.email, status: r.status }));
        });

        if (lapsed.length === 0) {
            return { checked: 0, paused: 0, emailed: 0, failures: 0 };
        }

        let pausedPosts = 0;
        let emailed = 0;
        let failures = 0;

        for (const plan of lapsed) {
            const result = await step.run(`pause-${plan.id}`, async (): Promise<PauseStepResult> => {
                try {
                    // No live posts → nothing to pause and the employer was already
                    // told on the run that paused them. Keeps the sweep idempotent.
                    const jobIds = await pausePlanPosts(plan.userId);
                    if (jobIds.length === 0) return { pausedCount: 0, emailed: false };

                    const reason = plan.status === 'cancelled' ? 'cancelled' : 'past_due';
                    try {
                        await sendPlanPausedEmail(plan.email, { reason, pausedCount: jobIds.length });
                        return { pausedCount: jobIds.length, emailed: true };
                    } catch (emailErr) {
                        // Posts are paused (the entitlement decision stands); only
                        // the notice failed. Surface it, do not retry the pause.
                        logger.error('[PlanLapse] paused email failed', emailErr, { planId: plan.id });
                        return { pausedCount: jobIds.length, emailed: false, error: 'email failed' };
                    }
                } catch (err) {
                    // Contain per-plan failures so one broken row cannot abort
                    // the sweep for every other employer.
                    logger.error('[PlanLapse] failed to pause plan posts', err, { planId: plan.id, userId: plan.userId });
                    return { pausedCount: 0, emailed: false, error: err instanceof Error ? err.message : String(err) };
                }
            });

            pausedPosts += result.pausedCount;
            if (result.emailed) emailed += 1;
            if (result.error) failures += 1;
        }

        if (pausedPosts > 0 || failures > 0) {
            logger.info('[PlanLapse] sweep complete', { checked: lapsed.length, pausedPosts, emailed, failures });
        }

        return { checked: lapsed.length, paused: pausedPosts, emailed, failures };
    },
);

export const planLapseFunctions = [planLapseSweep] as const;
