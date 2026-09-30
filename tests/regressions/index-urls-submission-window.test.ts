/**
 * index-urls submits a job once when it appears and once per content change,
 * and only while it is a live, valid job posting (GFJ-05, plan fixSoon 4).
 *
 * The cron used to select every published job whose createdAt OR updatedAt
 * fell in the last 25 hours. Ingest renewal, source presence and page views
 * write updatedAt on every live job every day, so the whole inventory went to
 * IndexNow and Bing daily, and up to the new-content lane's share of it to
 * Google as URL_UPDATED, with no expiry, dead-link or quarantine filter.
 *
 * These tests drive the real route and the real window module
 * (app/api/cron/index-urls/window.ts) over an in-memory jobs and cron_runs
 * stand-in. The jobs stand-in evaluates the route's Prisma where with the
 * app's own SQL-semantics evaluator (app/api/jobs/filter-counts/
 * where-evaluator.ts), so the filter under test is the one production runs.
 * Nothing reaches the network or a database.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        job: { findMany: vi.fn() },
        cronRun: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    },
}));
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({ verifyCronOrAdmin: vi.fn() }));
vi.mock('@/lib/discord-notifier', () => ({ sendCronFailureAlert: vi.fn() }));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEnginesBatch: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { pingAllSearchEnginesBatch } from '@/lib/search-indexing';
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/active-job-filter';
import { isMemoryEvaluable, matchesWhere, type MemoryRow } from '@/app/api/jobs/filter-counts/where-evaluator';
import { isJobPostingEligible } from '@/app/jobs/[slug]/job-posting-facts';
import {
    FIRST_RUN_WINDOW_MS,
    INDEX_URLS_CRON,
    MAX_LOOKBACK_MS,
    SETTLE_MS,
    planSubmissionWindow,
    submissionWhere,
    windowEndFromMetrics,
} from '@/app/api/cron/index-urls/window';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The daily 13:00 UTC firing. Every other time here is relative to it. */
const NOW = new Date('2026-09-28T13:00:00.000Z');
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

// ─── In-memory jobs and cron_runs ────────────────────────────────────────────

interface JobRow extends MemoryRow {
    id: string;
    title: string;
    slug: string;
    employer: string;
    description: string;
    professionClass: string | null;
    isPublished: boolean;
    expiresAt: Date | null;
    healthConsecutiveMissing: number;
    city: string | null;
    state: string | null;
    stateCode: string | null;
    location: string | null;
    mode: string | null;
    country: string | null;
    isRemote: boolean;
    isHybrid: boolean;
    createdAt: Date;
    contentChangedAt: Date | null;
    updatedAt: Date;
}

type RunRow = {
    id: string;
    name: string;
    startedAt: Date;
    success: boolean;
    metrics?: unknown;
};

let jobs: JobRow[] = [];
let runs: RunRow[] = [];

const COLUMNS: ReadonlySet<string> = new Set([
    'id', 'title', 'slug', 'employer', 'description', 'professionClass', 'isPublished', 'expiresAt',
    'healthConsecutiveMissing', 'city', 'state', 'stateCode', 'location', 'mode', 'country', 'isRemote', 'isHybrid', 'createdAt',
    'contentChangedAt', 'updatedAt',
]);

type OrderBy = Record<string, 'asc' | 'desc'>;

function sortRows<T extends Record<string, unknown>>(rows: readonly T[], orderBy?: OrderBy | OrderBy[]): T[] {
    const keys = orderBy === undefined ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
    const value = (v: unknown): number | string => (v instanceof Date ? v.getTime() : (v as number | string));
    return [...rows].sort((a, b) => {
        for (const entry of keys) {
            for (const [key, direction] of Object.entries(entry)) {
                const x = value(a[key]);
                const y = value(b[key]);
                if (x === y) continue;
                const order = x < y ? -1 : 1;
                return direction === 'desc' ? -order : order;
            }
        }
        return 0;
    });
}

