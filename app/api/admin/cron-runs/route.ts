/**
 * GET /api/admin/cron-runs: the most recent run of every tracked cron.
 *
 * /api/admin/cron-list answers "what is scheduled" out of vercel.json, which
 * is why the cron page could show a schedule and a trigger button and nothing
 * else: no endpoint answered "did it work". The pipeline panel reads cron_runs
 * too, but only as a flat 30 row feed, so a cron that last ran a week ago
 * falls off it entirely.
 *
 * Keyed by the name passed to withCronTracking (see cron-run-lookup.ts for
 * how a scheduled path maps to it). Routes that take a query param
 * (ingest?source=...) record one name for every variant, so they share one
 * run history.
 *
 * On this board 21 housekeeping crons run inside three batch dispatchers and
 * have no vercel.json entry of their own, so the response also lists each
 * batch's targets, and a stale threshold per tracked name derived from the
 * schedule (the cron watchdog's cadences) so a monthly cron is not flagged
 * after a week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logger } from '@/lib/logger';
import { CRON_BATCHES } from '@/config/cron-schedule';
import { buildExpectedCronCadences } from '@/lib/inngest/functions/cron-watchdog';
import {
    describeTargetGate,
    staleThresholdMs,
    type CronBatchView,
    type LatestCronRun,
} from '@/app/admin/cron/cron-run-lookup';

export const dynamic = 'force-dynamic';

/** Enough of the failure to recognise it; the full text lives in the row. */
const ERROR_PREVIEW_CHARS = 300;

async function readLatestRuns(): Promise<LatestCronRun[]> {
    const latest = await prisma.cronRun.groupBy({
        by: ['name'],
        _max: { startedAt: true },
    });

    const keys = latest
        .map((row) => ({ name: row.name, startedAt: row._max.startedAt }))
        .filter((row): row is { name: string; startedAt: Date } => row.startedAt !== null);

    if (keys.length === 0) return [];

    const rows = await prisma.cronRun.findMany({
        where: { OR: keys.map((k) => ({ name: k.name, startedAt: k.startedAt })) },
        select: {
            name: true, startedAt: true, finishedAt: true,
            durationMs: true, success: true, error: true,
        },
        orderBy: { startedAt: 'desc' },
    });

    // Two rows can share a name and a startedAt if a cron was triggered twice
    // in the same millisecond. Keep the first, which the ordering above makes
    // the newest.
    const byName = new Map<string, LatestCronRun>();
    for (const row of rows) {
        if (byName.has(row.name)) continue;
        byName.set(row.name, {
            name: row.name,
            startedAt: row.startedAt.toISOString(),
            finishedAt: row.finishedAt?.toISOString() ?? null,
            durationMs: row.durationMs,
            success: row.success,
            error: row.error ? row.error.slice(0, ERROR_PREVIEW_CHARS) : null,
        });
    }
    return [...byName.values()];
}

function describeBatches(): CronBatchView[] {
    return CRON_BATCHES.map((batch) => ({
        path: `/api/cron/batch/${batch.group}`,
        targets: batch.targets.map((target) => ({
            path: target.path,
            gate: describeTargetGate(target),
        })),
    }));
}

function staleThresholds(): Record<string, number> {
    return Object.fromEntries(
        buildExpectedCronCadences().map((cadence) => [cadence.name, staleThresholdMs(cadence.maxGapMs)]),
    );
}

export async function GET(request: NextRequest) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    try {
        const runs = await readLatestRuns();
        return NextResponse.json({
            success: true,
            runs,
            batches: describeBatches(),
            staleAfterMs: staleThresholds(),
        });
    } catch (err) {
        logger.error('[admin/cron-runs] failed to read cron run history', err);
        return NextResponse.json(
            { success: false, error: 'Failed to read cron run history' },
            { status: 500 },
        );
    }
}
