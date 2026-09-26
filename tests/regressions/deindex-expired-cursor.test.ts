/**
 * deindex-expired sends each expired job's URL once, oldest first.
 *
 * The cron used to take the newest expiries of a fixed 48 hour window and
 * remember nothing. Google takes a fixed number of removals per run from the
 * expired-job-removal lane, so every run spent the lane on the same newest
 * URLs, older expiries in the window never reached Google, and a run that
 * failed or never fired lost its expiries once the window rolled past them.
 * Harmless only while the search engine keys are unset.
 *
 * The fix keeps an (updatedAt, id) cursor in cron_runs.metrics
 * (app/api/cron/deindex-expired/cursor.ts). These tests drive the real route,
 * the real lib/cron/track.ts and the real lib/search-indexing.ts (Google lane
 * and scope rule) over an in-memory stand-in for the two tables the cron
 * touches, so a sequence of runs here behaves like one in production. Every
 * fetch is mocked; nothing reaches the network or a database.
 *
 * Once means once per update. A job another writer updates after it was sent
 * is offered again (cursor.ts explains). Ingest renewal in
 * lib/ingestion-service.ts sees expired jobs on every ingest run, so it is
 * guarded to leave them untouched, and section 4 pins those guards. The other
 * tests have no second writer; the last test in section 2 models one.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

// Local prisma mock: the shared tests/setup.ts mock has no cronRun.findFirst
// or job.count wiring for this, and shared test files must not be edited.
vi.mock('@/lib/prisma', () => ({
    prisma: {
        job: { findMany: vi.fn(), count: vi.fn() },
        cronRun: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    },
}));
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({ verifyCronOrAdmin: vi.fn() }));
vi.mock('@/lib/discord-notifier', () => ({ sendCronFailureAlert: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import {
    GOOGLE_BUDGET_REFUSED,
    GOOGLE_INDEXING_LANES,
    GOOGLE_POLICY_REFUSED,
    pingAllSearchEnginesBatchDeleted,
    resetGoogleIndexingBudget,
} from '@/lib/search-indexing';
import {
    MAX_LOOKBACK_MS,
    SETTLE_MS,
    advanceCursor,
    cursorFromMetrics,
    parseCursor,
    planWindow,
    type DeindexCursor,
    type OfferedJob,
} from '@/app/api/cron/deindex-expired/cursor';

const ROOT = process.cwd();
const ROUTE = 'app/api/cron/deindex-expired/route.ts';
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LANE_CAP = GOOGLE_INDEXING_LANES['expired-job-removal'].perInvocation;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A scheduled midday firing. Every other time in this file is relative to it. */
const NOW = new Date('2026-09-21T12:45:00.000Z');
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

// ─── An in-memory stand-in for the jobs and cron_runs tables ────────────────

interface JobRow {
    id: string;
    title: string;
    slug: string | null;
    updatedAt: Date;
    isPublished: boolean;
    sourceProvider: string | null;
    expiresAt: Date | null;
}

interface RunRow {
    id: string;
    name: string;
    startedAt: Date;
    success: boolean;
    metrics?: unknown;
}

type Where = Record<string, unknown>;
type OrderBy = Record<string, 'asc' | 'desc'>;
interface QueryArgs {
    where?: Where;
    orderBy?: OrderBy | OrderBy[];
    take?: number;
    select?: Record<string, boolean>;
}

let jobs: JobRow[] = [];
let runs: RunRow[] = [];

const field = (row: object, key: string): unknown => (row as Record<string, unknown>)[key];

function sortKey(value: unknown): string | number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value as string | number;
}

function compare(a: unknown, b: unknown): number {
    const x = sortKey(a);
    const y = sortKey(b);
    if (typeof x === 'number' && typeof y === 'number') return Math.sign(x - y);
    const xs = String(x);
    const ys = String(y);
    if (xs < ys) return -1;
    return xs > ys ? 1 : 0;
}

/** One column against one condition, in the Prisma filter shapes the cron uses. */
function fieldMatches(value: unknown, condition: unknown): boolean {
    if (condition === null) return value === null;
    if (typeof condition !== 'object' || condition instanceof Date) {
        return value !== null && value !== undefined && compare(value, condition) === 0;
    }
    return Object.entries(condition as Where).every(([op, operand]) => {
        if (op === 'not') return !fieldMatches(value, operand);
        if (value === null || value === undefined) return false;
        const order = compare(value, operand);
        if (op === 'gt') return order > 0;
        if (op === 'gte') return order >= 0;
        if (op === 'lt') return order < 0;
        if (op === 'lte') return order <= 0;
        // Refuse anything unmodelled rather than silently matching it.
        throw new Error(`fake prisma: unsupported operator "${op}"`);
    });
}

