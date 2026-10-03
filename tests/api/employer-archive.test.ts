/**
 * PATCH /api/employer/jobs/[jobId]/archive, the Archive and Restore buttons on
 * the employer dashboard. The dashboard sends the state its employer chose,
 * { archived: true } or { archived: false }, and shows the archivedAt and
 * isPublished it gets back (components/employer/EmployerDashboardClient.tsx
 * performArchiveToggle). A request with no body still toggles, for older
 * clients and the e2e journeys.
 *
 * Pinned:
 *   - Gates, in order: the rate limiter (before any lookup), a session (401),
 *     an employer or admin profile (403), the body (400), then ownership. An
 *     employer reaches only their own row, or an unclaimed legacy row (userId
 *     null) under their email; a row another account claimed stays out of
 *     reach even when it carries the caller's email (P5.A), and a session
 *     with no email reaches no unclaimed row at all. Every post out of reach
 *     answers exactly as an unknown or malformed id does: 404, nothing
 *     written. An admin reaches any post through the job row.
 *   - The body: { archived: boolean } sets that state; no body, a blank body
 *     or {} toggles; any other shape is a 400 before any job lookup.
 *   - A request for the state the post is already in answers that stored
 *     state and writes nothing, so a stale tab cannot undo another tab's
 *     choice: Archive in a tab that still shows the post live keeps it
 *     archived, and Restore in a tab that still shows it archived keeps a
 *     republished post live.
 *   - The one request for the current state that does write: { archived: true }
 *     for a post that is archived yet still live. An admin republish sets
 *     isPublished and leaves archivedAt alone (publishStateFields in
 *     app/api/admin/jobs/_lib/job-input.ts), so "already archived" would
 *     leave the post on the board. The route unpublishes it, flags it and
 *     keeps the stored archive time.
 *   - Archiving stamps archivedAt and, in the same write, unpublishes and sets
 *     isManuallyUnpublished (4212caf). /jobs, the pSEO listings and the
 *     sitemaps filter on isPublished, not archivedAt (lib/filters.ts,
 *     lib/pseo/listing-where.ts, lib/active-job-filter.ts), so the unpublish
 *     is what takes the post off the board. The flag is what keeps
 *     fp-recovery, which has no archive filter, and resumePlanPosts (every
 *     plan renewal), once the post is restored, from reviving it.
 *   - Restoring clears archivedAt and nothing else. It does not republish and
 *     the flag stays, so the post waits for the employer to republish it
 *     through toggle-publish, which runs the expiry, payment and plan slot
 *     checks.
 *   - Repeating a toggle: one that reads the post archived restores it, still
 *     unpublished; two that both read it live both archive it. No run of
 *     repeats puts a post live.
 *   - Every failure answers one generic 500 that carries no internal detail,
 *     and logs the cause.
 *
 * The prisma fake applies the route's own where clauses to in-memory rows, so
 * ownership is decided by the filter the route builds, not by a canned null.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/rate-limit';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    rateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: mocks.rateLimit,
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PATCH } from '@/app/api/employer/jobs/[jobId]/archive/route';

interface SessionUser {
    id: string;
    email: string;
}

/** A Supabase session from a sign-in method that carries no email. */
interface EmailLessSession {
    id: string;
    email?: undefined;
}

interface JobRow {
    id: string;
    title: string;
    archivedAt: Date | null;
    isPublished: boolean;
    isManuallyUnpublished: boolean;
}

interface EmployerJobRow {
    id: string;
    jobId: string;
    userId: string | null;
    contactEmail: string;
    paymentStatus: string;
}

type Where = Record<string, unknown>;

const NOW = new Date('2026-10-01T15:00:00.000Z');
const ARCHIVED_ON = new Date('2026-09-20T09:00:00.000Z');
const JOB_ID = 'job-1';
const OWN_JOB_ID = 'job-2';
const OWNER: SessionUser = { id: 'supabase-owner', email: 'hiring@clinic.example' };
const OTHER: SessionUser = { id: 'supabase-other', email: 'talent@other-clinic.example' };
const ADMIN: SessionUser = { id: 'supabase-admin', email: 'staff@nphiring.example' };
const PHONE_USER: EmailLessSession = { id: 'supabase-phone' };
/** The archive write in full: a field more or less is a regression. */
const ARCHIVE_WRITE = { archivedAt: NOW, isPublished: false, isManuallyUnpublished: true };
const ARCHIVED_MESSAGE = 'Job archived. It will no longer appear on the public job board.';
const RESTORED_MESSAGE = 'Job restored from archive. Republish it to make it visible again.';

