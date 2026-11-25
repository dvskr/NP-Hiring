/**
 * The emergency brake reaches every automated sender cron.
 *
 * With OUTBOUND_MESSAGING_PAUSED=1 each of these answers { enabled: false }
 * with the reason before it reads a single row, so a pause costs no work and
 * sends nothing: job alert digests (which bypass sendAndLog through the
 * provider's batch API), candidate alerts, saved-job reminders, the monthly
 * employer report and push notifications (not email, so sendAndLog never
 * sees them). The ordering is also pinned in source by
 * tests/regressions/cron-outbound-pause-static.test.ts.
 *
 * The pause is the first statement of each cron's tracked run, so it is
 * recorded in cron_runs as a run with metrics { paused: true }: it used to
 * return before withCronTracking and write no row, and the cron watchdog and
 * /admin/cron read the silence as a cron that had stopped working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
    prismaCalls: [] as string[],
    withCronTracking: vi.fn(),
    sendJobAlerts: vi.fn(),
    sendNotification: vi.fn(),
    sendCronFailureAlert: vi.fn(),
    /** The runs the tracker recorded: the name, and the metrics or the error. */
    runs: [] as Array<{ name: string; metrics?: Record<string, unknown>; error?: string }>,
}));

vi.mock('@/lib/auth/verify-cron-or-admin', () => ({ verifyCronOrAdmin: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/cron/track', () => ({ withCronTracking: mocks.withCronTracking }));
vi.mock('@/lib/discord-notifier', () => ({ sendCronFailureAlert: mocks.sendCronFailureAlert, sendDiscordMessage: vi.fn() }));
vi.mock('@/lib/job-alerts-service', () => ({ sendJobAlerts: mocks.sendJobAlerts }));
vi.mock('@/lib/tier-limits', () => ({ getEmployerActivePostings: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/candidate-pool', () => ({ talentPoolWhere: () => ({}) }));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: mocks.sendNotification } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/prisma', () => {
    // Every model method records itself, so "read nothing" is checkable.
    const model = (name: string) => new Proxy({}, {
        get: (_target, method: string) => async () => {
            mocks.prismaCalls.push(`${name}.${method}`);
            return [];
        },
    });
    return { prisma: new Proxy({}, { get: (_target, name: string) => model(name) }) };
});

import { GET as sendAlerts } from '@/app/api/cron/send-alerts/route';
import { GET as candidateAlerts } from '@/app/api/cron/candidate-alerts/route';
import { GET as savedJobReminder } from '@/app/api/cron/saved-job-reminder/route';
import { GET as employerReport } from '@/app/api/cron/employer-report/route';
import { GET as pushNotifications } from '@/app/api/cron/push-notifications/route';
import { OUTBOUND_PAUSED_MESSAGE } from '@/lib/outbound-kill-switch';

type CronGet = (request: NextRequest) => Promise<Response>;

const CRONS: ReadonlyArray<readonly [string, CronGet]> = [
    ['send-alerts', sendAlerts as unknown as CronGet],
    ['candidate-alerts', candidateAlerts as unknown as CronGet],
    ['saved-job-reminder', savedJobReminder as unknown as CronGet],
    ['employer-report', employerReport as unknown as CronGet],
    ['push-notifications', pushNotifications as unknown as CronGet],
];

const cronRequest = (name: string) => new NextRequest(`https://example.com/api/cron/${name}`);

type TrackedBody = () => Promise<{ response: Response; metrics?: Record<string, unknown> }>;

/** The tracker as lib/cron/track.ts runs it: the body runs, and its metrics or its error are recorded. */
function runTrackedBodies(): void {
    mocks.withCronTracking.mockImplementation(async (name: string, body: TrackedBody) => {
        try {
            const result = await body();
            mocks.runs.push({ name, metrics: result.metrics });
            return result.response;
        } catch (err) {
            mocks.runs.push({ name, error: err instanceof Error ? err.message : String(err) });
            throw err;
        }
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.prismaCalls.length = 0;
    mocks.runs.length = 0;
    mocks.withCronTracking.mockResolvedValue(NextResponse.json({ success: true }));
});

afterEach(() => {
    delete process.env.OUTBOUND_MESSAGING_PAUSED;
});

describe('sender crons while OUTBOUND_MESSAGING_PAUSED=1', () => {
    it.each(CRONS)('%s answers enabled: false and does no work', async (name, get) => {
        process.env.OUTBOUND_MESSAGING_PAUSED = '1';
        runTrackedBodies();
        const res = await get(cronRequest(name));

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ enabled: false, paused: true, message: OUTBOUND_PAUSED_MESSAGE });
        expect(mocks.prismaCalls).toEqual([]);
        expect(mocks.sendJobAlerts).not.toHaveBeenCalled();
        expect(mocks.sendNotification).not.toHaveBeenCalled();
        expect(mocks.sendCronFailureAlert).not.toHaveBeenCalled();
    });

    it.each(CRONS)('%s records the pause as a tracked run under its own name, with metrics { paused: true }', async (name, get) => {
        process.env.OUTBOUND_MESSAGING_PAUSED = 'true';
        runTrackedBodies();

        await get(cronRequest(name));

        expect(mocks.withCronTracking).toHaveBeenCalledTimes(1);
        expect(mocks.runs).toEqual([{ name, metrics: { paused: true } }]);
    });
});

describe('push-notifications without VAPID keys, brake off', () => {
    it('records a failed run with the reason and answers 500 as before, with no failure alert of its own', async () => {
        runTrackedBodies();

        const res = await pushNotifications(cronRequest('push-notifications'));

        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'VAPID keys not configured' });
        expect(mocks.runs).toEqual([{ name: 'push-notifications', error: 'VAPID keys not configured' }]);
        expect(mocks.prismaCalls).toEqual([]);
        expect(mocks.sendCronFailureAlert).not.toHaveBeenCalled();
    });
});

describe('sender crons with the brake off', () => {
    it.each(CRONS)('%s runs its tracked body as before', async (name, get) => {
        await get(cronRequest(name));
        expect(mocks.withCronTracking).toHaveBeenCalledTimes(1);
        expect(mocks.withCronTracking.mock.calls[0][0]).toBe(name);
    });
});