function matches(row: object, where: Where = {}): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (key === 'AND') return (condition as Where[]).every((clause) => matches(row, clause));
        if (key === 'OR') return (condition as Where[]).some((clause) => matches(row, clause));
        if (!(key in row)) throw new Error(`fake prisma: unknown column "${key}"`);
        return fieldMatches(field(row, key), condition);
    });
}

function sortRows<T extends object>(rows: readonly T[], orderBy: QueryArgs['orderBy']): T[] {
    const keys = orderBy === undefined ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
        for (const entry of keys) {
            for (const [key, direction] of Object.entries(entry)) {
                const order = compare(field(a, key), field(b, key));
                if (order !== 0) return direction === 'desc' ? -order : order;
            }
        }
        return 0;
    });
}

function project(row: object, select?: Record<string, boolean>): Record<string, unknown> {
    if (!select) return { ...row };
    return Object.fromEntries(
        Object.keys(select).filter((key) => select[key]).map((key) => [key, field(row, key)]),
    );
}

function installFakeDatabase(): void {
    vi.mocked(prisma.job.findMany).mockImplementation((async (args: QueryArgs) => {
        const hits = sortRows(jobs.filter((job) => matches(job, args.where)), args.orderBy);
        return hits.slice(0, args.take ?? hits.length).map((job) => project(job, args.select));
    }) as never);
    vi.mocked(prisma.job.count).mockImplementation((async (args: QueryArgs) =>
        jobs.filter((job) => matches(job, args.where)).length) as never);
    vi.mocked(prisma.cronRun.create).mockImplementation((async (args: { data: Omit<RunRow, 'id'> }) => {
        const row: RunRow = { id: `run-${runs.length + 1}`, ...args.data };
        runs = [...runs, row];
        return { id: row.id };
    }) as never);
    vi.mocked(prisma.cronRun.update).mockImplementation((async (args: { where: { id: string }; data: Partial<RunRow> }) => {
        runs = runs.map((row) => (row.id === args.where.id ? { ...row, ...args.data } : row));
        return runs.find((row) => row.id === args.where.id);
    }) as never);
    vi.mocked(prisma.cronRun.findFirst).mockImplementation((async (args: QueryArgs) => {
        const hit = sortRows(runs.filter((row) => matches(row, args.where)), args.orderBy)[0];
        return hit ? project(hit, args.select) : null;
    }) as never);
}

/** A successful run from before the ones under test, holding `cursor`. */
function seedSuccessfulRun(startedAt: Date, cursor: DeindexCursor | null): void {
    runs = [
        ...runs,
        { id: `seed-${runs.length + 1}`, name: 'deindex-expired', startedAt, success: true, metrics: { cursor } },
    ];
}

/** The cursor the newest successful run recorded, as the next run will read it. */
function lastRecordedCursor(): DeindexCursor | null {
    const newest = sortRows(runs.filter((row) => row.success), { startedAt: 'desc' })[0];
    return newest ? cursorFromMetrics(newest.metrics) : null;
}

// ─── Job fixtures ────────────────────────────────────────────────────────────

/** A UUID the job page resolver accepts, so the scope rule lets it reach Google. */
const jobUuid = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function expiredJob(i: number, updatedAt: Date, overrides: Partial<JobRow> = {}): JobRow {
    const id = jobUuid(i);
    return {
        id,
        title: `Expired role ${i}`,
        slug: `expired-role-${i}-${id}`,
        updatedAt,
        isPublished: false,
        sourceProvider: 'test-feed',
        expiresAt: new Date(updatedAt.getTime() - HOUR),
        ...overrides,
    };
}

const urlOf = (job: JobRow): string => `${brand.baseUrl}/jobs/${job.slug}`;

const oldestFirst = (rows: readonly JobRow[]): JobRow[] =>
    sortRows(rows, [{ updatedAt: 'asc' }, { id: 'asc' }]);

const duplicates = (urls: readonly string[]): string[] =>
    urls.filter((url, i) => urls.indexOf(url) !== i);

// ─── Credentials, network and clock ─────────────────────────────────────────

/** A real RSA key: lib/search-indexing.ts signs a JWT with it before any publish. */
const { privateKey: SERVICE_ACCOUNT_PRIVATE_KEY } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function armGoogle(): void {
    process.env.GOOGLE_INDEXING_CREDENTIALS = JSON.stringify({
        client_email: 'indexer@test-project.iam.gserviceaccount.com',
        private_key: SERVICE_ACCOUNT_PRIVATE_KEY,
    });
}

const INDEXING_KEYS = ['GOOGLE_INDEXING_CREDENTIALS', 'INDEXNOW_KEY', 'INDEXNOW_API_KEY'] as const;
const savedEnv = new Map<string, string | undefined>();

interface NetworkOptions {
    /** What the Indexing API answers for one published URL. Default 200. */
    googleStatus?: (publishedUrl: string) => number;
}

