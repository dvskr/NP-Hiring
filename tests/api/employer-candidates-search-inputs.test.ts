/**
 * GET /api/employer/candidates: paging and the search inputs (finding EMP-CAND-1).
 *
 * page and limit went through parseInt and Math.max(1, ...), and Math.max
 * keeps NaN, so ?page=abc or ?limit=abc reached Prisma as a NaN skip or take
 * and the talent pool search answered 500; a huge page overflowed skip the
 * same way. The route now parses them with the public job search's parser
 * (app/api/jobs/pagination.ts), which has this route's defaults.
 *
 * The specialties and states filters turned every comma-separated term into
 * its own case-insensitive `contains` branch with no cap on the count, and q,
 * matched against nine columns, had no length cap, so one request could carry
 * thousands of pattern matches for every candidate row, twice (the page and
 * the count). workMode and experience were unbounded the same way.
 *
 * Pinned, through the real handler:
 *   - a page or limit that is not a positive whole number (or is too large to
 *     be a safe integer) falls back to page 1 and 20 per page, limit stays at
 *     most 50 and page at most 100,000;
 *   - each list filter keeps its first 60 terms, each term and workMode keep
 *     100 characters, q keeps 200, and experience is a whole number of at most
 *     100 years;
 *   - what the talent pool page sends (a page, 20 per page, every specialty
 *     preset, all 51 states, a typed query, a work mode, an experience level)
 *     reaches the query unchanged;
 *   - the pool gate stays on both queries whatever the inputs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEmployerActivePostings, getEmployerTier } from '@/lib/tier-limits';
import { SPECIALTY_PRESETS } from '@/config/niche/credentials';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), count: vi.fn() }));

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

import { GET as searchCandidates } from '@/app/api/employer/candidates/route';

// The global prisma fake has no userProfile.count; the route counts the matches.
Object.assign(prisma.userProfile, { count: mocks.count });

/** The states the talent pool page offers (components/employer/CandidateSearchClient.tsx). */
const US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

const POOL_GATE = { profileVisible: true, openToOffers: true, role: 'job_seeker', deletedAt: null };

type Where = Record<string, unknown> & {
    OR?: Record<string, { contains: string }>[];
    AND?: { OR: Record<string, { contains: string }>[] }[];
};
interface FindManyArgs { where: Where; skip: number; take: number }

/**
 * Prisma refuses a skip or take that is not a whole number in range; that
 * refusal is the 500 the route used to answer. The fake refuses the same way.
 */
function refuseLikePrisma(args: { skip?: unknown; take?: unknown }): void {
    for (const key of ['skip', 'take'] as const) {
        const value = args[key];
        if (value !== undefined && !(Number.isSafeInteger(value) && (value as number) >= 0)) {
            throw new Error(`Invalid value for argument \`${key}\`: ${String(value)}`);
        }
    }
}

function signedIn(): void {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'supabase-employer', email: 'hiring@clinic.example' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'employer' } as never);
    vi.mocked(getEmployerTier).mockResolvedValue('pro' as never);
    vi.mocked(getEmployerActivePostings).mockResolvedValue([{ id: 'posting-1' }] as never);
    vi.mocked(prisma.userProfile.findMany).mockImplementation((async (args: FindManyArgs) => {
        refuseLikePrisma(args);
        return [];
    }) as never);
    mocks.count.mockResolvedValue(95);
    vi.mocked(prisma.profileView.findMany).mockResolvedValue([] as never);
}

async function search(query: string): Promise<{ status: number; body: Record<string, unknown>; args: FindManyArgs }> {
    const res = await searchCandidates(new NextRequest(`http://localhost:3000/api/employer/candidates?${query}`));
    const body = (await res.json()) as Record<string, unknown>;
    expect(vi.mocked(prisma.userProfile.findMany), 'one page query').toHaveBeenCalledTimes(1);
    const [args] = vi.mocked(prisma.userProfile.findMany).mock.calls[0] as unknown as [FindManyArgs];
    return { status: res.status, body, args };
}

/** The terms of the list filter on `field`, in the order the query carries them. */
function termsOf(where: Where, field: 'specialties' | 'licenseStates'): string[] {
    const branch = (where.AND ?? []).find((clause) => clause.OR.some((term) => field in term));
    return branch ? branch.OR.map((term) => term[field].contains) : [];
}

function manyTerms(count: number, prefix: string): string {
    return Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(',');
}

beforeEach(() => {
    vi.clearAllMocks();
    signedIn();
});

