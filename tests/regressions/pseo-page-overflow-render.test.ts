/**
 * Reviewer blocker (PSEO): /jobs/state/texas?page=1000000000000000000
 * answered 500. parseListingPage had no upper bound, so the page was 1e18;
 * pageOffset gave 3e19, above int64, and the state hub ran its listing query
 * BEFORE its range check. Prisma rejects such a `skip` with
 * PrismaClientValidationError ("Unable to fit value ... into a 64-bit signed
 * integer for field `skip`") before any query runs, and nothing caught it.
 * /jobs had the same arithmetic; its catch rendered the empty fallback board
 * at 200 instead of the TECH-09 404.
 *
 * These tests render the real pages against a Prisma mock that models that
 * validation: a `skip` at or above 2^63 throws, exactly as the client does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        job: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
        pseoStats: { findUnique: vi.fn(), findMany: vi.fn() },
        company: { findMany: vi.fn(), count: vi.fn() },
        $queryRaw: vi.fn(),
    },
}));

vi.mock('@/lib/pseo/listing-facts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/pseo/listing-facts')>()),
    getListingFacts: vi.fn(),
}));

vi.mock('@/lib/pseo/state-hub-index', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/pseo/state-hub-index')>()),
    countHubLiveDataSections: vi.fn(() => 0),
}));

vi.mock('@/lib/pseo/practice-environment', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/pseo/practice-environment')>()),
    isLicenseGuideLive: vi.fn(async () => false),
}));

vi.mock('@/lib/salary-analytics', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/salary-analytics')>()),
    getPublishableSalaryGuideStates: vi.fn(async () => new Set<string>()),
}));

vi.mock('@/app/jobs/locations/[state]/directory', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/app/jobs/locations/[state]/directory')>()),
    getStatesWithCityDirectory: vi.fn(async () => new Map()),
}));

import { prisma } from '@/lib/prisma';
import { getListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import { LISTING_PAGE_SIZE, MAX_LISTING_PAGE } from '@/lib/pseo/listing-pagination';
import StateJobsPage from '@/app/jobs/state/[state]/page';
import JobsPage from '@/app/jobs/page';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/** Prisma's `skip` is a 64-bit signed integer. */
const INT64_LIMIT = 2 ** 63;

/** The page after the reviewer's ?page value. */
const HUGE_PAGE = '1000000000000000000';

/** A marker the listing query rejects with once it has recorded its arguments. */
const LISTING_REACHED = 'listing query reached';

/** Rejects as the real client does for an int64 overflow; otherwise runs `then`. */
function modelSkipValidation(then: () => Promise<unknown>) {
    return async (args: { skip?: number }) => {
        if (typeof args?.skip === 'number' && args.skip >= INT64_LIMIT) {
            throw new Error(`Unable to fit value ${args.skip} into a 64-bit signed integer for field \`skip\``);
        }
        return then();
    };
}

/** How a render settled: "resolved", or the rejection's digest and message. */
async function settle(promise: Promise<unknown>): Promise<string> {
    return promise.then(
        () => 'resolved',
        (error: unknown) => {
            const e = error as { digest?: string; message?: string };
            return `${e.digest ?? ''} ${e.message ?? ''}`;
        },
    );
}

function stateHub(page: string) {
    return StateJobsPage({
        params: Promise.resolve({ state: 'texas' }),
        searchParams: Promise.resolve({ page }),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => { });
    db.job.groupBy.mockResolvedValue([]);
    db.job.count.mockResolvedValue(0);
    db.pseoStats.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue([]);
    vi.mocked(getListingFacts).mockResolvedValue({ total: 45, distinctPostings: 45, distinctEmployers: 9 } as ListingFacts);
});

describe('state hub: a huge ?page is a 404, never a 5xx', () => {
    it('404s before the listing query runs', async () => {
        db.job.findMany.mockImplementation(modelSkipValidation(async () => []));
        const result = await settle(stateHub(HUGE_PAGE));
        expect(result).toMatch(/404|NOT_FOUND/);
        expect(result).not.toContain('Unable to fit value');
        expect(db.job.findMany).not.toHaveBeenCalled();
    });

    it('any page past the last one 404s before the listing query', async () => {
        db.job.findMany.mockImplementation(modelSkipValidation(async () => []));
        // 45 jobs at 30 a page is 2 pages; page 3 is past the end.
        const result = await settle(stateHub('3'));
        expect(result).toMatch(/404|NOT_FOUND/);
        expect(db.job.findMany).not.toHaveBeenCalled();
    });

    it('a page in range still reaches the listing query with its exact offset', async () => {
        db.job.findMany.mockImplementation(modelSkipValidation(async () => { throw new Error(LISTING_REACHED); }));
        const result = await settle(stateHub('2'));
        expect(result).toContain(LISTING_REACHED);
        expect(db.job.findMany).toHaveBeenCalledTimes(1);
        expect(db.job.findMany.mock.calls[0][0]).toMatchObject({ skip: LISTING_PAGE_SIZE, take: LISTING_PAGE_SIZE });
    });

    it('page 1 queries from the first row', async () => {
        db.job.findMany.mockImplementation(modelSkipValidation(async () => { throw new Error(LISTING_REACHED); }));
        const result = await settle(stateHub('1'));
        expect(result).toContain(LISTING_REACHED);
        expect(db.job.findMany.mock.calls[0][0]).toMatchObject({ skip: 0 });
    });
});

describe('/jobs: a huge ?page is a 404, never the fallback board at 200', () => {
    it('caps the page, queries inside int64 and 404s past the last page', async () => {
        db.job.findMany.mockImplementation(modelSkipValidation(async () => []));
        db.job.count.mockResolvedValue(638);
        const result = await settle(JobsPage({ searchParams: Promise.resolve({ page: HUGE_PAGE }) }));
        expect(result).toMatch(/404|NOT_FOUND/);
        expect(db.job.findMany).toHaveBeenCalledTimes(1);
        const { skip } = db.job.findMany.mock.calls[0][0] as { skip: number };
        expect(skip).toBe((MAX_LISTING_PAGE - 1) * 50);
        expect(Number.isSafeInteger(skip)).toBe(true);
    });
});