function mockNetwork(opts: NetworkOptions = {}) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com')) {
            return new Response(JSON.stringify({ access_token: 'test-access-token' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url.includes('indexing.googleapis.com')) {
            const published = JSON.parse(String(init?.body)).url as string;
            const status = opts.googleStatus?.(published) ?? 200;
            return new Response(status === 200 ? '{}' : `Google answered ${status}`, { status });
        }
        if (url.includes('indexnow')) return new Response('', { status: 200 });
        throw new Error(`unexpected request to ${url}`);
    });
}

let fetchMock: ReturnType<typeof mockNetwork>;

// Load the route graph once, outside any single test's time budget.
beforeAll(async () => {
    await import('@/app/api/cron/deindex-expired/route');
});

beforeEach(() => {
    jobs = [];
    runs = [];
    installFakeDatabase();
    vi.mocked(verifyCronOrAdmin).mockResolvedValue(null);
    vi.mocked(sendCronFailureAlert).mockResolvedValue(undefined as never);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    // Google publishes are paced 100 ms apart. The pacing is not under test,
    // and at the lane's cap it would cost seconds per run. setImmediate still
    // yields between publishes, without a timer's minimum delay.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void) =>
        setImmediate(handler)) as never);
    for (const method of ['log', 'warn', 'error'] as const) {
        vi.spyOn(console, method).mockImplementation(() => undefined);
    }
    for (const key of INDEXING_KEYS) {
        savedEnv.set(key, process.env[key]);
        delete process.env[key];
    }
    armGoogle();
    process.env.INDEXNOW_KEY = 'f'.repeat(32);
    fetchMock = mockNetwork();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    savedEnv.clear();
});

interface RunOutcome {
    status: number;
    body: Record<string, unknown>;
    /** URLs this run published to the Google Indexing API, in order. */
    google: string[];
    /** URLs this run submitted to IndexNow, in order. */
    indexNow: string[];
}

/**
 * Fire the cron at `when`. Each firing is its own serverless invocation, so the
 * in-process Google grant starts full, unless a test is modelling a warm
 * instance that already spent it.
 */
async function runCron(when: Date, options: { sameInvocation?: boolean } = {}): Promise<RunOutcome> {
    vi.setSystemTime(when);
    if (!options.sameInvocation) resetGoogleIndexingBudget();
    const before = fetchMock.mock.calls.length;

    const { GET } = await import('@/app/api/cron/deindex-expired/route');
    const res = await GET(
        new Request('https://example.com/api/cron/deindex-expired', {
            headers: { authorization: 'Bearer test' },
        }) as never,
    );

    const calls = fetchMock.mock.calls.slice(before);
    const bodyOf = (call: (typeof calls)[number]) => JSON.parse(String((call[1] as RequestInit).body));
    return {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
        google: calls
            .filter((call) => String(call[0]).includes('indexing.googleapis.com'))
            .map((call) => bodyOf(call).url as string),
        indexNow: calls
            .filter((call) => String(call[0]).includes('indexnow'))
            .flatMap((call) => bodyOf(call).urlList as string[]),
    };
}

// ─── 1. The resume point on its own ─────────────────────────────────────────

