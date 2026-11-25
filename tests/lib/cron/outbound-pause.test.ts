/**
 * A sender cron's run while the emergency brake is engaged
 * (lib/cron/outbound-pause.ts) is a normal run, recorded as one.
 *
 * The five sender crons used to answer the pause before withCronTracking, so
 * a paused run wrote no cron_runs row. The cron watchdog reads the newest
 * successful row of each cron, so a pause longer than twice a cron's cadence
 * read as a cron that had stopped succeeding, and /admin/cron showed the last
 * real run going stale. The pause is now a tracked run: success, with
 * metrics { paused: true }. Pinned here with the real tracker
 * (lib/cron/track.ts), the real watchdog handler and the real cron page
 * reader; the routes are pinned in tests/api/cron-outbound-pause.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { name: string; startedAt: Date; success: boolean };

const h = vi.hoisted(() => ({
    rows: [] as Array<{ name: string; startedAt: Date; success: boolean }>,
    create: vi.fn(),
    update: vi.fn(),
    groupBy: vi.fn(),
    sendDiscordMessage: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    prisma: { cronRun: { create: h.create, update: h.update, groupBy: h.groupBy } },
}));
vi.mock('@/lib/inngest/client', () => ({
    inngest: { createFunction: vi.fn((opts: unknown, handler: unknown) => ({ opts, handler })) },
}));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: h.sendDiscordMessage }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { withCronTracking } from '@/lib/cron/track';
import { outboundPausedRun } from '@/lib/cron/outbound-pause';
import { OUTBOUND_PAUSED_MESSAGE } from '@/lib/outbound-kill-switch';
import { runOutcome } from '@/app/admin/cron/cron-run-lookup';
import { cronWatchdog } from '@/lib/inngest/functions/cron-watchdog';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type WatchdogResult = { stale: Array<{ name: string }>; neverSucceeded: string[] };
type StepRun = (name: string, fn: () => Promise<unknown>) => Promise<unknown>;

/** The watchdog's own handler, with each step run inline. */
function runWatchdog(): Promise<WatchdogResult> {
    const fn = cronWatchdog as unknown as { handler: (ctx: { step: { run: StepRun } }) => Promise<WatchdogResult> };
    return fn.handler({ step: { run: (_name, cb) => cb() } });
}

/** cron_runs grouped by name, newest start per name, as Prisma's groupBy answers it. */
function groupRows(where: { success?: boolean } | undefined): Array<{ name: string; _max: { startedAt: Date } }> {
    const kept = h.rows.filter((row) => where?.success === undefined || row.success === where.success);
    const newest = new Map<string, Date>();
    for (const row of kept) {
        const seen = newest.get(row.name);
        if (!seen || row.startedAt > seen) newest.set(row.name, row.startedAt);
    }
    return [...newest.entries()].map(([name, startedAt]) => ({ name, _max: { startedAt } }));
}

/** Records one tracked run in the in-memory cron_runs, the way withCronTracking writes it. */
function trackRowsInMemory(): void {
    h.create.mockImplementation(async ({ data }: { data: Row }) => {
        h.rows.push({ ...data });
        return { id: `run-${h.rows.length - 1}` };
    });
    h.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const index = Number(where.id.slice('run-'.length));
        h.rows[index] = { ...h.rows[index], ...data };
        return h.rows[index];
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    h.rows.length = 0;
    h.groupBy.mockImplementation(async (args: { where?: { success?: boolean } }) => groupRows(args.where));
    trackRowsInMemory();
});

describe('outboundPausedRun', () => {
    it('answers enabled: false with the reason, and records { paused: true }', async () => {
        const { response, metrics } = outboundPausedRun();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ enabled: false, paused: true, message: OUTBOUND_PAUSED_MESSAGE });
        expect(metrics).toEqual({ paused: true });
    });
});

describe('a paused run through the real tracker', () => {
    it('is written to cron_runs as a finished, successful run with the pause in its metrics', async () => {
        const res = await withCronTracking('send-alerts', async () => outboundPausedRun());

        expect(res.status).toBe(200);
        expect(h.update).toHaveBeenCalledWith({
            where: { id: 'run-0' },
            data: expect.objectContaining({ success: true, finishedAt: expect.any(Date), metrics: { paused: true } }),
        });
        expect(h.rows).toEqual([expect.objectContaining({ name: 'send-alerts', success: true })]);
    });

    it('reads on /admin/cron as a run that succeeded, like any other', () => {
        const startedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const finishedAt = new Date(Date.now() - 2 * 60 * 1000 + 15).toISOString();

        expect(runOutcome({ startedAt, finishedAt, success: true })).toBe('succeeded');
    });
});

describe('the cron watchdog during a long pause', () => {
    const lastRealRun = (): Row => ({ name: 'send-alerts', startedAt: new Date(Date.now() - 30 * DAY_MS), success: true });

    it('reported a daily sender silent when the pause wrote no rows', async () => {
        h.rows.push(lastRealRun());

        const result = await runWatchdog();

        expect(result.stale.map((cron) => cron.name)).toContain('send-alerts');
    });

    it('sees a normal run once the paused run is recorded, and raises no alert for it', async () => {
        h.rows.push(lastRealRun());
        await withCronTracking('send-alerts', async () => outboundPausedRun());

        const result = await runWatchdog();

        expect(result.stale.map((cron) => cron.name)).not.toContain('send-alerts');
        expect(result.neverSucceeded).not.toContain('send-alerts');
        expect(JSON.stringify(h.sendDiscordMessage.mock.calls)).not.toContain('send-alerts');
    });
});
