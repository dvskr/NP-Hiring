/**
 * The ingest run and a posting the duplicate check resolves to a stored job
 * that is not that job's own posting: the same role under a new id, a near
 * miss, another source's copy.
 *
 * lib/health/renewal-decision.ts has the rules and tests/lib/
 * renew-existing-job.test.ts runs the renewal on its own. This file runs the
 * whole loop, so what is pinned here is the wiring around it: which strategy
 * finds the stored job, what the run then writes, what it reports, and that a
 * posting the renewal answers 'separate' for goes on to be stored as a job of
 * its own.
 *
 * The real ingestJobs runs over stand-in adapters and a stand-in jobs table:
 * nothing reaches a database or the network. Relevance and normalization are
 * stood in for too (they belong to the pack; this is about what happens after
 * them). Titles and employers are invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Aggregator, RawJobData } from '@/lib/aggregators/types';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
    /** What the stand-in adapters return on their next fetch. */
    rows: [] as Array<Record<string, unknown>>,
    /** The jobs table. */
    jobs: [] as Array<Record<string, unknown>>,
    /** The newest health row of a job, by job id. */
    health: new Map<string, { checkType: string; alive: boolean }>(),
    created: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
}));

vi.mock('@/lib/prisma', () => {
    interface FindManyArgs {
        where?: {
            AND?: Array<{ employer?: { contains: string }; title?: { contains: string } }>;
            isPublished?: boolean;
            sourceProvider?: string;
        };
        orderBy?: Array<Record<string, 'asc' | 'desc'>>;
        take?: number;
    }
    const rank = (value: unknown): number => (value instanceof Date ? value.getTime() : Number(value));
    return {
        prisma: {
            job: {
                findMany: vi.fn(async (args: FindManyArgs = {}) => {
                    const where = args.where ?? {};
                    if (Array.isArray(where.AND)) {
                        // The fuzzy duplicate strategy: look-alikes, published or
                        // not, in the order and number it asks for.
                        const employer = where.AND.find((c) => c.employer)?.employer?.contains ?? '';
                        const title = where.AND.find((c) => c.title)?.title?.contains ?? '';
                        const matched = state.jobs.filter((j) => String(j.employer).includes(employer) && String(j.title).includes(title));
                        const ordered = [...matched].sort((a, b) => {
                            for (const clause of args.orderBy ?? []) {
                                const [key, direction] = Object.entries(clause)[0];
                                const diff = rank(a[key]) - rank(b[key]);
                                if (diff !== 0) return direction === 'desc' ? -diff : diff;
                            }
                            return 0;
                        });
                        return ordered.slice(0, args.take ?? ordered.length);
                    }
                    // The run's dedupe maps: published rows only.
                    if (where.isPublished === true) return state.jobs.filter((j) => j.isPublished === true);
                    if (where.sourceProvider) return state.jobs.filter((j) => j.sourceProvider === where.sourceProvider);
                    return state.jobs;
                }),
                findFirst: vi.fn(async (args: { where: { externalId?: string; sourceProvider?: string } }) =>
                    state.jobs.find((j) => j.externalId === args.where.externalId && j.sourceProvider === args.where.sourceProvider) ?? null),
                findUnique: vi.fn(async (args: { where: { id: string }; select?: Record<string, unknown> }) => {
                    const found = state.jobs.find((j) => j.id === args.where.id);
                    if (!found) return null;
                    if (!args.select) return { ...found };
                    return Object.fromEntries(Object.keys(args.select).map((key) => [key, found[key] ?? null]));
                }),
                update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
                    state.updates.push({ id: args.where.id, data: args.data });
                    const found = state.jobs.find((j) => j.id === args.where.id);
                    if (found) Object.assign(found, args.data);
                    return {};
                }),
                create: vi.fn(async (args: { data: Record<string, unknown> }) => {
                    state.created.push(args.data);
                    state.jobs.push({ ...args.data });
                    return { ...args.data };
                }),
            },
            jobHealthCheck: {
                findFirst: vi.fn(async (args: { where: { jobId: string } }) => state.health.get(args.where.jobId) ?? null),
            },
            rejectedJob: { createMany: vi.fn(async () => ({ count: 0 })) },
        },
    };
});

vi.mock('@/lib/aggregators/registry', () => {
    const standIn = (key: string): Aggregator =>
        ({
            key,
            chunkCount: 1,
            async fetch(): Promise<RawJobData[]> {
                return state.rows as RawJobData[];
            },
        }) as unknown as Aggregator;
    // An employer's own feed and a relisting source (lib/aggregators/source-kind.ts).
    return { aggregators: { workable: standIn('workable'), adzuna: standIn('adzuna') } };
});