describe('the deindex-expired resume point', () => {
    const cursor: DeindexCursor = { updatedAt: at(-DAY).toISOString(), id: jobUuid(7) };

    it('reads a stored cursor back and refuses anything malformed', () => {
        expect(parseCursor(cursor)).toEqual(cursor);
        expect(parseCursor({ updatedAt: '2026-09-20T12:45:00Z', id: 'a' })).toEqual({
            updatedAt: '2026-09-20T12:45:00.000Z',
            id: 'a',
        });
        for (const bad of [null, 'x', [], {}, { updatedAt: 'not a date', id: 'a' }, { updatedAt: cursor.updatedAt, id: '' }]) {
            expect(parseCursor(bad), JSON.stringify(bad)).toBeNull();
        }
        expect(cursorFromMetrics({ cursor, completed: 3 })).toEqual(cursor);
        // Runs from before the cursor existed recorded only counts.
        expect(cursorFromMetrics({ expiredCount: 12, googleDeleted: 0 })).toBeNull();
        expect(cursorFromMetrics(null)).toBeNull();
    });

    it('reaches back to the cursor inside the lookback, and to the floor otherwise', () => {
        const fresh = planWindow(cursor, NOW);
        expect(fresh.resumeAfter).toEqual(cursor);
        expect(fresh.staleCursor).toBeNull();
        expect(fresh.floor.getTime()).toBe(NOW.getTime() - MAX_LOOKBACK_MS);
        expect(fresh.ceiling.getTime()).toBe(NOW.getTime() - SETTLE_MS);

        expect(planWindow(null, NOW).resumeAfter).toBeNull();

        const old: DeindexCursor = { updatedAt: at(-MAX_LOOKBACK_MS - HOUR).toISOString(), id: jobUuid(1) };
        const stale = planWindow(old, NOW);
        expect(stale.resumeAfter).toBeNull();
        expect(stale.staleCursor).toEqual(old);
    });

    it('keeps the lookback a sane bound: longer than the old window, at most a few weeks', () => {
        expect(MAX_LOOKBACK_MS).toBeGreaterThan(2 * DAY);
        expect(MAX_LOOKBACK_MS).toBeLessThanOrEqual(30 * DAY);
        expect(SETTLE_MS).toBeGreaterThan(0);
        expect(SETTLE_MS).toBeLessThan(HOUR);
    });

    const offered: OfferedJob[] = [1, 2, 3, 4].map((i) => ({
        id: jobUuid(i),
        updatedAt: at(-DAY + i * HOUR),
        url: urlOf(expiredJob(i, at(-DAY + i * HOUR))),
    }));
    const ok = (job: OfferedJob) => ({ engine: 'Google', url: job.url, success: true });
    const failed = (job: OfferedJob) => ({ engine: 'Google', url: job.url, success: false, error: 'HTTP 500' });
    const refusedBudget = (job: OfferedJob) => ({
        engine: 'Google',
        url: job.url,
        success: false,
        error: `${GOOGLE_BUDGET_REFUSED} for lane "expired-job-removal"`,
    });
    const outOfScope = (job: OfferedJob) => ({ engine: 'Google', url: job.url, success: false, error: GOOGLE_POLICY_REFUSED });
    const cursorAt = (job: OfferedJob): DeindexCursor => ({ updatedAt: job.updatedAt.toISOString(), id: job.id });

    it('moves past every job Google answered', () => {
        expect(advanceCursor(cursor, offered, offered.map(ok))).toEqual({
            cursor: cursorAt(offered[3]),
            completed: 4,
            hold: null,
        });
    });

    it('stops at the first job Google was never asked about, so the rest carry over', () => {
        const google = [ok(offered[0]), ok(offered[1]), refusedBudget(offered[2]), refusedBudget(offered[3])];
        expect(advanceCursor(cursor, offered, google)).toEqual({
            cursor: cursorAt(offered[1]),
            completed: 2,
            hold: 'google-not-asked',
        });
        expect(advanceCursor(cursor, offered, offered.map(refusedBudget))).toEqual({
            cursor,
            completed: 0,
            hold: 'google-not-asked',
        });
    });

    it('holds the whole batch when Google refused every job it was asked about', () => {
        expect(advanceCursor(cursor, offered, offered.map(failed))).toEqual({
            cursor,
            completed: 0,
            hold: 'google-rejected-every-url',
        });
    });

    it('does not let one failing URL hold back the jobs that went through', () => {
        const google = [ok(offered[0]), failed(offered[1]), ok(offered[2]), ok(offered[3])];
        expect(advanceCursor(cursor, offered, google).completed).toBe(4);
    });

    it('stops just after the last job Google accepted when every job it asked about after that failed', () => {
        // A quota that runs out, or an outage that begins, partway through a
        // batch fails every URL from there on. None of those failures is final.
        expect(advanceCursor(cursor, offered, [ok(offered[0]), ok(offered[1]), failed(offered[2]), failed(offered[3])])).toEqual({
            cursor: cursorAt(offered[1]),
            completed: 2,
            hold: 'google-failed-after-last-success',
        });
        // Nor is a failure followed only by jobs Google was never asked about.
        expect(
            advanceCursor(cursor, offered, [ok(offered[0]), failed(offered[1]), refusedBudget(offered[2]), refusedBudget(offered[3])]),
        ).toEqual({
            cursor: cursorAt(offered[0]),
            completed: 1,
            hold: 'google-failed-after-last-success',
        });
        // A failure with a success after it is final, and the not asked tail carries over.
        expect(advanceCursor(cursor, offered, [ok(offered[0]), failed(offered[1]), ok(offered[2]), refusedBudget(offered[3])])).toEqual({
            cursor: cursorAt(offered[2]),
            completed: 3,
            hold: 'google-not-asked',
        });
    });

    it('moves past scope refusals after the last accepted job, but not past a failure before them', () => {
        expect(advanceCursor(cursor, offered, [ok(offered[0]), ok(offered[1]), outOfScope(offered[2]), outOfScope(offered[3])])).toEqual({
            cursor: cursorAt(offered[3]),
            completed: 4,
            hold: null,
        });
        expect(advanceCursor(cursor, offered, [ok(offered[0]), outOfScope(offered[1]), failed(offered[2]), outOfScope(offered[3])])).toEqual({
            cursor: cursorAt(offered[1]),
            completed: 2,
            hold: 'google-failed-after-last-success',
        });
    });

    it('treats a scope refusal as final, since no later run could send it', () => {
        expect(advanceCursor(null, offered, offered.map(outOfScope))).toEqual({
            cursor: cursorAt(offered[3]),
            completed: 4,
            hold: null,
        });
    });

    it('stops at a result it cannot match to the job, and leaves an empty batch alone', () => {
        const google = [ok(offered[0]), ok(offered[2]), ok(offered[1]), ok(offered[3])];
        expect(advanceCursor(cursor, offered, google).completed).toBe(1);
        expect(advanceCursor(cursor, offered, google.slice(0, 1)).completed).toBe(1);
        expect(advanceCursor(cursor, [], [])).toEqual({ cursor, completed: 0, hold: null });
    });
});

