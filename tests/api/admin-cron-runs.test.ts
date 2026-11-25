/**
 * GET /api/admin/cron-runs: the newest run of every tracked cron, the crons
 * each batch dispatcher runs, and a stale threshold per tracked name.
 *
 * The cron page used to show a schedule and a trigger button and nothing
 * about whether the cron worked. This route is what it reads instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
    requireApiAdmin: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
    logError: vi.fn(),
}));

vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdmin: h.requireApiAdmin }));
vi.mock('@/lib/prisma', () => ({ prisma: { cronRun: { groupBy: h.groupBy, findMany: h.findMany } } }));
vi.mock('@/lib/logger', () => ({ logger: { error: h.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/config/cron-schedule', () => ({
    CRON_BATCHES: [
        {
            group: 'morning',
            schedule: '30 8 * * *',
            targets: [
                { path: '/api/cron/cleanup-rejected-jobs' },
                { path: '/api/cron/employer-report', utcDaysOfMonth: [1] },
            ],
        },
    ],
}));
vi.mock('@/lib/inngest/functions/cron-watchdog', () => ({
    buildExpectedCronCadences: () => [
        { name: 'ingest', maxGapMs: 12 * 60 * 60 * 1000 },
        { name: 'employer-report', maxGapMs: 31 * 24 * 60 * 60 * 1000 },
    ],
}));

import { GET } from '@/app/api/admin/cron-runs/route';

const DAY_MS = 24 * 60 * 60 * 1000;

function req(): NextRequest {
    return new NextRequest('https://example.test/api/admin/cron-runs');
}

beforeEach(() => {
    vi.clearAllMocks();
    h.requireApiAdmin.mockResolvedValue(null);
});

describe('GET /api/admin/cron-runs', () => {
    it('answers the auth error and reads nothing for a caller who is not an admin', async () => {
        h.requireApiAdmin.mockResolvedValue(NextResponse.json({ error: 'Admin access required' }, { status: 403 }));

        const res = await GET(req());

        expect(res.status).toBe(403);
        expect(h.groupBy).not.toHaveBeenCalled();
        expect(h.findMany).not.toHaveBeenCalled();
    });

    it('returns the newest run of each name, with a long error cut to a preview', async () => {
        const ingestAt = new Date('2026-11-24T09:00:00.000Z');
        const alertsAt = new Date('2026-11-20T13:30:00.000Z');
        h.groupBy.mockResolvedValue([
            { name: 'ingest', _max: { startedAt: ingestAt } },
            { name: 'send-alerts', _max: { startedAt: alertsAt } },
            // A group with no start time has nothing to look up.
            { name: 'empty-group', _max: { startedAt: null } },
        ]);
        h.findMany.mockResolvedValue([
            { name: 'ingest', startedAt: ingestAt, finishedAt: null, durationMs: null, success: false, error: null },
            // Same name and millisecond: the first row (newest by ordering) wins.
            { name: 'ingest', startedAt: ingestAt, finishedAt: ingestAt, durationMs: 5, success: true, error: null },
            {
                name: 'send-alerts', startedAt: alertsAt, finishedAt: new Date('2026-11-20T13:31:00.000Z'),
                durationMs: 60_000, success: false, error: 'x'.repeat(1000),
            },
        ]);

        const res = await GET(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(h.findMany.mock.calls[0][0].where).toEqual({
            OR: [
                { name: 'ingest', startedAt: ingestAt },
                { name: 'send-alerts', startedAt: alertsAt },
            ],
        });
        expect(body.runs).toEqual([
            {
                name: 'ingest', startedAt: '2026-11-24T09:00:00.000Z', finishedAt: null,
                durationMs: null, success: false, error: null,
            },
            {
                name: 'send-alerts', startedAt: '2026-11-20T13:30:00.000Z', finishedAt: '2026-11-20T13:31:00.000Z',
                durationMs: 60_000, success: false, error: 'x'.repeat(300),
            },
        ]);
    });

    it('answers an empty history without a second read when nothing has run', async () => {
        h.groupBy.mockResolvedValue([]);

        const body = await (await GET(req())).json();

        expect(body.success).toBe(true);
        expect(body.runs).toEqual([]);
        expect(h.findMany).not.toHaveBeenCalled();
    });

    it('lists each batch dispatcher with the crons it runs and their gates', async () => {
        h.groupBy.mockResolvedValue([]);

        const body = await (await GET(req())).json();

        expect(body.batches).toEqual([
            {
                path: '/api/cron/batch/morning',
                targets: [
                    { path: '/api/cron/cleanup-rejected-jobs', gate: null },
                    { path: '/api/cron/employer-report', gate: 'day 1 of the month only' },
                ],
            },
        ]);
    });

    it('flags a frequent cron after a week and a monthly one after twice its cadence', async () => {
        h.groupBy.mockResolvedValue([]);

        const body = await (await GET(req())).json();

        expect(body.staleAfterMs.ingest).toBe(7 * DAY_MS);
        expect(body.staleAfterMs['employer-report']).toBe(62 * DAY_MS);
    });

    it('says so, and logs it, when cron_runs cannot be read', async () => {
        h.groupBy.mockRejectedValue(new Error('connection refused'));

        const res = await GET(req());
        const body = await res.json();

        expect(res.status).toBe(500);
        expect(body).toEqual({ success: false, error: 'Failed to read cron run history' });
        expect(h.logError).toHaveBeenCalledTimes(1);
    });
});
