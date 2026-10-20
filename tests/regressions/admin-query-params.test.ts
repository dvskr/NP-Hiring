/**
 * Admin query parameters that reached Prisma unchecked (ADM-2, ADM-3).
 *
 * GET /api/admin/email/history read page and limit with a bare parseInt:
 * ?limit=abc sent a NaN take to Prisma (500), ?page=0 a negative skip (500),
 * ?limit=100000000 returned the whole broadcast table in one response, and
 * ?limit=0 reported pages as Infinity (null in JSON). GET /api/admin/analytics
 * clamped days with Math.min and Math.max, which pass NaN through: ?days=abc
 * built an invalid `since` date and the handler answered 500. Both now read
 * their numbers through parsePagingParam, as GET /api/admin/jobs does: junk,
 * zero and negatives fall back to the default, and anything above the cap is
 * capped.
 *
 * The analytics per-job drill-down also ran every stored referrer through
 * new URL(). A referrer is the raw Referer header GET /api/jobs/[id] stores,
 * so one forged header made ?jobId=<that job> answer 500 for the whole window.
 *
 * Prisma and the admin gate are mocked: nothing here touches a database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ctDayBounds } from '@/lib/format-ct';

const db = vi.hoisted(() => ({
    emailBroadcast: { findMany: vi.fn(), count: vi.fn() },
    job: { findUnique: vi.fn() },
    jobViewEvent: { findMany: vi.fn() },
    applyClick: { findMany: vi.fn() },
    jobApplication: { findMany: vi.fn() },
    jobReport: { findMany: vi.fn() },
}));
const requireApiAdmin = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdmin }));
// Loaded with parsePagingParam (app/api/admin/jobs/_lib/job-input.ts); never called here.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { GET as historyGET } from '@/app/api/admin/email/history/route';
import { GET as analyticsGET } from '@/app/api/admin/analytics/route';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-14T18:00:00.000Z');
const BROADCAST_TOTAL = 45;

beforeEach(() => {
    vi.clearAllMocks();
    requireApiAdmin.mockResolvedValue(null);
    db.emailBroadcast.findMany.mockResolvedValue([]);
    db.emailBroadcast.count.mockResolvedValue(BROADCAST_TOTAL);
    db.job.findUnique.mockResolvedValue({ id: 'job-1', title: 'Nurse Practitioner', employer: 'Clinic Co' });
    db.jobViewEvent.findMany.mockResolvedValue([]);
    db.applyClick.findMany.mockResolvedValue([]);
    db.jobApplication.findMany.mockResolvedValue([]);
    db.jobReport.findMany.mockResolvedValue([]);
});

function forbidden(): NextResponse {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

async function history(query: string) {
    const res = await historyGET(new Request(`http://127.0.0.1:3000/api/admin/email/history${query}`));
    return { res, body: await res.json() };
}

describe('GET /api/admin/email/history paging (ADM-2)', () => {
    it.each([
        { label: 'no parameters (the admin Email page)', query: '', skip: 0, take: 20 },
        { label: 'page=3&limit=10', query: '?page=3&limit=10', skip: 20, take: 10 },
        { label: 'page=abc&limit=abc', query: '?page=abc&limit=abc', skip: 0, take: 20 },
        { label: 'page=0', query: '?page=0', skip: 0, take: 20 },
        { label: 'page=-3', query: '?page=-3', skip: 0, take: 20 },
        { label: 'limit=0', query: '?limit=0', skip: 0, take: 20 },
        { label: 'limit=-5', query: '?limit=-5', skip: 0, take: 20 },
        { label: 'limit=100000000', query: '?limit=100000000', skip: 0, take: 100 },
        { label: 'page=99999999&limit=100', query: '?page=99999999&limit=100', skip: (1_000_000 - 1) * 100, take: 100 },
    ])('$label reads skip $skip and take $take', async ({ query, skip, take }) => {
        const { res, body } = await history(query);
        expect(res.status).toBe(200);
        expect(db.emailBroadcast.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip, take }));
        expect(body.pagination).toEqual({
            page: skip / take + 1,
            limit: take,
            total: BROADCAST_TOTAL,
            pages: Math.ceil(BROADCAST_TOTAL / take),
        });
    });

    it('still refuses a non-admin before reading anything', async () => {
        requireApiAdmin.mockResolvedValueOnce(forbidden());
        const { res } = await history('?page=abc');
        expect(res.status).toBe(403);
        expect(db.emailBroadcast.findMany).not.toHaveBeenCalled();
        expect(db.emailBroadcast.count).not.toHaveBeenCalled();
    });
});

async function analytics(query: string) {
    const res = await analyticsGET(new NextRequest(`http://127.0.0.1:3000/api/admin/analytics${query}`));
    return { res, body: await res.json() };
}

/** The route's lookback start: CT midnight today, less days - 1 whole days. */
function sinceFor(days: number): string {
    return new Date(ctDayBounds(NOW).startUtc.getTime() - (days - 1) * DAY_MS).toISOString();
}

