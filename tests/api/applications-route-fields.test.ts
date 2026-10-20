/**
 * GET, POST and DELETE /api/applications (app/api/applications/route.ts).
 *
 * APP-1: GET returned each JobApplication row whole (`include` with no
 * `select`), so a candidate could read what the employer privately wrote
 * about them (`notes`, which also carries the auto-reject reason) and the
 * employer-side AI assessment (aiMatchScore, aiMatchReasons, aiMissingItems)
 * on every job they applied to.
 *
 * APP-3: POST stored `sourceUrl || null`, so any JSON value reached the
 * insert: a string as large as the request body limit was written to
 * job_applications.source_url, and a number, an object or a NUL character
 * made Prisma or Postgres throw, which answered 500.
 *
 * Review follow-ups: DELETE parsed its body unguarded, so invalid JSON or
 * JSON null answered 500, and it had no rate limit, so a caller could
 * delete and log the same rows again without bound. A jobId was checked for
 * type only: a NUL or an over-long id reached the query, and a lost insert
 * race between two POSTs for one job, or a job id that names no job (a
 * deleted job left in a visitor's applied history), answered 500.
 *
 * Pinned:
 *   - GET answers only the candidate allowlist. The Prisma fake projects a
 *     fully populated row through the query args the way Prisma does, so a
 *     whole-row `include` fails here instead of passing on a canned row;
 *   - every field the candidate's own pages read is still returned, taken
 *     from the types the pages give the response, where TypeScript puts
 *     every field they read whatever the variables are called. The /saved
 *     "Clear history" partition decides from these fields which rows it may
 *     hard-delete, so a field dropped from the select could delete a
 *     submitted application;
 *   - POST keeps a trimmed string of at most 2,048 characters with no
 *     control characters, stores null for anything else, never rewrites an
 *     existing row, and answers 400 for a body that is not a JSON object;
 *   - POST and DELETE answer 400 for a jobId that is empty, over 64
 *     characters or carries a control character, before any query;
 *   - POST answers 200 with the row after a lost insert race (P2002) and 404
 *     for a job id that names no job (P2003), with no error log; a P2003
 *     while the job exists is the user's foreign key and stays a 500;
 *   - DELETE answers 400 for a body that is not a JSON object, deletes only
 *     the caller's row, and has the POST budget in a bucket of its own,
 *     which a Clear history over a full GET page fits inside.
 *
 * Fully mocked: the only database is production.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    findJob: vi.fn(),
    rateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        jobApplication: { findMany: h.findMany, upsert: h.upsert, deleteMany: h.deleteMany },
        job: { findUnique: h.findJob },
    },
}));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: h.rateLimit,
    RATE_LIMITS: { general: { limit: 60, windowSeconds: 60 } },
}));

import { GET, POST, DELETE } from '@/app/api/applications/route';
import { RATE_LIMITS } from '@/lib/rate-limit';

type Row = Record<string, unknown>;
interface QueryArgs {
    select?: Record<string, unknown>;
    include?: Record<string, unknown>;
}

const USER_ID = 'supabase-candidate';
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_JOB_ID_LENGTH = 64;

/** A JobApplication as stored: every column set, plus its two relations. */
const STORED_ROW: Row = {
    id: 'app-1',
    userId: USER_ID,
    jobId: JOB_ID,
    sourceUrl: 'https://employer.example.com/apply',
    coverLetter: 'Dear hiring team',
    coverLetterUrl: 'https://test.supabase.co/storage/v1/object/cover-letters/u/c.pdf',
    resumeUrl: 'https://test.supabase.co/storage/v1/object/resumes/u/r.pdf',
    appliedAt: new Date('2026-10-01T12:00:00.000Z'),
    status: 'screening',
    notes: 'PRIVATE employer note',
    statusUpdatedAt: new Date('2026-10-02T12:00:00.000Z'),
    consentGiven: true,
    consentGivenAt: new Date('2026-10-01T12:00:00.000Z'),
    withdrawnAt: null,
    aiMatchScore: 42,
    aiMatchReasons: ['PRIVATE match reason'],
    aiMissingItems: ['PRIVATE missing item'],
    screeningAnswers: [{ questionId: 'q1', questionText: 'Licensed in Texas?', answer: 'yes' }],
    job: {
        id: JOB_ID,
        title: 'Family Nurse Practitioner',
        slug: 'family-nurse-practitioner-1111',
        employer: 'Example Clinic',
        location: 'Austin, TX',
        jobType: 'Full-time',
        mode: 'In-person',
        displaySalary: '$120,000 to $140,000/yr',
        isPublished: true,
        description: 'Full job description',
        contactEmail: 'PRIVATE-hiring@employer.example.com',
    },
    user: { supabaseId: USER_ID, email: 'np@example.com' },
};
const RELATIONS = new Set(['job', 'user']);

