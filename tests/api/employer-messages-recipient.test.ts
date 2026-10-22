/**
 * POST /api/employer/messages reaches only someone the sending employer may
 * contact, and GET /api/employer/messages never shows a recipient's email.
 *
 * Before: the send path loaded the recipient by Supabase id and checked
 * nothing about them, so an employer past the featured post gate could open
 * a thread with, and email, any profile: a seeker who hid their profile or
 * switched off "Open to offers", a deleted account, another employer, an
 * admin. GET /api/conversations then showed that person's full name and
 * profile, and the sent list named an unnamed recipient by raw email.
 *
 * The ways an employer legitimately messages someone, each kept working:
 *   - the candidate pool: the Message button lives on the candidate profile
 *     page, which shows only a visible job seeker who is open to offers
 *     (GET /api/employer/candidates/[id]) and records a ProfileView for the
 *     employer before it renders;
 *   - the applicants view: anyone who applied to one of the employer's own
 *     jobs, whatever their pool settings;
 *   - a reply in an existing thread for the same (pair, job) key;
 *   - an admin, who sends from the same pages under the same rules.
 *
 * Pinned:
 *   - A new thread opens only with a pool candidate whose profile this
 *     employer opened, or with an applicant to one of its own jobs (the
 *     shared ownership clause, so an unclaimed legacy post counts only for a
 *     session with the matching email).
 *   - A reply lands in the existing thread even after the recipient left the
 *     pool; a new key with the same person is new outreach again.
 *   - A deleted account is never a recipient, not even for a reply.
 *   - Anyone out of reach answers exactly as an unknown id does, before the
 *     featured gate and the InMail check, and nothing is written or emailed.
 *   - The sent list names an unnamed recipient "Candidate", never an email.
 *
 * The prisma fake applies the route's own where clauses to in-memory rows,
 * so reach is decided by the filters the route builds, not by canned nulls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    after: vi.fn(),
    sendEmployerMessageNotification: vi.fn(),
    getEmployerTier: vi.fn(),
    canSendInMail: vi.fn(),
    prisma: {
        userProfile: { findUnique: vi.fn() },
        profileView: { findUnique: vi.fn() },
        jobApplication: { findFirst: vi.fn() },
        employerJob: { findFirst: vi.fn() },
        job: { findFirst: vi.fn(), findUnique: vi.fn() },
        conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
        employerMessage: { create: vi.fn(), findMany: vi.fn() },
        $transaction: vi.fn(),
    },
}));

// Only after() is replaced: outside a request scope Next throws from it.
vi.mock('next/server', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/server')>()),
    after: h.after,
}));
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/email-service', () => ({
    sendEmployerMessageNotification: h.sendEmployerMessageNotification,
}));
vi.mock('@/lib/tier-limits', () => ({
    getEmployerTier: h.getEmployerTier,
    canSendInMail: h.canSendInMail,
}));

import { GET, POST } from '@/app/api/employer/messages/route';

type Where = Record<string, unknown>;
type Select = Record<string, unknown>;

interface SessionUser {
    id: string;
    email?: string;
    /** Supabase stamps it once the address is confirmed; real sessions carry it. */
    email_confirmed_at?: string;
}

type ProfileRow = {
    id: string;
    supabaseId: string;
    email: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    profileVisible: boolean;
    openToOffers: boolean;
    deletedAt: Date | null;
};

type JobRow = { id: string; title: string; isFeatured: boolean };
type EmployerJobRow = { id: string; jobId: string; userId: string | null; contactEmail: string };
type ApplicationRow = { id: string; userId: string; jobId: string };
type ProfileViewRow = { id: string; viewerId: string; candidateId: string };

type ConversationRow = {
    id: string;
    participantA: string;
    participantB: string;
    jobId: string | null;
    subject: string;
    lastMessageAt: Date;
    deletedByA: boolean;
    deletedByB: boolean;
};

type MessageRow = {
    id: string;
    senderId: string;
    recipientId: string;
    conversationId: string;
    subject: string;
    body: string;
    jobId: string | null;
    sentAt: Date;
    readAt: Date | null;
};

interface Store {
    profiles: ProfileRow[];
    jobs: JobRow[];
    employerJobs: EmployerJobRow[];
    applications: ApplicationRow[];
    profileViews: ProfileViewRow[];
    conversations: ConversationRow[];
    messages: MessageRow[];
}

