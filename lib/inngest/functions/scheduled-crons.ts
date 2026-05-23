/**
 * Scheduled cron functions — Inngest replacement for vercel.json crons.
 *
 * Why: Vercel Pro caps cron entries at 64. The pmhnp fork already had 67
 * crons (over-limit on import alone). Inngest has no per-project cron
 * cap and gives us per-function observability, retries, and replays for
 * free.
 *
 * Pattern: each entry below produces one Inngest function that triggers
 * on a cron schedule and HTTP-fetches the underlying /api/cron/<name>
 * endpoint. The route handlers are unchanged — only the trigger moves
 * from Vercel cron to Inngest.
 *
 * Activation: set INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY in env. Until
 * then the functions register on boot but Inngest's hosted scheduler
 * doesn't fire them.
 *
 * Local dev: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
 * fires schedules locally for testing.
 */

import { inngest } from '../client';

type CronJob = {
    /** Function id — must be unique. Used in Inngest dashboard. */
    id: string;
    /** Cron expression (UTC). */
    cron: string;
    /** Path under /api/cron — query string included. */
    path: string;
};

const CRON_JOBS: CronJob[] = [
    // ── Ingestion (morning wave, UTC) ──
    { id: 'cron-ingest-adzuna-am',           cron: '0 10 * * *',  path: '/api/cron/ingest?source=adzuna' },
    { id: 'cron-ingest-greenhouse-0-am',     cron: '10 10 * * *', path: '/api/cron/ingest?source=greenhouse&chunk=0' },
    { id: 'cron-ingest-greenhouse-1-am',     cron: '15 10 * * *', path: '/api/cron/ingest?source=greenhouse&chunk=1' },
    { id: 'cron-ingest-greenhouse-2-am',     cron: '20 10 * * *', path: '/api/cron/ingest?source=greenhouse&chunk=2' },
    { id: 'cron-ingest-greenhouse-3-am',     cron: '25 10 * * *', path: '/api/cron/ingest?source=greenhouse&chunk=3' },
    { id: 'cron-ingest-lever-am',            cron: '50 10 * * *', path: '/api/cron/ingest?source=lever' },
    { id: 'cron-ingest-workday-0-am',        cron: '5 11 * * *',  path: '/api/cron/ingest?source=workday&chunk=0' },
    { id: 'cron-ingest-workday-1-am',        cron: '10 11 * * *', path: '/api/cron/ingest?source=workday&chunk=1' },
    { id: 'cron-ingest-workday-2-am',        cron: '15 11 * * *', path: '/api/cron/ingest?source=workday&chunk=2' },
    { id: 'cron-ingest-workday-3-am',        cron: '20 11 * * *', path: '/api/cron/ingest?source=workday&chunk=3' },
    { id: 'cron-ingest-workday-4-am',        cron: '25 11 * * *', path: '/api/cron/ingest?source=workday&chunk=4' },
    { id: 'cron-ingest-smartrecruiters-am',  cron: '35 11 * * *', path: '/api/cron/ingest?source=smartrecruiters' },
    { id: 'cron-ingest-usajobs-am',          cron: '45 11 * * *', path: '/api/cron/ingest?source=usajobs' },
    { id: 'cron-ingest-ashby-am',            cron: '40 11 * * *', path: '/api/cron/ingest?source=ashby' },
    { id: 'cron-ingest-bamboohr-am',         cron: '50 11 * * *', path: '/api/cron/ingest?source=bamboohr' },
    { id: 'cron-ingest-jazzhr-am',           cron: '55 11 * * *', path: '/api/cron/ingest?source=jazzhr' },
    { id: 'cron-ingest-workable-am',         cron: '0 12 * * *',  path: '/api/cron/ingest?source=workable' },
    { id: 'cron-ingest-doccafe-am',          cron: '5 12 * * *',  path: '/api/cron/ingest?source=doccafe' },
    { id: 'cron-ingest-healthcareer-am',     cron: '10 12 * * *', path: '/api/cron/ingest?source=healthcareercenter' },
    { id: 'cron-ingest-fantastic-24h-noon',  cron: '30 12 * * *', path: '/api/cron/ingest?source=fantastic-jobs-db&endpoint=24h' },
    { id: 'cron-ingest-wave-summary-noon',   cron: '50 12 * * *', path: '/api/cron/ingest-wave-summary' },

    // ── Ingestion (evening wave, UTC) ──
    { id: 'cron-ingest-adzuna-pm',           cron: '0 23 * * *',  path: '/api/cron/ingest?source=adzuna' },
    { id: 'cron-ingest-greenhouse-0-pm',     cron: '10 23 * * *', path: '/api/cron/ingest?source=greenhouse&chunk=0' },
    { id: 'cron-ingest-greenhouse-1-pm',     cron: '15 23 * * *', path: '/api/cron/ingest?source=greenhouse&chunk=1' },
    { id: 'cron-ingest-greenhouse-2-pm',     cron: '20 23 * * *', path: '/api/cron/ingest?source=greenhouse&chunk=2' },
    { id: 'cron-ingest-greenhouse-3-pm',     cron: '25 23 * * *', path: '/api/cron/ingest?source=greenhouse&chunk=3' },
    { id: 'cron-ingest-lever-pm',            cron: '50 23 * * *', path: '/api/cron/ingest?source=lever' },
    { id: 'cron-ingest-workday-0-pm',        cron: '5 0 * * *',   path: '/api/cron/ingest?source=workday&chunk=0' },
    { id: 'cron-ingest-workday-1-pm',        cron: '10 0 * * *',  path: '/api/cron/ingest?source=workday&chunk=1' },
    { id: 'cron-ingest-workday-2-pm',        cron: '15 0 * * *',  path: '/api/cron/ingest?source=workday&chunk=2' },
    { id: 'cron-ingest-workday-3-pm',        cron: '20 0 * * *',  path: '/api/cron/ingest?source=workday&chunk=3' },
    { id: 'cron-ingest-workday-4-pm',        cron: '25 0 * * *',  path: '/api/cron/ingest?source=workday&chunk=4' },
    { id: 'cron-ingest-smartrecruiters-pm',  cron: '35 0 * * *',  path: '/api/cron/ingest?source=smartrecruiters' },
    { id: 'cron-ingest-ashby-pm',            cron: '40 0 * * *',  path: '/api/cron/ingest?source=ashby' },
    { id: 'cron-ingest-bamboohr-pm',         cron: '45 0 * * *',  path: '/api/cron/ingest?source=bamboohr' },
    { id: 'cron-ingest-jazzhr-pm',           cron: '48 0 * * *',  path: '/api/cron/ingest?source=jazzhr' },
    { id: 'cron-ingest-workable-pm',         cron: '52 0 * * *',  path: '/api/cron/ingest?source=workable' },
    { id: 'cron-ingest-doccafe-pm',          cron: '53 0 * * *',  path: '/api/cron/ingest?source=doccafe' },
    { id: 'cron-ingest-healthcareer-pm',     cron: '54 0 * * *',  path: '/api/cron/ingest?source=healthcareercenter' },
    { id: 'cron-ingest-fantastic-24h-eve',   cron: '0 21 * * *',  path: '/api/cron/ingest?source=fantastic-jobs-db&endpoint=24h' },
    { id: 'cron-ingest-wave-summary-eve',    cron: '55 17 * * *', path: '/api/cron/ingest-wave-summary' },
    { id: 'cron-ingest-wave-summary-night',  cron: '55 0 * * *',  path: '/api/cron/ingest-wave-summary' },
    // 6-month deep ingest — once per year, Jan 1
    { id: 'cron-ingest-fantastic-6m-yearly', cron: '0 0 1 1 *',   path: '/api/cron/ingest?source=fantastic-jobs-db&endpoint=6m' },

    // ── Enrichment + maintenance ──
    { id: 'cron-enrich-jobs',           cron: '0 6,12,18,22 * * *', path: '/api/cron/enrich-jobs' },
    { id: 'cron-cleanup-expired',       cron: '10 12,18 * * *',     path: '/api/cron/cleanup-expired' },
    { id: 'cron-cleanup-rejected',      cron: '45 4 * * *',         path: '/api/cron/cleanup-rejected-jobs' },
    { id: 'cron-aggregate-pseo',        cron: '15 0,6,12,18 * * *', path: '/api/cron/aggregate-pseo' },
    { id: 'cron-freshness-decay',       cron: '20 12,18 * * *',     path: '/api/cron/freshness-decay' },
    { id: 'cron-check-dead-links',      cron: '30 12,18 * * *',     path: '/api/cron/check-dead-links' },
    { id: 'cron-engagement-anomaly',    cron: '0 5 * * *',          path: '/api/cron/engagement-anomaly' },
    { id: 'cron-daily-report',          cron: '0 13 * * *',         path: '/api/cron/daily-report' },

    // ── SEO ──
    { id: 'cron-index-urls',            cron: '15 13 * * *',        path: '/api/cron/index-urls' },
    { id: 'cron-index-pseo',            cron: '45 13 * * *',        path: '/api/cron/index-pseo' },
    { id: 'cron-deindex-expired',       cron: '45 12,18 * * *',     path: '/api/cron/deindex-expired' },
    { id: 'cron-historical-deindex',    cron: '0 1,7,19 * * *',     path: '/api/cron/historical-deindex' },
    { id: 'cron-gsc-health-check',      cron: '30 9 * * *',         path: '/api/cron/gsc-health-check' },

    // ── AI ops ──
    { id: 'cron-embedding-drift-check', cron: '0 14 * * *',         path: '/api/cron/embedding-drift-check' },

    // ── Communications ──
    { id: 'cron-send-alerts',           cron: '30 13 * * *',        path: '/api/cron/send-alerts' },
    { id: 'cron-candidate-alerts',      cron: '45 13 * * *',        path: '/api/cron/candidate-alerts' },
    { id: 'cron-employer-report',       cron: '0 14 1 * *',         path: '/api/cron/employer-report' },
    { id: 'cron-saved-job-reminder',    cron: '0 13 * * 3,6',       path: '/api/cron/saved-job-reminder' },
    { id: 'cron-push-notifications',    cron: '30 14 * * *',        path: '/api/cron/push-notifications' },
    { id: 'cron-expiry-warnings',       cron: '0 22 * * *',         path: '/api/cron/expiry-warnings' },

    // ── Health + lifecycle ──
    { id: 'cron-source-presence-unpublish', cron: '55 12 * * *', path: '/api/cron/source-presence-unpublish' },
    { id: 'cron-health-anomaly-check',      cron: '0 13 * * *',  path: '/api/cron/health-anomaly-check' },
    { id: 'cron-purge-soft-deleted',        cron: '30 8 * * *',  path: '/api/cron/purge-soft-deleted' },
    { id: 'cron-purge-inactive-users',      cron: '45 8 * * *',  path: '/api/cron/purge-inactive-users' },
];

/**
 * Generate a fetch invocation for a cron endpoint.
 * Requires NEXT_PUBLIC_BASE_URL + CRON_SECRET to be set.
 */
async function invokeCronEndpoint(path: string): Promise<{ ok: boolean; status: number; body: string }> {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        throw new Error('CRON_SECRET not set — cannot invoke cron endpoint');
    }
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
        // No timeout — let the underlying route's `maxDuration` handle it.
        // Inngest has its own per-function timeout (default 30s, configurable).
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body: body.slice(0, 2000) };
}

/**
 * Build Inngest fns from the CRON_JOBS table. One fn per row.
 */
export const scheduledCronFunctions = CRON_JOBS.map((job) =>
    inngest.createFunction(
        {
            id: job.id,
            name: job.id,
            triggers: [{ cron: `TZ=UTC ${job.cron}` }],
            retries: 1,
        },
        async ({ step }) => {
            return step.run('invoke', () => invokeCronEndpoint(job.path));
        },
    ),
);
