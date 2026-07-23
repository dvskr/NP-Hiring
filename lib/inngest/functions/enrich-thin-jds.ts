/**
 * Scheduled trigger for /api/cron/enrich-thin-jds (audit B3/B13).
 *
 * The thin-JD enrichment route was built, tracked (cron_runs), guardrailed,
 * and tested — but never scheduled anywhere, so SEO thin-JD enrichment
 * simply never ran. Scheduling lives HERE, on Inngest, per the repo rule
 * that new schedules go through lib/inngest/functions (vercel.json is at
 * its cron budget and owned by the payments-infra package).
 *
 * Why trigger the route over HTTP instead of importing its internals: the
 * route already owns auth, the ai.platform.seo_content kill switch, cron_runs
 * tracking, Discord failure alerting, guardrails, and the per-run cost cap
 * (MAX_JOBS_PER_RUN). Re-implementing that here would fork the logic; a
 * bearer-authed self-call reuses all of it. The route also remains manually
 * triggerable from /admin/cron exactly as before.
 *
 * Spend safety: the route is flag-gated (registry default false) — until
 * 'ai.platform.seo_content' is enabled via DB override, each tick is a
 * cheap no-op that returns { skipped: 'feature_disabled' }.
 */

import { inngest } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';
import { brand } from '@/config/brand';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

/**
 * The route caps itself at ~250s; this fetch waits up to 280s. If the
 * serving platform kills THIS invocation first, Inngest retries — the route
 * is incremental (lastEnrichedAt cooldown + thin-length filter), so a
 * retried tick just resumes where the last one stopped.
 */
const FETCH_TIMEOUT_MS = 280_000;

export const enrichThinJdsDaily = inngest.createFunction(
    {
        id: 'enrich-thin-jds-daily',
        name: 'Thin-JD enrichment — daily trigger',
        // 06:15 UTC daily — off-peak, clear of the 08:00 eval-drift and
        // 09:00 recommendations crons.
        triggers: [{ cron: 'TZ=UTC 15 6 * * *' }],
        retries: 2,
        concurrency: 1,
    },
    async ({ step }) => {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) {
            logger.warn('enrich-thin-jds trigger skipped: CRON_SECRET is not set');
            return { skipped: 'no_cron_secret' };
        }

        const result = await step.run('trigger-enrich-thin-jds', async () => {
            const res = await fetch(`${BASE_URL}/api/cron/enrich-thin-jds`, {
                headers: { authorization: `Bearer ${cronSecret}` },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                // Throw so Inngest retries — the route's own catch already
                // fired the Discord alert with the underlying error.
                throw new Error(`enrich-thin-jds returned ${res.status}: ${JSON.stringify(body)}`);
            }
            return body as Record<string, unknown> | null;
        });

        logger.info('enrich-thin-jds trigger complete', { result });
        return { triggered: true, result };
    },
);

export const enrichThinJdsFunctions = [enrichThinJdsDaily] as const;