// The pack's relevance gate and normalizer are stood in for: every posting
// passes, and is stored as the adapter gave it.
vi.mock('@/lib/utils/job-filter', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    classifyRelevance: () => ({ passes: true, reason: null }),
}));
vi.mock('@/lib/job-normalizer', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/job-normalizer')>();
    return {
        ...actual,
        computeCompleteness: () => 100,
        normalizeJobWithReason: (raw: Record<string, unknown>, source: string) => ({
            job: {
                title: String(raw.title),
                employer: String(raw.company),
                location: String(raw.location),
                description: String(raw.description),
                applyLink: String(raw.applyLink),
                externalId: actual.rawExternalId(raw, source),
                sourceType: 'external',
                sourceProvider: source,
                sourceSite: null,
                originalPostedAt: new Date(),
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
            rejectionReason: null,
        }),
    };
});

// A new posting's apply link is probed before it is stored: alive here.
vi.mock('@/lib/health/check-job-health', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    checkJobHealth: vi.fn(async () => ({
        alive: true,
        reason: 'alive_2xx',
        evidence: { finalStatus: 200, finalUrl: '', redirectHops: 0, softMatch: null, elapsedMs: 1, errorKind: null, errorMessage: null, checkerVersion: 'test', sourceProbe: null },
    })),
}));

vi.mock('@/lib/health/source-presence', () => ({
    loadHistoricalAvgFetched: vi.fn(async () => 2),
    recordSourcePresence: vi.fn(async () => ({ outcome: 'completed', seenAgain: 0, missingThisRun: 0, updatesIssued: 0, skippedReason: null })),
}));
vi.mock('@/lib/health/recorder', () => ({
    HealthRecorder: class {
        async flush(): Promise<void> {}
        stats() {
            return { staged: 0, flushed: 0, failedFlushes: 0 };
        }
    },
}));
vi.mock('@/lib/source-analytics', () => ({ recordIngestionStats: vi.fn(async () => undefined) }));
vi.mock('@/lib/employer-email-collector', () => ({ collectEmployerEmails: vi.fn(async () => ({ created: 0, updated: 0 })) }));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEnginesBatch: vi.fn(async () => ({ google: [], bing: [], indexNow: [] })) }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));
vi.mock('@/lib/llm-enrichment', () => ({ extractWithLLM: vi.fn(async () => ({ result: null })) }));
vi.mock('@/lib/lead-persistence', () => ({ mineAndPersistFromJob: vi.fn(async () => undefined) }));
vi.mock('@/lib/company-normalizer', () => ({ getOrCreateCompany: vi.fn(async () => null) }));
vi.mock('@/lib/ingestion-monitor', () => ({ generateIngestionSummary: () => '' }));

import { prisma } from '@/lib/prisma';
import { ingestJobs } from '@/lib/ingestion-service';

const DESCRIPTION = 'The clinic is hiring for this role. Duties, schedule and supervision are described to candidates at interview. '.repeat(3);
const DAY_MS = 24 * 60 * 60 * 1000;

/** A stored job. Published, from the employer's own feed, unless told otherwise. */
const storedJob = (over: Row = {}): Row => ({
    id: 'job-1',
    title: 'Fixture Role',
    employer: 'Quiet Clinic',
    location: 'Austin, TX',
    description: DESCRIPTION,
    sourceType: 'external',
    sourceProvider: 'workable',
    externalId: 'wk-1',
    applyLink: 'https://jobs.example/wk-1',
    isPublished: true,
    isManuallyUnpublished: false,
    healthConsecutiveMissing: 0,
    originalPostedAt: new Date(Date.now() - 5 * DAY_MS),
    expiresAt: new Date(Date.now() + 25 * DAY_MS),
    createdAt: new Date(Date.now() - 5 * DAY_MS),
    benefits: [],
    ...over,
});

/** What an adapter returns for one posting. The same role as the stored job unless told otherwise. */
const posting = (externalId: string, over: Row = {}): Row => ({
    externalId,
    title: 'Fixture Role',
    company: 'Quiet Clinic',
    location: 'Austin, TX',
    description: DESCRIPTION,
    applyLink: `https://jobs.example/${externalId}`,
    ...over,
});

const SWEPT = { checkType: 'source_presence', alive: false };
const LINK_DEAD = { checkType: 'http_probe', alive: false };

const rejectedRows = (): Array<Record<string, unknown>> =>
    vi.mocked(prisma.rejectedJob.createMany).mock.calls.flatMap((call) => ((call[0] as { data: Array<Record<string, unknown>> }).data));

