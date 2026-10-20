/**
 * The inbox never names a person by their email address, and a reply never
 * reaches an account its owner deleted.
 *
 * Before:
 *   - GET /api/conversations and GET /api/conversations/[id] read the other
 *     participant's email and, when that person had no name and no company,
 *     showed the start of the address (everything before the @) as their
 *     name, to the other side of every thread.
 *   - POST /api/conversations/[id] stored a reply to a deleted account and
 *     emailed the deleted address. Deletion hides the profile and suppresses
 *     email (app/api/auth/delete-account), but the notification senders do
 *     not check suppression, and POST /api/employer/messages already refuses
 *     a deleted recipient.
 *
 * Pinned:
 *   - An unnamed person with no company is "User", a person is still named
 *     by name, then by company, and neither GET reads an email address.
 *   - A reply to a deleted account answers exactly as an unknown thread does,
 *     from either side and before the awaiting-reply gate, and nothing is
 *     written or emailed.
 *   - A reply to a live participant still lands in the thread and emails
 *     them, from either side.
 *
 * The prisma fake applies the route's own where, include and select to
 * in-memory rows, so a field the route does not select is not there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    after: vi.fn(),
    sendEmployerMessageNotification: vi.fn(),
    sendCandidateInquiryNotification: vi.fn(),
    prisma: {
        userProfile: { findUnique: vi.fn() },
        conversation: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
        employerMessage: { groupBy: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(), create: vi.fn() },
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
vi.mock('@/lib/csrf', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/email-service', () => ({
    sendEmployerMessageNotification: h.sendEmployerMessageNotification,
    sendCandidateInquiryNotification: h.sendCandidateInquiryNotification,
}));
vi.mock('@/lib/document-storage', () => ({
    mintDocReadUrl: vi.fn(async () => 'signed-url'),
    extractRequestContext: vi.fn(() => ({})),
    toBareDocPath: vi.fn(() => null),
}));

import { GET as LIST } from '@/app/api/conversations/route';
import { GET as THREAD, POST as REPLY } from '@/app/api/conversations/[id]/route';

type Where = Record<string, unknown>;
type Select = Record<string, unknown>;

type ProfileRow = {
    id: string;
    supabaseId: string;
    email: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    avatarUrl: string | null;
    headline: string | null;
    specialties: string | null;
    licenseStates: string | null;
    deletedAt: Date | null;
};

type ConversationRow = {
    id: string;
    participantA: string;
    participantB: string;
    jobId: string | null;
    subject: string;
    lastMessageAt: Date;
    createdAt: Date;
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
    editedAt: Date | null;
    attachmentUrl: string | null;
    attachmentName: string | null;
    deletedBySender: boolean;
    deletedByRecipient: boolean;
};

interface Store {
    profiles: ProfileRow[];
    conversations: ConversationRow[];
    messages: MessageRow[];
}

interface Include {
    userA?: { select: Select };
    userB?: { select: Select };
    job?: { select: Select };
    messages?: { take?: number; select: Select };
}

const EMPLOYER = 'auth-employer';
const SEEKER = 'auth-seeker';
const UNNAMED_SEEKER = 'auth-unnamed-seeker';
const UNNAMED_EMPLOYER = 'auth-unnamed-employer';
const COMPANY_ONLY_EMPLOYER = 'auth-company-employer';
const DELETED_SEEKER = 'auth-deleted-seeker';
const DELETED_EMPLOYER = 'auth-deleted-employer';
const QUIET_DELETED_EMPLOYER = 'auth-quiet-deleted-employer';

const UNNAMED_SEEKER_EMAIL = 'unnamed.person@example.com';
const UNNAMED_EMPLOYER_EMAIL = 'recruiting.desk@clinic.example';
const DELETED_ON = new Date('2026-10-01T12:00:00.000Z');
const NOT_FOUND = { status: 404, body: { error: 'Conversation not found' } };

let db: Store;
let sequence = 0;

const profileId = (supabaseId: string): string => `profile-${supabaseId}`;

function person(supabaseId: string, overrides: Partial<ProfileRow> = {}): ProfileRow {
    return {
        id: profileId(supabaseId),
        supabaseId,
        email: `${supabaseId}@example.com`,
        role: 'job_seeker',
        firstName: 'Grace',
        lastName: 'Hopper',
        company: null,
        avatarUrl: null,
        headline: null,
        specialties: null,
        licenseStates: null,
        deletedAt: null,
        ...overrides,
    };
}

function thread(id: string, supabaseIdA: string, supabaseIdB: string): ConversationRow {
    return {
        id,
        participantA: profileId(supabaseIdA),
        participantB: profileId(supabaseIdB),
        jobId: null,
        subject: 'Telehealth NP role',
        lastMessageAt: new Date('2026-09-01T00:00:00.000Z'),
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        deletedByA: false,
        deletedByB: false,
    };
}

/** A message already read, so it never holds back the next notification. */
function sent(conversationId: string, from: string, to: string, body: string): MessageRow {
    return {
        id: `msg-${conversationId}-${from}`,
        senderId: profileId(from),
        recipientId: profileId(to),
        conversationId,
        subject: 'Telehealth NP role',
        body,
        jobId: null,
        sentAt: new Date('2026-09-01T09:00:00.000Z'),
        readAt: new Date('2026-09-01T10:00:00.000Z'),
        editedAt: null,
        attachmentUrl: null,
        attachmentName: null,
        deletedBySender: false,
        deletedByRecipient: false,
    };
}