let jobs: JobRow[] = [];
let employerJobs: EmployerJobRow[] = [];

function jobRow(overrides: Partial<JobRow> = {}): JobRow {
    return { id: JOB_ID, title: 'PMHNP Outpatient', archivedAt: null, isPublished: true, isManuallyUnpublished: false, ...overrides };
}

function ownedBy(user: SessionUser, overrides: Partial<EmployerJobRow> = {}): EmployerJobRow {
    return { id: 'ej-1', jobId: JOB_ID, userId: user.id, contactEmail: user.email, paymentStatus: 'promo', ...overrides };
}

function seed(rows: { jobs: JobRow[]; employerJobs: EmployerJobRow[] }): void {
    jobs = rows.jobs;
    employerJobs = rows.employerJobs;
}

function storedJob(id: string = JOB_ID): JobRow {
    const job = jobs.find((row) => row.id === id);
    if (!job) throw new Error(`fake prisma: no job ${id}`);
    return job;
}

/**
 * What toggle-publish writes on a republish, applied straight to the store.
 * An admin republish writes the same two fields (publishStateFields(true)),
 * and neither touches archivedAt.
 */
function republishStoredJob(id: string = JOB_ID): void {
    jobs = jobs.map((job) => (job.id === id ? { ...job, isPublished: true, isManuallyUnpublished: false } : job));
}

/**
 * Column equality and OR, the only filter shapes the route uses. An undefined
 * value adds no condition, as in Prisma; an unknown column throws, so a change
 * to the route's query fails here instead of matching by accident.
 */
function matches(row: object, where: Where): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (condition === undefined) return true;
        if (key === 'OR') return (condition as Where[]).some((branch) => matches(row, branch));
        if (!(key in row)) throw new Error(`fake prisma: unknown column "${key}"`);
        return (row as Record<string, unknown>)[key] === condition;
    });
}

function installFakeDatabase(): void {
    vi.mocked(prisma.employerJob.findFirst).mockImplementation((async (args: { where: Where }) => {
        const row = employerJobs.find((candidate) => matches(candidate, args.where));
        const job = row ? jobs.find((candidate) => candidate.id === row.jobId) : undefined;
        return row && job ? { ...row, job: { ...job } } : null;
    }) as never);
    vi.mocked(prisma.job.findUnique).mockImplementation((async (args: { where: Where }) => {
        const job = jobs.find((candidate) => matches(candidate, args.where));
        return job ? { ...job } : null;
    }) as never);
    vi.mocked(prisma.job.update).mockImplementation((async (args: { where: { id: string }; data: Partial<JobRow> }) => {
        // Updating a missing row throws, as Prisma's P2025 does.
        const updated = { ...storedJob(args.where.id), ...args.data };
        jobs = jobs.map((job) => (job.id === updated.id ? updated : job));
        return updated;
    }) as never);
}

function signIn(user: SessionUser | EmailLessSession | null, role: string | null = 'employer'): void {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(
        (user && role ? { id: `profile-${user.id}`, role } : null) as never,
    );
}