function installFakeDatabase(): void {
    vi.mocked(prisma.job.findMany).mockImplementation((async (args: {
        where: object;
        orderBy?: OrderBy | OrderBy[];
        select?: Record<string, boolean>;
    }) => {
        // Refuse a filter the evaluator cannot model rather than guess at it.
        expect(isMemoryEvaluable(args.where, COLUMNS)).toBe(true);
        const hits = sortRows(jobs.filter((job) => matchesWhere(args.where, job)), args.orderBy);
        return hits.map((job) =>
            args.select
                ? Object.fromEntries(Object.keys(args.select).map((key) => [key, job[key]]))
                : { ...job },
        );
    }) as never);
    vi.mocked(prisma.cronRun.create).mockImplementation((async (args: { data: Omit<RunRow, 'id'> }) => {
        const row: RunRow = { id: `run-${runs.length + 1}`, ...args.data };
        runs = [...runs, row];
        return { id: row.id };
    }) as never);
    vi.mocked(prisma.cronRun.update).mockImplementation((async (args: { where: { id: string }; data: Partial<RunRow> }) => {
        runs = runs.map((row) => (row.id === args.where.id ? { ...row, ...args.data } : row));
        return runs.find((row) => row.id === args.where.id);
    }) as never);
    vi.mocked(prisma.cronRun.findFirst).mockImplementation((async (args: {
        where: { name: string; success: boolean };
        select: Record<string, boolean>;
    }) => {
        const hit = sortRows(
            runs.filter((row) => row.name === args.where.name && row.success === args.where.success),
            { startedAt: 'desc' },
        )[0];
        return hit ? Object.fromEntries(Object.keys(args.select).map((key) => [key, hit[key as keyof RunRow]])) : null;
    }) as never);
}

// ─── Job fixtures ────────────────────────────────────────────────────────────

const jobUuid = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** A live, valid, in-person NP job created at `createdAt`. */
function job(i: number, createdAt: Date, overrides: Partial<JobRow> = {}): JobRow {
    const id = jobUuid(i);
    return {
        id,
        title: `Family Nurse Practitioner ${i}`,
        slug: `family-nurse-practitioner-${i}-${id}`,
        employer: 'Riverbend Health',
        // Real prose: GFJ-04 keeps stub descriptions out of index-urls.
        description: 'Outpatient primary care role. You will evaluate new patients, manage medications and work closely with therapists and primary care teams.',
        professionClass: 'np_eligible',
        isPublished: true,
        expiresAt: at(30 * DAY),
        healthConsecutiveMissing: 0,
        city: 'Austin',
        state: 'Texas',
        stateCode: 'TX',
        location: 'Austin, TX',
        mode: 'In-Person',
        country: 'US',
        isRemote: false,
        isHybrid: false,
        createdAt,
        contentChangedAt: createdAt,
        updatedAt: createdAt,
        ...overrides,
    };
}

const urlOf = (row: JobRow): string => `${brand.baseUrl}/jobs/${row.slug}`;

/** What an ingest run does to every live job it sees again: write updatedAt only. */
function renewEverything(when: Date): void {
    jobs = jobs.map((row) => ({ ...row, updatedAt: when }));
}

async function runCron(when: Date): Promise<{ status: number; body: Record<string, unknown>; submitted: string[] }> {
    vi.setSystemTime(when);
    const before = vi.mocked(pingAllSearchEnginesBatch).mock.calls.length;
    const { GET } = await import('@/app/api/cron/index-urls/route');
    const res = await GET(
        new Request('https://example.com/api/cron/index-urls', { headers: { authorization: 'Bearer test' } }) as never,
    );
    const calls = vi.mocked(pingAllSearchEnginesBatch).mock.calls.slice(before);
    return {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
        submitted: calls.flatMap((call) => call[0]),
    };
}

beforeAll(async () => {
    await import('@/app/api/cron/index-urls/route');
}, 60_000);