function seed(): Store {
    return {
        profiles: [
            person(EMPLOYER, { role: 'employer', firstName: 'Ada', lastName: 'Lovelace', company: 'Riverside Psychiatry', email: 'hiring@clinic.example' }),
            person(SEEKER),
            person(UNNAMED_SEEKER, { firstName: null, lastName: null, email: UNNAMED_SEEKER_EMAIL }),
            person(UNNAMED_EMPLOYER, { role: 'employer', firstName: null, lastName: null, email: UNNAMED_EMPLOYER_EMAIL }),
            person(COMPANY_ONLY_EMPLOYER, { role: 'employer', firstName: null, lastName: null, company: 'Lakeside Clinic' }),
            // As app/api/auth/delete-account leaves them.
            person(DELETED_SEEKER, { firstName: 'Dana', lastName: 'Gone', deletedAt: DELETED_ON }),
            person(DELETED_EMPLOYER, { role: 'employer', firstName: 'Del', lastName: 'Eted', company: 'Closed Clinic', deletedAt: DELETED_ON }),
            person(QUIET_DELETED_EMPLOYER, { role: 'employer', firstName: 'Quinn', lastName: 'Quiet', company: 'Quiet Clinic', deletedAt: DELETED_ON }),
        ],
        conversations: [
            thread('conv-live', EMPLOYER, SEEKER),
            thread('conv-unnamed-seeker', EMPLOYER, UNNAMED_SEEKER),
            thread('conv-unnamed-employer', UNNAMED_EMPLOYER, SEEKER),
            thread('conv-company-employer', COMPANY_ONLY_EMPLOYER, SEEKER),
            thread('conv-deleted-seeker', EMPLOYER, DELETED_SEEKER),
            thread('conv-deleted-employer', DELETED_EMPLOYER, SEEKER),
            // The seeker wrote first and this employer never answered.
            thread('conv-quiet-deleted-employer', SEEKER, QUIET_DELETED_EMPLOYER),
        ],
        messages: [
            sent('conv-live', EMPLOYER, SEEKER, 'Could we talk this week?'),
            sent('conv-unnamed-seeker', EMPLOYER, UNNAMED_SEEKER, 'Are you still looking?'),
            sent('conv-unnamed-employer', UNNAMED_EMPLOYER, SEEKER, 'We have an opening.'),
            sent('conv-company-employer', COMPANY_ONLY_EMPLOYER, SEEKER, 'We have a night shift.'),
            sent('conv-deleted-seeker', DELETED_SEEKER, EMPLOYER, 'I am interested.'),
            sent('conv-deleted-employer', DELETED_EMPLOYER, SEEKER, 'Thanks for applying.'),
            sent('conv-quiet-deleted-employer', SEEKER, QUIET_DELETED_EMPLOYER, 'Is this role still open?'),
        ],
    };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * Equality, OR and { not } filters: the shapes these routes use. An undefined
 * value adds no condition, as in Prisma; an unknown field or filter throws, so
 * a change to a route's query fails here instead of matching by accident.
 */
function matches(row: object, where: Where): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (condition === undefined) return true;
        if (key === 'OR') return (condition as Where[]).some((branch) => matches(row, branch));
        if (!(key in row)) throw new Error(`fake prisma: unknown field "${key}"`);
        const value = (row as Record<string, unknown>)[key];
        if (isRecord(condition)) {
            if (Object.keys(condition).join() !== 'not') throw new Error(`fake prisma: unsupported filter on "${key}"`);
            return value !== condition.not;
        }
        return value === condition;
    });
}

