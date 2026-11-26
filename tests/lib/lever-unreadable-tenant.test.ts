/**
 * A Lever tenant whose request failed (a 429, a 5xx, a 401 or 403, a timeout
 * or a network error) came back as an empty list, and nobody was told. The
 * presence check then counted every live posting of that tenant as missing,
 * and enough such runs in a row took them all off the site.
 *
 * Now the adapter names each tenant it could not read by the prefix of its
 * external ids, and the presence check leaves those postings alone, up to a
 * grace period. A board that answers 404 or 410 is gone, and its postings are
 * still struck. No network: fetch is stubbed throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/aggregators/tenants/lever', () => ({
    LEVER_SLUGS: ['acme-ok', 'acme-busy', 'acme-down', 'acme-blocked', 'acme-gone', 'acme-hung'],
    LEVER_NAMES: {},
}));
vi.mock('@/lib/health/check-job-health', () => ({ checkJobHealth: vi.fn() }));

import { fetchLeverJobs, leverAggregator } from '@/lib/aggregators/lever';
import { recordSourcePresence, UNREADABLE_PART_GRACE_MS } from '@/lib/health/source-presence';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const OK_POSTING = {
    id: 'p1',
    text: 'Nurse Practitioner',
    hostedUrl: 'https://jobs.lever.co/acme-ok/p1',
    applyUrl: 'https://jobs.lever.co/acme-ok/p1/apply',
    createdAt: Date.UTC(2026, 10, 20),
    categories: { location: 'Austin, TX', commitment: 'Full-time' },
    descriptionPlain: 'A fixture posting.',
    lists: [],
};

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the Lever adapter names the tenants it could not read', () => {
    beforeEach(() => {
        fetchMock.mockImplementation(async (url: string) => {
            if (url.endsWith('/acme-busy')) return jsonResponse({}, 429);
            if (url.endsWith('/acme-down')) return jsonResponse({}, 503);
            if (url.endsWith('/acme-blocked')) return jsonResponse({}, 403);
            if (url.endsWith('/acme-gone')) return jsonResponse({}, 404);
            if (url.endsWith('/acme-hung')) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
            return jsonResponse([OK_POSTING]);
        });
    });

    it('reports a 429, a 5xx, a 403 and a timeout, and not a board that is gone', async () => {
        const unavailable: string[] = [];

        const jobs = await fetchLeverJobs({ onUnavailable: (prefix) => unavailable.push(prefix) });

        expect(jobs.map((job) => job.externalId)).toEqual(['lever-acme-ok-p1']);
        expect(unavailable.sort()).toEqual(['lever-acme-blocked-', 'lever-acme-busy-', 'lever-acme-down-', 'lever-acme-hung-']);
    });

    it('gives every request a time limit', async () => {
        await fetchLeverJobs();

        expect(fetchMock).toHaveBeenCalled();
        for (const [, init] of fetchMock.mock.calls) {
            expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
        }
    });

    it('passes the report through the registered adapter', async () => {
        const unavailable: string[] = [];

        await leverAggregator.fetch({ onUnavailable: (prefix) => unavailable.push(prefix) });

        expect(unavailable).toContain('lever-acme-busy-');
    });

    it('reports nothing on a run where every board answered', async () => {
        fetchMock.mockImplementation(async () => jsonResponse([]));
        const unavailable: string[] = [];

        await fetchLeverJobs({ onUnavailable: (prefix) => unavailable.push(prefix) });

        expect(unavailable).toEqual([]);
    });
});

interface PublishedRow {
    id: string;
    externalId: string;
    healthLastSeenAt?: Date | null;
    createdAt?: Date;
}

function fakePrisma(published: PublishedRow[]) {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    return {
        prisma: {
            job: {
                findMany: vi.fn().mockResolvedValue(published),
                findFirst: vi.fn().mockResolvedValue(null),
                updateMany,
            },
        } as unknown as Parameters<typeof recordSourcePresence>[0],
        updateMany,
    };
}

/** Ids handed to the "missing" update ({ increment: 1 }), or [] when none. */
function struckIds(updateMany: ReturnType<typeof vi.fn>): string[] {
    const call = updateMany.mock.calls.find(([args]) => args.data.healthConsecutiveMissing?.increment === 1);
    return call ? call[0].where.id.in : [];
}

const HOUR_MS = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

const PUBLISHED: PublishedRow[] = [
    { id: 'job-ok', externalId: 'lever-acme-ok-p1', healthLastSeenAt: ago(HOUR_MS) },
    { id: 'job-busy', externalId: 'lever-acme-busy-p7', healthLastSeenAt: ago(HOUR_MS) },
    { id: 'job-closed', externalId: 'lever-acme-ok-p2', healthLastSeenAt: ago(HOUR_MS) },
];

describe('the presence check and a tenant that could not be read', () => {
    it('leaves that tenant\'s postings alone, and still strikes a real miss', async () => {
        const { prisma, updateMany } = fakePrisma(PUBLISHED);

        const result = await recordSourcePresence(prisma, {
            source: 'lever',
            fetchedExternalIds: ['lever-acme-ok-p1'],
            fetchedCount: 1,
            historicalAvgFetched: 1,
            unavailableExternalIdPrefixes: ['lever-acme-busy-'],
        });

        expect(result.outcome).toBe('completed');
        expect(struckIds(updateMany)).toEqual(['job-closed']);
        expect(result.missingThisRun).toBe(1);
    });

    it('without the report, strikes that tenant\'s postings too, as it did before', async () => {
        const { prisma, updateMany } = fakePrisma(PUBLISHED);

        await recordSourcePresence(prisma, {
            source: 'lever',
            fetchedExternalIds: ['lever-acme-ok-p1'],
            fetchedCount: 1,
            historicalAvgFetched: 1,
        });

        expect(struckIds(updateMany)).toEqual(['job-busy', 'job-closed']);
    });

    it('treats a tenant unreadable for longer than the grace period as gone', async () => {
        const day = 24 * HOUR_MS;
        const { prisma, updateMany } = fakePrisma([
            { id: 'seen-recently', externalId: 'lever-acme-busy-1', healthLastSeenAt: ago(day), createdAt: ago(20 * day) },
            { id: 'unseen-for-days', externalId: 'lever-acme-busy-2', healthLastSeenAt: ago(UNREADABLE_PART_GRACE_MS + day), createdAt: ago(20 * day) },
            { id: 'never-seen-old', externalId: 'lever-acme-busy-3', healthLastSeenAt: null, createdAt: ago(UNREADABLE_PART_GRACE_MS + day) },
            { id: 'never-seen-new', externalId: 'lever-acme-busy-4', healthLastSeenAt: null, createdAt: ago(HOUR_MS) },
        ]);

        const result = await recordSourcePresence(prisma, {
            source: 'lever',
            fetchedExternalIds: ['lever-acme-ok-p1'],
            fetchedCount: 1,
            historicalAvgFetched: 1,
            unavailableExternalIdPrefixes: ['lever-acme-busy-'],
        });

        expect(struckIds(updateMany).sort()).toEqual(['never-seen-old', 'unseen-for-days']);
        expect(result.missingThisRun).toBe(2);
    });
});
