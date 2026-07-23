/**
 * Autofill telemetry retention (audit B94).
 *
 * The extension's field-level telemetry exists to promote recurring AI
 * matches into deterministic rules — a purpose served by RECENT data.
 * Rows previously accumulated forever, and although the ingest route now
 * redacts value samples (see app/api/autofill/telemetry/route.ts), the
 * table still maps userId → which ATS forms they filled and when, which is
 * behavioral data with no business value beyond the analysis window.
 *
 * Daily cron deletes rows older than RETENTION_DAYS. Chunked deletes keep
 * each statement's lock/WAL footprint small on a table with a large backlog.
 */

import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const TELEMETRY_RETENTION_DAYS = 90;

/** Per-statement delete cap. */
const DELETE_CHUNK = 5_000;
/** Hard bound on chunks per run — resumes next night on enormous backlogs. */
const MAX_CHUNKS_PER_RUN = 20;

export const autofillTelemetryRetention = inngest.createFunction(
    {
        id: 'autofill-telemetry-retention',
        name: 'Autofill telemetry — retention cleanup',
        // 05:40 UTC daily, before the 06:15 enrichment trigger.
        triggers: [{ cron: 'TZ=UTC 40 5 * * *' }],
        retries: 2,
        concurrency: 1,
    },
    async ({ step }) => {
        const cutoff = new Date(Date.now() - TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        let totalDeleted = 0;

        for (let chunk = 0; chunk < MAX_CHUNKS_PER_RUN; chunk++) {
            const deleted = await step.run(`delete-chunk-${chunk}`, async () => {
                const stale = await prisma.autofillTelemetry.findMany({
                    where: { createdAt: { lt: cutoff } },
                    select: { id: true },
                    take: DELETE_CHUNK,
                });
                if (stale.length === 0) return 0;
                const result = await prisma.autofillTelemetry.deleteMany({
                    where: { id: { in: stale.map((r) => r.id) } },
                });
                return result.count;
            });

            totalDeleted += deleted;
            if (deleted < DELETE_CHUNK) break;
        }

        if (totalDeleted > 0) {
            logger.info('autofill telemetry retention complete', {
                deleted: totalDeleted,
                retentionDays: TELEMETRY_RETENTION_DAYS,
            });
        }
        return { deleted: totalDeleted, retentionDays: TELEMETRY_RETENTION_DAYS };
    },
);

export const autofillTelemetryRetentionFunctions = [autofillTelemetryRetention] as const;
