/**
 * lib/jobs-board-data.ts: the one loader behind the /jobs page, its metadata
 * and GET /api/jobs (2026-11-23).
 *
 * One filter click used to run five listing queries (the page's list and
 * count, the metadata's count, the API's list and count), each 0.8 s or more
 * on the production database, through a two-connection pool: a few quick
 * clicks, or one crawler burst, and the page answered the error screen. The
 * loader runs each read once, shares it with every caller, and keeps the last
 * copy of the common views so they do not need the database at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A stand-in data cache that behaves like Next's for a per-request page: an
 * entry inside its window is returned as it is; an older one is returned at
 * once too, however old, and refreshed behind the answer (a failed refresh
 * is swallowed and the old entry stays); with no entry the read runs inline
 * and its error reaches the caller.
 */
const dataCache = vi.hoisted(() => ({
    store: new Map<string, { body: string; storedAt: number }>(),
    background: [] as Array<Promise<unknown>>,
}));

vi.mock('next/cache', () => ({
    unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keyParts: string[], options: { revalidate: number }) =>
        async (...args: unknown[]) => {
            const key = `${keyParts.join(',')}|${JSON.stringify(args)}`;
            const keep = (value: unknown) => {
                dataCache.store.set(key, { body: JSON.stringify(value), storedAt: Date.now() });
            };
            const hit = dataCache.store.get(key);
            if (!hit) {
                const value = await fn(...args);
                keep(value);
                return value;
            }
            if (Date.now() - hit.storedAt > options.revalidate * 1000) {
                dataCache.background.push(fn(...args).then(keep).catch(() => undefined));
            }
            return JSON.parse(hit.body);
        },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: { job: { count: vi.fn(), findMany: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { DEFAULT_FILTERS } from '@/types/filters';
import { SPECIALTY_FILTER_OPTIONS, type RecruitmentFilterState } from '@/lib/filters';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import {
    JOBS_BOARD_CACHE_SECONDS,
    JOBS_BOARD_MAX_STALE_SECONDS,
    JOBS_BOARD_PAGE_SIZE,
    JOBS_BOARD_REFRESH_WAIT_MS,
    JOBS_BOARD_SHARED_VIEW_MAX_FILTERS,
    boardFiltersKey,
    boardMemoSize,
    clearBoardMemo,
    isSharedBoardView,
    loadBoardCount,
    loadBoardRows,
} from '@/lib/jobs-board-data';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const POOL_TIMEOUT = 'timeout exceeded when trying to connect';
const T0 = new Date('2026-11-23T06:00:00Z');
const A_SPECIALTY = SPECIALTY_FILTER_OPTIONS[0].value;
const COUNT_KEY_FOR_ALL_JOBS = 'jobs-board-count,v1|[""]';

const F = (overrides: Partial<RecruitmentFilterState> = {}): RecruitmentFilterState => ({ ...DEFAULT_FILTERS, ...overrides });

function dbRow(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        slug: `nurse-practitioner-${id}`,
        title: 'Nurse Practitioner',
        employer: 'Acme Health',
        location: 'Austin, TX',
        city: 'Austin',
        state: 'Texas',
        stateCode: 'TX',
        jobType: 'Full-Time',
        isRemote: false,
        isHybrid: false,
        displaySalary: '$120k to $140k',
        normalizedMinSalary: 120000,
        normalizedMaxSalary: 140000,
        salaryPeriod: 'year',
        salaryRange: null,
        descriptionSummary: 'Outpatient clinic.',
        createdAt: new Date('2026-11-20T10:00:00Z'),
        isFeatured: false,
        isVerifiedEmployer: false,
        originalPostedAt: null,
        mode: null,
        applyLink: 'https://example.com/apply',
        applyOnPlatform: false,
        sourceType: 'external',
        experienceLabel: null,
        newGradFriendly: false,
        employerJobs: { companyLogoUrl: 'https://example.com/logo.png' },
        ...overrides,
    };
}

/** Moves the clock without touching the memo. */
const advance = (seconds: number) => vi.setSystemTime(new Date(Date.now() + seconds * 1000));

/** A later request in another moment: the clock moves and this instance's memo is gone. */
const later = (seconds: number) => {
    advance(seconds);
    clearBoardMemo();
};

/** Waits for the refreshes the cache started behind its answers. */
const settleBackground = () => Promise.all(dataCache.background.splice(0));

/** A database answer the test gives when it chooses to, like a query that takes real time. */
function slowAnswer<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

/** Lets every waiting continuation run: the loader gets as far as its wait on the database. */
const untilWaiting = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => { });
    dataCache.store.clear();
    dataCache.background.length = 0;
    clearBoardMemo();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('boardFiltersKey', () => {
    it('is the same for the same view, whatever order its values arrive in', () => {
        const a = boardFiltersKey(F({ workMode: ['remote', 'hybrid'], jobType: ['Contract'], specialty: ['pediatric', 'cardiology'] }));
        const b = boardFiltersKey(F({ specialty: ['cardiology', 'pediatric'], jobType: ['Contract'], workMode: ['hybrid', 'remote'] }));
        expect(a).toBe(b);
        expect(boardFiltersKey(F())).toBe('');
    });

    it('differs when any filter differs', () => {
        const keys = [
            F(), F({ workMode: ['remote'] }), F({ search: 'telehealth' }), F({ salaryMin: 150000 }),
            F({ recruitmentType: 'direct_hire' }), F({ stateCode: 'TX' }), F({ newGradFriendly: true }),
        ].map(boardFiltersKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('spells a recognised place one way, so "texas" and "Texas" are one view', () => {
        expect(boardFiltersKey(F({ location: 'texas' }))).toBe('location=Texas');
        expect(boardFiltersKey(F({ location: 'TEXAS' }))).toBe('location=Texas');
        expect(boardFiltersKey(F({ location: 'tx' }))).toBe('location=TX');
        expect(boardFiltersKey(F({ location: ' REMOTE ' }))).toBe('location=Remote');
        expect(boardFiltersKey(F({ location: 'new york' }))).toBe('location=New+York');
        expect(boardFiltersKey(F({ stateCode: 'ny' }))).toBe('stateCode=NY');
    });

    it('keeps any other place exactly as it was typed', () => {
        expect(boardFiltersKey(F({ location: 'Springfield' }))).toBe('location=Springfield');
        expect(boardFiltersKey(F({ location: ' texas ' }))).toBe('location=+texas+');
        expect(boardFiltersKey(F({ stateCode: 'zz' }))).toBe('stateCode=zz');
    });

    it('counts a value ticked twice once', () => {
        expect(boardFiltersKey(F({ workMode: ['remote', 'remote'] }))).toBe('workMode=remote');
    });

    it('reads the same jobs for either spelling: the remote alias is still the remote flag', async () => {
        db.job.count.mockResolvedValue(9);
        await loadBoardCount(F({ location: ' REMOTE ' }));
        expect(JSON.stringify(db.job.count.mock.calls[0][0].where)).toContain('{"isRemote":true}');
    });
});

describe('isSharedBoardView: only views built from closed lists are kept in the shared cache', () => {
    it.each([
        ['no filters', F()],
        ['a work mode', F({ workMode: ['remote'] })],
        ['a specialty and a job type', F({ specialty: [A_SPECIALTY], jobType: ['Contract'] })],
        ['the work-type specialties', F({ specialty: ['Telehealth', 'Travel'] })],
        ['a state typed in lowercase', F({ location: 'texas' })],
        ['a state code', F({ location: 'TX' })],
        ['the remote alias', F({ location: 'remote' })],
        ['a state code deep link', F({ stateCode: 'ny' })],
        ['a salary floor from the sidebar', F({ salaryMin: 150000 })],
        ['a posted window', F({ postedWithin: '7d' })],
        ['an experience bucket', F({ minYearsExperience: 2 })],
        ['new grad', F({ newGradFriendly: true })],
        ['an employer type', F({ recruitmentType: 'direct_hire' })],
        ['a category', F({ category: ALL_CATEGORY_SLUGS[0] })],
        ['the legacy experience level', F({ experienceLevel: ['Senior'] })],
    ])('keeps %s', (_label, filters) => {
        expect(isSharedBoardView(filters)).toBe(true);
    });

    it.each([
        ['a search phrase', F({ search: 'telehealth' })],
        ['a city', F({ cityExact: 'Austin' })],
        ['an employer name', F({ employer: 'Acme Health' })],
        ['a place that is not a state', F({ location: 'Springfield' })],
        ['a state with stray spaces', F({ location: ' texas ' })],
        ['an unknown state code', F({ stateCode: 'ZZ' })],
        ['an unknown category', F({ category: 'made-up' })],
        ['an unknown work mode', F({ workMode: ['anywhere'] })],
        ['an unknown job type', F({ jobType: ['Gig'] })],
        ['an unknown specialty', F({ specialty: ['made-up'] })],
        ['an unknown experience level', F({ experienceLevel: ['Guru'] })],
        ['a salary typed into the URL', F({ salaryMin: 123456 })],
        ['an unknown posted window', F({ postedWithin: '90d' })],
        ['an experience figure typed into the URL', F({ minYearsExperience: 7 })],
    ])('reads %s from the database each time', (_label, filters) => {
        expect(isSharedBoardView(filters)).toBe(false);
    });

    it('keeps a view with a handful of values, not one with more', () => {
        const four = F({ workMode: ['remote', 'hybrid'], jobType: ['Contract'], location: 'Texas' });
        expect(JOBS_BOARD_SHARED_VIEW_MAX_FILTERS).toBe(4);
        expect(isSharedBoardView(four)).toBe(true);
        expect(isSharedBoardView({ ...four, postedWithin: '7d' })).toBe(false);
    });

    it('still answers a view it does not keep, with nothing left in the cache', async () => {
        db.job.count.mockResolvedValue(3);
        db.job.findMany.mockResolvedValue([dbRow('a')]);
        for (const filters of [F({ search: 'telehealth' }), F({ employer: 'Acme Health' }), F({ location: 'Springfield' })]) {
            expect(await loadBoardCount(filters)).toBe(3);
            expect(await loadBoardRows(filters, 'best', 1, JOBS_BOARD_PAGE_SIZE)).toHaveLength(1);
        }
        expect(dataCache.store.size).toBe(0);
        clearBoardMemo();
        await loadBoardCount(F({ search: 'telehealth' }));
        expect(db.job.count).toHaveBeenCalledTimes(4);
    });
});

describe('one read per view, shared by the page, its metadata and the API', () => {
    it('counts once for callers that ask together or one after another', async () => {
        db.job.count.mockResolvedValue(638);
        const [a, b] = await Promise.all([loadBoardCount(F()), loadBoardCount(F())]);
        expect([a, b, await loadBoardCount(F())]).toEqual([638, 638, 638]);
        expect(db.job.count).toHaveBeenCalledTimes(1);
    });

    it('lists once for the same view, and again for another sort or page', async () => {
        db.job.findMany.mockResolvedValue([dbRow('a')]);
        await Promise.all([loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE), loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE)]);
        expect(db.job.findMany).toHaveBeenCalledTimes(1);
        await loadBoardRows(F(), 'newest', 1, JOBS_BOARD_PAGE_SIZE);
        await loadBoardRows(F(), 'best', 2, JOBS_BOARD_PAGE_SIZE);
        expect(db.job.findMany).toHaveBeenCalledTimes(3);
        expect(db.job.findMany.mock.calls[2][0]).toMatchObject({ skip: JOBS_BOARD_PAGE_SIZE, take: JOBS_BOARD_PAGE_SIZE });
    });

    it('treats an unknown sort as the default, so it shares the default view', async () => {
        db.job.findMany.mockResolvedValue([dbRow('a')]);
        await loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE);
        await loadBoardRows(F(), 'made-up', 1, JOBS_BOARD_PAGE_SIZE);
        expect(db.job.findMany).toHaveBeenCalledTimes(1);
    });

    it('does not keep a failed read: the next caller tries the database again', async () => {
        db.job.count.mockRejectedValueOnce(new Error(POOL_TIMEOUT)).mockResolvedValueOnce(12);
        await expect(loadBoardCount(F({ workMode: ['remote'] }))).rejects.toThrow(POOL_TIMEOUT);
        expect(await loadBoardCount(F({ workMode: ['remote'] }))).toBe(12);
    });

    it('runs one query for a view two requests miss at the same moment, memo or not', async () => {
        let answer!: (count: number) => void;
        db.job.count.mockReturnValueOnce(new Promise<number>((resolve) => { answer = resolve; }));
        const first = loadBoardCount(F({ search: 'cardiology' }));
        clearBoardMemo();
        const second = loadBoardCount(F({ search: 'cardiology' }));
        answer(21);
        expect(await Promise.all([first, second])).toEqual([21, 21]);
        expect(db.job.count).toHaveBeenCalledTimes(1);
    });
});

describe('the memo stays small', () => {
    it('never holds more than a hundred views, and drops them once their 15 seconds pass', async () => {
        db.job.count.mockResolvedValue(1);
        await Promise.all(Array.from({ length: 150 }, (_, i) => loadBoardCount(F({ search: `query ${i}` }))));
        expect(boardMemoSize()).toBe(100);
        advance(16);
        await loadBoardCount(F({ search: 'one more' }));
        expect(boardMemoSize()).toBe(1);
    });

    it('keeps the views used last when it has to drop some', async () => {
        db.job.count.mockResolvedValue(1);
        for (let i = 0; i < 101; i += 1) await loadBoardCount(F({ search: `query ${i}` }));
        await loadBoardCount(F({ search: 'query 0' }));
        await loadBoardCount(F({ search: 'query 100' }));
        // "query 0" was the oldest and was dropped, so it read again; "query 100" was kept.
        expect(db.job.count).toHaveBeenCalledTimes(102);
    });
});

describe('rows are the same shape from the database and from the cache', () => {
    it('carries dates as ISO strings and the logo as a plain field', async () => {
        db.job.findMany.mockResolvedValue([dbRow('a', { originalPostedAt: new Date('2026-11-19T08:30:00Z') }), dbRow('b', { employerJobs: null })]);
        const first = await loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE);
        expect(first[0]).toMatchObject({
            id: 'a', createdAt: '2026-11-20T10:00:00.000Z', originalPostedAt: '2026-11-19T08:30:00.000Z',
            companyLogoUrl: 'https://example.com/logo.png',
        });
        expect(first[1]).toMatchObject({ id: 'b', originalPostedAt: null, companyLogoUrl: null });
        expect(first[0]).not.toHaveProperty('employerJobs');
        clearBoardMemo();
        expect(await loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE)).toEqual(first);
        expect(db.job.findMany).toHaveBeenCalledTimes(1);
    });

    it('keys the cached rows by their columns, so a release that adds one never reads the old shape', async () => {
        db.job.findMany.mockResolvedValue([dbRow('a')]);
        await loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE);
        const [key] = [...dataCache.store.keys()];
        const columns = Object.keys(db.job.findMany.mock.calls[0][0].select).join(',');
        expect(key).toBe(`jobs-board-rows,v1,${columns}|["","best",1,${JOBS_BOARD_PAGE_SIZE}]`);
    });
});