/** What Prisma returns for `row` under `args`: the selected keys, or every scalar plus the included relations. */
function project(row: Row, args: QueryArgs): Row {
    const pick = (key: string, spec: unknown): unknown =>
        spec !== null && typeof spec === 'object' ? project(row[key] as Row, spec as QueryArgs) : row[key];
    if (args.select) {
        return Object.fromEntries(
            Object.entries(args.select).filter(([, spec]) => spec).map(([key, spec]) => [key, pick(key, spec)]),
        );
    }
    const scalars = Object.entries(row).filter(([key]) => !RELATIONS.has(key));
    const included = Object.entries(args.include ?? {}).filter(([, spec]) => spec).map(([key, spec]) => [key, pick(key, spec)]);
    return Object.fromEntries([...scalars, ...included]);
}

/** The response keys the candidate is entitled to, sorted. */
const CANDIDATE_FIELDS = [
    'appliedAt', 'consentGiven', 'coverLetter', 'coverLetterUrl', 'id', 'job', 'jobId',
    'resumeUrl', 'screeningAnswers', 'status', 'withdrawnAt',
];
const JOB_FIELDS = ['displaySalary', 'employer', 'id', 'isPublished', 'jobType', 'location', 'mode', 'slug', 'title'];
const EMPLOYER_PRIVATE_FIELDS = ['notes', 'aiMatchScore', 'aiMatchReasons', 'aiMissingItems'];

/** Not JSON, JSON that is not an object, or an object without a string jobId. */
const BAD_BODIES = ['not json', 'null', '[]', '"https://employer.example.com"', '42', '{"sourceUrl":"https://employer.example.com"}', '{"jobId":42}'];
/** A jobId no query should see: empty, over-long, or carrying a control character (Postgres rejects NUL). */
const BAD_JOB_IDS = ['', 'a'.repeat(MAX_JOB_ID_LENGTH + 1), `${JOB_ID}\u0000`, `${JOB_ID}\n`, 'a\u007fb'];

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/**
 * The keys of the object type that opens on the line holding `marker`: its
 * own keys, and the keys of each object-typed key one level down. The pages
 * declare one key per line; a page that changes shape fails the sanity
 * checks in the tests below instead of passing on an empty list.
 */