/** PATCH the route; `body` is sent verbatim as JSON, and left out when undefined. */
async function patchArchive(jobId: string = JOB_ID, body?: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const req = new NextRequest(`http://localhost:3000/api/employer/jobs/${encodeURIComponent(jobId)}/archive`, {
        method: 'PATCH',
        ...(body !== undefined && { body, headers: { 'Content-Type': 'application/json' } }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ jobId }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The request the dashboard sends: the state its employer chose. */
function requestState(archived: boolean, jobId: string = JOB_ID): Promise<{ status: number; body: Record<string, unknown> }> {
    return patchArchive(jobId, JSON.stringify({ archived }));
}

beforeEach(() => {
    // Only Date is faked, so archivedAt is exact and promises run as usual.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mocks.rateLimit.mockResolvedValue(null);
    installFakeDatabase();
    seed({ jobs: [jobRow()], employerJobs: [ownedBy(OWNER)] });
    signIn(OWNER);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('who may archive', () => {
    it('lets the rate limiter answer first, before the session or any lookup', async () => {
        mocks.rateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));

        const res = await patchArchive();

        expect(res.status).toBe(429);
        expect(mocks.rateLimit).toHaveBeenCalledWith(expect.any(NextRequest), 'employer:archive', RATE_LIMITS.employer);
        expect(mocks.getUser).not.toHaveBeenCalled();
        expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('answers 401 without a session', async () => {
        signIn(null);

        const res = await patchArchive();

        expect(res).toEqual({ status: 401, body: { error: 'Unauthorized' } });
        expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('answers 401 when Supabase reports an auth error, even beside a user object', async () => {
        // Supabase pairs an error with a null user; the route trusts neither
        // half of a failed call.
        mocks.getUser.mockResolvedValue({ data: { user: OWNER }, error: { name: 'AuthApiError', message: 'JWT expired', status: 401 } });

        const res = await patchArchive();

        expect(res).toEqual({ status: 401, body: { error: 'Unauthorized' } });
        expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it.each<[string, string | null]>([
        ['no profile', null],
        ['a job seeker profile', 'job_seeker'],
    ])('answers 403 to a signed-in user with %s, before any job lookup', async (_label, role) => {
        signIn(OWNER, role);

        const res = await patchArchive();

        expect(res).toEqual({ status: 403, body: { error: 'Forbidden' } });
        expect(prisma.userProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { supabaseId: OWNER.id } }));
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });
});

describe('ownership', () => {
    it.each<[string, EmployerJobRow]>([
        ['their own post', ownedBy(OWNER)],
        ["an unclaimed legacy post (userId null) filed under the caller's email", ownedBy(OWNER, { userId: null })],
    ])('lets an employer archive %s', async (_label, row) => {
        seed({ jobs: [jobRow()], employerJobs: [row] });

        const res = await patchArchive();

        expect(res.status).toBe(200);
        expect(storedJob()).toEqual(jobRow(ARCHIVE_WRITE));
    });

    it.each<[string, EmployerJobRow]>([
        ["another employer's post", ownedBy(OTHER)],
        ["an unclaimed legacy post under another employer's email", ownedBy(OTHER, { userId: null })],
        // P5.A: the email fallback is for unclaimed rows only. Matching on
        // contactEmail alone would let anyone whose address equals a post's
        // contact email act on another account's post.
        ["a post another account claimed that carries the caller's email", ownedBy(OTHER, { contactEmail: OWNER.email })],
    ])('answers 404 for %s, exactly as for an id that does not exist, and writes nothing', async (_label, row) => {
        // The caller owns a different post, so a lookup that lost its jobId
        // scope would find that one and archive it.
        seed({
            jobs: [jobRow(), jobRow({ id: OWN_JOB_ID, title: 'FNP Primary Care' })],
            employerJobs: [row, ownedBy(OWNER, { id: 'ej-2', jobId: OWN_JOB_ID })],
        });

        const outOfReach = await patchArchive(JOB_ID);
        const missing = await patchArchive('job-that-does-not-exist');

        expect(outOfReach).toEqual({ status: 404, body: { error: 'Job not found or access denied' } });
        expect(missing).toEqual(outOfReach);
        // Reading the job row directly is the admin path, never an employer's.
        expect(prisma.job.findUnique).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('keeps a session without an email away from every unclaimed legacy post', async () => {
        // A sign-in method with no email. The inline branch
        // { userId: null, contactEmail: user.email! } read as { userId: null }
        // for this session (Prisma drops an undefined condition) and reached
        // every unclaimed row; lib/employer-ownership.ts leaves it out.
        signIn(PHONE_USER);
        seed({ jobs: [jobRow()], employerJobs: [ownedBy(OTHER, { userId: null })] });

        const res = await patchArchive();

        expect(res).toEqual({ status: 404, body: { error: 'Job not found or access denied' } });
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(storedJob()).toEqual(jobRow());
    });

    it('still lets a session without an email archive the post it claimed', async () => {
        signIn(PHONE_USER);
        seed({ jobs: [jobRow()], employerJobs: [ownedBy(OTHER, { userId: PHONE_USER.id })] });

        const res = await patchArchive();

        expect(res.status).toBe(200);
        expect(storedJob()).toEqual(jobRow(ARCHIVE_WRITE));
    });

    it('lets an admin archive a post they do not own, through the job row', async () => {
        signIn(ADMIN, 'admin');

        const res = await patchArchive();

        expect(res.status).toBe(200);
        expect(prisma.job.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: JOB_ID } }));
        expect(storedJob()).toEqual(jobRow(ARCHIVE_WRITE));
    });

    const UNMATCHED_IDS: Array<[string, string]> = [
        ['an unknown id', '3f1b8a52-6d0e-4c1e-9a57-2b8f0c9d4e71'],
        ['a malformed id', 'not a job id'],
        ['an oversized id', 'x'.repeat(2048)],
    ];

    it.each(UNMATCHED_IDS)('answers an employer 404 for %s and writes nothing', async (_label, jobId) => {
        const res = await patchArchive(jobId);

        expect(res).toEqual({ status: 404, body: { error: 'Job not found or access denied' } });
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it.each(UNMATCHED_IDS)('answers an admin 404 for %s and writes nothing', async (_label, jobId) => {
        signIn(ADMIN, 'admin');

        const res = await patchArchive(jobId);

        expect(res).toEqual({ status: 404, body: { error: 'Job not found' } });
        expect(prisma.job.update).not.toHaveBeenCalled();
    });
});

describe('archiving', () => {
    it('stamps archivedAt, unpublishes and flags the post in one write', async () => {
        const res = await patchArchive();

        expect(res).toEqual({
            status: 200,
            body: {
                success: true,
                archivedAt: NOW.toISOString(),
                isPublished: false,
                message: ARCHIVED_MESSAGE,
            },
        });
        // One write, so there is no moment where the post is archived but live.
        expect(prisma.job.update).toHaveBeenCalledTimes(1);
        expect(prisma.job.update).toHaveBeenCalledWith({ where: { id: JOB_ID }, data: ARCHIVE_WRITE });
        expect(storedJob()).toEqual(jobRow(ARCHIVE_WRITE));
        expect(logger.info).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ jobId: JOB_ID, userId: OWNER.id, archivedAt: NOW }),
        );
    });

    it('flags a post the plan had paused, so a plan renewal cannot revive it once restored', async () => {
        // pausePlanPosts unpublishes without the flag, and resumePlanPosts
        // revives only plan posts that are unflagged and unarchived.
        seed({ jobs: [jobRow({ isPublished: false })], employerJobs: [ownedBy(OWNER, { paymentStatus: 'plan' })] });

        await patchArchive();

        expect(storedJob()).toEqual(jobRow(ARCHIVE_WRITE));
    });
});

describe('restoring', () => {
    it('clears archivedAt and nothing else: no republish, and the flag stays', async () => {
        seed({
            jobs: [jobRow({ archivedAt: ARCHIVED_ON, isPublished: false, isManuallyUnpublished: true })],
            employerJobs: [ownedBy(OWNER)],
        });

        const res = await patchArchive();

        expect(res).toEqual({
            status: 200,
            body: {
                success: true,
                archivedAt: null,
                isPublished: false,
                message: RESTORED_MESSAGE,
            },
        });
        expect(prisma.job.update).toHaveBeenCalledWith({ where: { id: JOB_ID }, data: { archivedAt: null } });
        expect(storedJob()).toEqual(jobRow({ archivedAt: null, isPublished: false, isManuallyUnpublished: true }));
    });

    it('reports a post that was archived and live at once as live once restored, without the republish hint', async () => {
        // Not a state this route writes, but nothing else forbids it; the
        // answer describes the post as stored.
        seed({ jobs: [jobRow({ archivedAt: ARCHIVED_ON, isPublished: true })], employerJobs: [ownedBy(OWNER)] });

        const res = await requestState(false);

        expect(res).toEqual({
            status: 200,
            body: { success: true, archivedAt: null, isPublished: true, message: 'Job restored from archive.' },
        });
        expect(storedJob()).toEqual(jobRow({ archivedAt: null, isPublished: true }));
    });
});

describe('the requested state', () => {
    it('{ archived: true } archives a live post in the same single write', async () => {
        const res = await requestState(true);

        expect(res).toEqual({
            status: 200,
            body: { success: true, archivedAt: NOW.toISOString(), isPublished: false, message: ARCHIVED_MESSAGE },
        });
        expect(prisma.job.update).toHaveBeenCalledTimes(1);
        expect(prisma.job.update).toHaveBeenCalledWith({ where: { id: JOB_ID }, data: ARCHIVE_WRITE });
    });

    it('{ archived: false } restores an archived post and leaves it unpublished', async () => {
        seed({
            jobs: [jobRow({ archivedAt: ARCHIVED_ON, isPublished: false, isManuallyUnpublished: true })],
            employerJobs: [ownedBy(OWNER)],
        });

        const res = await requestState(false);

        expect(res).toEqual({
            status: 200,
            body: { success: true, archivedAt: null, isPublished: false, message: RESTORED_MESSAGE },
        });
        expect(prisma.job.update).toHaveBeenCalledWith({ where: { id: JOB_ID }, data: { archivedAt: null } });
    });

    it('{ archived: true } on a post already archived answers its stored state and writes nothing', async () => {
        seed({
            jobs: [jobRow({ archivedAt: ARCHIVED_ON, isPublished: false, isManuallyUnpublished: true })],
            employerJobs: [ownedBy(OWNER)],
        });

        const res = await requestState(true);

        expect(res).toEqual({
            status: 200,
            body: { success: true, archivedAt: ARCHIVED_ON.toISOString(), isPublished: false, message: 'Job is already archived.' },
        });
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ jobId: JOB_ID, archived: true, userId: OWNER.id }),
        );
    });

    it('{ archived: false } on a post that is not archived answers its stored state and writes nothing', async () => {
        const res = await requestState(false);

        expect(res).toEqual({
            status: 200,
            body: { success: true, archivedAt: null, isPublished: true, message: 'Job is not archived.' },
        });
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(storedJob()).toEqual(jobRow());
    });

    it.each<[string, SessionUser, string]>([
        ['its employer', OWNER, 'employer'],
        ['an admin', ADMIN, 'admin'],
    ])('{ archived: true } from %s on a post that is archived yet still live takes it off the board', async (_label, user, role) => {
        // Archived and live at once: an admin republish sets isPublished and
        // leaves archivedAt alone. "Already archived" with no write would
        // leave the listing public.
        signIn(user, role);
        seed({ jobs: [jobRow({ archivedAt: ARCHIVED_ON, isPublished: true })], employerJobs: [ownedBy(OWNER)] });

        const res = await requestState(true);

        expect(res).toEqual({
            status: 200,
            body: { success: true, archivedAt: ARCHIVED_ON.toISOString(), isPublished: false, message: ARCHIVED_MESSAGE },
        });
        // Off the board and flagged as the employer's choice, like any
        // archive; the stored archive time is kept, not restamped.
        expect(prisma.job.update).toHaveBeenCalledTimes(1);
        expect(prisma.job.update).toHaveBeenCalledWith({
            where: { id: JOB_ID },
            data: { isPublished: false, isManuallyUnpublished: true },
        });
        expect(storedJob()).toEqual(jobRow({ archivedAt: ARCHIVED_ON, isPublished: false, isManuallyUnpublished: true }));
        expect(logger.info).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ jobId: JOB_ID, userId: user.id, archivedAt: ARCHIVED_ON }),
        );
    });

    it('lets an admin set the state of a post they do not own the same way', async () => {
        signIn(ADMIN, 'admin');
        seed({ jobs: [jobRow({ archivedAt: ARCHIVED_ON, isPublished: false })], employerJobs: [ownedBy(OWNER)] });

        const again = await requestState(true);
        const restored = await requestState(false);

        expect([again.body.archivedAt, restored.body.archivedAt]).toEqual([ARCHIVED_ON.toISOString(), null]);
        expect(prisma.job.update).toHaveBeenCalledTimes(1);
    });
});