beforeEach(() => {
    jobs = [];
    runs = [];
    installFakeDatabase();
    vi.mocked(verifyCronOrAdmin).mockResolvedValue(null);
    vi.mocked(sendCronFailureAlert).mockResolvedValue(undefined as never);
    vi.mocked(pingAllSearchEnginesBatch).mockImplementation((async (urls: string[]) => ({
        google: urls.map((url) => ({ engine: 'Google', url, success: true })),
        bing: [],
        indexNow: urls.map((url) => ({ engine: 'IndexNow', url, success: true })),
    })) as never);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    for (const method of ['log', 'warn', 'error'] as const) {
        vi.spyOn(console, method).mockImplementation(() => undefined);
    }
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(pingAllSearchEnginesBatch).mockReset();
});

// ─── 1. The window on its own ────────────────────────────────────────────────

describe('the index-urls submission window', () => {
    it('covers the old 25 hours on a first run, ending a settle margin before now', () => {
        const window = planSubmissionWindow(null, NOW);
        expect(window.since.getTime()).toBe(NOW.getTime() - FIRST_RUN_WINDOW_MS);
        expect(window.until.getTime()).toBe(NOW.getTime() - SETTLE_MS);
    });

    it('resumes exactly where the last window ended, so windows neither overlap nor leave gaps', () => {
        const lastEnd = at(-DAY - SETTLE_MS);
        expect(planSubmissionWindow(lastEnd, NOW).since).toEqual(lastEnd);
    });

    it('reaches back at most the lookback after missed runs', () => {
        const window = planSubmissionWindow(at(-30 * DAY), NOW);
        expect(window.since.getTime()).toBe(NOW.getTime() - MAX_LOOKBACK_MS);
    });

    it('never moves the resume point backwards', () => {
        const justRan = at(-SETTLE_MS / 2);
        const window = planSubmissionWindow(justRan, NOW);
        expect(window.since).toEqual(justRan);
        expect(window.until).toEqual(justRan);
    });

    it('reads a recorded window end back and refuses anything malformed', () => {
        expect(windowEndFromMetrics({ windowEnd: '2026-09-27T12:55:00.000Z' })).toEqual(
            new Date('2026-09-27T12:55:00.000Z'),
        );
        for (const bad of [null, [], {}, { windowEnd: 'yesterday' }, { windowEnd: 7 }]) {
            expect(windowEndFromMetrics(bad), JSON.stringify(bad)).toBeNull();
        }
    });

    it('builds a filter the in-memory evaluator models completely', () => {
        const where = submissionWhere(planSubmissionWindow(null, NOW), NOW);
        expect(isMemoryEvaluable(where, COLUMNS)).toBe(true);
    });
});

// ─── 2. Runs in sequence ─────────────────────────────────────────────────────