function declaredKeys(src: string, marker: string): { keys: string[]; nested: Record<string, string[]> } {
    const at = src.indexOf(marker);
    if (at === -1) throw new Error(`${marker} not found`);
    const keys: string[] = [];
    const nested: Record<string, string[]> = {};
    let depth = 0;
    let parent = '';
    for (const line of src.slice(at).split('\n')) {
        const key = /^\s*(\w+)\??:/.exec(line)?.[1];
        if (key && depth === 1) keys.push(key);
        if (key && depth === 2) nested[parent].push(key);
        const next = depth + (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
        if (key && depth === 1 && next === 2) {
            parent = key;
            nested[key] = [];
        }
        if (depth > 0 && next <= 0) break;
        depth = next;
    }
    return { keys, nested };
}

async function listApplications(): Promise<{ status: number; rows: Row[] }> {
    const res = await GET();
    return { status: res.status, rows: await res.json() };
}

function jsonRequest(method: 'POST' | 'DELETE', body: unknown): NextRequest {
    return new NextRequest('http://localhost:3000/api/applications', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

/** POST a body; `create` is what the upsert would insert (undefined when no upsert ran). */
async function post(body: unknown): Promise<{ status: number; create?: Row; update?: Row }> {
    const res = await POST(jsonRequest('POST', body));
    const args = h.upsert.mock.calls.at(-1)?.[0] as { create: Row; update: Row } | undefined;
    return { status: res.status, create: args?.create, update: args?.update };
}

/** DELETE a body; `where` is what deleteMany matched (undefined when it never ran). */
async function del(body: unknown): Promise<{ status: number; where?: Row }> {
    const res = await DELETE(jsonRequest('DELETE', body));
    const args = h.deleteMany.mock.calls.at(-1)?.[0] as { where: Row } | undefined;
    return { status: res.status, where: args?.where };
}

/** A Prisma known request error as the route sees it: an Error carrying a code. */
const prismaError = (code: string): Error => Object.assign(new Error(`Prisma error ${code}`), { code });

const silenceErrorLog = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => {
    vi.clearAllMocks();
    // mockReset also drops a queued *Once value a test did not use.
    h.getUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID, email: 'np@example.com' } }, error: null });
    h.findMany.mockReset().mockImplementation(async (args: QueryArgs) => [project(STORED_ROW, args)]);
    h.upsert.mockReset().mockResolvedValue({ id: 'app-1' });
    h.deleteMany.mockReset().mockResolvedValue({ count: 1 });
    h.findJob.mockReset().mockResolvedValue({ id: JOB_ID });
    h.rateLimit.mockReset().mockResolvedValue(null);
});

describe('GET /api/applications: the candidate reads only their side of the row', () => {
    it('never returns the employer notes or the AI assessment', async () => {
        const { status, rows } = await listApplications();
        expect(status).toBe(200);
        expect(rows).toHaveLength(1);
        for (const key of EMPLOYER_PRIVATE_FIELDS) expect(rows[0], key).not.toHaveProperty(key);
        expect(JSON.stringify(rows)).not.toContain('PRIVATE');
    });

    it('returns exactly the candidate allowlist, and only the listed job fields', async () => {
        const { rows } = await listApplications();
        expect(Object.keys(rows[0]).sort()).toEqual(CANDIDATE_FIELDS);
        expect(Object.keys(rows[0].job as Row).sort()).toEqual(JOB_FIELDS);
    });

    it('queries an explicit select, scoped to the caller, newest 50 first', async () => {
        await listApplications();
        expect(h.findMany).toHaveBeenCalledTimes(1);
        const args = h.findMany.mock.calls[0][0] as QueryArgs & Row;
        expect(args).not.toHaveProperty('include');
        expect(args).toMatchObject({ where: { userId: USER_ID }, orderBy: { appliedAt: 'desc' }, take: 50 });
        expect(Object.keys(args.select ?? {}).sort()).toEqual(CANDIDATE_FIELDS);
    });

    it('answers 401 and runs no query for a signed-out caller', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const { status } = await listApplications();
        expect(status).toBe(401);
        expect(h.findMany).not.toHaveBeenCalled();
    });
});