const EMPLOYER_EMAIL = 'hiring@clinic.example';
const OTHER_EMPLOYER_EMAIL = 'talent@other-clinic.example';
const ADMIN_EMAIL = 'staff@nphiring.example';
const CONFIRMED_AT = '2026-10-01T00:00:00Z';
const EMPLOYER: SessionUser = { id: 'auth-employer', email: EMPLOYER_EMAIL, email_confirmed_at: CONFIRMED_AT };
/** The same account through a sign-in method that carries no email. */
const EMPLOYER_NO_EMAIL: SessionUser = { id: 'auth-employer' };
const OTHER_EMPLOYER: SessionUser = { id: 'auth-other-employer', email: OTHER_EMPLOYER_EMAIL, email_confirmed_at: CONFIRMED_AT };
const ADMIN: SessionUser = { id: 'auth-admin', email: ADMIN_EMAIL, email_confirmed_at: CONFIRMED_AT };
const DELETED_ON = new Date('2026-10-01T12:00:00.000Z');
const NOT_FOUND = { status: 404, body: { error: 'Recipient not found' } };

let db: Store;
let sequence = 0;

const profileId = (supabaseId: string): string => `profile-${supabaseId}`;

function profile(supabaseId: string, overrides: Partial<ProfileRow> = {}): ProfileRow {
    return {
        id: profileId(supabaseId),
        supabaseId,
        email: `${supabaseId}@example.com`,
        role: 'job_seeker',
        firstName: 'Grace',
        lastName: 'Hopper',
        company: null,
        profileVisible: true,
        openToOffers: true,
        deletedAt: null,
        ...overrides,
    };
}

function opened(viewerId: string, candidateId: string): ProfileViewRow {
    return { id: `view-${viewerId}-${candidateId}`, viewerId, candidateId };
}

function seed(): Store {
    return {
        profiles: [
            profile(EMPLOYER.id, { role: 'employer', firstName: 'Ada', lastName: 'Lovelace', company: 'Riverside Psychiatry', email: EMPLOYER_EMAIL }),
            profile(OTHER_EMPLOYER.id, { role: 'employer', firstName: 'Ola', lastName: 'Other', company: 'Other Clinic', email: OTHER_EMPLOYER_EMAIL }),
            profile(ADMIN.id, { role: 'admin', firstName: 'Sam', lastName: 'Staff', email: ADMIN_EMAIL }),
            // In the pool, and this employer opened the profile.
            profile('auth-pool'),
            // In the pool, never opened by this employer.
            profile('auth-pool-unopened'),
            // Opened while in the pool, then left it.
            profile('auth-closed', { openToOffers: false }),
            profile('auth-hidden', { profileVisible: false }),
            // Applicants, out of the pool.
            profile('auth-applicant', { profileVisible: false, openToOffers: false }),
            profile('auth-legacy-applicant', { profileVisible: false, openToOffers: false }),
            profile('auth-other-applicant', { profileVisible: false, openToOffers: false }),
            // Applied and was opened, then deleted the account (deletion
            // also hides the profile: app/api/auth/delete-account).
            profile('auth-deleted', { profileVisible: false, openToOffers: false, deletedAt: DELETED_ON }),
            profile('auth-unnamed', { firstName: null, lastName: null, email: 'unnamed.person@example.com' }),
        ],
        jobs: [
            { id: 'job-own', title: 'Psychiatric NP', isFeatured: true },
            { id: 'job-legacy', title: 'Family NP', isFeatured: false },
            { id: 'job-other', title: 'Acute Care NP', isFeatured: true },
            { id: 'job-admin', title: 'Pediatric NP', isFeatured: true },
        ],
        employerJobs: [
            { id: 'ej-own', jobId: 'job-own', userId: EMPLOYER.id, contactEmail: EMPLOYER_EMAIL },
            // Posted before accounts were linked, filed under the employer's email.
            { id: 'ej-legacy', jobId: 'job-legacy', userId: null, contactEmail: EMPLOYER_EMAIL },
            { id: 'ej-other', jobId: 'job-other', userId: OTHER_EMPLOYER.id, contactEmail: OTHER_EMPLOYER_EMAIL },
            { id: 'ej-admin', jobId: 'job-admin', userId: ADMIN.id, contactEmail: ADMIN_EMAIL },
        ],
        applications: [
            { id: 'app-own', userId: 'auth-applicant', jobId: 'job-own' },
            { id: 'app-legacy', userId: 'auth-legacy-applicant', jobId: 'job-legacy' },
            { id: 'app-other', userId: 'auth-other-applicant', jobId: 'job-other' },
            { id: 'app-deleted', userId: 'auth-deleted', jobId: 'job-own' },
        ],
        profileViews: [
            opened(EMPLOYER.id, 'auth-pool'),
            opened(EMPLOYER.id, 'auth-closed'),
            opened(EMPLOYER.id, 'auth-hidden'),
            opened(EMPLOYER.id, 'auth-deleted'),
            opened(ADMIN.id, 'auth-pool'),
            opened(ADMIN.id, 'auth-hidden'),
        ],
        conversations: [],
        messages: [],
    };
}