/** Only the selected scalar fields, as Prisma returns them. */
function pick(row: object, select: Select): Record<string, unknown> {
    const all = row as Record<string, unknown>;
    return Object.fromEntries(
        Object.keys(select).filter((key) => select[key] === true).map((key) => {
            if (!(key in all)) throw new Error(`fake prisma: unknown field "${key}"`);
            return [key, all[key]];
        }),
    );
}

function participant(id: string): ProfileRow {
    const row = db.profiles.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`fake prisma: no profile ${id}`);
    return row;
}

function withInclude(conversation: ConversationRow, include: Include): Record<string, unknown> {
    return {
        ...conversation,
        ...(include.userA && { userA: pick(participant(conversation.participantA), include.userA.select) }),
        ...(include.userB && { userB: pick(participant(conversation.participantB), include.userB.select) }),
        ...(include.job && { job: null }),
        ...(include.messages && {
            messages: db.messages
                .filter((message) => message.conversationId === conversation.id)
                .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
                .slice(0, include.messages.take)
                .map((message) => pick(message, include.messages!.select)),
        }),
    };
}

function installFakeDatabase(): void {
    const p = h.prisma;
    p.userProfile.findUnique.mockImplementation(async (args: { where: Where; select: Select }) => {
        const row = db.profiles.find((candidate) => matches(candidate, args.where));
        return row ? pick(row, args.select) : null;
    });
    p.conversation.findMany.mockImplementation(async (args: { where: Where; include: Include }) =>
        db.conversations
            .filter((row) => matches(row, args.where))
            .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
            .map((row) => withInclude(row, args.include)));
    p.conversation.findUnique.mockImplementation(async (args: { where: { id: string }; include: Include }) => {
        const row = db.conversations.find((candidate) => candidate.id === args.where.id);
        return row ? withInclude(row, args.include) : null;
    });
    p.conversation.update.mockImplementation(async (args: { where: { id: string }; data: Partial<ConversationRow> }) => {
        const existing = db.conversations.find((row) => row.id === args.where.id);
        if (!existing) throw new Error(`fake prisma: no conversation ${args.where.id}`);
        const updated = { ...existing, ...args.data };
        db = { ...db, conversations: db.conversations.map((row) => (row.id === updated.id ? updated : row)) };
        return updated;
    });
    p.employerMessage.groupBy.mockImplementation(async (args: { where: Where }) => {
        const counts = new Map<string, number>();
        for (const row of db.messages.filter((message) => matches(message, args.where))) {
            counts.set(row.conversationId, (counts.get(row.conversationId) ?? 0) + 1);
        }
        return [...counts].map(([conversationId, count]) => ({ conversationId, _count: { id: count } }));
    });
    p.employerMessage.findMany.mockImplementation(async (args: { where: Where }) =>
        db.messages
            .filter((row) => matches(row, args.where))
            .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
            .map((row) => ({ ...row, sender: { supabaseId: participant(row.senderId).supabaseId } })));
    p.employerMessage.updateMany.mockImplementation(async (args: { where: Where; data: Partial<MessageRow> }) => {
        const hit = db.messages.filter((row) => matches(row, args.where));
        db = { ...db, messages: db.messages.map((row) => (hit.includes(row) ? { ...row, ...args.data } : row)) };
        return { count: hit.length };
    });
    p.employerMessage.count.mockImplementation(async (args: { where: Where }) =>
        db.messages.filter((row) => matches(row, args.where)).length);
    p.employerMessage.create.mockImplementation(async (args: { data: Partial<MessageRow> }) => {
        sequence += 1;
        // Defaults first, then what the route wrote (it always writes the
        // sender, recipient, conversation, subject and body).
        const row = {
            id: `msg-new-${sequence}`,
            jobId: null,
            sentAt: new Date(),
            readAt: null,
            editedAt: null,
            attachmentUrl: null,
            attachmentName: null,
            deletedBySender: false,
            deletedByRecipient: false,
            ...args.data,
        } as MessageRow;
        db = { ...db, messages: [...db.messages, row] };
        return row;
    });
}

