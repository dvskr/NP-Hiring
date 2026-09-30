import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert, sendDiscordMessage } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { brand } from '@/config/brand';
import { evaluateJobPostingIntegrity, formatIntegrityAlert, type IntegrityRow } from './evaluate';

export const maxDuration = 120;

const CRON_NAME = 'job-posting-integrity';

/** Rows read per page; descriptions are the heavy column. */
const PAGE_SIZE = 500;

const INTEGRITY_SELECT = {
    id: true,
    slug: true,
    title: true,
    employer: true,
    location: true,
    description: true,
    mode: true,
    isRemote: true,
    isHybrid: true,
    isPublished: true,
    sourceType: true,
    city: true,
    state: true,
    stateCode: true,
    country: true,
} as const;

/**
 * Daily, read-only integrity check over every live job the job sitemap
 * lists (activeIndexableJobWhere): stub descriptions (GFJ-04), work-mode
 * invariants and drift (GFJ-01, the --check of
 * scripts/backfill-remote-flags.ts), and the count of jobs that emit no
 * JobPosting location (CS-03). A failing check posts a Discord alert; the run
 * itself succeeds, and every count lands in cron_runs.metrics for trends.
 * ./evaluate.ts holds the rules. Dispatched by the 'daily' batch
 * (config/cron-schedule.ts) ahead of index-urls. Writes nothing.
 */
export async function GET(request: NextRequest) {
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    try {
        return await withCronTracking(CRON_NAME, async () => {
            const rows = await loadLiveRows(new Date());
            const report = evaluateJobPostingIntegrity(rows);
            const healthy = report.failures.length === 0;
            const alerted = healthy ? false : await sendDiscordMessage(formatIntegrityAlert(report, brand.baseUrl));

            const metrics = {
                scanned: report.scanned,
                healthy,
                alerted,
                stubDescriptions: report.stubDescriptions.count,
                missingJobPostingLocation: report.missingJobPostingLocation.count,
                missingJobPostingLocationShare: Number(report.missingJobPostingLocation.share.toFixed(4)),
                remoteWithoutEvidence: report.workModeViolations.remote_without_evidence.count,
                bothWorkModeFlags: report.workModeViolations.both_flags.count,
                flagsDisagreeWithMode: report.workModeViolations.flags_disagree_with_mode.count,
                workModeFlagDrift: report.workModeFlagDrift.count,
                falseRemoteDrift: report.falseRemoteDrift,
                workModeModeOnlyDrift: report.workModeModeOnlyDrift,
            };
            return {
                response: NextResponse.json({ success: true, ...metrics, failures: report.failures }),
                metrics,
            };
        });
    } catch (error) {
        await sendCronFailureAlert(CRON_NAME, error);
        console.error(`[cron:${CRON_NAME}] failed:`, error);
        return NextResponse.json({ error: 'Job posting integrity check failed' }, { status: 500 });
    }
}

/** Every live, sitemap-eligible job, read in id-ordered pages. */
async function loadLiveRows(now: Date): Promise<IntegrityRow[]> {
    const where = activeIndexableJobWhere(now);
    const rows: IntegrityRow[] = [];
    let cursor: string | undefined;
    for (;;) {
        const page: IntegrityRow[] = await prisma.job.findMany({
            where,
            select: INTEGRITY_SELECT,
            orderBy: { id: 'asc' },
            take: PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const list = Array.isArray(page) ? page : [];
        rows.push(...list);
        if (list.length < PAGE_SIZE) return rows;
        cursor = list[list.length - 1].id;
    }
}