describe('index-urls sends each job once per appearance or content change', () => {
    it('does not resend unchanged jobs whose updatedAt every ingest run moves', async () => {
        const monday = [job(1, at(-10 * HOUR)), job(2, at(-2 * HOUR))];
        jobs = monday;
        const first = await runCron(NOW);
        expect(first.submitted).toEqual([monday[1], monday[0]].map(urlOf));

        // A day of ingest runs rewrites updatedAt on every live row and adds
        // one new job. Only the new job goes out.
        renewEverything(at(20 * HOUR));
        const tuesday = job(3, at(18 * HOUR));
        jobs = [...jobs, tuesday];
        const second = await runCron(at(DAY));
        expect(second.submitted).toEqual([urlOf(tuesday)]);

        // A quiet day sends nothing at all.
        renewEverything(at(44 * HOUR));
        const third = await runCron(at(2 * DAY));
        expect(third.submitted).toEqual([]);
        expect(third.body.jobCount).toBe(0);
    });

    it('sends a job again once after a real content change, and not the day after', async () => {
        const row = job(1, at(-5 * DAY));
        jobs = [row];
        expect((await runCron(NOW)).submitted).toEqual([]);

        jobs = jobs.map((j) => ({ ...j, title: 'Family Nurse Practitioner, updated pay', contentChangedAt: at(3 * HOUR) }));
        expect((await runCron(at(DAY))).submitted).toEqual([urlOf(row)]);
        expect((await runCron(at(2 * DAY))).submitted).toEqual([]);
    });

    it('sends new jobs ahead of changed ones, newest first, so the Google lane goes to new pages', async () => {
        const changed = job(1, at(-5 * DAY), { contentChangedAt: at(-3 * HOUR) });
        const older = job(2, at(-8 * HOUR));
        const newer = job(3, at(-HOUR));
        jobs = [changed, older, newer];
        expect((await runCron(NOW)).submitted).toEqual([newer, older, changed].map(urlOf));
    });

    it('leaves a job stamped inside the settle margin for the next run, and sends it then', async () => {
        const late = job(1, new Date(NOW.getTime() - SETTLE_MS / 2));
        jobs = [late];
        expect((await runCron(NOW)).submitted).toEqual([]);
        expect((await runCron(at(DAY))).submitted).toEqual([urlOf(late)]);
    });

    it('resumes from the start of a run recorded before windows were stored', async () => {
        runs = [{ id: 'legacy', name: INDEX_URLS_CRON, startedAt: at(-DAY), success: true, metrics: { jobCount: 686 } }];
        const alreadySent = job(1, at(-DAY - HOUR));
        const fresh = job(2, at(-DAY + HOUR));
        jobs = [alreadySent, fresh];
        expect((await runCron(NOW)).submitted).toEqual([urlOf(fresh)]);
    });

    it('covers a failed day on the next successful run', async () => {
        jobs = [job(1, at(-2 * HOUR))];
        await runCron(NOW);

        const missed = job(2, at(5 * HOUR));
        jobs = [...jobs, missed];
        vi.mocked(pingAllSearchEnginesBatch).mockRejectedValueOnce(new Error('network down'));
        const failed = await runCron(at(DAY));
        expect(failed.status).toBe(500);
        expect(sendCronFailureAlert).toHaveBeenCalledWith(INDEX_URLS_CRON, expect.any(Error));

        const recovered = await runCron(at(2 * DAY));
        expect(recovered.submitted).toEqual([urlOf(missed)]);
    });

    it('records the window end on every successful run, including an empty one', async () => {
        const run = await runCron(NOW);
        expect(run.body.jobCount).toBe(0);
        const recorded = runs.at(-1);
        expect(recorded?.success).toBe(true);
        expect(windowEndFromMetrics(recorded?.metrics)).toEqual(new Date(NOW.getTime() - SETTLE_MS));
    });
});

// ─── 3. Only live, valid job postings ────────────────────────────────────────