describe('a stale tab', () => {
    it('Archive in a tab that still shows the post live keeps the post archived', async () => {
        // Tab A archives. Tab B loaded before that, still shows the post
        // live, and its employer clicks Archive too. As a toggle, that second
        // request restored the post while tab B showed it archived.
        const tabA = await requestState(true);
        const tabB = await requestState(true);

        expect(tabA.body).toMatchObject({ archivedAt: NOW.toISOString(), isPublished: false });
        expect(tabB).toEqual({
            status: 200,
            body: { success: true, archivedAt: NOW.toISOString(), isPublished: false, message: 'Job is already archived.' },
        });
        expect(prisma.job.update).toHaveBeenCalledTimes(1);
        expect(storedJob()).toEqual(jobRow(ARCHIVE_WRITE));
    });

    it('Restore in a tab that still shows the post archived keeps a republished post live, and says so', async () => {
        seed({
            jobs: [jobRow({ archivedAt: ARCHIVED_ON, isPublished: false, isManuallyUnpublished: true })],
            employerJobs: [ownedBy(OWNER)],
        });
        // Tab A restores, then the employer republishes from it.
        await requestState(false);
        republishStoredJob();

        // Tab B still shows the post archived; its Restore must not archive it.
        const tabB = await requestState(false);

        expect(tabB).toEqual({
            status: 200,
            body: { success: true, archivedAt: null, isPublished: true, message: 'Job is not archived.' },
        });
        expect(prisma.job.update).toHaveBeenCalledTimes(1);
        expect(storedJob()).toEqual(jobRow({ archivedAt: null, isPublished: true, isManuallyUnpublished: false }));
    });

    it('Archive in a tab that still shows the post live unpublishes one an admin republished while it was archived', async () => {
        // Tab A archives. An admin then republishes the post, which leaves it
        // archived and live. Tab B loaded before the archive, still shows the
        // post live, and its employer clicks Archive.
        await requestState(true);
        republishStoredJob();

        const tabB = await requestState(true);
        const repeat = await requestState(true);

        expect(tabB).toEqual({
            status: 200,
            body: { success: true, archivedAt: NOW.toISOString(), isPublished: false, message: ARCHIVED_MESSAGE },
        });
        // The repeat finds the post archived and off the board: nothing to write.
        expect(repeat).toEqual({
            status: 200,
            body: { success: true, archivedAt: NOW.toISOString(), isPublished: false, message: 'Job is already archived.' },
        });
        expect(prisma.job.update).toHaveBeenCalledTimes(2);
        expect(storedJob()).toEqual(jobRow(ARCHIVE_WRITE));
    });
});