describe('GET /api/employer/candidates: page and limit are whole numbers Prisma accepts', () => {
    it.each(['page=abc', 'page=NaN', 'page=%20'])('falls back to page 1 for %s instead of a NaN skip', async (query) => {
        const { status, body, args } = await search(query);

        expect(status).toBe(200);
        expect(args.skip).toBe(0);
        expect(args.take).toBe(20);
        expect(body.page).toBe(1);
        expect(body.totalPages).toBe(5);
    });

    it.each(['limit=abc', 'limit=NaN', 'page=2&limit=abc'])('falls back to 20 per page for %s instead of a NaN take', async (query) => {
        const { status, args } = await search(query);

        expect(status).toBe(200);
        expect(args.take).toBe(20);
        expect(args.skip % 20).toBe(0);
    });

    it('holds a huge page inside the range of skip', async () => {
        // Above 100,000 a page is the last one the parser allows; too large
        // to be a safe integer it is junk, and junk is page 1.
        const clamped = await search('page=5000000');
        expect(clamped.status).toBe(200);
        expect(clamped.body.page).toBe(100_000);
        expect(clamped.args.skip).toBe(99_999 * 20);

        vi.mocked(prisma.userProfile.findMany).mockClear();
        const unsafe = await search('page=1000000000000000000');
        expect(unsafe.status).toBe(200);
        expect(unsafe.body.page).toBe(1);
        expect(unsafe.args.skip).toBe(0);
    });

    it('keeps limit at 50 or under', async () => {
        const { args } = await search('limit=5000');

        expect(args.take).toBe(50);
    });

    it('keeps the page and limit the talent pool page sends', async () => {
        const { status, body, args } = await search('page=3&limit=20');

        expect(status).toBe(200);
        expect(args.skip).toBe(40);
        expect(args.take).toBe(20);
        expect(body.page).toBe(3);
        expect(body.totalPages).toBe(5);
    });
});

describe('GET /api/employer/candidates: the list filters are bounded', () => {
    it('keeps the first 60 specialty terms of a longer list', async () => {
        const { args } = await search(`specialties=${encodeURIComponent(manyTerms(5000, 's'))}`);

        expect(termsOf(args.where, 'specialties')).toEqual(Array.from({ length: 60 }, (_, i) => `s${i}`));
    });

    it('keeps the first 60 state terms of a longer list', async () => {
        const { args } = await search(`states=${encodeURIComponent(manyTerms(5000, 'x'))}`);

        expect(termsOf(args.where, 'licenseStates')).toEqual(Array.from({ length: 60 }, (_, i) => `x${i}`));
    });

    it('keeps 100 characters of an overlong term', async () => {
        const { args } = await search(`specialties=${'a'.repeat(5000)},Oncology`);

        expect(termsOf(args.where, 'specialties')).toEqual(['a'.repeat(100), 'Oncology']);
    });

    it('passes every specialty preset and all 51 states through unchanged', async () => {
        const params = new URLSearchParams({
            specialties: SPECIALTY_PRESETS.join(','),
            states: US_STATES.join(','),
        });

        const { args } = await search(params.toString());

        expect(termsOf(args.where, 'specialties')).toEqual([...SPECIALTY_PRESETS]);
        expect(termsOf(args.where, 'licenseStates')).toEqual(US_STATES);
    });
});

describe('GET /api/employer/candidates: the text inputs are bounded', () => {
    it('matches the first 200 characters of an overlong q across all nine columns', async () => {
        const { args } = await search(`q=${'b'.repeat(10_000)}`);

        expect(args.where.OR).toHaveLength(9);
        for (const branch of args.where.OR ?? []) {
            expect(Object.values(branch)[0].contains).toBe('b'.repeat(200));
        }
    });

    it('matches a typed query unchanged', async () => {
        const { args } = await search(`q=${encodeURIComponent('  telehealth FNP  ')}`);

        expect((args.where.OR ?? []).map((branch) => Object.values(branch)[0].contains)).toEqual(Array(9).fill('telehealth FNP'));
    });

    it('keeps 100 characters of an overlong workMode, and a real one unchanged', async () => {
        expect((await search(`workMode=${'w'.repeat(5000)}`)).args.where.preferredWorkMode).toEqual({
            contains: 'w'.repeat(100),
            mode: 'insensitive',
        });

        vi.mocked(prisma.userProfile.findMany).mockClear();
        expect((await search('workMode=Telehealth')).args.where.preferredWorkMode).toEqual({
            contains: 'Telehealth',
            mode: 'insensitive',
        });
    });

    it('takes experience as a whole number of years, at most 100', async () => {
        const cases: [string, unknown][] = [
            ['0', { gte: 0 }],
            ['3', { gte: 3 }],
            ['20', { gte: 20 }],
            ['99999999999', { gte: 100 }],
            ['abc', undefined],
            ['-5', undefined],
            ['2.5', undefined],
        ];
        for (const [experience, expected] of cases) {
            vi.mocked(prisma.userProfile.findMany).mockClear();
            const { status, args } = await search(`experience=${experience}`);
            expect(status, `experience=${experience}`).toBe(200);
            expect(args.where.yearsExperience, `experience=${experience}`).toEqual(expected);
        }
    });
});

describe('GET /api/employer/candidates: the pool gate', () => {
    it('stays on the page query and the count whatever the inputs', async () => {
        const { args } = await search([
            'page=abc',
            'limit=abc',
            `q=${'q'.repeat(500)}`,
            `specialties=${manyTerms(200, 's')}`,
            `states=${manyTerms(200, 'x')}`,
            'workMode=Remote',
            'hasResume=true',
            'experience=3',
        ].join('&'));

        expect(args.where).toMatchObject(POOL_GATE);
        const [countArgs] = mocks.count.mock.calls[0] as [{ where: Where }];
        expect(countArgs.where).toBe(args.where);
    });
});