function thread(supabaseIdA: string, supabaseIdB: string, jobId: string | null = null): ConversationRow {
    return {
        id: `conv-existing-${supabaseIdB}`,
        participantA: profileId(supabaseIdA),
        participantB: profileId(supabaseIdB),
        jobId,
        subject: 'Earlier thread',
        lastMessageAt: new Date('2026-09-01T00:00:00.000Z'),
        deletedByA: false,
        deletedByB: false,
    };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * Equality, OR, and nested to-one relation filters: the shapes the route
 * uses. An undefined value adds no condition, as in Prisma; an unknown field
 * throws, so a change to the route's query fails here instead of matching by
 * accident.
 */
function matches(row: object, where: Where): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (condition === undefined) return true;
        if (key === 'OR') return (condition as Where[]).some((branch) => matches(row, branch));
        if (!(key in row)) throw new Error(`fake prisma: unknown field "${key}"`);
        const value = (row as Record<string, unknown>)[key];
        if (isRecord(condition)) return isRecord(value) && matches(value, condition);
        return value === condition;
    });
}

/** Only the selected fields, as Prisma returns them. */
function pick(row: object, select?: Select): Record<string, unknown> {
    const all = row as Record<string, unknown>;
    if (!select) return { ...all };
    return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, all[key]]));
}

const jobWithOwner = (job: JobRow) => ({ ...job, employerJobs: db.employerJobs.find((ej) => ej.jobId === job.id) ?? null });
const employerJobWithJob = (ej: EmployerJobRow) => ({ ...ej, job: db.jobs.find((job) => job.id === ej.jobId) ?? null });
function applicationWithJob(application: ApplicationRow) {
    const job = db.jobs.find((row) => row.id === application.jobId);
    return { ...application, job: job ? jobWithOwner(job) : null };
}

function installFakeDatabase(): void {
    const p = h.prisma;
    p.userProfile.findUnique.mockImplementation(async (args: { where: Where; select?: Select }) => {
        const row = db.profiles.find((candidate) => matches(candidate, args.where));
        return row ? pick(row, args.select) : null;
    });
    p.profileView.findUnique.mockImplementation(async (args: { where: { viewerId_candidateId: { viewerId: string; candidateId: string } } }) => {
        const key = args.where.viewerId_candidateId;
        return db.profileViews.find((view) => view.viewerId === key.viewerId && view.candidateId === key.candidateId) ?? null;
    });
    p.jobApplication.findFirst.mockImplementation(async (args: { where: Where }) =>
        db.applications.map(applicationWithJob).find((row) => matches(row, args.where)) ?? null);
    p.employerJob.findFirst.mockImplementation(async (args: { where: Where }) =>
        db.employerJobs.map(employerJobWithJob).find((row) => matches(row, args.where)) ?? null);
    p.job.findFirst.mockImplementation(async (args: { where: Where }) =>
        db.jobs.map(jobWithOwner).find((row) => matches(row, args.where)) ?? null);
    p.job.findUnique.mockImplementation(async (args: { where: Where }) =>
        db.jobs.find((row) => matches(row, args.where)) ?? null);
    p.conversation.findFirst.mockImplementation(async (args: { where: Where }) =>
        db.conversations.find((row) => matches(row, args.where)) ?? null);
    p.conversation.create.mockImplementation(async (args: { data: Pick<ConversationRow, 'participantA' | 'participantB' | 'jobId' | 'subject'> }) => {
        sequence += 1;
        const row: ConversationRow = { id: `conv-${sequence}`, lastMessageAt: new Date(), deletedByA: false, deletedByB: false, ...args.data };
        db = { ...db, conversations: [...db.conversations, row] };
        return row;
    });
    p.conversation.update.mockImplementation(async (args: { where: { id: string }; data: Partial<ConversationRow> }) => {
        const current = db.conversations.find((row) => row.id === args.where.id);
        if (!current) throw new Error(`fake prisma: no conversation ${args.where.id}`);
        const updated = { ...current, ...args.data };
        db = { ...db, conversations: db.conversations.map((row) => (row.id === updated.id ? updated : row)) };
        return updated;
    });
    p.employerMessage.create.mockImplementation(async (args: { data: Omit<MessageRow, 'id' | 'sentAt' | 'readAt' | 'jobId'> & { jobId?: string } }) => {
        sequence += 1;
        const row: MessageRow = { id: `msg-${sequence}`, sentAt: new Date(), readAt: null, ...args.data, jobId: args.data.jobId ?? null };
        db = { ...db, messages: [...db.messages, row] };
        return row;
    });
    p.employerMessage.findMany.mockImplementation(async (args: { where: Where; include: { recipient: { select: Select }; job: { select: Select } } }) =>
        db.messages
            .filter((row) => matches(row, args.where))
            .map((row) => {
                const recipient = db.profiles.find((candidate) => candidate.id === row.recipientId);
                const job = db.jobs.find((candidate) => candidate.id === row.jobId);
                return {
                    ...row,
                    recipient: recipient ? pick(recipient, args.include.recipient.select) : null,
                    job: job ? pick(job, args.include.job.select) : null,
                };
            }));
    // The route's interactive transaction runs against the same store.
    p.$transaction.mockImplementation(async (fn: (tx: typeof p) => Promise<unknown>) => fn(p));
}

