/**
 * Every new thread an employer opens spends one InMail credit of one of its
 * active postings, and the count finds it later (owner, 2026-11-25).
 *
 * canSendInMail counted threads by their posting's job, so a thread opened
 * with no job named counted against no posting: leaving out the job id sent
 * InMails without limit. Now:
 *   - With no job named, the thread spends the credit of the active posting
 *     with credit left that ends soonest (inMailSpendOrder), and the message
 *     that opens it records that posting. The thread itself names no job, as
 *     the employer sent it.
 *   - A named job spends its own posting's credit and no other's.
 *   - With no credit to spend, the send is refused as at the limit, and
 *     nothing is written.
 *   - A reply stays free.
 *   - Only threads the employer opened count, as on PMHNP Hiring: a
 *     candidate's question about a job no longer spends the employer's own
 *     allowance.
 *
 * The fake prisma applies the real where clauses to rows in memory, so the
 * route, canSendInMail and the count run as written. Every fixture is
 * fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { rowMatches, type Relations, type Row } from '../helpers/fake-row-where';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    after: vi.fn(),
    sendEmployerMessageNotification: vi.fn(),
    prisma: {
        userProfile: { findUnique: vi.fn() },
        profileView: { findUnique: vi.fn(), count: vi.fn() },
        jobApplication: { findFirst: vi.fn() },
        job: { findFirst: vi.fn(), findUnique: vi.fn() },
        employerJob: { findFirst: vi.fn(), findMany: vi.fn() },
        conversation: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
        employerMessage: { create: vi.fn() },
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
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/email-service', () => ({ sendEmployerMessageNotification: h.sendEmployerMessageNotification }));

import { POST } from '@/app/api/employer/messages/route';
import { canSendInMail, getInMailsForPosting, getPerPostingUsage, inMailSpendOrder } from '@/lib/tier-limits';
import { config } from '@/lib/config';

const LIMIT = config.limits.inmailsPerPosting;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const at = (days: number): Date => new Date(NOW + days * DAY);

const EMPLOYER = { id: 'auth-employer', email: 'hiring@clinic.example', email_confirmed_at: '2026-10-01T00:00:00Z' };
const EMPLOYER_PROFILE = 'profile-employer';

/** Three live postings: one ends in 10 days, one in 50, one has no end date. */
const POSTED: Record<string, Date> = { 'job-soon': at(-20), 'job-late': at(-5), 'job-open': at(-30) };

interface Store {
    profiles: Row[];
    jobs: Row[];
    employerJobs: Row[];
    profileViews: Row[];
    conversations: Row[];
    messages: Row[];
}

let db: Store;
let sequence = 0;

/** A strictly later time for every row written, so the first message of a thread is unambiguous. */
const tick = (): Date => new Date(NOW + ++sequence);

function candidate(key: string): Row {
    return {
        id: `profile-${key}`, supabaseId: `auth-${key}`, email: `${key}@example.com`, firstName: 'Grace', lastName: 'Hopper',
        company: null, role: 'job_seeker', profileVisible: true, openToOffers: true, deletedAt: null,
    };
}

function seed(): Store {
    return {
        profiles: [
            {
                id: EMPLOYER_PROFILE, supabaseId: EMPLOYER.id, email: EMPLOYER.email, firstName: 'Ada', lastName: 'Lovelace',
                company: 'Riverside Psychiatry', role: 'employer', profileVisible: false, openToOffers: false, deletedAt: null,
            },
            candidate('cand-1'),
            candidate('cand-2'),
            candidate('cand-3'),
        ],
        jobs: [
            { id: 'job-soon', title: 'Psychiatric NP', isPublished: true, expiresAt: at(10) },
            { id: 'job-late', title: 'Family NP', isPublished: true, expiresAt: at(50) },
            { id: 'job-open', title: 'Telehealth NP', isPublished: true, expiresAt: null },
        ],
        employerJobs: Object.entries(POSTED).map(([jobId, createdAt]) => ({
            id: `ej-${jobId}`, jobId, userId: EMPLOYER.id, contactEmail: EMPLOYER.email, pricingTier: 'pro', createdAt,
        })),
        // The employer opened each candidate's profile, so each is in reach.
        profileViews: ['cand-1', 'cand-2', 'cand-3'].map((key) => ({ viewerId: EMPLOYER.id, candidateId: `auth-${key}` })),
        conversations: [],
        messages: [],
    };
}

