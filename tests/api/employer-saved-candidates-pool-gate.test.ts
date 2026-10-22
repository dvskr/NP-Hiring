/**
 * Saved candidates and the talent pool gate (finding EMP-SAVED-1).
 *
 * Every other employer read of a candidate (the candidate list, the candidate
 * page, the resume download, bulk unlock and AI search) serves a profile only
 * while it is a job seeker's, visible to employers and open to offers. The
 * saved list did not:
 *   - POST saved any profile id that existed: a hidden or deleted seeker,
 *     another employer, an admin;
 *   - GET returned the card of every saved profile whatever its flags, so a
 *     seeker who hid the profile, closed it to offers or deleted the account
 *     (the soft delete clears both flags) stayed on the employer's Saved tab,
 *     later edits included;
 *   - POST wrote any EmployerJob id as the posting, owned or not.
 *
 * Pinned, through the real handlers, against an in-memory store whose fake
 * Prisma reads apply `where` the way Prisma does for these shapes:
 *   - POST saves a pool member, and answers 404 writing nothing for a hidden,
 *     closed, deleted or non-seeker profile, the same 404 as an unknown id;
 *   - POST saves under a posting the caller owns (claimed, or an unclaimed
 *     legacy row under the sign-in email) and answers 404 writing nothing for
 *     another employer's posting or one that does not exist;
 *   - GET lists pool members only, with and without ?postingId=, for an
 *     employer and an admin alike, and never another employer's rows;
 *   - GET shows a posting's title only for the caller's own postings (claimed,
 *     or legacy under the sign-in email), so a save that named another
 *     employer's posting before the posting check no longer shows its title;
 *     the posting id the caller sent stays, so the row can still be removed;
 *   - DELETE and PATCH /note still reach a saved row whose candidate left the
 *     pool, so the employer can remove or annotate it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEmployerActivePostings, getEmployerTier } from '@/lib/tier-limits';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    savedCandidate: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
    },
}));

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
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET as listSaved, POST as save, DELETE as unsave } from '@/app/api/employer/saved-candidates/route';
import { PATCH as saveNote } from '@/app/api/employer/saved-candidates/note/route';

// The global prisma fake has no savedCandidate model; these routes read and write it.
Object.assign(prisma, { savedCandidate: mocks.savedCandidate });

type Row = Record<string, unknown>;

/**
 * A `where` as Prisma reads it for these routes: scalar equality (null
 * included), an `in` list, a nested filter on a to-one relation (bare or
 * under `is`), and OR / AND branches. An undefined condition is no
 * condition, as in Prisma.
 */
function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (condition === undefined) return true;
        if (key === 'OR') return (condition as Row[]).some((branch) => matches(row, branch));
        if (key === 'AND') return (condition as Row[]).every((branch) => matches(row, branch));
        if (key === 'is') return matches(row, condition as Row);
        const value = row[key];
        if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
            const { in: oneOf } = condition as { in?: unknown };
            if (Array.isArray(oneOf)) return oneOf.includes(value);
            return value !== null && typeof value === 'object' && matches(value as Row, condition as Row);
        }
        return value === condition;
    });
}

// The legacy email branch needs a confirmed email (register 2.26).
const CONFIRMED = '2026-01-15T10:00:00.000Z';
const EMPLOYER = { id: 'supabase-employer', email: 'hiring@clinic.example', email_confirmed_at: CONFIRMED };
const ADMIN = { id: 'supabase-admin', email: 'admin@board.example', email_confirmed_at: CONFIRMED };
const OTHER_EMPLOYER_ID = 'supabase-other-employer';