beforeEach(() => {
    state.rows = [];
    state.jobs = [];
    state.health = new Map();
    state.created = [];
    state.updates = [];
    vi.mocked(prisma.rejectedJob.createMany).mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('the same role under a new id', () => {
    it('moves a published job the presence check has missed to the id that is live, in the same row', async () => {
        state.jobs = [storedJob({ healthConsecutiveMissing: 2 })];
        state.rows = [posting('wk-2')];

        const [result] = await ingestJobs(['workable']);

        expect(result).toMatchObject({ fetched: 1, added: 0, duplicates: 1 });
        expect(state.created).toEqual([]);
        expect(state.jobs).toHaveLength(1);
        expect(state.jobs[0]).toMatchObject({ id: 'job-1', isPublished: true, externalId: 'wk-2', applyLink: 'https://jobs.example/wk-2', healthConsecutiveMissing: 0 });
        expect(rejectedRows()).toEqual([
            expect.objectContaining({ externalId: 'wk-2', rawData: expect.objectContaining({ matchedJobId: 'job-1', renewal: 'took-over' }) }),
        ]);
    });

    it('brings back a job the presence sweep took down, pointing at the live posting', async () => {
        // Down, so not in the run's dedupe maps: the fuzzy strategy finds it.
        state.jobs = [storedJob({ isPublished: false, healthConsecutiveMissing: 3 })];
        state.health.set('job-1', SWEPT);
        state.rows = [posting('wk-2')];

        const [result] = await ingestJobs(['workable']);

        expect(result).toMatchObject({ added: 0, duplicates: 1 });
        expect(state.jobs[0]).toMatchObject({ isPublished: true, externalId: 'wk-2', healthConsecutiveMissing: 0, lastLinkCheckedAt: null });
        expect(rejectedRows()[0].rawData).toMatchObject({ matchedJobId: 'job-1', matchType: 'fuzzy_title', renewal: 'took-over' });
    });

    it('a second look-alike in the same run stays one job, on the id the first one gave it', async () => {
        state.jobs = [storedJob({ isPublished: false, healthConsecutiveMissing: 3 })];
        state.health.set('job-1', SWEPT);
        state.rows = [posting('wk-2'), posting('wk-3')];

        const [result] = await ingestJobs(['workable']);

        expect(result).toMatchObject({ added: 0, duplicates: 2 });
        expect(state.created).toEqual([]);
        expect(state.jobs).toHaveLength(1);
        expect(state.jobs[0]).toMatchObject({ isPublished: true, externalId: 'wk-2' });
        // One take-over; the second posting finds the job live on an id this fetch returned.
        expect(state.updates.filter((u) => 'externalId' in u.data)).toHaveLength(1);
    });

    it('the stored job\'s own posting, listed again after the sweep, brings it back as it is', async () => {
        state.jobs = [storedJob({ isPublished: false, healthConsecutiveMissing: 3 })];
        state.health.set('job-1', SWEPT);
        state.rows = [posting('wk-1')];

        const [result] = await ingestJobs(['workable']);

        expect(result).toMatchObject({ added: 0, duplicates: 1 });
        expect(state.jobs[0]).toMatchObject({ isPublished: true, externalId: 'wk-1', applyLink: 'https://jobs.example/wk-1', healthConsecutiveMissing: 0 });
        expect(rejectedRows()[0].rawData).toMatchObject({ matchedJobId: 'job-1', matchType: 'exact_id', renewal: 'renewed' });
    });
});

describe('a posting that may not bring the stored job back', () => {
    it('a near miss is stored as a job of its own, and the downed job is not touched', async () => {
        // The same title in a city spelled almost alike: a match for the fuzzy
        // strategy, another opening.
        state.jobs = [storedJob({ isPublished: false, healthConsecutiveMissing: 3 })];
        state.health.set('job-1', SWEPT);
        state.rows = [posting('wk-2', { location: 'Houston, TX' })];

        const [result] = await ingestJobs(['workable']);

        expect(result).toMatchObject({ fetched: 1, added: 1, duplicates: 0 });
        expect(state.updates).toEqual([]);
        expect(state.jobs[0]).toMatchObject({ id: 'job-1', isPublished: false, externalId: 'wk-1' });
        expect(state.created).toHaveLength(1);
        expect(state.created[0]).toMatchObject({ externalId: 'wk-2', location: 'Houston, TX', applyLink: 'https://jobs.example/wk-2', sourceProvider: 'workable' });
        // Stored, so not filed as a duplicate.
        expect(rejectedRows().filter((r) => String(r.rejectionReason).startsWith('duplicate_'))).toEqual([]);
    });

    it('a relisted copy of a job its own employer feed closed is dropped, and nothing is written', async () => {
        state.jobs = [storedJob({ isPublished: false })];
        state.health.set('job-1', LINK_DEAD);
        state.rows = [posting('adzuna_7')];

        const [result] = await ingestJobs(['adzuna']);

        expect(result).toMatchObject({ fetched: 1, added: 0, duplicates: 1 });
        expect(state.updates).toEqual([]);
        expect(state.created).toEqual([]);
        expect(state.jobs[0]).toMatchObject({ isPublished: false, externalId: 'wk-1' });
        expect(rejectedRows()[0].rawData).toMatchObject({ matchedJobId: 'job-1', renewal: 'left-unpublished' });
    });

    it('a job that is down for a reason the health checks did not give stays down, whatever is listed', async () => {
        // No health row says dead: a person, a report threshold or a cleanup took it down.
        state.jobs = [storedJob({ isPublished: false })];
        state.health.set('job-1', { checkType: 'http_probe', alive: true });
        state.rows = [posting('wk-1'), posting('wk-2')];

        const [result] = await ingestJobs(['workable']);

        expect(result).toMatchObject({ added: 0, duplicates: 2 });
        expect(state.updates).toEqual([]);
        expect(state.created).toEqual([]);
        expect(state.jobs[0].isPublished).toBe(false);
    });
});