const relations: Relations = {
    job: (row) => db.jobs.find((job) => job.id === row.jobId) ?? null,
    employerJobs: (row) => db.employerJobs.find((ej) => ej.jobId === row.id) ?? null,
    messages: (row) => db.messages.filter((m) => m.conversationId === row.id),
};
const matches = (row: Row, where: unknown): boolean => rowMatches(row, where, relations);

function pick(row: Row, select?: Record<string, unknown>): Row {
    if (!select) return { ...row };
    return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

const bySentAt = (a: Row, b: Row): number =>
    (a.sentAt as Date).getTime() - (b.sentAt as Date).getTime() || String(a.id).localeCompare(String(b.id));

function installFakeDatabase(): void {
    const p = h.prisma;
    p.userProfile.findUnique.mockImplementation(async ({ where, select }: { where: Row; select?: Record<string, unknown> }) => {
        const row = db.profiles.find((profile) => matches(profile, where));
        return row ? pick(row, select) : null;
    });
    p.profileView.findUnique.mockImplementation(async ({ where }: { where: { viewerId_candidateId: Row } }) =>
        db.profileViews.find((view) => matches(view, where.viewerId_candidateId)) ?? null);
    p.profileView.count.mockResolvedValue(0);
    p.jobApplication.findFirst.mockResolvedValue(null);
    p.job.findFirst.mockImplementation(async ({ where }: { where: Row }) => db.jobs.find((job) => matches(job, where)) ?? null);
    p.job.findUnique.mockImplementation(async ({ where }: { where: Row }) => db.jobs.find((job) => matches(job, where)) ?? null);
    p.employerJob.findFirst.mockImplementation(async ({ where }: { where: Row }) =>
        db.employerJobs.find((ej) => matches(ej, where)) ?? null);
    // getEmployerActivePostings: its own where, newest first, with the job.
    p.employerJob.findMany.mockImplementation(async ({ where }: { where: Row }) =>
        db.employerJobs
            .filter((ej) => matches(ej, where))
            .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
            .map((ej) => ({ ...ej, job: { ...relations.job(ej) as Row, createdAt: ej.createdAt } })));
    p.conversation.findFirst.mockImplementation(async ({ where }: { where: Row }) =>
        db.conversations.find((conv) => matches(conv, where)) ?? null);
    // getInMailsForPosting: its where, and each thread's first message.
    p.conversation.findMany.mockImplementation(async ({ where, select }: {
        where: Row;
        select: { messages: { take: number } };
    }) => db.conversations
        .filter((conv) => matches(conv, where))
        .map((conv) => ({
            jobId: conv.jobId,
            messages: db.messages
                .filter((m) => m.conversationId === conv.id)
                .sort(bySentAt)
                .slice(0, select.messages.take)
                .map((m) => ({ senderId: m.senderId, jobId: m.jobId })),
        })));
    p.conversation.create.mockImplementation(async ({ data }: { data: Row }) => {
        const row = { id: `conv-${++sequence}`, createdAt: tick(), lastMessageAt: tick(), deletedByA: false, deletedByB: false, ...data };
        db = { ...db, conversations: [...db.conversations, row] };
        return row;
    });
    p.conversation.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const updated = { ...db.conversations.find((conv) => conv.id === where.id), ...data };
        db = { ...db, conversations: db.conversations.map((conv) => (conv.id === where.id ? updated : conv)) };
        return updated;
    });
    p.employerMessage.create.mockImplementation(async ({ data }: { data: Row }) => {
        const row = { id: `msg-${String(++sequence).padStart(4, '0')}`, sentAt: tick(), readAt: null, ...data, jobId: data.jobId ?? null };
        db = { ...db, messages: [...db.messages, row] };
        return row;
    });
    p.$transaction.mockImplementation(async (fn: (tx: typeof p) => Promise<unknown>) => fn(p));
}