function profile(id: string, supabaseId: string, role: string, firstName: string, flags: Row): Row {
    return {
        id,
        supabaseId,
        role,
        firstName,
        lastName: 'Example',
        avatarUrl: null,
        headline: 'Nurse practitioner',
        yearsExperience: 6,
        specialties: 'Family Practice (FNP)',
        preferredWorkMode: 'Remote',
        certifications: 'FNP-BC',
        licenseStates: 'CA,OR',
        desiredSalaryMin: 150000,
        desiredSalaryMax: 170000,
        desiredSalaryType: 'annual',
        availableDate: null,
        resumeUrl: null,
        bio: null,
        preferredJobType: null,
        state: 'CA',
        city: 'Fresno',
        deletedAt: null,
        ...flags,
    };
}

const OPEN = { profileVisible: true, openToOffers: true };

const PROFILES = {
    employer: profile('profile-employer', EMPLOYER.id, 'employer', 'Ada', OPEN),
    admin: profile('profile-admin', ADMIN.id, 'admin', 'Grace', OPEN),
    inPool: profile('profile-in-pool', 'seeker-in-pool', 'job_seeker', 'Mary', OPEN),
    neverSaved: profile('profile-never-saved', 'seeker-never-saved', 'job_seeker', 'Nora', OPEN),
    hidden: profile('profile-hidden', 'seeker-hidden', 'job_seeker', 'Hana', { profileVisible: false, openToOffers: true }),
    closed: profile('profile-closed', 'seeker-closed', 'job_seeker', 'Cleo', { profileVisible: true, openToOffers: false }),
    // The soft delete clears both flags for its 30 day grace period (app/api/auth/delete-account).
    deleted: profile('profile-deleted', 'seeker-deleted', 'job_seeker', 'Dana', {
        profileVisible: false,
        openToOffers: false,
        deletedAt: new Date('2026-10-01T00:00:00Z'),
    }),
    // Deleted with both flags still on: only the deletion check of the shared
    // pool rule (lib/candidate-pool.ts, register 2.26) keeps it out.
    deletedFlagsOn: profile('profile-deleted-flags-on', 'seeker-deleted-flags-on', 'job_seeker', 'Eve', {
        ...OPEN,
        deletedAt: new Date('2026-10-01T00:00:00Z'),
    }),
    // Employer accounts keep the schema defaults for both flags, so only the role keeps them out.
    otherEmployer: profile('profile-other-employer', OTHER_EMPLOYER_ID, 'employer', 'Otto', OPEN),
};
const ALL_PROFILES: readonly Row[] = Object.values(PROFILES);

const POSTINGS = {
    own: { id: 'posting-own', userId: EMPLOYER.id, contactEmail: EMPLOYER.email, job: { title: 'FNP, Clinic A' } },
    // Unclaimed, posted before accounts were linked, under the caller's sign-in email: still the caller's.
    legacy: { id: 'posting-legacy', userId: null, contactEmail: EMPLOYER.email, job: { title: 'AGNP, Clinic B' } },
    foreign: { id: 'posting-foreign', userId: OTHER_EMPLOYER_ID, contactEmail: 'talent@other.example', job: { title: 'Confidential search' } },
};
const ALL_POSTINGS: readonly Row[] = Object.values(POSTINGS);

function savedRow(id: string, employerId: string, candidate: Row, employerJob: Row | null): Row {
    return {
        id,
        employerId,
        candidateId: candidate.id,
        employerJobId: employerJob ? employerJob.id : null,
        note: null,
        tags: [],
        savedAt: new Date('2026-10-02T12:00:00Z'),
        candidate,
        employerJob,
    };
}

const SAVED: readonly Row[] = [
    savedRow('saved-in-pool', 'profile-employer', PROFILES.inPool, null),
    savedRow('saved-hidden', 'profile-employer', PROFILES.hidden, null),
    savedRow('saved-closed', 'profile-employer', PROFILES.closed, null),
    savedRow('saved-deleted', 'profile-employer', PROFILES.deleted, null),
    savedRow('saved-deleted-flags-on', 'profile-employer', PROFILES.deletedFlagsOn, null),
    savedRow('saved-other-employer', 'profile-employer', PROFILES.otherEmployer, null),
    savedRow('saved-in-pool-posting', 'profile-employer', PROFILES.inPool, POSTINGS.own),
    savedRow('saved-hidden-posting', 'profile-employer', PROFILES.hidden, POSTINGS.own),
    savedRow('saved-by-admin', 'profile-admin', PROFILES.inPool, null),
    savedRow('saved-hidden-by-admin', 'profile-admin', PROFILES.hidden, null),
    savedRow('saved-by-another-employer', 'profile-other-employer', PROFILES.inPool, null),
];

