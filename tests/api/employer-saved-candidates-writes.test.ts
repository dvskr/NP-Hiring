/**
 * Saved candidates: rate limits and input bounds on the write routes
 * (review of finding EMP-SAVED-1).
 *
 * Only GET /api/employer/saved-candidates had a rate limit. POST stored a
 * note of any length. PATCH /note read the body with no catch (a malformed
 * body answered 500), checked none of its types, and wrote note and tags as
 * sent, so an object such as `tags: { push: 'x' }` reached Prisma as an
 * update operator and a list of any size was stored. DELETE and PATCH /note
 * looked the candidate up first and answered 'Candidate not found' for an id
 * that matches no profile, so their answers told an unknown id from a real
 * one.
 *
 * Pinned, through the real handlers:
 *   - POST, DELETE and PATCH /note each check their own rate limit first,
 *     and a refused request reads and writes nothing;
 *   - a note keeps at most 2000 characters, on POST and PATCH /note alike;
 *   - PATCH /note answers 400 and writes nothing for a malformed body, a
 *     candidateId or postingId that is not a string, a note that is not a
 *     string or null, and tags that are not a list of at most 50 strings of
 *     at most 50 characters;
 *   - what the Saved tab sends (a note, the full tag list, a posting id or
 *     none) is written as before;
 *   - DELETE and PATCH /note answer an unknown id exactly as they answer a
 *     candidate the caller has not saved, and still reach a saved row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    savedCandidate: {
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

import { POST as save, DELETE as unsave } from '@/app/api/employer/saved-candidates/route';
import { PATCH as saveNote } from '@/app/api/employer/saved-candidates/note/route';

// The global prisma fake has no savedCandidate model; these routes read and write it.
Object.assign(prisma, { savedCandidate: mocks.savedCandidate });

type Row = Record<string, unknown>;

/** A `where` as Prisma reads it here: scalar equality (null included) and a nested filter on a to-one relation. */
function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (condition === undefined) return true;
        const value = row[key];
        if (condition !== null && typeof condition === 'object') {
            return value !== null && typeof value === 'object' && matches(value as Row, condition as Row);
        }
        return value === condition;
    });
}

const EMPLOYER = { id: 'supabase-employer', email: 'hiring@clinic.example' };
const POOL = { role: 'job_seeker', profileVisible: true, openToOffers: true };

const PROFILES: readonly Row[] = [
    { id: 'profile-employer', supabaseId: EMPLOYER.id, role: 'employer', profileVisible: true, openToOffers: true },
    { id: 'profile-saved', supabaseId: 'seeker-saved', ...POOL },
    { id: 'profile-not-saved', supabaseId: 'seeker-not-saved', ...POOL },
];
const SAVED_SEEKER = PROFILES[1];

const SAVED: readonly Row[] = [
    {
        id: 'saved-general', employerId: 'profile-employer', candidateId: 'profile-saved', employerJobId: null,
        note: 'Strong fit', tags: ['Top pick'], candidate: SAVED_SEEKER,
    },
    {
        id: 'saved-under-posting', employerId: 'profile-employer', candidateId: 'profile-saved', employerJobId: 'posting-own',
        note: null, tags: [], candidate: SAVED_SEEKER,
    },
];

const NOTE_ERROR = 'note must be at most 2000 characters';
const TAGS_ERROR = 'tags must be a list of at most 50 tags, each at most 50 characters';