describe('which reads of a kept view go through the shared cache', () => {
    it('keeps its count, whatever page is shown', async () => {
        db.job.count.mockResolvedValue(57);
        await loadBoardCount(F({ specialty: [A_SPECIALTY] }));
        clearBoardMemo();
        expect(await loadBoardCount(F({ specialty: [A_SPECIALTY] }))).toBe(57);
        expect(db.job.count).toHaveBeenCalledTimes(1);
    });

    it('keeps page 1 of the list, not deeper pages (each is a one-off for a crawler)', async () => {
        db.job.findMany.mockResolvedValue([dbRow('a')]);
        await loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE);
        await loadBoardRows(F(), 'best', 3, JOBS_BOARD_PAGE_SIZE);
        clearBoardMemo();
        await loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE);
        expect(db.job.findMany).toHaveBeenCalledTimes(2);
        await loadBoardRows(F(), 'best', 3, JOBS_BOARD_PAGE_SIZE);
        expect(db.job.findMany).toHaveBeenCalledTimes(3);
    });
});

describe('how old a served copy can be', () => {
    it('inside the cache window, answers without the database', async () => {
        db.job.count.mockResolvedValue(638);
        await loadBoardCount(F());
        later(JOBS_BOARD_CACHE_SECONDS - 5);
        db.job.count.mockRejectedValue(new Error(POOL_TIMEOUT));
        expect(await loadBoardCount(F())).toBe(638);
        expect(db.job.count).toHaveBeenCalledTimes(1);
    });

    it('past the window but inside the limit, answers at once and refreshes behind the answer', async () => {
        db.job.count.mockResolvedValueOnce(638);
        await loadBoardCount(F());
        later(JOBS_BOARD_MAX_STALE_SECONDS - 5);
        const refresh = slowAnswer<number>();
        db.job.count.mockReturnValueOnce(refresh.promise);
        // Answered while the refresh is still running.
        expect(await loadBoardCount(F())).toBe(638);
        refresh.resolve(702);
        await settleBackground();
        later(1);
        expect(await loadBoardCount(F())).toBe(702);
        expect(db.job.count).toHaveBeenCalledTimes(2);
    });

    it('past the limit, waits for that same refresh: the query runs once, not twice', async () => {
        db.job.count.mockResolvedValueOnce(638);
        db.job.findMany.mockResolvedValueOnce([dbRow('old')]);
        await loadBoardCount(F());
        await loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE);
        later(JOBS_BOARD_MAX_STALE_SECONDS + 60);
        const count = slowAnswer<number>();
        const rows = slowAnswer<unknown[]>();
        db.job.count.mockReturnValueOnce(count.promise);
        db.job.findMany.mockReturnValueOnce(rows.promise);
        const pendingCount = loadBoardCount(F());
        const pendingRows = loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE);
        await untilWaiting();
        count.resolve(702);
        rows.resolve([dbRow('new')]);
        expect(await pendingCount).toBe(702);
        expect((await pendingRows)[0].id).toBe('new');
        await settleBackground();
        expect(db.job.count).toHaveBeenCalledTimes(2);
        expect(db.job.findMany).toHaveBeenCalledTimes(2);
    });

    it('past the limit with the database failing, serves the old copy after one attempt', async () => {
        db.job.count.mockResolvedValueOnce(638);
        db.job.findMany.mockResolvedValueOnce([dbRow('old')]);
        await loadBoardCount(F());
        await loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE);
        later(JOBS_BOARD_MAX_STALE_SECONDS + 60);
        const count = slowAnswer<number>();
        const rows = slowAnswer<unknown[]>();
        db.job.count.mockReturnValueOnce(count.promise);
        db.job.findMany.mockReturnValueOnce(rows.promise);
        const pendingCount = loadBoardCount(F());
        const pendingRows = loadBoardRows(F(), 'best', 1, JOBS_BOARD_PAGE_SIZE);
        await untilWaiting();
        count.reject(new Error(POOL_TIMEOUT));
        rows.reject(new Error(POOL_TIMEOUT));
        expect(await pendingCount).toBe(638);
        expect((await pendingRows)[0].id).toBe('old');
        await settleBackground();
        expect(db.job.count).toHaveBeenCalledTimes(2);
        expect(db.job.findMany).toHaveBeenCalledTimes(2);
    });

    it('past the limit with a slow database, serves the old copy once the wait is up', async () => {
        // Installed afresh: a second useFakeTimers call keeps the first one's list.
        vi.useRealTimers();
        vi.useFakeTimers({ now: T0, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        db.job.count.mockResolvedValueOnce(638);
        await loadBoardCount(F());
        later(JOBS_BOARD_MAX_STALE_SECONDS + 60);
        const refresh = slowAnswer<number>();
        db.job.count.mockReturnValueOnce(refresh.promise);
        try {
            let served: number | null = null;
            const pending = loadBoardCount(F()).then((count) => { served = count; });
            await untilWaiting();
            await vi.advanceTimersByTimeAsync(JOBS_BOARD_REFRESH_WAIT_MS - 1);
            expect(served).toBeNull();
            await vi.advanceTimersByTimeAsync(1);
            await pending;
            expect(served).toBe(638);
        } finally {
            refresh.resolve(702);
        }
        // The slow read was not thrown away: it lands in the cache for the next visitor.
        await settleBackground();
        later(1);
        expect(await loadBoardCount(F())).toBe(702);
        expect(db.job.count).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['no read time', JSON.stringify({ value: 5 })],
        ['a read time that is not a number', JSON.stringify({ value: 5, readAt: '2026-11-23' })],
        ['a bare value', '5'],
        ['nothing', 'null'],
    ])('does not trust a cached entry with %s: the database answers', async (_label, body) => {
        dataCache.store.set(COUNT_KEY_FOR_ALL_JOBS, { body, storedAt: Date.now() });
        db.job.count.mockResolvedValue(41);
        expect(await loadBoardCount(F())).toBe(41);
    });

    it('and with such an entry and the database failing, the error reaches the caller', async () => {
        dataCache.store.set(COUNT_KEY_FOR_ALL_JOBS, { body: JSON.stringify({ value: 5 }), storedAt: Date.now() });
        db.job.count.mockRejectedValue(new Error(POOL_TIMEOUT));
        await expect(loadBoardCount(F())).rejects.toThrow(POOL_TIMEOUT);
    });

    it('with no cached copy and the database failing, the error reaches the caller', async () => {
        db.job.count.mockRejectedValue(new Error(POOL_TIMEOUT));
        await expect(loadBoardCount(F({ jobType: ['Contract'] }))).rejects.toThrow(POOL_TIMEOUT);
    });
});