describe('the request body', () => {
    it.each<[string, string]>([
        ['malformed JSON', '{archived: true}'],
        ['a form body', 'archived=true'],
        ['an array', '[]'],
        ['null', 'null'],
        ['a bare boolean', 'true'],
        ['a string', '"archived"'],
        ['a string flag', '{"archived":"true"}'],
        ['a numeric flag', '{"archived":1}'],
        ['a null flag', '{"archived":null}'],
        ['a misspelt key', '{"archive":true}'],
        ['an extra key', '{"archived":true,"isPublished":true}'],
    ])('answers 400 to %s before any job lookup, and writes nothing', async (_label, body) => {
        const res = await patchArchive(JOB_ID, body);

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ error: 'Invalid request body', message: expect.any(String) });
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it.each<[string, string | undefined]>([
        ['no body', undefined],
        ['a blank body', '  \n'],
        ['an empty object', '{}'],
    ])('toggles on %s, as older clients send it', async (_label, body) => {
        const archived = await patchArchive(JOB_ID, body);
        const restored = await patchArchive(JOB_ID, body);

        expect([archived.body.archivedAt, restored.body.archivedAt]).toEqual([NOW.toISOString(), null]);
        expect(prisma.job.update).toHaveBeenCalledTimes(2);
    });

    it('reads the body only after the session and profile gates', async () => {
        signIn(null);
        const anonymous = await patchArchive(JOB_ID, 'not json');
        signIn(OWNER, 'job_seeker');
        const seeker = await patchArchive(JOB_ID, 'not json');

        expect([anonymous.status, seeker.status]).toEqual([401, 403]);
    });

    it("answers {} for another employer's post with 404, as the e2e foreign-post check sends it", async () => {
        // tests/e2e/journeys/auth-security.spec.ts PATCHes { data: {} } at a
        // foreign post and accepts only 403 or 404.
        seed({ jobs: [jobRow()], employerJobs: [ownedBy(OTHER)] });

        const res = await patchArchive(JOB_ID, '{}');

        expect(res).toEqual({ status: 404, body: { error: 'Job not found or access denied' } });
        expect(prisma.job.update).not.toHaveBeenCalled();
    });
});