function wireStore(): void {
    const firstProfile = async (args: { where: Row }) => PROFILES.find((p) => matches(p, args.where)) ?? null;
    vi.mocked(prisma.userProfile.findUnique).mockImplementation(firstProfile as never);
    vi.mocked(prisma.userProfile.findFirst).mockImplementation(firstProfile as never);
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

function jsonRequest(method: string, path: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
        method,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
}

const patchNote = (body: unknown) => saveNote(jsonRequest('PATCH', '/api/employer/saved-candidates/note', body));

/** Every write the routes made to SavedCandidate, removals included. */
function writes(): unknown[][] {
    return [
        ...mocks.savedCandidate.upsert.mock.calls,
        ...mocks.savedCandidate.create.mock.calls,
        ...mocks.savedCandidate.update.mock.calls,
        ...mocks.savedCandidate.deleteMany.mock.calls,
    ];
}

/** The saved-row ids each DELETE selected, one list per call. */
function removedIds(): string[][] {
    return mocks.savedCandidate.deleteMany.mock.calls.map(([args]) =>
        SAVED.filter((s) => matches(s, (args as { where: Row }).where)).map((s) => s.id as string));
}

beforeEach(() => {
    vi.clearAllMocks();
    // A queued refusal must not outlive its test.
    vi.mocked(rateLimit).mockReset();
    vi.mocked(rateLimit).mockResolvedValue(null);
    wireStore();
    mocks.getUser.mockResolvedValue({ data: { user: EMPLOYER }, error: null });
});

describe('the write routes check their own rate limit first', () => {
    it.each([
        ['POST /api/employer/saved-candidates', 'employer:saved-candidates:save',
            () => save(jsonRequest('POST', '/api/employer/saved-candidates', { candidateId: 'seeker-not-saved' }))],
        ['DELETE /api/employer/saved-candidates', 'employer:saved-candidates:remove',
            () => unsave(jsonRequest('DELETE', '/api/employer/saved-candidates', { candidateId: 'seeker-saved' }))],
        ['PATCH /api/employer/saved-candidates/note', 'employer:saved-candidates:note',
            () => patchNote({ candidateId: 'seeker-saved', note: 'Call Tuesday' })],
    ])('%s answers 429 under its own key, and reads and writes nothing', async (_name, key, send) => {
        vi.mocked(rateLimit).mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));

        const res = await send();

        expect(res.status).toBe(429);
        expect(rateLimit).toHaveBeenCalledTimes(1);
        expect(rateLimit).toHaveBeenCalledWith(expect.any(NextRequest), key, RATE_LIMITS.employer);
        expect(mocks.getUser).not.toHaveBeenCalled();
        expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
        expect(mocks.savedCandidate.findFirst).not.toHaveBeenCalled();
        expect(writes()).toEqual([]);
    });
});

describe('POST /api/employer/saved-candidates: a note keeps at most 2000 characters', () => {
    it('answers 400 and writes nothing for a longer note', async () => {
        const res = await save(jsonRequest('POST', '/api/employer/saved-candidates', {
            candidateId: 'seeker-not-saved', note: 'n'.repeat(2001),
        }));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: NOTE_ERROR });
        expect(writes()).toEqual([]);
    });

    it('saves a note of exactly 2000 characters', async () => {
        const res = await save(jsonRequest('POST', '/api/employer/saved-candidates', {
            candidateId: 'seeker-not-saved', note: 'n'.repeat(2000),
        }));

        expect(res.status).toBe(201);
        expect(mocks.savedCandidate.create).toHaveBeenCalledWith({
            data: { employerId: 'profile-employer', candidateId: 'profile-not-saved', employerJobId: null, note: 'n'.repeat(2000) },
        });
    });
});

describe('PATCH /api/employer/saved-candidates/note: the body is checked before anything is read or written', () => {
    it('answers 400 for a body that is not JSON', async () => {
        const res = await saveNote(new NextRequest('http://localhost:3000/api/employer/saved-candidates/note', {
            method: 'PATCH',
            body: '{"candidateId":',
            headers: { 'Content-Type': 'application/json' },
        }));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
        expect(writes()).toEqual([]);
    });

    it.each([
        ['a candidateId that is an object', { candidateId: { not: 'x' }, note: 'x' }, 'candidateId is required'],
        ['a candidateId that is a number', { candidateId: 42, note: 'x' }, 'candidateId is required'],
        ['a postingId that is an object', { candidateId: 'seeker-saved', postingId: { not: null }, note: 'x' }, 'postingId must be a string'],
        ['a note that is an update operator', { candidateId: 'seeker-saved', note: { set: 'x' } }, 'note must be a string'],
        ['a note that is a number', { candidateId: 'seeker-saved', note: 5 }, 'note must be a string'],
        ['a note over 2000 characters', { candidateId: 'seeker-saved', note: 'n'.repeat(2001) }, NOTE_ERROR],
        ['tags that are an update operator', { candidateId: 'seeker-saved', tags: { push: 'x' } }, TAGS_ERROR],
        ['tags that are a string', { candidateId: 'seeker-saved', tags: 'Top pick' }, TAGS_ERROR],
        ['tags that are null', { candidateId: 'seeker-saved', tags: null }, TAGS_ERROR],
        ['a tag that is not a string', { candidateId: 'seeker-saved', tags: ['Top pick', 7] }, TAGS_ERROR],
        ['more than 50 tags', { candidateId: 'seeker-saved', tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }, TAGS_ERROR],
        ['a tag over 50 characters', { candidateId: 'seeker-saved', tags: ['t'.repeat(51)] }, TAGS_ERROR],
    ])('answers 400 and writes nothing for %s', async (_label, body, error) => {
        const res = await patchNote(body);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error });
        expect(mocks.savedCandidate.findFirst).not.toHaveBeenCalled();
        expect(writes()).toEqual([]);
    });
});