describe('GET /api/admin/analytics days (ADM-3)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        // What the admin Analytics page (7, 30, 90) and the admin home (30) send.
        { raw: '7', days: 7 },
        { raw: '30', days: 30 },
        { raw: '90', days: 90 },
        { raw: '9999', days: 365 },
        { raw: 'abc', days: 30 },
        { raw: '%20', days: 30 },
        { raw: 'NaN', days: 30 },
        { raw: 'Infinity', days: 30 },
        { raw: '.5', days: 30 },
        { raw: '', days: 30 },
        { raw: '0', days: 30 },
        { raw: '-5', days: 30 },
    ])('days=$raw reads a $days day window', async ({ raw, days }) => {
        const { res, body } = await analytics(`?days=${raw}&section=reports`);
        expect(res.status).toBe(200);
        expect(body.period).toEqual({ since: sinceFor(days), days });
    });

    it('reads the default 30 day window when days is absent', async () => {
        const { res, body } = await analytics('?section=reports');
        expect(res.status).toBe(200);
        expect(body.period).toEqual({ since: sinceFor(30), days: 30 });
    });

    it('the per-job drill-down queries a valid lookback date when days is junk', async () => {
        const { res, body } = await analytics('?days=abc&jobId=job-1');
        expect(res.status).toBe(200);
        expect(body.period).toEqual({ since: sinceFor(30), days: 30 });
        // A mocked Prisma accepts an Invalid Date that the real client rejects,
        // so check the Date each query was given, not only the status.
        expect((db.jobViewEvent.findMany.mock.calls[0][0].where.timestamp.gte as Date).toISOString()).toBe(sinceFor(30));
        expect((db.applyClick.findMany.mock.calls[0][0].where.timestamp.gte as Date).toISOString()).toBe(sinceFor(30));
        expect((db.jobApplication.findMany.mock.calls[0][0].where.appliedAt.gte as Date).toISOString()).toBe(sinceFor(30));
    });

    it('counts a stored referrer that is not a URL instead of answering 500', async () => {
        const at = new Date('2026-10-13T15:00:00.000Z');
        db.jobViewEvent.findMany.mockResolvedValue([
            { timestamp: at, referrer: 'not a url', sessionId: 's1' },
            { timestamp: at, referrer: 'https://www.google.com/search?q=np+jobs', sessionId: 's2' },
            { timestamp: at, referrer: null, sessionId: 's3' },
        ]);
        const { res, body } = await analytics('?jobId=job-1');
        expect(res.status).toBe(200);
        expect(body.views.total).toBe(3);
        expect(body.views.referrers).toEqual({ unknown: 1, 'www.google.com': 1, direct: 1 });
    });

    it('still refuses a non-admin before reading anything', async () => {
        requireApiAdmin.mockResolvedValueOnce(forbidden());
        const { res } = await analytics('?days=abc&jobId=job-1');
        expect(res.status).toBe(403);
        expect(db.job.findUnique).not.toHaveBeenCalled();
        expect(db.jobViewEvent.findMany).not.toHaveBeenCalled();
    });
});