describe('repeating the request', () => {
    it('toggles: a request that finds the post archived restores it, and no repeat puts it live', async () => {
        const steps: Array<Record<string, unknown>> = [];
        for (let request = 0; request < 3; request += 1) {
            const { status, body } = await patchArchive();
            const { isPublished, isManuallyUnpublished } = storedJob();
            steps.push({ status, archivedAt: body.archivedAt, isPublished, isManuallyUnpublished });
        }

        expect(steps).toEqual([
            { status: 200, archivedAt: NOW.toISOString(), isPublished: false, isManuallyUnpublished: true },
            { status: 200, archivedAt: null, isPublished: false, isManuallyUnpublished: true },
            { status: 200, archivedAt: NOW.toISOString(), isPublished: false, isManuallyUnpublished: true },
        ]);
    });

    it('archives twice when two requests both read the post live, since each write sets the archived state outright', async () => {
        // The read is not locked, so a double submit can read the row twice
        // before either write lands. Serve that same live read to both.
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ ...ownedBy(OWNER), job: jobRow() } as never);

        const responses = await Promise.all([patchArchive(), patchArchive()]);

        expect(responses.map(({ status, body }) => [status, body.archivedAt])).toEqual([
            [200, NOW.toISOString()],
            [200, NOW.toISOString()],
        ]);
        expect(vi.mocked(prisma.job.update).mock.calls.map(([args]) => args.data)).toEqual([ARCHIVE_WRITE, ARCHIVE_WRITE]);
        expect(storedJob()).toEqual(jobRow(ARCHIVE_WRITE));
    });

    it('never restores on a repeated { archived: true }, however many times it is sent', async () => {
        const archivedAts: unknown[] = [];
        for (let request = 0; request < 3; request += 1) {
            archivedAts.push((await requestState(true)).body.archivedAt);
        }

        expect(archivedAts).toEqual([NOW.toISOString(), NOW.toISOString(), NOW.toISOString()]);
        expect(prisma.job.update).toHaveBeenCalledTimes(1);
    });
});

