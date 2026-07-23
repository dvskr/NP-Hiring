import { NextRequest, NextResponse } from 'next/server';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { CRON_BATCHES } from '@/config/cron-schedule';
import type { CronBatchTarget } from '@/config/cron-schedule';
import { logger } from '@/lib/logger';

/**
 * Sequential cron batch dispatcher (B106).
 *
 * Vercel Pro caps a project at 40 cron entries; this route lets one
 * vercel.json entry drive several low-frequency housekeeping crons.
 * Batch membership + order live in config/cron-schedule.ts (CRON_BATCHES)
 * so the schedule config stays the single source of truth and the cron
 * watchdog can derive each target's effective cadence.
 *
 * Targets are invoked over HTTP, strictly one at a time, with the
 * CRON_SECRET bearer — each keeps its own route, auth, maxDuration,
 * and CronRun tracking. A failing target is recorded and skipped, never
 * fatal to the rest of the batch. A deadline guard skips remaining
 * targets (with a Discord alert) when the dispatcher nears its own
 * duration cap, so a pathological slow target can't strand the tail
 * silently.
 */

export const maxDuration = 300;

/** Leave this much headroom before our own maxDuration kills us. */
const DEADLINE_MARGIN_MS = 15_000;
/** Never wait longer than this on a single target (mirrors the largest target maxDuration). */
const TARGET_TIMEOUT_CAP_MS = 280_000;
/** Minimum budget worth starting a target with. */
const MIN_TARGET_BUDGET_MS = 5_000;

interface TargetResult {
    path: string;
    status: 'ok' | 'failed' | 'skipped-gate' | 'skipped-budget';
    httpStatus?: number;
    ms?: number;
    error?: string;
}

/** Evaluate a target's UTC gates against the dispatcher invocation time. */
function gateAllowsRun(target: CronBatchTarget, now: Date): boolean {
    if (target.utcHours && !target.utcHours.includes(now.getUTCHours())) return false;
    if (target.utcDaysOfWeek && !target.utcDaysOfWeek.includes(now.getUTCDay())) return false;
    if (target.utcDaysOfMonth && !target.utcDaysOfMonth.includes(now.getUTCDate())) return false;
    return true;
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ group: string }> },
) {
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    const { group } = await context.params;
    const batch = CRON_BATCHES.find((b) => b.group === group);
    if (!batch) {
        return NextResponse.json({ error: `Unknown cron batch: ${group}` }, { status: 404 });
    }

    try {
        return await withCronTracking(`batch/${group}`, async () => {
            const startedAt = Date.now();
            const deadline = startedAt + maxDuration * 1000 - DEADLINE_MARGIN_MS;
            const now = new Date();
            const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin;
            const authHeader = `Bearer ${process.env.CRON_SECRET ?? ''}`;

            const results: TargetResult[] = [];

            for (const target of batch.targets) {
                if (!gateAllowsRun(target, now)) {
                    results.push({ path: target.path, status: 'skipped-gate' });
                    continue;
                }

                const remaining = deadline - Date.now();
                if (remaining < MIN_TARGET_BUDGET_MS) {
                    results.push({ path: target.path, status: 'skipped-budget' });
                    continue;
                }

                const targetStart = Date.now();
                try {
                    const res = await fetch(new URL(target.path, baseUrl), {
                        headers: { authorization: authHeader },
                        signal: AbortSignal.timeout(Math.min(remaining, TARGET_TIMEOUT_CAP_MS)),
                        cache: 'no-store',
                    });
                    results.push({
                        path: target.path,
                        status: res.ok ? 'ok' : 'failed',
                        httpStatus: res.status,
                        ms: Date.now() - targetStart,
                    });
                    // Drain the body so the connection is released promptly.
                    await res.text().catch(() => undefined);
                } catch (err) {
                    results.push({
                        path: target.path,
                        status: 'failed',
                        ms: Date.now() - targetStart,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }

            const failed = results.filter((r) => r.status === 'failed');
            const skippedBudget = results.filter((r) => r.status === 'skipped-budget');
            const succeeded = results.filter((r) => r.status === 'ok');

            if (failed.length > 0 || skippedBudget.length > 0) {
                const summary = [
                    ...failed.map((r) => `${r.path}: FAILED (${r.error ?? `HTTP ${r.httpStatus}`})`),
                    ...skippedBudget.map((r) => `${r.path}: SKIPPED (dispatcher budget exhausted)`),
                ].join('; ');
                await sendCronFailureAlert(`batch/${group}`, new Error(summary), {
                    failed: failed.length,
                    skipped: skippedBudget.length,
                    succeeded: succeeded.length,
                });
            }

            logger.info(`[cron-batch] ${group} complete`, {
                succeeded: succeeded.length,
                failed: failed.length,
                skippedBudget: skippedBudget.length,
                totalMs: Date.now() - startedAt,
            });

            return {
                response: NextResponse.json({
                    success: failed.length === 0 && skippedBudget.length === 0,
                    group,
                    results,
                    timestamp: new Date().toISOString(),
                }),
                metrics: {
                    succeeded: succeeded.length,
                    failed: failed.length,
                    skippedBudget: skippedBudget.length,
                    results: results.map((r) => ({ path: r.path, status: r.status, ms: r.ms })),
                },
            };
        });
    } catch (error) {
        await sendCronFailureAlert(`batch/${group}`, error);
        logger.error(`[cron-batch] ${group} dispatcher error`, error);
        return NextResponse.json({ error: 'Batch dispatch failed' }, { status: 500 });
    }
}