// ─── 2. Runs in sequence ─────────────────────────────────────────────────────

describe('deindex-expired sends each expired job once, oldest first', () => {
    it('drains a backlog larger than the per run budget, carrying the rest over run by run', async () => {
        // Three expiry sweeps, each stamping 25 jobs with one shared updatedAt,
        // so the per run boundary falls inside a group of tied rows.
        const sweeps = [at(-3 * DAY), at(-2 * DAY), at(-DAY)];
        jobs = sweeps.flatMap((stamp, s) =>
            Array.from({ length: 25 }, (_, i) => expiredJob(s * 100 + (24 - i), stamp)),
        );
        const expected = oldestFirst(jobs).map(urlOf);
        expect(expected.length).toBeGreaterThan(2 * LANE_CAP);

        const fired = [NOW, at(6 * HOUR), at(DAY), at(DAY + 6 * HOUR)];
        const outcomes: RunOutcome[] = [];
        for (const when of fired) outcomes.push(await runCron(when));

        expect(outcomes.map((o) => o.google)).toEqual([
            expected.slice(0, LANE_CAP),
            expected.slice(LANE_CAP, 2 * LANE_CAP),
            expected.slice(2 * LANE_CAP),
            [],
        ]);
        // IndexNow is offered exactly what Google is, so it too hears each URL once.
        expect(outcomes.map((o) => o.indexNow)).toEqual(outcomes.map((o) => o.google));
        expect(outcomes.map((o) => o.body.backlog)).toEqual([
            expected.length - LANE_CAP,
            expected.length - 2 * LANE_CAP,
            0,
            0,
        ]);
        expect(outcomes.every((o) => o.status === 200)).toBe(true);
        expect(lastRecordedCursor()).toEqual({
            updatedAt: sweeps[2].toISOString(),
            id: oldestFirst(jobs).at(-1)?.id,
        });
    });

    it('reaches back past 48 hours to the last successful run after runs were skipped', async () => {
        const beforeA = [expiredJob(1, at(-10 * HOUR)), expiredJob(2, at(-9 * HOUR))];
        jobs = beforeA;
        expect((await runCron(NOW)).google).toEqual(beforeA.map(urlOf));

        // Then five scheduled firings never happen. Expiries keep arriving,
        // some of them more than 48 hours before the next run that does fire.
        const whileDown = [
            expiredJob(3, at(HOUR)),
            expiredJob(4, at(2 * HOUR)),
            expiredJob(5, at(30 * HOUR)),
            expiredJob(6, at(59 * HOUR)),
        ];
        jobs = [...beforeA, ...whileDown];

        const next = await runCron(at(3 * DAY));
        expect(next.google).toEqual(whileDown.map(urlOf));
        expect(next.body.completed).toBe(whileDown.length);
    });

    it('resumes from the last successful run after a run fails', async () => {
        jobs = [expiredJob(1, at(-10 * HOUR))];
        await runCron(NOW);
        jobs = [...jobs, expiredJob(2, at(2 * HOUR)), expiredJob(3, at(3 * HOUR))];

        vi.mocked(prisma.job.count).mockRejectedValueOnce(new Error('connection reset'));
        const failed = await runCron(at(6 * HOUR));
        expect(failed.status).toBe(500);
        expect(failed.google).toEqual([]);
        expect(sendCronFailureAlert).toHaveBeenCalledWith('deindex-expired', expect.any(Error));
        expect(runs.at(-1)?.success).toBe(false);

        const next = await runCron(at(DAY));
        expect(next.google).toEqual([jobs[1], jobs[2]].map(urlOf));
    });

    it('sends a batch again, rather than skipping it, when the run that sent it was never recorded', async () => {
        jobs = [expiredJob(1, at(-3 * HOUR)), expiredJob(2, at(-2 * HOUR))];
        // withCronTracking logs a failed bookkeeping write and still answers
        // 200, so the run stays marked unsuccessful and its cursor unread.
        vi.mocked(prisma.cronRun.update).mockRejectedValueOnce(new Error('write timeout'));
        const unrecorded = await runCron(NOW);
        expect(unrecorded.status).toBe(200);
        expect(unrecorded.google).toEqual(jobs.map(urlOf));

        expect((await runCron(at(6 * HOUR))).google).toEqual(jobs.map(urlOf));
        expect((await runCron(at(DAY))).google).toEqual([]);
    });

    it('carries the whole batch over when a warm instance already spent the lane', async () => {
        jobs = Array.from({ length: LANE_CAP + 10 }, (_, i) => expiredJob(i + 1, at(-DAY + i * 60_000)));
        const expected = oldestFirst(jobs).map(urlOf);

        const first = await runCron(NOW);
        // Same process and same UTC day: the in-process grant is already spent.
        const second = await runCron(at(6 * HOUR), { sameInvocation: true });
        const third = await runCron(at(DAY));

        expect(first.google).toEqual(expected.slice(0, LANE_CAP));
        expect(second.google).toEqual([]);
        expect(second.body.hold).toBe('google-not-asked');
        expect(second.body.completed).toBe(0);
        expect(third.google).toEqual(expected.slice(LANE_CAP));

        const everything = [...first.google, ...second.google, ...third.google];
        expect(everything).toEqual(expected);
        expect(duplicates(everything)).toEqual([]);
    });

    it('carries over exactly the jobs a partly spent lane could not reach', async () => {
        jobs = Array.from({ length: LANE_CAP }, (_, i) => expiredJob(i + 1, at(-DAY + i * 60_000)));
        const expected = oldestFirst(jobs).map(urlOf);

        resetGoogleIndexingBudget();
        const spent = 12;
        await pingAllSearchEnginesBatchDeleted(
            Array.from({ length: spent }, (_, i) => urlOf(expiredJob(900 + i, NOW))),
            'expired-job-removal',
        );
        const partial = await runCron(NOW, { sameInvocation: true });
        const next = await runCron(at(6 * HOUR));

        expect(partial.google).toEqual(expected.slice(0, LANE_CAP - spent));
        expect(partial.body.completed).toBe(LANE_CAP - spent);
        expect(next.google).toEqual(expected.slice(LANE_CAP - spent));
        expect(duplicates([...partial.google, ...next.google])).toEqual([]);
    });

    it('offers a batch again while Google refuses every removal, then sends it once', async () => {
        jobs = [expiredJob(1, at(-3 * HOUR)), expiredJob(2, at(-2 * HOUR))];
        fetchMock.mockRestore();
        fetchMock = mockNetwork({ googleStatus: () => 403 });

        const refused = await runCron(NOW);
        expect(refused.google).toEqual(jobs.map(urlOf));
        expect(refused.body.hold).toBe('google-rejected-every-url');
        expect(refused.body.completed).toBe(0);
        expect(lastRecordedCursor()).toBeNull();

        fetchMock.mockRestore();
        fetchMock = mockNetwork();
        const accepted = await runCron(at(6 * HOUR));
        expect(accepted.google).toEqual(jobs.map(urlOf));
        expect((accepted.body.google as { deleted: number }).deleted).toBe(2);
        expect((await runCron(at(DAY))).google).toEqual([]);
    });

    it('does not let one URL Google keeps failing stall the jobs behind it', async () => {
        jobs = [1, 2, 3].map((i) => expiredJob(i, at(-6 * HOUR + i * HOUR)));
        const poisoned = urlOf(jobs[0]);
        fetchMock.mockRestore();
        fetchMock = mockNetwork({ googleStatus: (url) => (url === poisoned ? 400 : 200) });

        const run = await runCron(NOW);
        expect(run.body.completed).toBe(3);
        expect(run.body.google).toEqual({ deleted: 2, failed: 1, notAsked: 0 });
        expect((await runCron(at(6 * HOUR))).google).toEqual([]);
    });

    it('carries over every job Google failed after its last success, as when the daily quota runs out mid batch', async () => {
        jobs = Array.from({ length: LANE_CAP }, (_, i) => expiredJob(i + 1, at(-DAY + i * 60_000)));
        const ordered = oldestFirst(jobs);
        const expected = ordered.map(urlOf);
        // The project quota has room for this many more publishes, spent
        // elsewhere in the day; after that Google answers 429 to every publish.
        const quota = 12;
        expect(quota).toBeLessThan(LANE_CAP);
        let quotaLeft = quota;
        const acceptedByGoogle: string[] = [];
        fetchMock.mockRestore();
        fetchMock = mockNetwork({
            googleStatus: (url) => {
                if (quotaLeft <= 0) return 429;
                quotaLeft -= 1;
                acceptedByGoogle.push(url);
                return 200;
            },
        });

        const exhausted = await runCron(NOW);
        expect(exhausted.google).toEqual(expected);
        expect(exhausted.body.google).toEqual({ deleted: quota, failed: LANE_CAP - quota, notAsked: 0 });
        expect(exhausted.body.completed).toBe(quota);
        expect(exhausted.body.backlog).toBe(LANE_CAP - quota);
        expect(exhausted.body.hold).toBe('google-failed-after-last-success');
        expect(lastRecordedCursor()).toEqual({
            updatedAt: ordered[quota - 1].updatedAt.toISOString(),
            id: ordered[quota - 1].id,
        });

        // The quota has reset by the next day's run.
        quotaLeft = Number.POSITIVE_INFINITY;
        const next = await runCron(at(DAY));
        expect(next.google).toEqual(expected.slice(quota));
        expect(next.body.completed).toBe(LANE_CAP - quota);
        expect(next.body.hold).toBeNull();

        expect(acceptedByGoogle).toEqual(expected);
        expect(duplicates(acceptedByGoogle)).toEqual([]);
        expect((await runCron(at(DAY + 6 * HOUR))).google).toEqual([]);
    });

    it('offers a URL Google failed at the end of a batch again, and passes it once a job behind it goes through', async () => {
        jobs = [1, 2, 3].map((i) => expiredJob(i, at(-6 * HOUR + i * HOUR)));
        const poisoned = urlOf(jobs[2]);
        fetchMock.mockRestore();
        fetchMock = mockNetwork({ googleStatus: (url) => (url === poisoned ? 400 : 200) });

        const first = await runCron(NOW);
        expect(first.google).toEqual(jobs.map(urlOf));
        expect(first.body.completed).toBe(2);
        expect(first.body.hold).toBe('google-failed-after-last-success');

        // Alone in its batch, its failure still proves nothing about the URL.
        const alone = await runCron(at(6 * HOUR));
        expect(alone.google).toEqual([poisoned]);
        expect(alone.body.hold).toBe('google-rejected-every-url');

        const later = expiredJob(4, at(7 * HOUR));
        jobs = [...jobs, later];
        const passed = await runCron(at(DAY));
        expect(passed.google).toEqual([poisoned, urlOf(later)]);
        expect(passed.body.completed).toBe(2);
        expect(passed.body.hold).toBeNull();
        expect((await runCron(at(DAY + 6 * HOUR))).google).toEqual([]);
    });

    it('starts a first run at the lookback floor, oldest first', async () => {
        const tooOld = expiredJob(1, at(-MAX_LOOKBACK_MS - HOUR));
        const inside = [expiredJob(2, at(-MAX_LOOKBACK_MS + HOUR)), expiredJob(3, at(-HOUR))];
        jobs = [inside[1], tooOld, inside[0]];

        expect((await runCron(NOW)).google).toEqual(inside.map(urlOf));
    });

    it('reports the expiries a stale cursor fell behind on, then resumes inside the window', async () => {
        seedSuccessfulRun(at(-10 * DAY), { updatedAt: at(-10 * DAY).toISOString(), id: jobUuid(0) });
        const lost = expiredJob(1, at(-9 * DAY));
        const kept = expiredJob(2, at(-2 * DAY));
        jobs = [lost, kept];

        const run = await runCron(NOW);
        expect(run.google).toEqual([urlOf(kept)]);
        expect(run.body.passedOver).toBe(1);
        expect(lastRecordedCursor()).toEqual({ updatedAt: kept.updatedAt.toISOString(), id: kept.id });
    });

    it('leaves a job flipped in the last few minutes for the next run', async () => {
        const settled = expiredJob(1, at(-HOUR));
        const justFlipped = expiredJob(2, new Date(NOW.getTime() - SETTLE_MS / 2));
        jobs = [settled, justFlipped];

        expect((await runCron(NOW)).google).toEqual([urlOf(settled)]);
        expect((await runCron(at(6 * HOUR))).google).toEqual([urlOf(justFlipped)]);
    });

    it('reads no jobs and sends nothing without the Google key, and keeps the cursor for later', async () => {
        const sentEarlier = expiredJob(1, at(-2 * DAY));
        const waiting = expiredJob(2, at(-DAY));
        jobs = [sentEarlier, waiting];
        const earlier: DeindexCursor = { updatedAt: sentEarlier.updatedAt.toISOString(), id: sentEarlier.id };
        seedSuccessfulRun(at(-2 * DAY + HOUR), earlier);
        delete process.env.GOOGLE_INDEXING_CREDENTIALS;

        const unarmed = await runCron(NOW);
        expect(unarmed.body.hold).toBe('google-not-configured');
        expect(prisma.job.findMany).not.toHaveBeenCalled();
        expect(prisma.job.count).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(lastRecordedCursor()).toEqual(earlier);

        armGoogle();
        expect((await runCron(at(6 * HOUR))).google).toEqual([urlOf(waiting)]);
    });

    it('offers only jobs the expiry path unpublished', async () => {
        const eligible = expiredJob(1, at(-2 * HOUR));
        jobs = [
            eligible,
            expiredJob(2, at(-2 * HOUR), { isPublished: true }),
            expiredJob(3, at(-2 * HOUR), { sourceProvider: null }),
            expiredJob(4, at(-2 * HOUR), { slug: null }),
            expiredJob(5, at(-2 * HOUR), { expiresAt: at(DAY) }),
            expiredJob(6, at(-2 * HOUR), { expiresAt: null }),
        ];

        expect((await runCron(NOW)).google).toEqual([urlOf(eligible)]);
    });

    it('offers a sent job again after each write another writer makes to it, and never skips it', async () => {
        // Any writer that touches an expired job after it was sent moves
        // updatedAt past the cursor. Ingest renewal used to do this on every
        // ingest run; section 4 pins the guards that stopped it.
        const renewed = expiredJob(1, at(-3 * HOUR));
        const untouched = expiredJob(2, at(-2 * HOUR));
        jobs = [renewed, untouched];
        const rewrite = (patch: Partial<JobRow>): void => {
            jobs = jobs.map((job) => (job.id === renewed.id ? { ...job, ...patch } : job));
        };
        expect((await runCron(NOW)).google).toEqual([renewed, untouched].map(urlOf));

        // A write that changes nothing but updatedAt, as renewal's age cap
        // once made to a row that was already unpublished.
        rewrite({ updatedAt: at(HOUR) });
        expect((await runCron(at(6 * HOUR))).google).toEqual([urlOf(renewed)]);

        // A job published again, then swept again, as renewal once did to an
        // undated job. A run in between does not see it and does not move past it.
        rewrite({ isPublished: true, updatedAt: at(7 * HOUR) });
        expect((await runCron(at(7 * HOUR + 2 * SETTLE_MS))).google).toEqual([]);
        rewrite({ isPublished: false, updatedAt: at(8 * HOUR) });
        expect((await runCron(at(DAY))).google).toEqual([urlOf(renewed)]);

        // Left alone, as a guarded write in renewJob would leave it, it stays sent.
        expect((await runCron(at(DAY + 6 * HOUR))).google).toEqual([]);
    });
});