describe('failures', () => {
    // What a driver error can carry; none of it may reach the client.
    const INTERNAL_DETAIL = 'connect ECONNREFUSED 10.0.0.12:6543 password authentication failed for user "postgres"';

    it.each<[string, (cause: Error) => void]>([
        ['the session lookup', (cause) => mocks.getUser.mockRejectedValue(cause)],
        ['the profile lookup', (cause) => vi.mocked(prisma.userProfile.findUnique).mockRejectedValue(cause)],
        ['the ownership lookup', (cause) => vi.mocked(prisma.employerJob.findFirst).mockRejectedValue(cause)],
        ['the admin job lookup', (cause) => {
            signIn(ADMIN, 'admin');
            vi.mocked(prisma.job.findUnique).mockRejectedValue(cause);
        }],
        ['the write', (cause) => vi.mocked(prisma.job.update).mockRejectedValue(cause)],
    ])('answers a generic 500 when %s fails, and logs the cause', async (_label, fail) => {
        const cause = new Error(INTERNAL_DETAIL);
        fail(cause);

        const res = await patchArchive();

        expect(res).toEqual({ status: 500, body: { error: 'Failed to update archive state' } });
        expect(logger.error).toHaveBeenCalledWith(expect.any(String), cause);
    });
});

describe('copy follows the house style', () => {
    it('no answer the route gives carries an em dash, an en dash or a spaced hyphen', async () => {
        const archived = await patchArchive();
        const alreadyArchived = await requestState(true);
        const restored = await patchArchive();
        const notArchived = await requestState(false);
        seed({ jobs: [jobRow({ archivedAt: ARCHIVED_ON, isPublished: true })], employerJobs: [ownedBy(OWNER)] });
        const restoredLive = await requestState(false);
        const invalid = await patchArchive(JOB_ID, '{"archive":true}');

        const copy = [archived, alreadyArchived, restored, notArchived, restoredLive].map((res) => res.body.message);
        copy.push(invalid.body.error, invalid.body.message);
        expect(new Set(copy).size).toBe(copy.length);
        for (const text of copy) {
            expect(text).toEqual(expect.any(String));
            expect(text).not.toMatch(/[–—]| - /);
        }
    });
});