describe('GET /api/applications: every field the candidate pages read is still returned', () => {
    it('the /saved "Clear history" partition, which picks the rows it may hard-delete from these fields', async () => {
        const page = read('app/saved/page.tsx');
        const fn = page.slice(page.indexOf('const clearAppliedHistory'), page.indexOf('const handleClearApplied'));
        const { keys } = declaredKeys(fn, 'as Array<{');
        expect(keys).toEqual(expect.arrayContaining([
            'jobId', 'status', 'consentGiven', 'coverLetter', 'coverLetterUrl', 'resumeUrl', 'screeningAnswers', 'withdrawnAt',
        ]));
        const { rows } = await listApplications();
        for (const field of keys) expect(rows[0], field).toHaveProperty(field);
    });

    it('/my-applications (cards, status pipeline and withdraw), through its Application type', async () => {
        const { keys, nested } = declaredKeys(read('app/my-applications/page.tsx'), 'interface Application {');
        expect(keys).toEqual(expect.arrayContaining(['id', 'status', 'appliedAt', 'withdrawnAt', 'job']));
        expect(nested.job).toEqual(expect.arrayContaining(['id', 'title', 'slug', 'isPublished']));
        const { rows } = await listApplications();
        for (const field of keys) expect(rows[0], field).toHaveProperty(field);
        for (const field of nested.job) expect(rows[0].job as Row, `job.${field}`).toHaveProperty(field);
    });

    it('the applied-jobs store (lib/hooks/useAppliedJobs.ts AppliedJobRow)', async () => {
        const { keys } = declaredKeys(read('lib/hooks/useAppliedJobs.ts'), 'export interface AppliedJobRow {');
        expect(keys).toEqual(expect.arrayContaining(['jobId', 'appliedAt', 'withdrawnAt', 'status']));
        const { rows } = await listApplications();
        for (const field of keys) expect(rows[0], field).toHaveProperty(field);
    });
});

describe('POST /api/applications: sourceUrl is a short URL string or null', () => {
    it('stores an apply link unchanged, web or mail', async () => {
        for (const link of ['https://employer.example.com/jobs/123?utm_source=nphiring', 'mailto:jobs@employer.example.com']) {
            const { status, create } = await post({ jobId: JOB_ID, sourceUrl: link });
            expect(status).toBe(200);
            expect(create?.sourceUrl).toBe(link);
        }
    });

    it(`keeps a link of exactly ${MAX_SOURCE_URL_LENGTH} characters`, async () => {
        const prefix = 'https://employer.example.com/apply?ref=';
        const link = prefix + 'a'.repeat(MAX_SOURCE_URL_LENGTH - prefix.length);
        expect(link).toHaveLength(MAX_SOURCE_URL_LENGTH);
        const { create } = await post({ jobId: JOB_ID, sourceUrl: link });
        expect(create?.sourceUrl).toBe(link);
    });

    it('stores null rather than a cut link for anything longer', async () => {
        for (const length of [MAX_SOURCE_URL_LENGTH + 1, 5000]) {
            const link = 'https://employer.example.com/apply?ref=' + 'a'.repeat(length);
            const { status, create } = await post({ jobId: JOB_ID, sourceUrl: link.slice(0, length) });
            expect(status).toBe(200);
            expect(create?.sourceUrl, `length ${length}`).toBeNull();
        }
    });

    it('stores null for a value that is not a string, and still answers 200', async () => {
        for (const value of [123, true, {}, [], { href: 'https://x.example.com' }, ['https://x.example.com'], null, 0, false]) {
            const { status, create } = await post({ jobId: JOB_ID, sourceUrl: value });
            expect(status, JSON.stringify(value)).toBe(200);
            expect(create?.sourceUrl, JSON.stringify(value)).toBeNull();
        }
    });

    it('stores null when the key is missing, empty or blank', async () => {
        for (const body of [{ jobId: JOB_ID }, { jobId: JOB_ID, sourceUrl: '' }, { jobId: JOB_ID, sourceUrl: '   ' }]) {
            const { create } = await post(body);
            expect(create?.sourceUrl, JSON.stringify(body)).toBeNull();
        }
    });

    it('stores null for a value carrying a control character (NUL made Postgres reject the insert)', async () => {
        for (const link of ['https://employer.example.com/a\u0000b', 'https://employer.example.com/a\nb', 'https://employer.example.com/\u007f']) {
            const { status, create } = await post({ jobId: JOB_ID, sourceUrl: link });
            expect(status).toBe(200);
            expect(create?.sourceUrl, JSON.stringify(link)).toBeNull();
        }
    });

    it('trims whitespace around a link', async () => {
        const { create } = await post({ jobId: JOB_ID, sourceUrl: '  https://employer.example.com/apply\n' });
        expect(create?.sourceUrl).toBe('https://employer.example.com/apply');
    });
});

