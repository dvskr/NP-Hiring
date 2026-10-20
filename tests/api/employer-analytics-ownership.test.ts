/**
 * GET /api/employer/analytics: the job filter and the day window
 * (docs/PENDING_WORK.md 2.19).
 *
 * The route took `jobId` from the query string and used it as the whole job
 * set (`jobIdFilter ? [jobIdFilter] : owned`), so an employer with one live
 * post could read the daily apply-click series of any job on the board. No
 * page sends the parameter, which is why nothing noticed. `days` had no
 * ceiling either, and it sizes a loop.
 *
 * Pinned:
 *   - a jobId the caller does not own answers 404 and reads no clicks, even
 *     when the caller owns no jobs at all;
 *   - an owned jobId narrows the series to that job;
 *   - without a jobId the series covers the caller's own jobs only;
 *   - an admin may still name any job (the admin area already shows them all);
 *   - `days` is held to 1..365 and falls back to 30.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEmployerActivePostings, getEmployerTier } from '@/lib/tier-limits';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), applyClickFindMany: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/tier-limits', () => ({
    getEmployerTier: vi.fn(),
    getEmployerActivePostings: vi.fn(),
}));

import { GET as analytics } from '@/app/api/employer/analytics/route';

// The global prisma fake has no applyClick model; the route reads it for the series.
Object.assign(prisma, { applyClick: { findMany: mocks.applyClickFindMany } });

const USER = { id: 'supabase-employer', email: 'hiring@clinic.example' };
const OWN_A = 'job-own-a';
const OWN_B = 'job-own-b';
const SOMEONE_ELSES = 'job-of-another-employer';

const OWNED_ROWS = [
    { jobId: OWN_A, job: { id: OWN_A, title: 'FNP, Clinic A', viewCount: 40, applyClickCount: 4 } },
    { jobId: OWN_B, job: { id: OWN_B, title: 'PNP, Clinic B', viewCount: 10, applyClickCount: 1 } },
];

function request(query: string): NextRequest {
    return new NextRequest(`http://localhost:3000/api/employer/analytics${query}`);
}

function signedIn(role: 'employer' | 'admin' = 'employer'): void {
    mocks.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-1', role } as never);
    vi.mocked(getEmployerTier).mockResolvedValue('pro' as never);
    vi.mocked(getEmployerActivePostings).mockResolvedValue([{ id: 'posting-1' }] as never);
    vi.mocked(prisma.employerJob.findMany).mockResolvedValue(OWNED_ROWS as never);
}

/** The job ids of the one click read the route made. */
function clickJobIds(): unknown {
    expect(mocks.applyClickFindMany, 'one click read').toHaveBeenCalledTimes(1);
    const [args] = mocks.applyClickFindMany.mock.calls[0] as [{ where: { jobId: { in: string[] } } }];
    return args.where.jobId.in;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyClickFindMany.mockResolvedValue([]);
});

describe('GET /api/employer/analytics: the jobId filter is held to the caller\'s own jobs', () => {
    it('answers 404 for a job the employer does not own, and reads no clicks', async () => {
        signedIn();
        const res = await analytics(request(`?jobId=${SOMEONE_ELSES}`));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Job not found' });
        expect(mocks.applyClickFindMany).not.toHaveBeenCalled();
    });

    it('answers the same 404 when the employer owns no jobs at all, and reads no clicks', async () => {
        // The empty-chart answer for an employer with no jobs must not come
        // first and swallow the 404.
        signedIn();
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
        const res = await analytics(request(`?jobId=${SOMEONE_ELSES}`));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Job not found' });
        expect(mocks.applyClickFindMany).not.toHaveBeenCalled();
    });

    it('answers the empty chart, not 404, when an employer with no jobs names none', async () => {
        signedIn();
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
        const res = await analytics(request(''));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ views: [], clicks: [], jobs: [] });
        expect(mocks.applyClickFindMany).not.toHaveBeenCalled();
    });

    it('narrows the series to an owned job', async () => {
        signedIn();
        const res = await analytics(request(`?jobId=${OWN_B}`));
        expect(res.status).toBe(200);
        expect(clickJobIds()).toEqual([OWN_B]);
    });

    it('covers the caller\'s own jobs, and only those, when no jobId is given', async () => {
        signedIn();
        const res = await analytics(request(''));
        expect(res.status).toBe(200);
        expect(clickJobIds()).toEqual([OWN_A, OWN_B]);
    });

    it('lets an admin name any job', async () => {
        signedIn('admin');
        const res = await analytics(request(`?jobId=${SOMEONE_ELSES}`));
        expect(res.status).toBe(200);
        expect(clickJobIds()).toEqual([SOMEONE_ELSES]);
    });
});

describe('GET /api/employer/analytics: the day window is bounded', () => {
    async function labelsFor(query: string): Promise<string[]> {
        signedIn();
        const res = await analytics(request(query));
        expect(res.status).toBe(200);
        return ((await res.json()) as { chart: { labels: string[] } }).chart.labels;
    }

    it('defaults to 30 days', async () => {
        expect(await labelsFor('')).toHaveLength(30);
    });

    it('honours a window inside the range', async () => {
        expect(await labelsFor('?days=7')).toHaveLength(7);
        expect(await labelsFor('?days=365')).toHaveLength(365);
    });

    it('caps a window above 365 days instead of looping that many times', async () => {
        expect(await labelsFor('?days=100000')).toHaveLength(365);
    });

    it('falls back to 30 for a value that is not a positive whole number', async () => {
        for (const bad of ['abc', '0', '-5', '', '1.5e9']) {
            expect(await labelsFor(`?days=${encodeURIComponent(bad)}`), `days=${bad}`).toHaveLength(30);
        }
    });

    it('reads clicks from the start of that window', async () => {
        signedIn();
        const before = Date.now();
        await analytics(request('?days=100000'));
        const [args] = mocks.applyClickFindMany.mock.calls[0] as [{ where: { timestamp: { gte: Date } } }];
        const spanDays = (before - args.where.timestamp.gte.getTime()) / 86_400_000;
        expect(spanDays).toBeGreaterThan(364);
        expect(spanDays).toBeLessThan(366);
    });
});