function wireStore(): void {
    const firstProfile = async (args: { where: Row }) => ALL_PROFILES.find((p) => matches(p, args.where)) ?? null;
    vi.mocked(prisma.userProfile.findUnique).mockImplementation(firstProfile as never);
    vi.mocked(prisma.userProfile.findFirst).mockImplementation(firstProfile as never);
    vi.mocked(prisma.employerJob.findFirst).mockImplementation((async (args: { where: Row }) =>
        ALL_POSTINGS.find((j) => matches(j, args.where)) ?? null) as never);
    vi.mocked(prisma.employerJob.findMany).mockImplementation((async (args: { where: Row }) =>
        ALL_POSTINGS.filter((j) => matches(j, args.where))) as never);
    vi.mocked(prisma.profileView.findMany).mockResolvedValue([] as never);
    vi.mocked(getEmployerTier).mockResolvedValue('pro' as never);
    vi.mocked(getEmployerActivePostings).mockResolvedValue([{ id: POSTINGS.own.id }] as never);

    mocks.savedCandidate.findMany.mockImplementation(async (args: { where: Row }) => SAVED.filter((s) => matches(s, args.where)));
    mocks.savedCandidate.findFirst.mockImplementation(async (args: { where: Row }) => SAVED.find((s) => matches(s, args.where)) ?? null);
    mocks.savedCandidate.upsert.mockImplementation(async () => ({ id: 'saved-upserted' }));
    mocks.savedCandidate.create.mockImplementation(async (args: { data: Row }) => ({ id: 'saved-created', ...args.data }));
    mocks.savedCandidate.update.mockImplementation(async (args: { where: { id: string }; data: Row }) => ({
        ...SAVED.find((s) => s.id === args.where.id),
        ...args.data,
    }));
    mocks.savedCandidate.deleteMany.mockImplementation(async (args: { where: Row }) => ({
        count: SAVED.filter((s) => matches(s, args.where)).length,
    }));
}

function signIn(user: { id: string; email?: string }): void {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
}

function jsonRequest(method: string, path: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
        method,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
}