function signIn(supabaseId: string): void {
    h.getUser.mockResolvedValue({ data: { user: { id: supabaseId } }, error: null });
}

type Json = Record<string, unknown>;
type OtherUser = { name: string; initials: string };

async function inbox(): Promise<{ status: number; body: { conversations: Array<{ id: string; otherUser: OtherUser }> } }> {
    const res = await LIST();
    return { status: res.status, body: await res.json() };
}

async function openThread(id: string): Promise<{ status: number; body: { conversation: { otherUser: OtherUser } } }> {
    const res = await THREAD(new NextRequest(`http://localhost:3000/api/conversations/${id}`), { params: Promise.resolve({ id }) });
    return { status: res.status, body: await res.json() };
}

async function reply(id: string, body = 'Following up on the role.'): Promise<{ status: number; body: Json }> {
    const res = await REPLY(new NextRequest(`http://localhost:3000/api/conversations/${id}`, {
        method: 'POST',
        body: JSON.stringify({ body }),
        headers: { 'Content-Type': 'application/json' },
    }), { params: Promise.resolve({ id }) });
    return { status: res.status, body: (await res.json()) as Json };
}

function otherUserIn(list: Array<{ id: string; otherUser: OtherUser }>, id: string): OtherUser {
    const row = list.find((conversation) => conversation.id === id);
    if (!row) throw new Error(`conversation ${id} is not in the inbox`);
    return row.otherUser;
}

/** The include each GET passes for both participants. */
function participantSelects(mock: { mock: { calls: unknown[][] } }): Select[] {
    const include = (mock.mock.calls[0] as [{ include: Include }])[0].include;
    return [include.userA!.select, include.userB!.select];
}

/** Nothing written, nothing emailed. */
function expectNothingSent(before: Store): void {
    expect(db.messages).toEqual(before.messages);
    expect(db.conversations).toEqual(before.conversations);
    expect(h.prisma.employerMessage.create).not.toHaveBeenCalled();
    expect(h.after).not.toHaveBeenCalled();
    expect(h.sendEmployerMessageNotification).not.toHaveBeenCalled();
    expect(h.sendCandidateInquiryNotification).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.clearAllMocks();
    sequence = 0;
    db = seed();
    installFakeDatabase();
    h.sendEmployerMessageNotification.mockResolvedValue({ success: true });
    h.sendCandidateInquiryNotification.mockResolvedValue({ success: true });
});

describe('GET /api/conversations: how the inbox names the other person', () => {
    it('names an unnamed candidate with no company "User", never by the start of the email address', async () => {
        signIn(EMPLOYER);

        const res = await inbox();

        expect(res.status).toBe(200);
        expect(otherUserIn(res.body.conversations, 'conv-unnamed-seeker')).toMatchObject({ name: 'User', initials: 'U' });
        expect(JSON.stringify(res.body)).not.toContain('unnamed.person');
    });

    it('names an unnamed employer with no company "User" in the candidate\'s inbox', async () => {
        signIn(SEEKER);

        const res = await inbox();

        expect(otherUserIn(res.body.conversations, 'conv-unnamed-employer')).toMatchObject({ name: 'User', initials: 'U' });
        expect(JSON.stringify(res.body)).not.toContain('recruiting.desk');
    });

    it('still names a person by name, then by company', async () => {
        signIn(SEEKER);

        const res = await inbox();

        expect(otherUserIn(res.body.conversations, 'conv-live')).toMatchObject({ name: 'Ada Lovelace', initials: 'AL' });
        expect(otherUserIn(res.body.conversations, 'conv-company-employer')).toMatchObject({ name: 'Lakeside Clinic', initials: 'L' });
    });

    it('never reads either participant\'s email address', async () => {
        signIn(EMPLOYER);

        await inbox();

        for (const select of participantSelects(h.prisma.conversation.findMany)) {
            expect(select).not.toHaveProperty('email');
        }
    });
});