/**
 * `count` threads already opened, each with a message: by the employer
 * unless `opener` says otherwise. `jobId` is the thread's job; `charged` the
 * posting the opening message names when the thread names none.
 */
function threads(count: number, opts: { jobId?: string | null; charged?: string | null; opener?: 'employer' | 'candidate'; tag: string }): void {
    const rows = Array.from({ length: count }, (_, i) => {
        const other = `profile-${opts.tag}-${i}`;
        const conv = { id: `conv-${opts.tag}-${i}`, participantA: EMPLOYER_PROFILE, participantB: other, jobId: opts.jobId ?? null, createdAt: tick() };
        const byEmployer = (opts.opener ?? 'employer') === 'employer';
        const opening = {
            id: `msg-${opts.tag}-${String(i).padStart(4, '0')}`,
            conversationId: conv.id,
            senderId: byEmployer ? EMPLOYER_PROFILE : other,
            recipientId: byEmployer ? other : EMPLOYER_PROFILE,
            jobId: opts.jobId ?? opts.charged ?? null,
            sentAt: tick(),
        };
        return { conv, opening };
    });
    db = {
        ...db,
        conversations: [...db.conversations, ...rows.map((r) => r.conv)],
        messages: [...db.messages, ...rows.map((r) => r.opening)],
    };
}

/** A reply in a thread: a later message, which never changes who opened it. */
function reply(conversationId: string, senderId: string, jobId: string | null = null): void {
    db = { ...db, messages: [...db.messages, { id: `msg-reply-${++sequence}`, conversationId, senderId, recipientId: 'x', jobId, sentAt: tick() }] };
}

const countFor = (jobId: string): Promise<number> => getInMailsForPosting(EMPLOYER_PROFILE, jobId, POSTED[jobId]);

