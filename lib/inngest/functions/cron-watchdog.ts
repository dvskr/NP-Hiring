/**
 * Cron watchdog (B105) — detects crons that silently stopped running.
 *
 * Every scheduled cron in this repo records its runs to cron_runs via
 * lib/cron/track.ts (withCronTracking). The CronRun model comment promised
 * a watchdog on top of that history; this is it. Daily, for every cron the
 * schedule config says should be running (vercel.json entries AND batch
 * dispatcher targets), alert Discord when the most recent SUCCESSFUL run
 * is older than 2× the cron's cadence.
 *
 * Cadence is derived from config/cron-schedule.ts — the single source of
 * truth for vercel.json — so a cron removed from the schedule stops being
 * watched automatically, and batch targets inherit the dispatcher schedule
 * narrowed by their per-target gates.
 *
 * Runs on Inngest (not a vercel.json cron — the 40-entry limit is exactly
 * why B106 exists, and a watchdog on the same scheduling substrate it
 * watches would share its failure mode only partially: Inngest scheduling
 * is independent of Vercel cron delivery).
 */

import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sanitizeForDiscord } from '@/lib/sanitize-for-discord';
import { CRON_ENTRIES, CRON_BATCHES } from '@/config/cron-schedule';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Cadence fallback when a schedule expression can't be parsed. */
const FALLBACK_GAP_MS = 7 * DAY_MS;
/** Longest month, used for day-of-month (monthly) schedules. */
const MONTHLY_GAP_MS = 31 * DAY_MS;

const CRON_PATH_PREFIX = '/api/cron/';

/**
 * '5,10,15' → [5,10,15]; '*' → null. Ranges/steps are not used in this
 * config — throws on anything unparseable (caller falls back conservatively).
 */
function parseCronField(field: string): number[] | null {
    if (field === '*') return null;
    const values = field.split(',').map((v) => Number.parseInt(v, 10));
    if (values.some((v) => Number.isNaN(v))) {
        throw new Error(`Unparseable cron field: "${field}"`);
    }
    return values;
}

/** Largest wrap-around gap between consecutive sorted values over a cycle. */
function maxWrapGap(values: number[], cycle: number): number {
    if (values.length === 1) return cycle;
    const sorted = [...values].sort((a, b) => a - b);
    let max = sorted[0] + cycle - sorted[sorted.length - 1];
    for (let i = 1; i < sorted.length; i++) {
        max = Math.max(max, sorted[i] - sorted[i - 1]);
    }
    return max;
}

/**
 * Worst-case interval (ms) between two consecutive firings of a cron
 * schedule, optionally narrowed by batch-target gates. Conservative on
 * purpose: unparseable inputs fall back to 7 days so the watchdog stays
 * quiet rather than crying wolf.
 */
export function maxScheduleGapMs(
    schedule: string,
    gates?: {
        utcHours?: readonly number[];
        utcDaysOfWeek?: readonly number[];
        utcDaysOfMonth?: readonly number[];
    },
): number {
    const fields = schedule.trim().split(/\s+/);
    if (fields.length !== 5) return FALLBACK_GAP_MS;

    try {
        const hourField = parseCronField(fields[1]);
        const domField = parseCronField(fields[2]);
        const dowField = parseCronField(fields[4]);

        const effectiveDom = gates?.utcDaysOfMonth ? [...gates.utcDaysOfMonth] : domField;
        const effectiveDow = gates?.utcDaysOfWeek ? [...gates.utcDaysOfWeek] : dowField;
        const effectiveHours = gates?.utcHours ? [...gates.utcHours] : hourField;

        // Day-of-month restriction → monthly-class cadence.
        if (effectiveDom !== null) return MONTHLY_GAP_MS;

        // Day-of-week restriction → gap counted in days.
        if (effectiveDow !== null) {
            return maxWrapGap(effectiveDow, 7) * DAY_MS;
        }

        // Every hour.
        if (effectiveHours === null) return HOUR_MS;

        // Specific hours each day.
        return maxWrapGap(effectiveHours, 24) * HOUR_MS;
    } catch {
        return FALLBACK_GAP_MS;
    }
}

/** '/api/cron/ingest?source=x&chunk=0' → 'ingest' (the withCronTracking name). */
function cronNameFromPath(path: string): string {
    const withoutPrefix = path.startsWith(CRON_PATH_PREFIX)
        ? path.slice(CRON_PATH_PREFIX.length)
        : path;
    const queryIndex = withoutPrefix.indexOf('?');
    return queryIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, queryIndex);
}

export interface ExpectedCronCadence {
    name: string;
    /** Worst-case ms between consecutive scheduled runs. */
    maxGapMs: number;
}