describe('POST /api/applications: the rest of the write', () => {
    it('writes the session user, never a body userId, and never rewrites an existing row', async () => {
        const { create, update } = await post({ jobId: JOB_ID, userId: 'someone-else', sourceUrl: 'https://employer.example.com/apply' });
        expect(create).toEqual({ userId: USER_ID, jobId: JOB_ID, sourceUrl: 'https://employer.example.com/apply' });
        expect(update).toEqual({});
        expect(h.upsert.mock.calls[0][0].where).toEqual({ userId_jobId: { userId: USER_ID, jobId: JOB_ID } });
    });

    it('answers 400 and writes nothing for a body that is not a JSON object', async () => {
        for (const raw of BAD_BODIES) {
            const res = await POST(jsonRequest('POST', raw));
            expect(res.status, raw).toBe(400);
        }
        expect(h.upsert).not.toHaveBeenCalled();
    });

    it('answers 401 and writes nothing for a signed-out caller', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const { status } = await post({ jobId: JOB_ID, sourceUrl: 'https://employer.example.com/apply' });
        expect(status).toBe(401);
        expect(h.upsert).not.toHaveBeenCalled();
    });
});

describe('POST and DELETE /api/applications: a jobId is a short id with no control character', () => {
    it('POST answers 400 and writes nothing for an empty or over-long jobId, or one with a control character', async () => {
        for (const jobId of BAD_JOB_IDS) {
            const { status } = await post({ jobId, sourceUrl: 'https://employer.example.com/apply' });
            expect(status, JSON.stringify(jobId)).toBe(400);
        }
        expect(h.upsert).not.toHaveBeenCalled();
    });

    it('DELETE answers 400 and deletes nothing for the same ids', async () => {
        for (const jobId of BAD_JOB_IDS) {
            const { status } = await del({ jobId });
            expect(status, JSON.stringify(jobId)).toBe(400);
        }
        expect(h.deleteMany).not.toHaveBeenCalled();
    });

    it(`a jobId of exactly ${MAX_JOB_ID_LENGTH} characters still reaches the query`, async () => {
        const jobId = 'a'.repeat(MAX_JOB_ID_LENGTH);
        expect((await post({ jobId })).create?.jobId).toBe(jobId);
        expect((await del({ jobId })).where).toEqual({ userId: USER_ID, jobId });
    });
});

