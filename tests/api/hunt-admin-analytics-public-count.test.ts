/**
 * The admin analytics counts (and the dashboard, which reads the same
 * route) agree with the public site and with the broadcast audiences:
 *  - "Active Jobs" and the source breakdown count what /jobs shows
 *    (canonicalActiveJobWhere, lib/canonical-counts.ts: published, not
 *    expired, not a dead link, not excluded), not every published row;
 *  - the subscriber total, the "New Subscribers" list and the subscriber
 *    series count the mailing list a "subscribers" broadcast reaches
 *    (MAILING_LIST_LEADS), not every subscribed row, which included entries
 *    created only to hold an unsubscribe token;
 *  - the newsletter figure counts the people a "newsletter" broadcast reaches.
 *
 * Jobs are evaluated against the route's own where clauses with the shared
 * in-memory matcher (tests/helpers/fake-prisma-where.ts). All rows fictional.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const NOW = new Date('2026-11-25T18:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const state = vi.hoisted(() => ({
    jobs: [] as Array<Record<string, unknown>>,
    jobCount: [] as unknown[],
    jobGroupBy: [] as unknown[],
    leadCount: [] as unknown[],
    leadFindMany: [] as unknown[],
}));

vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdmin: vi.fn().mockResolvedValue(null) }));
// Loaded with parsePagingParam (app/api/admin/jobs/_lib/job-input.ts); never called here.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/prisma', async () => {
    const { matchesWhere } = await import('../helpers/fake-prisma-where');
    const matching = (where: unknown) =>
        state.jobs.filter((row) => matchesWhere('job', row, where, { jobs: state.jobs }));
    const job = {
        count: async (args: { where?: unknown } = {}) => {
            state.jobCount.push(args);
            return matching(args.where).length;
        },
        groupBy: async (args: { by: string[]; where?: unknown }) => {
            state.jobGroupBy.push(args);
            const counts = new Map<string, number>();
            for (const row of matching(args.where)) {
                const key = String(row.sourceProvider);
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            return [...counts].map(([sourceProvider, n]) => ({ sourceProvider, _count: n }));
        },
        findMany: async () => [],
    };
    const emailLead = {
        count: async (args: unknown) => {
            state.leadCount.push(args);
            return 0;
        },
        findMany: async (args: unknown) => {
            state.leadFindMany.push(args);
            return [];
        },
    };
    // Every other model answers empty: counts 0, lists [].
    const empty = () => new Proxy({}, {
        get: (_target, method: string) => async () => {
            if (method === 'count') return 0;
            if (method === 'aggregate') return { _avg: { rating: null } };
            return [];
        },
    });
    return {
        prisma: new Proxy({}, {
            get: (_target, model: string) => {
                if (model === 'job') return job;
                if (model === 'emailLead') return emailLead;
                return empty();
            },
        }),
    };
});

import { GET } from '@/app/api/admin/analytics/route';
import { canonicalActiveJobWhere } from '@/lib/canonical-counts';
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/dead-link-threshold';
import { MAILING_LIST_LEADS, NEWSLETTER_LEADS } from '@/lib/admin/broadcast-audience';

function job(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id,
        title: 'Family Nurse Practitioner',
        employer: 'Example Community Clinic',
        isPublished: true,
        expiresAt: null,
        healthConsecutiveMissing: 0,
        professionClass: null,
        shadowedByJobId: null,
        isRemote: false,
        sourceProvider: 'adzuna',
        ...over,
    };
}

async function analytics(section: string) {
    const res = await GET(new NextRequest(`https://example.com/api/admin/analytics?section=${section}`));
    expect(res.status).toBe(200);
    return res.json();
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    state.jobs = [
        job('live-open-ended', { sourceProvider: 'adzuna' }),
        job('live-dated', { sourceProvider: 'employer', expiresAt: new Date(NOW.getTime() + 7 * DAY_MS) }),
        job('unpublished', { isPublished: false }),
        job('expired', { expiresAt: new Date(NOW.getTime() - DAY_MS) }),
        job('dead-link', { healthConsecutiveMissing: DEAD_LINK_MISS_THRESHOLD }),
    ];
    state.jobCount.length = 0;
    state.jobGroupBy.length = 0;
    state.leadCount.length = 0;
    state.leadFindMany.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('GET /api/admin/analytics: active jobs', () => {
    it('counts only the jobs the public board shows', async () => {
        const body = await analytics('summary');
        expect(body.summary.activeJobs).toBe(2);
        expect(body.summary.jobSourceBreakdown).toEqual({ adzuna: 1, employer: 1 });
    });

    it('uses the canonical listing rule for both the count and the breakdown, never a bare isPublished', async () => {
        await analytics('summary');
        const canonical = canonicalActiveJobWhere(NOW);
        expect(state.jobCount).toContainEqual({ where: canonical });
        expect(state.jobGroupBy).toContainEqual(expect.objectContaining({ by: ['sourceProvider'], where: canonical }));
        expect(state.jobCount).not.toContainEqual({ where: { isPublished: true } });
        expect(state.jobGroupBy).not.toContainEqual(expect.objectContaining({ where: { isPublished: true } }));
    });
});

describe('GET /api/admin/analytics: subscribers', () => {
    it('counts subscribers, and the newsletter, as the broadcast audiences do', async () => {
        await analytics('summary');
        expect(state.leadCount).toContainEqual({ where: MAILING_LIST_LEADS });
        expect(state.leadCount).toContainEqual({ where: NEWSLETTER_LEADS });
        expect(state.leadCount).not.toContainEqual({ where: { isSubscribed: true } });
        expect(state.leadCount).not.toContainEqual({ where: { newsletterOptIn: true } });
    });

    it('lists new subscribers from the mailing list only', async () => {
        await analytics('summary');
        expect(state.leadFindMany).toContainEqual(expect.objectContaining({ where: MAILING_LIST_LEADS, take: 5 }));
    });

    it('builds the subscriber series from the same mailing list', async () => {
        await analytics('users');
        expect(state.leadFindMany).toContainEqual(expect.objectContaining({
            where: { ...MAILING_LIST_LEADS, createdAt: { gte: expect.any(Date) } },
        }));
        // Every lead read in this section carries the mailing list rule.
        for (const call of state.leadFindMany as Array<{ where: Record<string, unknown> }>) {
            expect(call.where).toMatchObject(MAILING_LIST_LEADS);
        }
    });
});