/**
 * Every cron name that should be producing successful CronRun rows, with
 * its worst-case firing gap. Names appearing on multiple entries (e.g.
 * 'ingest' across 32 wave entries) keep the SMALLEST gap — any single
 * entry alone already guarantees a run within that window.
 */
export function buildExpectedCronCadences(): ExpectedCronCadence[] {
    const byName = new Map<string, number>();

    const consider = (name: string, gapMs: number): void => {
        const existing = byName.get(name);
        if (existing === undefined || gapMs < existing) {
            byName.set(name, gapMs);
        }
    };

    for (const entry of CRON_ENTRIES) {
        consider(cronNameFromPath(entry.path), maxScheduleGapMs(entry.schedule));
    }

    for (const batch of CRON_BATCHES) {
        for (const target of batch.targets) {
            consider(
                cronNameFromPath(target.path),
                maxScheduleGapMs(batch.schedule, {
                    utcHours: target.utcHours,
                    utcDaysOfWeek: target.utcDaysOfWeek,
                    utcDaysOfMonth: target.utcDaysOfMonth,
                }),
            );
        }
    }

    return [...byName.entries()].map(([name, maxGapMs]) => ({ name, maxGapMs }));
}

interface StaleCron {
    name: string;
    lastSuccessAgoHours: number;
    thresholdHours: number;
}

export const cronWatchdog = inngest.createFunction(
    {
        id: 'cron-watchdog',
        name: 'Crons: alert when a scheduled cron stops succeeding',
        triggers: [{ cron: 'TZ=UTC 0 10 * * *' }], // daily 10:00 UTC — after the morning batch
        retries: 2,
    },
    async ({ step }) => {
        const expected = buildExpectedCronCadences();

        const lastRunsByName = await step.run('load-cron-run-history', async () => {
            const [successes, anyRuns] = await Promise.all([
                prisma.cronRun.groupBy({
                    by: ['name'],
                    where: { success: true },
                    _max: { startedAt: true },
                }),
                prisma.cronRun.groupBy({
                    by: ['name'],
                    _max: { startedAt: true },
                }),
            ]);
            return {
                lastSuccess: Object.fromEntries(
                    successes.map((r) => [r.name, r._max.startedAt?.toISOString() ?? null]),
                ),
                lastAttempt: Object.fromEntries(
                    anyRuns.map((r) => [r.name, r._max.startedAt?.toISOString() ?? null]),
                ),
            };
        });

        const now = Date.now();
        const stale: StaleCron[] = [];
        const neverSucceeded: string[] = [];
        const noHistory: string[] = [];

        for (const { name, maxGapMs } of expected) {
            const thresholdMs = 2 * maxGapMs;
            const lastSuccessIso = lastRunsByName.lastSuccess[name];
            const lastAttemptIso = lastRunsByName.lastAttempt[name];

            if (lastSuccessIso) {
                const age = now - Date.parse(lastSuccessIso);
                if (age > thresholdMs) {
                    stale.push({
                        name,
                        lastSuccessAgoHours: Math.round(age / HOUR_MS),
                        thresholdHours: Math.round(thresholdMs / HOUR_MS),
                    });
                }
            } else if (lastAttemptIso) {
                // Runs exist but none ever succeeded — chronically broken.
                neverSucceeded.push(name);
            } else {
                // No rows at all: newly added cron or tracking not yet live.
                // Reported in metrics only — alerting here would fire on
                // every fresh deployment.
                noHistory.push(name);
            }
        }

        if (stale.length > 0 || neverSucceeded.length > 0) {
            await step.run('alert-silent-crons', async () => {
                const lines = [
                    ...stale.map(
                        (s) =>
                            `${s.name} — last success ${s.lastSuccessAgoHours}h ago (threshold ${s.thresholdHours}h)`,
                    ),
                    ...neverSucceeded.map((n) => `${n} — has runs but has NEVER succeeded`),
                ];
                await sendDiscordMessage('', [
                    {
                        title: `🚨 Cron watchdog: ${lines.length} cron(s) silent beyond 2× cadence`,
                        description:
                            '```\n' + sanitizeForDiscord(lines.join('\n')).slice(0, 1800) + '\n```',
                        color: 0xff0000,
                    },
                ]);
                return { alerted: lines.length };
            });
        }

        logger.info('[CronWatchdog] Sweep complete', {
            watched: expected.length,
            stale: stale.length,
            neverSucceeded: neverSucceeded.length,
            noHistory: noHistory.length,
        });

        return {
            watched: expected.length,
            stale,
            neverSucceeded,
            noHistory,
        };
    },
);

export const cronWatchdogFunctions = [cronWatchdog] as const;