function getRequest(path: string): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`);
}

/** Every write the routes made to SavedCandidate. */
function writes(): unknown[][] {
    return [
        ...mocks.savedCandidate.upsert.mock.calls,
        ...mocks.savedCandidate.create.mock.calls,
        ...mocks.savedCandidate.update.mock.calls,
        ...mocks.savedCandidate.deleteMany.mock.calls,
    ];
}

/** The saved-row ids GET returned. */
async function listedIds(res: Response): Promise<string[]> {
    expect(res.status).toBe(200);
    const body = (await res.json()) as { savedCandidates: { id: string }[] };
    return body.savedCandidates.map((s) => s.id).sort();
}

beforeEach(() => {
    vi.clearAllMocks();
    wireStore();
    signIn(EMPLOYER);
});

describe('POST /api/employer/saved-candidates: only a talent pool member can be saved', () => {
    it('saves a job seeker who is visible and open to offers', async () => {
        const res = await save(jsonRequest('POST', '/api/employer/saved-candidates', { candidateId: 'seeker-never-saved' }));

        expect(res.status).toBe(201);
        expect(mocks.savedCandidate.create).toHaveBeenCalledWith({
            data: { employerId: 'profile-employer', candidateId: 'profile-never-saved', employerJobId: null, note: null },
        });
    });

    it.each([
        ['hidden from employers', 'seeker-hidden'],
        ['closed to offers', 'seeker-closed'],
        ['deleted (both flags cleared)', 'seeker-deleted'],
        ['deleted with both flags still on', 'seeker-deleted-flags-on'],
        ['another employer', OTHER_EMPLOYER_ID],
        ['an admin', ADMIN.id],
    ])('answers 404 and writes nothing for a profile that is %s', async (_label, candidateId) => {
        const res = await save(jsonRequest('POST', '/api/employer/saved-candidates', { candidateId }));

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Candidate not found' });
        expect(writes()).toEqual([]);
    });

    it('answers the same 404 for an id that matches no profile', async () => {
        const res = await save(jsonRequest('POST', '/api/employer/saved-candidates', { candidateId: 'no-such-profile' }));

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Candidate not found' });
        expect(writes()).toEqual([]);
    });
});

describe('POST /api/employer/saved-candidates: the posting must be one of the caller\'s own', () => {
    it('saves under a posting the caller owns', async () => {
        const res = await save(jsonRequest('POST', '/api/employer/saved-candidates', {
            candidateId: 'seeker-in-pool', postingId: POSTINGS.own.id,
        }));

        expect(res.status).toBe(201);
        expect(mocks.savedCandidate.upsert).toHaveBeenCalledTimes(1);
        expect(mocks.savedCandidate.upsert.mock.calls[0][0]).toMatchObject({
            create: { employerId: 'profile-employer', candidateId: 'profile-in-pool', employerJobId: POSTINGS.own.id },
        });
    });

    it('saves under an unclaimed legacy posting filed under the caller\'s sign-in email', async () => {
        const res = await save(jsonRequest('POST', '/api/employer/saved-candidates', {
            candidateId: 'seeker-in-pool', postingId: POSTINGS.legacy.id,
        }));

        expect(res.status).toBe(201);
        expect(mocks.savedCandidate.upsert.mock.calls[0][0]).toMatchObject({
            create: { employerJobId: POSTINGS.legacy.id },
        });
    });

    it.each([
        ['another employer\'s posting', POSTINGS.foreign.id],
        ['a posting that does not exist', 'posting-missing'],
    ])('answers 404 and writes nothing for %s', async (_label, postingId) => {
        const res = await save(jsonRequest('POST', '/api/employer/saved-candidates', {
            candidateId: 'seeker-in-pool', postingId,
        }));

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Posting not found' });
        expect(writes()).toEqual([]);
    });
});

describe('GET /api/employer/saved-candidates: the list holds talent pool members only', () => {
    it('drops a candidate who hid the profile, closed it to offers, deleted the account or is not a job seeker', async () => {
        const ids = await listedIds(await listSaved(getRequest('/api/employer/saved-candidates')));

        expect(ids).toEqual(['saved-in-pool', 'saved-in-pool-posting']);
    });

    it('applies the same gate under a posting filter', async () => {
        const ids = await listedIds(await listSaved(getRequest(`/api/employer/saved-candidates?postingId=${POSTINGS.own.id}`)));

        expect(ids).toEqual(['saved-in-pool-posting']);
    });

    it('applies the gate to an admin\'s list too, as the candidate list does', async () => {
        signIn(ADMIN);

        const ids = await listedIds(await listSaved(getRequest('/api/employer/saved-candidates')));

        expect(ids).toEqual(['saved-by-admin']);
    });

    it('reads the caller\'s own rows only', async () => {
        await listSaved(getRequest('/api/employer/saved-candidates'));

        const [args] = mocks.savedCandidate.findMany.mock.calls[0] as [{ where: Row }];
        expect(args.where).toMatchObject({ employerId: 'profile-employer' });
    });
});

/**
 * Saves of a pool member under a legacy posting of the caller's, and under
 * another employer's posting: a save could name any posting before the
 * posting check, so rows like the second can already exist.
 */
const POSTING_SAVES: readonly Row[] = [
    savedRow('saved-under-legacy-posting', 'profile-employer', PROFILES.inPool, POSTINGS.legacy),
    savedRow('saved-under-foreign-posting', 'profile-employer', PROFILES.inPool, POSTINGS.foreign),
];

describe('GET /api/employer/saved-candidates: a posting title shows only for the caller\'s own postings', () => {
    const store = (): Row[] => [...SAVED, ...POSTING_SAVES];

    beforeEach(() => {
        mocks.savedCandidate.findMany.mockImplementation(async (args: { where: Row }) => store().filter((s) => matches(s, args.where)));
        mocks.savedCandidate.deleteMany.mockImplementation(async (args: { where: Row }) => ({
            count: store().filter((s) => matches(s, args.where)).length,
        }));
    });

    /** The posting each listed saved row carries, by saved-row id. */
    async function postingsListed(): Promise<Record<string, { postingId: unknown; postingTitle: unknown }>> {
        const res = await listSaved(getRequest('/api/employer/saved-candidates'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { savedCandidates: { id: string; postingId: unknown; postingTitle: unknown }[] };
        return Object.fromEntries(body.savedCandidates.map((s) => [s.id, { postingId: s.postingId, postingTitle: s.postingTitle }]));
    }

    it('shows the title of a posting the caller owns, claimed or legacy, and none on a save with no posting', async () => {
        const listed = await postingsListed();

        expect(listed['saved-in-pool-posting']).toEqual({ postingId: POSTINGS.own.id, postingTitle: 'FNP, Clinic A' });
        expect(listed['saved-under-legacy-posting']).toEqual({ postingId: POSTINGS.legacy.id, postingTitle: 'AGNP, Clinic B' });
        expect(listed['saved-in-pool']).toEqual({ postingId: null, postingTitle: null });
    });

    it('leaves out the title of another employer\'s posting, and keeps the posting id the caller sent', async () => {
        const listed = await postingsListed();

        expect(listed['saved-under-foreign-posting']).toEqual({ postingId: POSTINGS.foreign.id, postingTitle: null });
    });

    it('leaves out a legacy posting\'s title for a session without an email, as every ownership check does', async () => {
        signIn({ id: EMPLOYER.id });

        const listed = await postingsListed();

        expect(listed['saved-in-pool-posting'].postingTitle).toBe('FNP, Clinic A');
        expect(listed['saved-under-legacy-posting'].postingTitle).toBeNull();
    });

    it('still lets the Saved tab remove that row by the posting id it was given', async () => {
        const res = await unsave(jsonRequest('DELETE', '/api/employer/saved-candidates', {
            candidateId: 'seeker-in-pool', postingId: POSTINGS.foreign.id,
        }));

        expect(res.status).toBe(200);
        const [args] = mocks.savedCandidate.deleteMany.mock.calls[0] as [{ where: Row }];
        expect(store().filter((s) => matches(s, args.where)).map((s) => s.id)).toEqual(['saved-under-foreign-posting']);
    });
});

describe('DELETE and PATCH /note: a row whose candidate left the pool can still be removed or annotated', () => {
    it('DELETE removes the saved row of a hidden candidate', async () => {
        const res = await unsave(jsonRequest('DELETE', '/api/employer/saved-candidates', { candidateId: 'seeker-hidden' }));

        expect(res.status).toBe(200);
        expect(mocks.savedCandidate.deleteMany).toHaveBeenCalledTimes(1);
        const [args] = mocks.savedCandidate.deleteMany.mock.calls[0] as [{ where: Row }];
        expect(SAVED.filter((s) => matches(s, args.where)).map((s) => s.id)).toEqual(['saved-hidden']);
    });

    it('PATCH /note updates the note on the saved row of a hidden candidate', async () => {
        const res = await saveNote(jsonRequest('PATCH', '/api/employer/saved-candidates/note', {
            candidateId: 'seeker-hidden', note: 'Follow up in November',
        }));

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, note: 'Follow up in November', tags: [] });
        expect(mocks.savedCandidate.update).toHaveBeenCalledWith({
            where: { id: 'saved-hidden' },
            data: { note: 'Follow up in November' },
        });
    });
});