describe('index-urls submits only pages that answer 200 with valid JobPosting', () => {
    /** A verified fully remote role: flags, mode, location and text all agree. */
    const remoteFields: Partial<JobRow> = {
        title: 'Remote Family Nurse Practitioner',
        description: 'Fully remote telehealth visits from home. You will evaluate new patients, manage medications and work closely with therapists and primary care teams.',
        city: null,
        state: null,
        stateCode: null,
        location: 'Remote',
        mode: 'Remote',
        isRemote: true,
        isHybrid: false,
    };
    /** No place anywhere: no columns and a location string that names none. */
    const placeless: Partial<JobRow> = { city: null, state: null, stateCode: null, location: 'Multiple Locations' };

    it('leaves out expired, unpublished, dead-link and quarantined jobs', async () => {
        const created = at(-2 * HOUR);
        const live = job(1, created);
        jobs = [
            live,
            job(10, created, { expiresAt: at(-HOUR) }),
            job(11, created, { isPublished: false }),
            job(12, created, { healthConsecutiveMissing: DEAD_LINK_MISS_THRESHOLD }),
            job(13, created, { professionClass: 'physician', title: 'Psychiatrist' }),
        ];

        expect((await runCron(NOW)).submitted).toEqual([urlOf(live)]);
    });

    it('leaves out a page that emits no JobPosting item, by the job page\'s own rule', async () => {
        const created = at(-2 * HOUR);
        const remote = job(2, created, remoteFields);
        const stateOnly = job(3, created, { city: null, stateCode: null, location: 'Texas' });
        const fromLocationString = job(4, created, { city: null, state: null, stateCode: null, location: 'Denver, CO' });
        const noPlace = job(14, created, placeless);
        const hybridNoPlace = job(15, created, { ...placeless, isRemote: true, isHybrid: true, mode: 'Hybrid' });
        // FB-3: a DC street address split into city '1730', state RI. The page
        // never uses that split; it emits the place the full address names, or
        // none, and index-urls follows whichever it does.
        const splitAddress = job(16, created, { city: '1730', state: 'Rhode Island', stateCode: 'RI', location: '1730 Rhode Island Ave NW, Washington, DC' });
        // Owner decision: non-US listings emit no JobPosting.
        const nonUs = job(17, created, { city: 'Baghdad', state: null, stateCode: null, location: 'Baghdad, Iraq', country: 'IQ' });
        const unverifiedRemote = job(18, created, { ...remoteFields, location: 'United States', mode: null });
        jobs = [remote, stateOnly, fromLocationString, noPlace, hybridNoPlace, splitAddress, nonUs, unverifiedRemote];

        const eligible = jobs.filter((row) => isJobPostingEligible(row));
        const run = await runCron(NOW);
        expect([...run.submitted].sort()).toEqual(eligible.map(urlOf).sort());
        // The rule is the page's, not a column check: a place parsed from the
        // location string counts even with empty columns.
        expect(run.submitted).toContain(urlOf(remote));
        expect(run.submitted).toContain(urlOf(fromLocationString));
        for (const row of [noPlace, hybridNoPlace, nonUs, unverifiedRemote]) {
            expect(run.submitted).not.toContain(urlOf(row));
        }
        expect(run.body.skippedNoJobPosting).toBe(jobs.length - eligible.length);
    });

    it('treats a job one miss short of the dead-link threshold as live', async () => {
        const row = job(1, at(-2 * HOUR), { healthConsecutiveMissing: DEAD_LINK_MISS_THRESHOLD - 1 });
        jobs = [row];
        expect((await runCron(NOW)).submitted).toEqual([urlOf(row)]);
    });

    it('uses the same eligibility rule the JobPosting emitter uses', () => {
        const windowSrc = read('app/api/cron/index-urls/window.ts');
        expect(windowSrc).toContain("import { isJobPostingEligible, type JobPostingFactsInput } from '@/app/jobs/[slug]/job-posting-facts';");
        expect(windowSrc).toContain('return isJobPostingEligible(job);');
    });
});

// ─── 4. The route keeps that shape ──────────────────────────────────────────

describe('the index-urls route', () => {
    const src = read('app/api/cron/index-urls/route.ts');
    const windowSrc = read('app/api/cron/index-urls/window.ts');

    it('selects through submissionWhere, not a bare published flag or updatedAt', () => {
        expect(src).toContain('where: submissionWhere(window, now)');
        expect(src).not.toMatch(/updatedAt/);
        expect(src).not.toMatch(/isPublished: true/);
        expect(windowSrc).toContain('activeIndexableJobWhere(now)');
        expect(src).toContain('candidates.filter(isSubmittableJobPosting)');
        expect(windowSrc).toMatch(/\{ createdAt: inWindow \}, \{ contentChangedAt: inWindow \}/);
    });

    it('resumes from the last successful run and records its own window end', () => {
        expect(src).toContain('planSubmissionWindow(await readLastWindowEnd(), now)');
        expect(src).toContain('windowEnd: window.until.toISOString()');
    });
});