function signIn(user: SessionUser | null): void {
    h.getUser.mockResolvedValue({ data: { user }, error: null });
}

function inMail(recipientId: string, jobId?: string): Record<string, unknown> {
    return { recipientId, subject: 'Telehealth NP role', body: 'Could we talk this week?', ...(jobId && { jobId }) };
}

async function send(payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await POST(new NextRequest('http://localhost:3000/api/employer/messages', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
    }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function sentList(): Promise<{ status: number; body: { messages: Array<Record<string, unknown>> } }> {
    const res = await GET(new NextRequest('http://localhost:3000/api/employer/messages'));
    return { status: res.status, body: (await res.json()) as { messages: Array<Record<string, unknown>> } };
}

/** Nothing written, nothing emailed, and no gate past the recipient consulted. */
function expectTurnedAway(before: Store): void {
    expect(db.conversations).toEqual(before.conversations);
    expect(db.messages).toEqual(before.messages);
    expect(h.after).not.toHaveBeenCalled();
    expect(h.sendEmployerMessageNotification).not.toHaveBeenCalled();
    expect(h.prisma.employerJob.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.job.findFirst).not.toHaveBeenCalled();
    expect(h.canSendInMail).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.clearAllMocks();
    sequence = 0;
    db = seed();
    installFakeDatabase();
    h.sendEmployerMessageNotification.mockResolvedValue({ success: true });
    h.getEmployerTier.mockResolvedValue('pro');
    h.canSendInMail.mockResolvedValue({ allowed: true, used: 0, limit: 25 });
    signIn(EMPLOYER);
});

describe('POST /api/employer/messages: the ways an employer reaches someone', () => {
    it('opens a thread with a pool candidate whose profile it opened, and emails them', async () => {
        const res = await send(inMail('auth-pool'));

        expect(res.status).toBe(200);
        expect(db.conversations).toHaveLength(1);
        expect(db.messages).toEqual([
            expect.objectContaining({ senderId: profileId(EMPLOYER.id), recipientId: profileId('auth-pool'), conversationId: db.conversations[0].id }),
        ]);
        expect(h.canSendInMail).toHaveBeenCalledTimes(1);
        expect(h.after).toHaveBeenCalledTimes(1);
        expect(h.sendEmployerMessageNotification).toHaveBeenCalledWith(
            'auth-pool@example.com', 'Grace', 'Ada Lovelace', 'Riverside Psychiatry', 'Telehealth NP role', 'Could we talk this week?', null,
        );
    });

    it.each([
        ['about the job they applied to, as the applicants view sends it', 'job-own'],
        ['with no job id', undefined],
    ])('opens a thread with an applicant to one of its own jobs who is out of the pool, %s', async (_label, jobId) => {
        const res = await send(inMail('auth-applicant', jobId));

        expect(res.status).toBe(200);
        expect(db.messages).toEqual([
            expect.objectContaining({ recipientId: profileId('auth-applicant'), jobId: jobId ?? null }),
        ]);
        expect(h.sendEmployerMessageNotification).toHaveBeenCalledTimes(1);
    });

    it('reaches an applicant to an unclaimed legacy post filed under its sign-in email', async () => {
        const res = await send(inMail('auth-legacy-applicant'));

        expect(res.status).toBe(200);
        expect(db.messages).toEqual([expect.objectContaining({ recipientId: profileId('auth-legacy-applicant') })]);
    });

    it('lands a reply in the existing thread after the recipient left the pool, without an InMail', async () => {
        db = { ...db, conversations: [thread(EMPLOYER.id, 'auth-hidden')] };

        const res = await send(inMail('auth-hidden'));

        expect(res.status).toBe(200);
        expect(res.body.conversationId).toBe('conv-existing-auth-hidden');
        expect(db.conversations).toHaveLength(1);
        expect(db.messages).toEqual([expect.objectContaining({ conversationId: 'conv-existing-auth-hidden', recipientId: profileId('auth-hidden') })]);
        expect(h.canSendInMail).not.toHaveBeenCalled();
    });
});

describe('POST /api/employer/messages: anyone else answers as an unknown id does', () => {
    it('answers 404 for an id with no profile', async () => {
        const before = db;

        expect(await send(inMail('not-a-user'))).toEqual(NOT_FOUND);
        expectTurnedAway(before);
    });

    it.each([
        ['a seeker who switched off Open to offers after it opened the profile', 'auth-closed', undefined],
        ['a seeker hidden from employers after it opened the profile', 'auth-hidden', undefined],
        ['a pool candidate whose profile it never opened', 'auth-pool-unopened', undefined],
        ['an applicant to another employer\'s job', 'auth-other-applicant', undefined],
        ['another employer', OTHER_EMPLOYER.id, undefined],
        ['an admin', ADMIN.id, undefined],
        ['a deleted account it once reached', 'auth-deleted', undefined],
        ['a seeker out of the pool, on its own featured job', 'auth-hidden', 'job-own'],
    ])('answers 404 for %s: nothing written or emailed, no InMail check', async (_label, recipientId, jobId) => {
        const before = db;

        expect(await send(inMail(recipientId, jobId))).toEqual(NOT_FOUND);
        expectTurnedAway(before);
    });

    it('treats a new job key with someone it has a thread with as new outreach', async () => {
        db = { ...db, conversations: [thread(EMPLOYER.id, 'auth-hidden')] };
        const before = db;

        expect(await send(inMail('auth-hidden', 'job-own'))).toEqual(NOT_FOUND);
        expectTurnedAway(before);
    });

    it('never reaches a deleted account, not even by a reply in an existing thread', async () => {
        db = { ...db, conversations: [thread(EMPLOYER.id, 'auth-deleted')] };
        const before = db;

        expect(await send(inMail('auth-deleted'))).toEqual(NOT_FOUND);
        expectTurnedAway(before);
    });

    it('leaves out the legacy post for a session with no email', async () => {
        signIn(EMPLOYER_NO_EMAIL);
        const before = db;

        expect(await send(inMail('auth-legacy-applicant'))).toEqual(NOT_FOUND);
        expectTurnedAway(before);
    });
});

describe('POST /api/employer/messages: an admin sends under the same rules', () => {
    beforeEach(() => {
        signIn(ADMIN);
    });

    it('opens a thread with a pool candidate whose profile the admin opened', async () => {
        const res = await send(inMail('auth-pool'));

        expect(res.status).toBe(200);
        expect(db.messages).toEqual([expect.objectContaining({ senderId: profileId(ADMIN.id), recipientId: profileId('auth-pool') })]);
    });

    it('cannot reach a seeker hidden from employers', async () => {
        const before = db;

        expect(await send(inMail('auth-hidden'))).toEqual(NOT_FOUND);
        expectTurnedAway(before);
    });
});

describe('GET /api/employer/messages: the sent list', () => {
    function sentTo(supabaseId: string): MessageRow {
        return {
            id: `msg-to-${supabaseId}`,
            senderId: profileId(EMPLOYER.id),
            recipientId: profileId(supabaseId),
            conversationId: 'conv-1',
            subject: 'Telehealth NP role',
            body: 'Could we talk this week?',
            jobId: null,
            sentAt: new Date('2026-10-02T09:00:00.000Z'),
            readAt: null,
        };
    }

    it('names an unnamed recipient "Candidate", never by email address', async () => {
        db = { ...db, messages: [sentTo('auth-unnamed')] };

        const res = await sentList();

        expect(res.status).toBe(200);
        expect(res.body.messages).toEqual([expect.objectContaining({ id: 'msg-to-auth-unnamed', recipientName: 'Candidate' })]);
        expect(JSON.stringify(res.body)).not.toContain('unnamed.person@example.com');
    });

    it('names a named recipient by first and last name, as before', async () => {
        db = { ...db, messages: [sentTo('auth-applicant')] };

        const res = await sentList();

        expect(res.body.messages).toEqual([expect.objectContaining({ recipientName: 'Grace Hopper' })]);
    });
});