describe('GET /api/conversations/[id]: how the thread names the other person', () => {
    it('names an unnamed candidate with no company "User", never by the start of the email address', async () => {
        signIn(EMPLOYER);

        const res = await openThread('conv-unnamed-seeker');

        expect(res.status).toBe(200);
        expect(res.body.conversation.otherUser).toMatchObject({ name: 'User', initials: 'U' });
        expect(JSON.stringify(res.body)).not.toContain('unnamed.person');
    });

    it('names an unnamed employer with no company "User"', async () => {
        signIn(SEEKER);

        const res = await openThread('conv-unnamed-employer');

        expect(res.body.conversation.otherUser).toMatchObject({ name: 'User', initials: 'U' });
        expect(JSON.stringify(res.body)).not.toContain('recruiting.desk');
    });

    it('still names a person by name, then by company', async () => {
        signIn(SEEKER);

        expect((await openThread('conv-live')).body.conversation.otherUser).toMatchObject({ name: 'Ada Lovelace', initials: 'AL' });
        expect((await openThread('conv-company-employer')).body.conversation.otherUser).toMatchObject({ name: 'Lakeside Clinic', initials: 'L' });
    });

    it('never reads either participant\'s email address', async () => {
        signIn(EMPLOYER);

        await openThread('conv-unnamed-seeker');

        for (const select of participantSelects(h.prisma.conversation.findUnique)) {
            expect(select).not.toHaveProperty('email');
        }
    });
});

describe('POST /api/conversations/[id]: a reply never reaches a deleted account', () => {
    it('answers an unknown thread with 404', async () => {
        signIn(EMPLOYER);
        const before = db;

        expect(await reply('conv-does-not-exist')).toEqual(NOT_FOUND);
        expectNothingSent(before);
    });

    it('answers the same 404 when an employer replies to a candidate who deleted the account', async () => {
        signIn(EMPLOYER);
        const before = db;

        expect(await reply('conv-deleted-seeker')).toEqual(NOT_FOUND);
        expectNothingSent(before);
    });

    it('answers the same 404 when a candidate replies to an employer who deleted the account', async () => {
        signIn(SEEKER);
        const before = db;

        expect(await reply('conv-deleted-employer')).toEqual(NOT_FOUND);
        expectNothingSent(before);
    });

    it('answers the same 404, not the awaiting-reply gate, for a deleted employer who never answered', async () => {
        signIn(SEEKER);
        const before = db;

        expect(await reply('conv-quiet-deleted-employer')).toEqual(NOT_FOUND);
        expectNothingSent(before);
    });
});

describe('POST /api/conversations/[id]: a reply to a live participant, as before', () => {
    it('an employer\'s reply lands in the thread and emails the candidate', async () => {
        signIn(EMPLOYER);

        const res = await reply('conv-live');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, message: { body: 'Following up on the role.', isFromMe: true } });
        expect(db.messages).toContainEqual(expect.objectContaining({
            conversationId: 'conv-live', senderId: profileId(EMPLOYER), recipientId: profileId(SEEKER), body: 'Following up on the role.',
        }));
        expect(h.after).toHaveBeenCalledTimes(1);
        expect(h.sendEmployerMessageNotification).toHaveBeenCalledWith(
            `${SEEKER}@example.com`, 'Grace', 'Ada Lovelace', 'Riverside Psychiatry', 'Telehealth NP role', 'Following up on the role.', null,
        );
    });

    it('a candidate\'s reply, after the employer wrote, lands in the thread and emails the employer', async () => {
        signIn(SEEKER);

        const res = await reply('conv-live', 'Yes, Thursday works.');

        expect(res.status).toBe(200);
        expect(db.messages).toContainEqual(expect.objectContaining({
            conversationId: 'conv-live', senderId: profileId(SEEKER), recipientId: profileId(EMPLOYER), body: 'Yes, Thursday works.',
        }));
        expect(h.sendCandidateInquiryNotification).toHaveBeenCalledWith(
            'hiring@clinic.example', 'Ada', 'Grace Hopper', 'Telehealth NP role', 'Yes, Thursday works.', null,
        );
    });

    it('still holds a candidate\'s follow-up until a live employer answers', async () => {
        signIn(SEEKER);
        db = { ...db, conversations: [...db.conversations, thread('conv-awaiting', SEEKER, EMPLOYER)] };
        db = { ...db, messages: [...db.messages, sent('conv-awaiting', SEEKER, EMPLOYER, 'Is this role still open?')] };
        const before = db;

        const res = await reply('conv-awaiting');

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ awaitingReply: true });
        expectNothingSent(before);
    });
});