async function send(recipientId: string, jobId?: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await POST(new NextRequest('http://localhost:3000/api/employer/messages', {
        method: 'POST',
        body: JSON.stringify({ recipientId, subject: 'Telehealth NP role', body: 'Could we talk this week?', ...(jobId && { jobId }) }),
        headers: { 'Content-Type': 'application/json' },
    }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
    vi.clearAllMocks();
    sequence = 0;
    db = seed();
    installFakeDatabase();
    h.sendEmployerMessageNotification.mockResolvedValue({ success: true });
    h.getUser.mockResolvedValue({ data: { user: EMPLOYER }, error: null });
});

describe('inMailSpendOrder', () => {
    const posting = (id: string, expiresAt: Date | null, createdAt: Date) => ({ id, createdAt, job: { expiresAt } });

    it('spends the posting that ends soonest first, and one with no end date last', () => {
        const order = inMailSpendOrder([
            posting('open', null, at(-30)),
            posting('late', at(50), at(-5)),
            posting('soon', at(10), at(-20)),
        ]);
        expect(order.map((p) => p.id)).toEqual(['soon', 'late', 'open']);
    });

    it('breaks a tie on the end date by the older posting, then by id, the same way every time', () => {
        const order = inMailSpendOrder([
            posting('b', at(10), at(-5)),
            posting('newer', at(10), at(-1)),
            posting('a', at(10), at(-5)),
        ]);
        expect(order.map((p) => p.id)).toEqual(['a', 'b', 'newer']);
    });
});

describe('getInMailsForPosting: what counts against a posting', () => {
    it('counts a thread the employer opened about the job once, however many messages it holds', async () => {
        threads(2, { jobId: 'job-soon', tag: 'named' });
        reply('conv-named-0', 'profile-named-0', 'job-soon');
        reply('conv-named-0', EMPLOYER_PROFILE, 'job-soon');

        expect(await countFor('job-soon')).toBe(2);
    });

    it('counts a thread that names no job when the message that opened it names the posting', async () => {
        threads(3, { charged: 'job-soon', tag: 'charged' });
        reply('conv-charged-0', 'profile-charged-0');

        expect(await countFor('job-soon')).toBe(3);
        expect(await countFor('job-late')).toBe(0);
    });

    it('leaves out a thread with no job charged to no posting, as every one opened before 2026-11-25 was', async () => {
        threads(4, { tag: 'legacy' });

        expect(await countFor('job-soon')).toBe(0);
        expect(await countFor('job-open')).toBe(0);
    });

    it("leaves out a candidate's question about the job, after the employer replied too", async () => {
        threads(5, { jobId: 'job-soon', opener: 'candidate', tag: 'asked' });
        reply('conv-asked-0', EMPLOYER_PROFILE, 'job-soon');

        expect(await countFor('job-soon')).toBe(0);
    });

    it('leaves out a thread opened before the posting began', async () => {
        threads(1, { jobId: 'job-late', tag: 'old' });
        db = { ...db, conversations: db.conversations.map((conv) => ({ ...conv, createdAt: at(-6) })) };

        expect(await countFor('job-late')).toBe(0);
    });
});

describe('canSendInMail: the credit a new thread spends', () => {
    it('with no job named, picks the active posting with credit left that ends soonest', async () => {
        expect(await canSendInMail(EMPLOYER_PROFILE, EMPLOYER.id, 'pro')).toEqual({ allowed: true, used: 0, limit: LIMIT, jobId: 'job-soon' });
    });

    it('moves to the next posting to end once one has spent its credit', async () => {
        threads(LIMIT, { charged: 'job-soon', tag: 'spent' });

        expect(await canSendInMail(EMPLOYER_PROFILE, EMPLOYER.id, 'pro')).toMatchObject({ allowed: true, jobId: 'job-late' });
    });

    it('refuses when no active posting has credit left, with the totals it read', async () => {
        threads(LIMIT, { charged: 'job-soon', tag: 'soon' });
        threads(LIMIT, { jobId: 'job-late', tag: 'late' });
        threads(LIMIT, { charged: 'job-open', tag: 'open' });

        expect(await canSendInMail(EMPLOYER_PROFILE, EMPLOYER.id, 'pro')).toEqual({ allowed: false, used: 3 * LIMIT, limit: 3 * LIMIT });
    });

    it('spends a named job on its own posting only: refused when that one is spent, though another has credit', async () => {
        threads(LIMIT, { jobId: 'job-late', tag: 'late' });

        expect(await canSendInMail(EMPLOYER_PROFILE, EMPLOYER.id, 'pro', 'job-late')).toEqual({ allowed: false, used: LIMIT, limit: LIMIT });
        expect(await canSendInMail(EMPLOYER_PROFILE, EMPLOYER.id, 'pro', 'job-open')).toMatchObject({ allowed: true, jobId: 'job-open' });
    });

    it('refuses a named job that is not one of its active postings', async () => {
        db = { ...db, jobs: db.jobs.map((job) => (job.id === 'job-late' ? { ...job, expiresAt: at(-1) } : job)) };

        expect(await canSendInMail(EMPLOYER_PROFILE, EMPLOYER.id, 'pro', 'job-late')).toEqual({ allowed: false, used: 0, limit: LIMIT });
        expect(await canSendInMail(EMPLOYER_PROFILE, EMPLOYER.id, 'pro', 'job-elsewhere')).toMatchObject({ allowed: false });
    });

    it("leaves a posting's credit alone for candidates' questions about it", async () => {
        threads(LIMIT, { jobId: 'job-soon', opener: 'candidate', tag: 'asked' });

        expect(await canSendInMail(EMPLOYER_PROFILE, EMPLOYER.id, 'pro')).toMatchObject({ allowed: true, used: 0, jobId: 'job-soon' });
    });
});

describe('POST /api/employer/messages: the count finds every new thread', () => {
    it('charges a new thread with no job to the posting that ends soonest, and the count includes it', async () => {
        const res = await send('auth-cand-1');

        expect(res.status).toBe(200);
        // The thread names no job, as the employer sent it; its opening
        // message records the posting that paid.
        expect(db.conversations).toEqual([expect.objectContaining({ jobId: null })]);
        expect(db.messages).toEqual([expect.objectContaining({ senderId: EMPLOYER_PROFILE, jobId: 'job-soon' })]);
        expect(await countFor('job-soon')).toBe(1);
        expect(await countFor('job-late')).toBe(0);
        // The candidate is not told of a job the employer never named.
        expect(h.sendEmployerMessageNotification).toHaveBeenCalledWith(
            'cand-1@example.com', 'Grace', 'Ada Lovelace', 'Riverside Psychiatry', 'Telehealth NP role', 'Could we talk this week?', null,
        );

        const usage = await getPerPostingUsage(EMPLOYER_PROFILE, EMPLOYER.id);
        expect(usage.find((p) => p.jobId === 'job-soon')?.inmails).toEqual({ used: 1, limit: LIMIT, remaining: LIMIT - 1 });
    });

    it('lands a later message to the same candidate in that thread as a free reply', async () => {
        await send('auth-cand-1');
        const res = await send('auth-cand-1');

        expect(res.status).toBe(200);
        expect(db.conversations).toHaveLength(1);
        expect(db.messages.map((m) => m.jobId)).toEqual(['job-soon', null]);
        expect(await countFor('job-soon')).toBe(1);
    });

    it('spends one more credit for each new thread, moving on when a posting has none left', async () => {
        threads(LIMIT - 1, { charged: 'job-soon', tag: 'spent' });

        await send('auth-cand-1');
        await send('auth-cand-2');

        expect(await countFor('job-soon')).toBe(LIMIT);
        expect(await countFor('job-late')).toBe(1);
        expect(db.messages.slice(-2).map((m) => m.jobId)).toEqual(['job-soon', 'job-late']);
    });

    it('refuses a new thread with no job when no active posting has credit left, and writes nothing', async () => {
        threads(LIMIT, { charged: 'job-soon', tag: 'soon' });
        threads(LIMIT, { charged: 'job-late', tag: 'late' });
        threads(LIMIT, { jobId: 'job-open', tag: 'open' });
        const before = db;

        expect(await send('auth-cand-1')).toEqual({
            status: 403,
            body: { error: 'InMail limit reached for this posting', used: 3 * LIMIT, limit: 3 * LIMIT, tier: 'pro', upgradeRequired: true },
        });
        expect(db.conversations).toEqual(before.conversations);
        expect(db.messages).toEqual(before.messages);
        expect(h.sendEmployerMessageNotification).not.toHaveBeenCalled();
    });

    it('refuses a named job whose posting is spent, though another posting has credit', async () => {
        threads(LIMIT, { jobId: 'job-soon', tag: 'soon' });
        const before = db;

        expect((await send('auth-cand-1', 'job-soon')).status).toBe(403);
        expect(db.messages).toEqual(before.messages);
        expect(await countFor('job-soon')).toBe(LIMIT);
    });

    it('opens a thread about a named job on that posting, and counts it there', async () => {
        expect((await send('auth-cand-1', 'job-late')).status).toBe(200);

        expect(db.conversations).toEqual([expect.objectContaining({ jobId: 'job-late' })]);
        expect(db.messages).toEqual([expect.objectContaining({ jobId: 'job-late' })]);
        expect(await countFor('job-late')).toBe(1);
        expect(await countFor('job-soon')).toBe(0);
    });

    it('lets a reply land with every posting spent: a reply needs no credit', async () => {
        threads(LIMIT, { charged: 'job-soon', tag: 'soon' });
        threads(LIMIT, { charged: 'job-late', tag: 'late' });
        threads(LIMIT, { charged: 'job-open', tag: 'open' });
        db = {
            ...db,
            conversations: [...db.conversations, { id: 'conv-earlier', participantA: EMPLOYER_PROFILE, participantB: 'profile-cand-1', jobId: null, createdAt: at(-40) }],
        };

        const res = await send('auth-cand-1');

        expect(res.status).toBe(200);
        expect(res.body.conversationId).toBe('conv-earlier');
        expect(db.messages.at(-1)).toMatchObject({ conversationId: 'conv-earlier', jobId: null });
    });
});