// ─── 3. The route keeps the shape the tests above rely on ───────────────────

describe('the deindex-expired route', () => {
    const src = read(ROUTE);

    it('spends the expired-job-removal lane, one run share at a time', () => {
        expect(src).toContain("'expired-job-removal',");
        expect(src).toContain("GOOGLE_INDEXING_LANES['expired-job-removal'].perInvocation");
        expect(src).toContain('take: BATCH_SIZE');
    });

    it('reads oldest first with the id as tie breaker, and no longer uses a fixed window', () => {
        expect(src).toContain("orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }]");
        expect(src).not.toMatch(/updatedAt: 'desc'/);
        expect(src).not.toMatch(/getHours\(\) - 48/);
    });

    it('resumes from the stored cursor and records one on every successful run', () => {
        expect(src).toContain('await readLastCursor()');
        expect(src).toContain('advanceCursor(previous, offered, results.google)');
        expect(src).toMatch(/metrics: \{[\s\S]*cursor: run\.cursor/);
    });
});

// ─── 4. Ingest renewal leaves expired jobs alone ────────────────────────────

describe('ingest renewal does not re-stamp expired jobs', () => {
    // renewJob is a closure inside ingestJobs, reached only through a full
    // ingest run, so its guards are pinned on the source. Each unguarded write
    // moved updatedAt past the cursor and resent the URL to Google and
    // IndexNow after every ingest run that still saw the job.
    const source = read('lib/ingestion-service.ts').replace(/\r\n/g, '\n');
    const start = source.indexOf('const renewJob = async (');
    const renewJob = source.slice(start, source.indexOf('// Process each job', start));

    it('reads the publish state and expiry it guards on', () => {
        expect(start).toBeGreaterThan(-1);
        expect(renewJob).toMatch(/select: \{[^}]*isPublished: true,[^}]*expiresAt: true,/);
    });

    it('skips the age cap write when the row is already unpublished', () => {
        const ageBranch = renewJob.slice(renewJob.indexOf('if (ageMs > MAX_JOB_AGE_MS)'));
        expect(ageBranch).toMatch(/if \(existing\.isPublished\) \{\s*await prisma\.job\.update\(\{\s*where: \{ id \},\s*data: \{ isPublished: false \},/);
    });

    it('never revives a job past its own expiresAt', () => {
        const guard = renewJob.indexOf('existing.expiresAt.getTime() < Date.now()');
        const revive = renewJob.indexOf('isPublished: true,\n          updatedAt: new Date(),');
        expect(guard).toBeGreaterThan(-1);
        expect(revive).toBeGreaterThan(guard);
        expect(renewJob.slice(guard, revive)).toMatch(/\{\s*return;\s*\}/);
    });
});