describe('POST /api/applications: a lost insert race or a missing job is not a server error', () => {
    let errorLog: ReturnType<typeof silenceErrorLog>;
    beforeEach(() => {
        errorLog = silenceErrorLog();
    });
    afterEach(() => {
        errorLog.mockRestore();
    });

    it('P2002, a concurrent POST inserted the row first: the retry returns that row with 200', async () => {
        h.upsert.mockRejectedValueOnce(prismaError('P2002')).mockResolvedValueOnce({ id: 'app-raced' });
        const res = await POST(jsonRequest('POST', { jobId: JOB_ID }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, id: 'app-raced' });
        expect(h.upsert).toHaveBeenCalledTimes(2);
        expect(h.upsert.mock.calls[1][0]).toEqual(h.upsert.mock.calls[0][0]);
        expect(errorLog).not.toHaveBeenCalled();
    });

    it('P2003 for a job id that names no job (a deleted job in the applied history): 404', async () => {
        h.upsert.mockRejectedValueOnce(prismaError('P2003'));
        h.findJob.mockResolvedValueOnce(null);
        const res = await POST(jsonRequest('POST', { jobId: JOB_ID }));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Job not found' });
        expect(h.findJob.mock.calls[0][0]).toMatchObject({ where: { id: JOB_ID } });
        expect(errorLog).not.toHaveBeenCalled();
    });

    it('P2003 while the job exists is the user foreign key (no profile row): still a logged 500', async () => {
        h.upsert.mockRejectedValueOnce(prismaError('P2003'));
        const res = await POST(jsonRequest('POST', { jobId: JOB_ID }));
        expect(res.status).toBe(500);
        expect(errorLog).toHaveBeenCalled();
    });

    it('any other database error is still a logged 500, with no retry and no job lookup', async () => {
        h.upsert.mockRejectedValueOnce(new Error('connection reset'));
        const res = await POST(jsonRequest('POST', { jobId: JOB_ID }));
        expect(res.status).toBe(500);
        expect(h.upsert).toHaveBeenCalledTimes(1);
        expect(h.findJob).not.toHaveBeenCalled();
        expect(errorLog).toHaveBeenCalled();
    });
});

describe('DELETE /api/applications: a bad body is a 400, and the delete has a rate limit', () => {
    /** The real budgets, read past the mock the route sees. */
    let realRateLimits: typeof RATE_LIMITS;

    // Load the real module once, outside any single test's time budget (a cold
    // import of its @upstash clients on a loaded run can outlast the 5 second default).
    beforeAll(async () => {
        realRateLimits = (await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit')).RATE_LIMITS;
    }, 60_000);

    it('removes only the caller row for the job, never one named by a body userId', async () => {
        const { status, where } = await del({ jobId: JOB_ID, userId: 'someone-else' });
        expect(status).toBe(200);
        expect(where).toEqual({ userId: USER_ID, jobId: JOB_ID });
    });

    it('answers 400 and deletes nothing for a body that is not a JSON object', async () => {
        for (const raw of BAD_BODIES) {
            const res = await DELETE(jsonRequest('DELETE', raw));
            expect(res.status, raw).toBe(400);
        }
        expect(h.deleteMany).not.toHaveBeenCalled();
    });

    it('answers 401 and deletes nothing for a signed-out caller', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        expect((await del({ jobId: JOB_ID })).status).toBe(401);
        expect(h.deleteMany).not.toHaveBeenCalled();
    });

    it('is rate limited with the POST budget, in a bucket of its own', async () => {
        await post({ jobId: JOB_ID });
        await del({ jobId: JOB_ID });
        const [postCall, deleteCall] = h.rateLimit.mock.calls;
        expect(postCall?.[2]).toEqual(RATE_LIMITS.general);
        expect(deleteCall?.[2], 'DELETE budget').toEqual(postCall?.[2]);
        // Its own bucket: the POSTs the applied-jobs sync sends for local-only
        // entries do not spend the budget of a Clear history right after.
        expect(deleteCall?.[1]).toEqual(expect.any(String));
        expect(deleteCall?.[1]).not.toBe(postCall?.[1]);
    });

    it('answers the 429 and touches nothing once the budget is spent', async () => {
        h.rateLimit.mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));
        const res = await DELETE(jsonRequest('DELETE', { jobId: JOB_ID }));
        expect(res.status).toBe(429);
        expect(h.getUser).not.toHaveBeenCalled();
        expect(h.deleteMany).not.toHaveBeenCalled();
    });

    it('a Clear history over a full GET page fits inside one window of that budget', async () => {
        await listApplications();
        const pageSize = (h.findMany.mock.calls[0][0] as { take: number }).take;
        // Clear history (app/saved/page.tsx) sends one DELETE per entry it
        // clears, and the entries with a server row are at most one GET page.
        expect(realRateLimits.general.limit).toBeGreaterThanOrEqual(pageSize);
    });
});
