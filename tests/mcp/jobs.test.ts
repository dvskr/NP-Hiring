/**
 * lib/mcp/jobs.ts: job search and job detail for the MCP tools.
 *
 * Pinned:
 *   - parseJobId takes a bare id, a job slug or a job page URL (with or
 *     without a trailing slash, query or fragment) and nothing else;
 *   - resolveState and resolveSearch map every search_jobs argument onto the
 *     site's own filter state (stored job type labels, a specialty facet slug
 *     versus an APRN role or a setting going to `category`), refuse
 *     contradictions (APRN role plus setting, a city without a state, an
 *     unknown state), alias `state: "remote"` to the remote work mode, and
 *     never put a dash used as punctuation in the chips or the heading;
 *   - searchJobs never orders or filters by isFeatured or employerJobs (both
 *     directories ban paid placement), pages with skip and take, answers
 *     nextPageArgs and the same search on /jobs, enriches saved and applied
 *     state only for the signed-in viewer's own userId, and adds review
 *     sandbox jobs on page 1 for a reviewer account only;
 *   - getJobDetail shows only a job the site itself lists (a sandbox job only
 *     to a reviewer), turns the HTML description into plain text, clips it,
 *     reports the apply route and never returns the employer's apply link.
 *
 * Prisma is a fake; nothing here reaches a database or the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    jobFindMany: vi.fn(),
    jobCount: vi.fn(),
    jobFindFirst: vi.fn(),
    savedFindMany: vi.fn(),
    appFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        job: { findMany: h.jobFindMany, count: h.jobCount, findFirst: h.jobFindFirst },
        savedJob: { findMany: h.savedFindMany },
        jobApplication: { findMany: h.appFindMany },
    },
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
    DEFAULT_PAGE_SIZE,
    DESCRIPTION_MAX,
    getJobDetail,
    parseJobId,
    resolveSearch,
    resolveState,
    searchJobs,
    type McpViewer,
    type ResolvedSearch,
} from '@/lib/mcp/jobs';
import {
    JOB_TYPE_VALUES,
    POSTED_WITHIN_VALUES,
    SETTING_SLUGS,
    SPECIALTY_SLUGS,
    WORK_MODE_VALUES,
    type SearchJobsInput,
} from '@/lib/mcp/contracts';
import { REVIEW_SANDBOX_SOURCE_PROVIDER } from '@/lib/mcp/sandbox';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import { STATE_CODES } from '@/lib/pseo/setting-state-config';
import { brand } from '@/config/brand';
import {
    DASH_AS_PUNCTUATION,
    JOB_ID,
    JOB_ID_2,
    JOB_ID_3,
    ME,
    SANDBOX_JOB_ID,
    SITE,
    deepKeys,
    jobDetailRow,
    jobRow,
    sandboxJobRow,
    type Row,
} from './fixtures';

const CANDIDATE: McpViewer = { userId: ME, reviewer: false };
const REVIEWER: McpViewer = { userId: ME, reviewer: true };
const PAID_PLACEMENT_KEYS = ['isFeatured', 'employerJobs'];

interface FindManyArgs {
    where: Row;
    orderBy: unknown;
    skip?: number;
    take?: number;
    select?: Row;
}

let mainRows: Row[];
let sandboxRows: Row[];

const isSandboxQuery = (args: FindManyArgs): boolean => JSON.stringify(args.where).includes(REVIEW_SANDBOX_SOURCE_PROVIDER);
const findManyCalls = (): FindManyArgs[] => h.jobFindMany.mock.calls.map(([args]) => args as FindManyArgs);
const mainCall = (): FindManyArgs => {
    const call = findManyCalls().find((args) => !isSandboxQuery(args));
    if (!call) throw new Error('no main search query ran');
    return call;
};
const sandboxCall = (): FindManyArgs | undefined => findManyCalls().find(isSandboxQuery);

function resolved(args: SearchJobsInput): ResolvedSearch {
    const result = resolveSearch(args);
    if (typeof result === 'string') throw new Error(`unexpected refusal: ${result}`);
    return result;
}

beforeEach(() => {
    mainRows = [jobRow(), jobRow({ id: JOB_ID_2, title: 'Pediatric Nurse Practitioner' }), jobRow({ id: JOB_ID_3, isRemote: true })];
    sandboxRows = [];
    h.jobFindMany.mockReset().mockImplementation(async (args: FindManyArgs) => (isSandboxQuery(args) ? sandboxRows : mainRows));
    h.jobCount.mockReset().mockImplementation(async () => mainRows.length);
    h.jobFindFirst.mockReset().mockResolvedValue(null);
    h.savedFindMany.mockReset().mockResolvedValue([]);
    h.appFindMany.mockReset().mockResolvedValue([]);
});

// ── parseJobId ──────────────────────────────────────────────────────────────

describe('parseJobId', () => {
    it.each([
        ['a bare id', JOB_ID],
        ['a bare id in capitals', JOB_ID.toUpperCase()],
        ['a bare id with spaces around it', `  ${JOB_ID}  `],
        ['a job slug', `family-nurse-practitioner-austin-tx-${JOB_ID}`],
        ['the job page URL', `${SITE}/jobs/family-nurse-practitioner-austin-tx-${JOB_ID}`],
        ['the job page URL with a trailing slash', `${SITE}/jobs/family-nurse-practitioner-austin-tx-${JOB_ID}/`],
        ['the job page URL with a query and a fragment', `${SITE}/jobs/fnp-${JOB_ID}?utm_source=chatgpt#apply`],
        ['the job page URL on plain http', `http://nphiring.com/jobs/fnp-${JOB_ID}`],
    ])('reads the id from %s', (_label, value) => {
        expect(parseJobId(value)).toBe(JOB_ID);
    });

    it.each([
        ['an empty string', ''],
        ['a word', 'hello'],
        ['a number', '12345'],
        ['a job list URL', `${SITE}/jobs/`],
        ['an id followed by more text', `${JOB_ID}-apply`],
        ['an id in the query string only', `${SITE}/jobs?id=${JOB_ID}`],
        ['an id in the fragment only', `${SITE}/jobs#${JOB_ID}`],
        ['a deeper path after the id', `${SITE}/jobs/fnp-${JOB_ID}/apply`],
        ['an unparseable URL', 'https://'],
        ['a truncated id', JOB_ID.slice(0, 30)],
    ])('null for %s', (_label, value) => {
        expect(parseJobId(value)).toBeNull();
    });
});

// ── resolveState ────────────────────────────────────────────────────────────

describe('resolveState', () => {
    it.each([
        ['Texas', 'Texas', 'TX'],
        ['texas', 'Texas', 'TX'],
        ['TEXAS', 'Texas', 'TX'],
        ['TX', 'Texas', 'TX'],
        ['tx', 'Texas', 'TX'],
        ['  tx  ', 'Texas', 'TX'],
        ['new york', 'New York', 'NY'],
        ['NY', 'New York', 'NY'],
        ['District of Columbia', 'District of Columbia', 'DC'],
        ['dc', 'District of Columbia', 'DC'],
    ])('%s is %s (%s)', (value, name, code) => {
        expect(resolveState(value)).toEqual({ name, code });
    });

    it.each(['Texass', 'XX', 'remote', 'Puerto Rico', '', 'T X'])('null for %j', (value) => {
        expect(resolveState(value)).toBeNull();
    });

    it('knows every state the site knows', () => {
        for (const [name, code] of Object.entries(STATE_CODES)) {
            expect(resolveState(name)).toEqual({ name, code });
            expect(resolveState(code.toLowerCase())).toEqual({ name, code });
        }
    });
});

// ── resolveSearch ───────────────────────────────────────────────────────────

describe('resolveSearch: each argument maps onto the site filter state', () => {
    it('no arguments: the whole board, newest jobs that have not expired, heading "<niche> jobs"', () => {
        const now = new Date('2026-10-28T00:00:00.000Z');
        const result = resolveSearch({}, now);
        if (typeof result === 'string') throw new Error(result);
        expect(result.filters).toMatchObject({
            search: '',
            workMode: [],
            jobType: [],
            specialty: [],
            category: null,
            location: null,
            stateCode: null,
            cityExact: null,
            employer: null,
            salaryMin: null,
            postedWithin: null,
            newGradFriendly: null,
            minYearsExperience: null,
        });
        expect(result.extra).toEqual([{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }]);
        expect(result.state).toBeNull();
        expect(result.heading).toBe(`${brand.niche.short} jobs`);
        expect(result.chips).toEqual([]);
    });

    it('job types become the labels the jobs are stored with (the /jobs Job Type facet values)', () => {
        const result = resolved({ job_type: ['full_time', 'part_time', 'contract', 'per_diem'] });
        expect(result.filters.jobType).toEqual(['Full-Time', 'Part-Time', 'Contract', 'Per Diem']);
        expect(result.chips).toEqual(['Full-Time', 'Part-Time', 'Contract', 'Per Diem']);
    });

    it('a specialty facet slug filters the Specialty facet, not the category', () => {
        const result = resolved({ specialty: 'pediatric' });
        expect(result.filters.specialty).toEqual(['pediatric']);
        expect(result.filters.category).toBeNull();
        expect(result.heading).toBe('Pediatric jobs');
    });

    it.each([...CATEGORY_AXES.aprn])('the APRN role %s goes to category, not the Specialty facet', (role) => {
        const result = resolved({ specialty: role });
        expect(result.filters.category).toBe(role);
        expect(result.filters.specialty).toEqual([]);
    });

    it.each([...SETTING_SLUGS])('the setting %s goes to category and shows a chip', (setting) => {
        const result = resolved({ setting });
        expect(result.filters.category).toBe(setting);
        expect(result.chips).toHaveLength(1);
    });

    it('a specialty facet and a setting combine (specialty facet plus category)', () => {
        const result = resolved({ specialty: 'pediatric', setting: 'urgent-care' });
        expect(result.filters.specialty).toEqual(['pediatric']);
        expect(result.filters.category).toBe('urgent-care');
        expect(result.chips).toEqual(['Urgent Care']);
    });

    it.each([...CATEGORY_AXES.aprn])('an APRN role (%s) plus a setting is refused: both would be the one category', (role) => {
        expect(resolveSearch({ specialty: role, setting: 'telehealth' })).toBe('Search one APRN role or one setting at a time.');
    });

    it.each(['remote', 'Remote', ' REMOTE '])('state %j is the remote work mode, not a state', (value) => {
        const result = resolved({ state: value });
        expect(result.filters.workMode).toEqual(['remote']);
        expect(result.state).toBeNull();
        expect(result.chips).toEqual(['Remote']);
        expect(JSON.stringify(result.extra)).not.toContain('stateCode');
    });

    it('state "remote" plus the remote work mode shows one chip, not two', () => {
        const result = resolved({ state: 'remote', work_mode: ['remote'] });
        expect(result.filters.workMode).toEqual(['remote']);
        expect(result.chips).toEqual(['Remote']);
    });

    it('a state matches its name or its code in either column, case insensitively', () => {
        const result = resolved({ state: 'tx' });
        expect(result.state).toEqual({ name: 'Texas', code: 'TX' });
        expect(result.extra).toContainEqual({
            OR: [
                { stateCode: { equals: 'TX', mode: 'insensitive' } },
                { state: { equals: 'Texas', mode: 'insensitive' } },
                { state: { equals: 'TX', mode: 'insensitive' } },
            ],
        });
        expect(result.heading).toBe(`${brand.niche.short} jobs in Texas`);
    });

    it('a city with its state is an exact city match, headed "in City, ST"', () => {
        const result = resolved({ city: 'Austin', state: 'Texas' });
        expect(result.filters.cityExact).toBe('Austin');
        expect(result.heading).toBe(`${brand.niche.short} jobs in Austin, TX`);
    });

    it('a city without a state is refused', () => {
        expect(resolveSearch({ city: 'Austin' })).toBe('A city search needs the state too.');
    });

    it('a city with state "remote" is refused too (remote is no state)', () => {
        expect(resolveSearch({ city: 'Austin', state: 'remote' })).toBe('A city search needs the state too.');
    });

    it('an unknown state is refused with a sentence the model can act on', () => {
        expect(resolveSearch({ state: 'Narnia' })).toBe('"Narnia" is not a US state. Use a state name or its two-letter code.');
    });

    it('the remaining filters and their chips', () => {
        const result = resolved({
            query: 'pediatric urgent care',
            work_mode: ['hybrid', 'onsite'],
            min_salary: 150000,
            posted_within: '7d',
            new_grad_friendly: true,
            max_years_required: 3,
            easy_apply_only: true,
        });
        expect(result.filters).toMatchObject({
            search: 'pediatric urgent care',
            workMode: ['hybrid', 'onsite'],
            salaryMin: 150000,
            postedWithin: '7d',
            newGradFriendly: true,
            minYearsExperience: 3,
        });
        expect(result.extra).toContainEqual({ applyOnPlatform: true });
        expect(result.chips).toEqual([
            '"pediatric urgent care"',
            'Hybrid',
            'On site',
            '$150k+/yr',
            'Last 7 days',
            'New grad welcome',
            'Up to 3 years required',
            'Easy Apply',
        ]);
    });

    it('one year reads "year"; zero years is still a filter', () => {
        expect(resolved({ max_years_required: 1 }).chips).toEqual(['Up to 1 year required']);
        const zero = resolved({ max_years_required: 0 });
        expect(zero.chips).toEqual(['Up to 0 years required']);
        expect(zero.filters.minYearsExperience).toBe(0);
    });

    it('new_grad_friendly false and easy_apply_only false add nothing', () => {
        const result = resolved({ new_grad_friendly: false, easy_apply_only: false });
        expect(result.filters.newGradFriendly).toBeNull();
        expect(result.extra).toHaveLength(1);
        expect(result.chips).toEqual([]);
    });
});

describe('resolveSearch: no dash used as punctuation in any chip or heading', () => {
    it('across every specialty, setting, job type, work mode, window and state', () => {
        const findings: string[] = [];
        const check = (args: SearchJobsInput): void => {
            const result = resolveSearch(args);
            if (typeof result === 'string') return;
            for (const text of [result.heading, ...result.chips]) {
                if (DASH_AS_PUNCTUATION.test(text)) findings.push(`${JSON.stringify(args)} -> ${text}`);
            }
        };
        const base: SearchJobsInput = {
            query: 'pediatric urgent care',
            work_mode: [...WORK_MODE_VALUES],
            job_type: [...JOB_TYPE_VALUES],
            min_salary: 135000,
            new_grad_friendly: true,
            max_years_required: 2,
            easy_apply_only: true,
        };
        for (const specialty of SPECIALTY_SLUGS) check({ ...base, specialty, state: 'TX', city: 'Austin' });
        for (const setting of SETTING_SLUGS) check({ ...base, setting, specialty: 'family-practice' });
        for (const posted_within of POSTED_WITHIN_VALUES) check({ ...base, posted_within });
        for (const state of Object.keys(STATE_CODES)) check({ state });
        check({ state: 'remote' });
        expect(findings).toEqual([]);
    });
});

// ── searchJobs ──────────────────────────────────────────────────────────────

describe('searchJobs: ordering never favours a paid or employer post', () => {
    it('relevance (the default) is quality score, then posting date, then ingest date', async () => {
        for (const sort of [undefined, 'relevance'] as const) {
            h.jobFindMany.mockClear();
            await searchJobs({ sort }, null);
            expect(mainCall().orderBy, String(sort)).toEqual([
                { qualityScore: 'desc' },
                { originalPostedAt: { sort: 'desc', nulls: 'last' } },
                { createdAt: 'desc' },
            ]);
        }
    });

    it('newest is posting date first; salary is highest pay first', async () => {
        await searchJobs({ sort: 'newest' }, null);
        expect(mainCall().orderBy).toEqual([{ originalPostedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]);

        h.jobFindMany.mockClear();
        await searchJobs({ sort: 'salary' }, null);
        expect(mainCall().orderBy).toEqual([
            { normalizedMaxSalary: { sort: 'desc', nulls: 'last' } },
            { normalizedMinSalary: { sort: 'desc', nulls: 'last' } },
            { createdAt: 'desc' },
        ]);
    });

    it('no query of any sort, for any viewer, mentions isFeatured or employerJobs', async () => {
        for (const sort of [undefined, 'relevance', 'newest', 'salary'] as const) {
            for (const viewer of [null, CANDIDATE, REVIEWER]) {
                h.jobFindMany.mockClear();
                h.jobCount.mockClear();
                await searchJobs({ sort, query: 'family', state: 'TX', easy_apply_only: true }, viewer);
                const queries = [...h.jobFindMany.mock.calls, ...h.jobCount.mock.calls].map(([args]) => args);
                expect(queries.length).toBeGreaterThan(0);
                for (const key of PAID_PLACEMENT_KEYS) {
                    expect(deepKeys(queries), `${String(sort)} / ${JSON.stringify(viewer)}`).not.toContain(key);
                }
            }
        }
    });
});

describe('searchJobs: the query', () => {
    it('lists published jobs only, through the site filter, and counts with the same where', async () => {
        await searchJobs({ query: 'pediatric', state: 'TX' }, null);
        const { where } = mainCall();
        const and = where.AND as Row[];
        expect(and[0]).toMatchObject({ isPublished: true });
        expect(JSON.stringify(where)).toContain('"expiresAt"');
        expect(h.jobCount).toHaveBeenCalledWith({ where });
    });

    it('pages with skip and take: 6 per page by default', async () => {
        await searchJobs({}, null);
        expect(mainCall()).toMatchObject({ skip: 0, take: DEFAULT_PAGE_SIZE });
        expect(DEFAULT_PAGE_SIZE).toBe(6);

        h.jobFindMany.mockClear();
        await searchJobs({ page: 3, limit: 5 }, null);
        expect(mainCall()).toMatchObject({ skip: 10, take: 5 });
    });

    it('a refused argument set runs no query and answers the sentence', async () => {
        expect(await searchJobs({ city: 'Austin' }, null)).toBe('A city search needs the state too.');
        expect(h.jobFindMany).not.toHaveBeenCalled();
        expect(h.jobCount).not.toHaveBeenCalled();
    });
});

describe('searchJobs: paging and the same search on the site', () => {
    async function view(args: SearchJobsInput, total: number) {
        h.jobCount.mockResolvedValue(total);
        const result = await searchJobs(args, null);
        if (typeof result === 'string') throw new Error(result);
        return result;
    }

    it('nextPageArgs repeats every argument with the next page, until the last page', async () => {
        const first = await view({ query: 'pediatric', state: 'TX' }, 13);
        expect(first).toMatchObject({ page: 1, totalPages: 3, total: 13 });
        expect(first.nextPageArgs).toEqual({ query: 'pediatric', state: 'TX', page: 2 });

        const last = await view({ query: 'pediatric', state: 'TX', page: 3 }, 13);
        expect(last.nextPageArgs).toBeNull();

        const exact = await view({ page: 2 }, 12);
        expect(exact).toMatchObject({ totalPages: 2, nextPageArgs: null });
    });

    it('no results: one page, no next page', async () => {
        mainRows = [];
        const empty = await view({}, 0);
        expect(empty).toMatchObject({ total: 0, page: 1, totalPages: 1, nextPageArgs: null, jobs: [] });
    });

    it('never offers a page past 20 (the page argument stops at 20)', async () => {
        const deep = await view({ page: 20 }, 1000);
        expect(deep.nextPageArgs).toBeNull();
    });

    it('browseUrl is /jobs itself when no filter is set', async () => {
        expect((await view({}, 3)).browseUrl).toBe(`${SITE}/jobs`);
    });

    it('browseUrl carries the same filters as /jobs URL parameters', async () => {
        const result = await view(
            {
                query: 'pediatric',
                state: 'TX',
                city: 'Austin',
                work_mode: ['remote', 'hybrid'],
                job_type: ['full_time', 'per_diem'],
                specialty: 'pediatric',
                setting: 'telehealth',
                min_salary: 150000,
                posted_within: '7d',
                new_grad_friendly: true,
                max_years_required: 2,
            },
            3,
        );
        const url = new URL(result.browseUrl);
        expect(`${url.origin}${url.pathname}`).toBe(`${SITE}/jobs`);
        const params = url.searchParams;
        expect(params.get('q')).toBe('pediatric');
        expect(params.get('location')).toBe('Texas');
        expect(params.get('cityExact')).toBe('Austin');
        expect(params.getAll('workMode')).toEqual(['remote', 'hybrid']);
        expect(params.getAll('jobType')).toEqual(['Full-Time', 'Per Diem']);
        expect(params.getAll('specialty')).toEqual(['pediatric']);
        expect(params.get('category')).toBe('telehealth');
        expect(params.get('salaryMin')).toBe('150000');
        expect(params.get('postedWithin')).toBe('7d');
        expect(params.get('newGrad')).toBe('1');
        expect(params.get('minYears')).toBe('2');
    });

    it('browseUrl: an APRN role is the category; state "remote" is the work mode with no location', async () => {
        const aprn = new URL((await view({ specialty: 'midwifery' }, 1)).browseUrl);
        expect(aprn.searchParams.get('category')).toBe('midwifery');
        expect(aprn.searchParams.getAll('specialty')).toEqual([]);

        const remote = new URL((await view({ state: 'remote' }, 1)).browseUrl);
        expect(remote.searchParams.getAll('workMode')).toEqual(['remote']);
        expect(remote.searchParams.get('location')).toBeNull();
    });
});

describe("searchJobs: saved and applied state is the signed-in viewer's own", () => {
    it('a signed-out search asks for no saved or applied state, and shows none', async () => {
        const result = await searchJobs({}, null);
        if (typeof result === 'string') throw new Error(result);
        expect(h.savedFindMany).not.toHaveBeenCalled();
        expect(h.appFindMany).not.toHaveBeenCalled();
        expect(result.signedIn).toBe(false);
        for (const job of result.jobs) {
            expect(job.saved).toBeNull();
            expect(job.applicationStatus).toBeNull();
        }
    });

    it("a signed-in search reads only the viewer's rows, for the jobs shown", async () => {
        h.savedFindMany.mockResolvedValue([{ jobId: JOB_ID }]);
        h.appFindMany.mockResolvedValue([
            { jobId: JOB_ID_2, status: 'interview', withdrawnAt: null },
            { jobId: JOB_ID_3, status: 'screening', withdrawnAt: new Date('2026-10-25T00:00:00.000Z') },
        ]);
        const result = await searchJobs({}, CANDIDATE);
        if (typeof result === 'string') throw new Error(result);

        const ids = [JOB_ID, JOB_ID_2, JOB_ID_3];
        expect(h.savedFindMany).toHaveBeenCalledWith({ where: { userId: ME, jobId: { in: ids } }, select: { jobId: true } });
        expect(h.appFindMany).toHaveBeenCalledWith({
            where: { userId: ME, jobId: { in: ids } },
            select: { jobId: true, status: true, withdrawnAt: true },
        });
        expect(result.signedIn).toBe(true);
        expect(result.jobs.map((job) => [job.id, job.saved, job.applicationStatus])).toEqual([
            [JOB_ID, true, null],
            [JOB_ID_2, false, 'interview'],
            [JOB_ID_3, false, 'withdrawn'],
        ]);
    });
});

describe('searchJobs: the review sandbox', () => {
    beforeEach(() => {
        sandboxRows = [sandboxJobRow()];
    });

    it('a reviewer sees the matching sandbox jobs first on page 1, never linked to a site page', async () => {
        const result = await searchJobs({ state: 'TX' }, REVIEWER);
        if (typeof result === 'string') throw new Error(result);

        const sandbox = sandboxCall();
        expect(sandbox).toBeDefined();
        const main = mainCall();
        const [sandboxBase, ...sandboxExtra] = sandbox?.where.AND as Row[];
        const [mainBase, ...mainExtra] = main.where.AND as Row[];
        expect(sandboxBase).toEqual({ ...mainBase, isPublished: false, sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER });
        expect(sandboxExtra).toEqual(mainExtra);
        expect(sandbox).toMatchObject({ orderBy: { createdAt: 'asc' }, take: DEFAULT_PAGE_SIZE });

        expect(result.jobs[0]).toMatchObject({ id: SANDBOX_JOB_ID, sandbox: true, url: null });
        expect(result.jobs.slice(1).every((job) => !job.sandbox)).toBe(true);
        expect(result.total).toBe(mainRows.length + 1);
    });

    it('a page stays at most `limit` jobs long with the sandbox jobs in front', async () => {
        mainRows = Array.from({ length: 6 }, (_, i) => jobRow({ id: `00000000-0000-4000-8000-00000000000${i}` }));
        sandboxRows = [sandboxJobRow(), sandboxJobRow({ id: '5a5a5a5a-0000-4000-8000-000000000002' })];
        const result = await searchJobs({}, REVIEWER);
        if (typeof result === 'string') throw new Error(result);
        expect(result.jobs).toHaveLength(DEFAULT_PAGE_SIZE);
        expect(result.jobs.slice(0, 2).every((job) => job.sandbox)).toBe(true);
    });

    it('a reviewer gets no sandbox query on later pages', async () => {
        await searchJobs({ page: 2 }, REVIEWER);
        expect(h.jobFindMany).toHaveBeenCalledTimes(1);
        expect(sandboxCall()).toBeUndefined();
    });

    it.each([
        ['a signed-in candidate', CANDIDATE],
        ['a signed-out visitor', null],
    ])('%s never gets a sandbox query, and the listing stays published only', async (_label, viewer) => {
        const result = await searchJobs({}, viewer);
        if (typeof result === 'string') throw new Error(result);
        expect(h.jobFindMany).toHaveBeenCalledTimes(1);
        expect(sandboxCall()).toBeUndefined();
        expect((mainCall().where.AND as Row[])[0]).toMatchObject({ isPublished: true });
        expect(result.jobs.some((job) => job.sandbox)).toBe(false);
    });
});

// ── getJobDetail ────────────────────────────────────────────────────────────

describe('getJobDetail', () => {
    const findFirstWhere = (): Row => (h.jobFindFirst.mock.calls[0][0] as { where: Row }).where;

    async function detail(row: Row, viewer: McpViewer | null = null) {
        h.jobFindFirst.mockResolvedValue(row);
        const result = await getJobDetail(JOB_ID, viewer);
        if (!result) throw new Error('job not found');
        return result;
    }

    it('null for a job the query does not find, and no query for an argument that names no job', async () => {
        expect(await getJobDetail(JOB_ID, null)).toBeNull();
        h.jobFindFirst.mockClear();
        expect(await getJobDetail('not a job', null)).toBeNull();
        expect(h.jobFindFirst).not.toHaveBeenCalled();
    });

    it.each([
        ['a signed-out visitor', null],
        ['a signed-in candidate', CANDIDATE],
    ])('%s sees only a job the site lists: published, live and unexpired, never a sandbox job', async (_label, viewer) => {
        await getJobDetail(`${SITE}/jobs/fnp-${JOB_ID}/`, viewer);
        const where = findFirstWhere();
        expect(where).toMatchObject({ id: JOB_ID, isPublished: true });
        expect(where).toHaveProperty('healthConsecutiveMissing');
        expect(JSON.stringify(where)).toContain('"expiresAt"');
        expect(JSON.stringify(where)).not.toContain(REVIEW_SANDBOX_SOURCE_PROVIDER);
    });

    it('a reviewer may also see an unpublished sandbox job, and nothing else unpublished', async () => {
        await getJobDetail(JOB_ID, REVIEWER);
        const where = findFirstWhere();
        expect(where.id).toBe(JOB_ID);
        const branches = where.OR as Row[];
        expect(branches).toHaveLength(2);
        expect(branches[0]).toMatchObject({ isPublished: true });
        expect(branches[1]).toEqual({ isPublished: false, sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER });
    });

    it('turns the HTML description into plain text, scripts and all tags gone', async () => {
        const job = await detail(
            jobDetailRow({
                description:
                    '<p>Join our <strong>primary care</strong> team.</p><ul><li>Four day week</li><li>CME budget</li></ul><script>alert("x")</script>',
            }),
        );
        expect(job.description).not.toMatch(/<[^>]+>/);
        expect(job.description).not.toContain('alert');
        expect(job.description).toContain('Join our primary care team.');
        expect(job.description).toContain('• Four day week');
        expect(job.descriptionTruncated).toBe(false);
    });

    it(`clips a long description near ${DESCRIPTION_MAX} characters at a sentence or paragraph boundary`, async () => {
        const paragraphs = Array.from(
            { length: 120 },
            (_, i) => `<p>Paragraph ${i} describes the clinic schedule and the patient panel in plain words.</p>`,
        ).join('');
        const job = await detail(jobDetailRow({ description: paragraphs }));
        expect(job.descriptionTruncated).toBe(true);
        expect(job.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(job.description.length).toBeGreaterThan(DESCRIPTION_MAX * 0.6);
        expect(job.description.endsWith('.')).toBe(true);
    });

    it.each([
        ['easy_apply', { applyOnPlatform: true, applyLink: 'https://careers.northside.example/apply/1', sourceType: 'employer' }],
        ['none', { applyOnPlatform: false, applyLink: null, sourceType: 'aggregator' }],
        ['employer_site', { applyOnPlatform: false, applyLink: 'https://northside.example/apply/1', sourceType: 'employer' }],
        ['employer_site', { applyOnPlatform: false, applyLink: 'https://acme.myworkdayjobs.com/en-US/careers/job/1', sourceType: 'aggregator' }],
        ['external', { applyOnPlatform: false, applyLink: 'https://board.example/listing/1', sourceType: 'aggregator' }],
    ])('applyRoute %s, and the apply link itself is never in the result', async (route, columns) => {
        const job = await detail(jobDetailRow(columns));
        expect(job.applyRoute).toBe(route);
        expect(deepKeys(job)).not.toContain('applyLink');
        expect(deepKeys(job)).not.toContain('sourceType');
        if (columns.applyLink) expect(JSON.stringify(job)).not.toContain(columns.applyLink);
    });

    it('reports the other facts as stored and the date the content last changed', async () => {
        const job = await detail(jobDetailRow());
        expect(job).toMatchObject({
            id: JOB_ID,
            summary: 'Outpatient primary care role.',
            setting: 'Outpatient',
            population: 'Adults',
            benefits: ['Health insurance', 'CME allowance'],
            experienceNote: 'New grads with a residency welcome',
            screeningQuestionCount: 2,
            updatedAt: '2026-10-22T08:00:00.000Z',
            url: `${SITE}/jobs/family-nurse-practitioner-austin-tx-${JOB_ID}`,
            pay: '$120k to $140k/yr',
            saved: null,
            applicationStatus: null,
        });
        expect((await detail(jobDetailRow({ contentChangedAt: null }))).updatedAt).toBeNull();
    });

    it("a signed-in viewer sees their own saved and applied state on the job", async () => {
        h.savedFindMany.mockResolvedValue([{ jobId: JOB_ID }]);
        h.appFindMany.mockResolvedValue([{ jobId: JOB_ID, status: 'offered', withdrawnAt: null }]);
        const job = await detail(jobDetailRow(), CANDIDATE);
        expect(job).toMatchObject({ saved: true, applicationStatus: 'offered' });
        expect(h.savedFindMany.mock.calls[0][0]).toMatchObject({ where: { userId: ME } });
        expect(h.appFindMany.mock.calls[0][0]).toMatchObject({ where: { userId: ME } });
    });
});