describe('PATCH /api/employer/saved-candidates/note: what the Saved tab sends is written as before', () => {
    it('writes a note on a save with no posting', async () => {
        const res = await patchNote({ candidateId: 'seeker-saved', note: 'Call Tuesday' });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, note: 'Call Tuesday', tags: ['Top pick'] });
        expect(mocks.savedCandidate.update).toHaveBeenCalledWith({ where: { id: 'saved-general' }, data: { note: 'Call Tuesday' } });
    });

    it.each([['an empty note', ''], ['a null note', null]])('clears the note for %s', async (_label, note) => {
        const res = await patchNote({ candidateId: 'seeker-saved', note });

        expect(res.status).toBe(200);
        expect(mocks.savedCandidate.update).toHaveBeenCalledWith({ where: { id: 'saved-general' }, data: { note: null } });
    });

    it('writes the full tag list, up to 50 tags of 50 characters each', async () => {
        const tags = Array.from({ length: 50 }, (_, i) => `${i}`.padStart(50, 't'));

        const res = await patchNote({ candidateId: 'seeker-saved', tags });

        expect(res.status).toBe(200);
        expect(mocks.savedCandidate.update).toHaveBeenCalledWith({ where: { id: 'saved-general' }, data: { tags } });
    });

    it('reaches a save under a posting by its id, and reads a null postingId as no posting', async () => {
        await patchNote({ candidateId: 'seeker-saved', postingId: 'posting-own', tags: ['Interviewing'] });
        await patchNote({ candidateId: 'seeker-saved', postingId: null, tags: [] });

        expect(mocks.savedCandidate.update.mock.calls.map(([args]) => args)).toEqual([
            { where: { id: 'saved-under-posting' }, data: { tags: ['Interviewing'] } },
            { where: { id: 'saved-general' }, data: { tags: [] } },
        ]);
    });
});

describe('DELETE and PATCH /note answer an unknown id as they answer a candidate the caller has not saved', () => {
    it('PATCH /note answers the same 404 for both, and writes nothing', async () => {
        const unknown = await patchNote({ candidateId: 'no-such-profile', note: 'x' });
        const notSaved = await patchNote({ candidateId: 'seeker-not-saved', note: 'x' });

        expect([unknown.status, await unknown.json()]).toEqual([404, { error: 'Candidate not saved' }]);
        expect([notSaved.status, await notSaved.json()]).toEqual([404, { error: 'Candidate not saved' }]);
        expect(writes()).toEqual([]);
    });

    it('DELETE answers the same 200 for both, and removes nothing', async () => {
        const unknown = await unsave(jsonRequest('DELETE', '/api/employer/saved-candidates', { candidateId: 'no-such-profile' }));
        const notSaved = await unsave(jsonRequest('DELETE', '/api/employer/saved-candidates', { candidateId: 'seeker-not-saved' }));

        expect([unknown.status, await unknown.json()]).toEqual([200, { success: true }]);
        expect([notSaved.status, await notSaved.json()]).toEqual([200, { success: true }]);
        expect(removedIds()).toEqual([[], []]);
    });

    it('DELETE still removes the caller\'s saved row, with or without its posting', async () => {
        await unsave(jsonRequest('DELETE', '/api/employer/saved-candidates', { candidateId: 'seeker-saved' }));
        await unsave(jsonRequest('DELETE', '/api/employer/saved-candidates', { candidateId: 'seeker-saved', postingId: 'posting-own' }));

        expect(removedIds()).toEqual([['saved-general'], ['saved-under-posting']]);
    });
});
