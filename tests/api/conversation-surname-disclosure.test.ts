/**
 * Messaging does not reveal the surname an unlock pays for.
 *
 * The inbox, the thread and the employer's sent list showed a job seeker's
 * full name and company to any employer in a conversation with them. Since
 * the reach check of 2026-10-20 a new thread needs an unlock or an
 * application, but a thread opened before it may have neither. An employer
 * now sees first name and last initial, and no company, until the candidate
 * writes in that conversation, the employer unlocks them, or the candidate
 * applied to one of the employer's own jobs (the applicants view already
 * names an applicant in full). The candidate's own view and an admin's are
 * unchanged, and the address is never read.
 *
 * The owner's rules of 2026-11-25 ride on the same evidence: the inbox and a
 * thread send the candidate's photo only once it holds, and license states
 * once it holds or the employer has an active posting. A photo that shows,
 * on either side, goes out as a signed link that expires, never the public
 * URL the column stores (lib/avatar-url.ts); a fake store signs here.
 *
 * All fixtures are fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { rowMatches, type Row } from '../helpers/fake-row-where';

const EMPLOYER_EMAIL = 'hiring@clinic.example';
const EMPLOYER = { id: 'profile-employer', supabaseId: 'supabase-employer', firstName: 'Riley', lastName: 'Hiringfic', company: 'Riverside Clinicfic', role: 'employer' };
const CANDIDATE = { id: 'profile-candidate', supabaseId: 'supabase-candidate', firstName: 'Anna', lastName: 'Nguyenfic', company: 'Current Clinicfic', role: 'job_seeker' };

const viewer = vi.hoisted(() => ({ supabaseId: 'supabase-employer', email: 'hiring@clinic.example' }));
/** Every key the fake store was asked to sign. */
const store = vi.hoisted(() => ({ signedKeys: [] as string[] }));
const db = vi.hoisted(() => ({
    userProfile: { findUnique: vi.fn() },
    conversation: { findMany: vi.fn(), findUnique: vi.fn() },
    employerMessage: { groupBy: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    profileView: { findMany: vi.fn() },
    jobApplication: { findMany: vi.fn() },
    // The employer's active postings (getEmployerActivePostings), for license states.
    employerJob: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: {
            getUser: async () => ({
                data: { user: { id: viewer.supabaseId, email: viewer.email, email_confirmed_at: '2026-10-01T00:00:00Z' } },
                error: null,
            }),
        },
    }),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => null, RATE_LIMITS: { employer: { limit: 100, windowSeconds: 60 } } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/email-service', () => ({
    sendEmployerMessageNotification: vi.fn(),
    sendCandidateInquiryNotification: vi.fn(),
}));
vi.mock('@/lib/document-storage', () => ({
    mintDocReadUrl: vi.fn(async () => 'signed-url'),
    extractRequestContext: vi.fn(() => ({})),
    toBareDocPath: vi.fn(() => null),
}));
vi.mock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({
        storage: {
            from: () => ({
                createSignedUrls: async (paths: string[]) => {
                    store.signedKeys.push(...paths);
                    return { data: paths.map((path) => ({ path, signedUrl: `https://test.supabase.co/storage/v1/object/sign/avatars/${path}?token=fic`, error: null })), error: null };
                },
            }),
        },
    }),
}));

import { GET as listConversations } from '@/app/api/conversations/route';
import { GET as openConversation } from '@/app/api/conversations/[id]/route';
import { GET as sentMessages } from '@/app/api/employer/messages/route';
import { participantDisplay, personName } from '@/app/api/conversations/_lib/participant-name';
import { showsConversationLicenseStates, showsPhoto, showsSurname } from '@/app/api/conversations/_lib/surname-disclosure';

const extras = { avatarUrl: null, headline: null, specialties: null, licenseStates: null };
/** Each photo's key, in its owner's own upload folder, as the column stores it and as a response sends it. */
const RILEY_KEY = `prod/${EMPLOYER.supabaseId}/1700000000000.jpg`;
const ANNA_KEY = `prod/${CANDIDATE.supabaseId}/1700000000001.jpg`;
const stored = (key: string): string => `https://test.supabase.co/storage/v1/object/public/avatars/${key}`;
const signedLink = (key: string): string => `https://test.supabase.co/storage/v1/object/sign/avatars/${key}?token=fic`;
const RILEY_PHOTO = signedLink(RILEY_KEY);
const ANNA_PHOTO = signedLink(ANNA_KEY);
const ANNA_STATES = 'TX,OK';
const conversation = {
    id: 'conv-1', participantA: EMPLOYER.id, participantB: CANDIDATE.id, subject: 'Family NP role', jobId: 'job-1',
    lastMessageAt: new Date('2026-11-20T10:00:00Z'), createdAt: new Date('2026-11-19T10:00:00Z'),
    userA: { ...EMPLOYER, ...extras, avatarUrl: stored(RILEY_KEY) },
    userB: { ...CANDIDATE, ...extras, avatarUrl: stored(ANNA_KEY), licenseStates: ANNA_STATES },
    job: null,
    messages: [{ body: 'Hello Anna.', sentAt: new Date('2026-11-20T10:00:00Z'), senderId: EMPLOYER.id }],
};

/** The posting an application went to, as the ownership clause reads it (EmployerJob). */
const OWN_POSTING: Row = { userId: EMPLOYER.supabaseId, contactEmail: EMPLOYER_EMAIL };
const LEGACY_POSTING: Row = { userId: null, contactEmail: EMPLOYER_EMAIL };
const FOREIGN_POSTING: Row = { userId: 'supabase-other-employer', contactEmail: 'talent@other.example' };

let candidateWrote = false;
let unlocked = false;
let applications: Array<{ userId: string; posting: Row }> = [];
let activePosting = false;

function asViewer(person: { id: string; supabaseId: string; role: string }) {
    viewer.supabaseId = person.supabaseId;
    db.userProfile.findUnique.mockResolvedValue({ id: person.id, role: person.role });
}

beforeEach(() => {
    vi.clearAllMocks();
    store.signedKeys = [];
    candidateWrote = false;
    unlocked = false;
    applications = [];
    activePosting = false;
    asViewer(EMPLOYER);
    db.employerJob.findMany.mockImplementation(async () => (activePosting ? [{ id: 'ej-live' }] : []));
    db.conversation.findMany.mockResolvedValue([conversation]);
    db.conversation.findUnique.mockResolvedValue(conversation);
    db.employerMessage.findMany.mockResolvedValue([]);
    db.employerMessage.updateMany.mockResolvedValue({ count: 0 });
    db.employerMessage.groupBy.mockImplementation(async (args: { by: string[]; where: { senderId?: { in: string[] } } }) => {
        // The surname lookup groups by conversation and sender; the inbox's unread count by conversation only.
        if (args.by.includes('senderId')) {
            return candidateWrote && args.where.senderId?.in.includes(CANDIDATE.id)
                ? [{ conversationId: 'conv-1', senderId: CANDIDATE.id }]
                : [];
        }
        return [];
    });
    db.profileView.findMany.mockImplementation(async () => (unlocked ? [{ candidateId: CANDIDATE.supabaseId }] : []));
    // Applies the route's own clause: the applicant ids, and the ownership of the posting applied to.
    db.jobApplication.findMany.mockImplementation(async ({ where }: { where: { userId: { in: string[] }; job: { employerJobs: unknown } } }) =>
        applications
            .filter((a) => where.userId.in.includes(a.userId) && rowMatches(a.posting, where.job.employerJobs))
            .map((a) => ({ userId: a.userId })));
});

describe('showsSurname', () => {
    const none = { counterpartHasWritten: false, viewerUnlocked: false, counterpartApplied: false };

    it('withholds a job seeker surname from an employer until it is disclosed', () => {
        expect(showsSurname('employer', 'job_seeker', none)).toBe(false);
        expect(showsSurname('employer', 'job_seeker', { ...none, counterpartHasWritten: true })).toBe(true);
        expect(showsSurname('employer', 'job_seeker', { ...none, viewerUnlocked: true })).toBe(true);
        expect(showsSurname('employer', 'job_seeker', { ...none, counterpartApplied: true })).toBe(true);
    });

    it('leaves every other pairing alone', () => {
        expect(showsSurname('job_seeker', 'employer', none)).toBe(true);
        expect(showsSurname('admin', 'job_seeker', none)).toBe(true);
        expect(showsSurname('employer', 'employer', none)).toBe(true);
    });
});

describe('showsPhoto and showsConversationLicenseStates', () => {
    const none = { counterpartHasWritten: false, viewerUnlocked: false, counterpartApplied: false };

    it('lock a job seeker photo until the evidence that discloses the surname holds', () => {
        expect(showsPhoto('employer', 'job_seeker', none)).toBe(false);
        expect(showsPhoto('employer', 'job_seeker', { ...none, counterpartHasWritten: true })).toBe(true);
        expect(showsPhoto('employer', 'job_seeker', { ...none, viewerUnlocked: true })).toBe(true);
        expect(showsPhoto('employer', 'job_seeker', { ...none, counterpartApplied: true })).toBe(true);
        expect(showsPhoto('admin', 'job_seeker', none)).toBe(true);
        expect(showsPhoto('job_seeker', 'employer', none)).toBe(true);
    });

    it('give license states to an employer with an active posting, or on the same evidence', () => {
        expect(showsConversationLicenseStates('employer', 'job_seeker', none, false)).toBe(false);
        expect(showsConversationLicenseStates('employer', 'job_seeker', none, true)).toBe(true);
        expect(showsConversationLicenseStates('employer', 'job_seeker', { ...none, viewerUnlocked: true }, false)).toBe(true);
        expect(showsConversationLicenseStates('admin', 'job_seeker', none, false)).toBe(true);
    });
});

describe('participantDisplay and personName without the surname', () => {
    it('give first name and last initial, never the company', () => {
        expect(participantDisplay(CANDIDATE, { showSurname: false })).toEqual({ name: 'Anna N.', initials: 'AN' });
        expect(participantDisplay({ ...CANDIDATE, lastName: null }, { showSurname: false })).toEqual({ name: 'Anna', initials: 'A' });
        expect(participantDisplay({ ...CANDIDATE, firstName: null }, { showSurname: false })).toEqual({ name: 'User', initials: 'U' });
        expect(personName({ firstName: null, lastName: 'Nguyenfic' }, false)).toBe('');
    });

    it('are unchanged by default', () => {
        expect(participantDisplay(CANDIDATE)).toEqual({ name: 'Anna Nguyenfic', initials: 'AN' });
        expect(participantDisplay({ ...CANDIDATE, firstName: null, lastName: null })).toEqual({ name: 'Current Clinicfic', initials: 'C' });
        expect(personName(CANDIDATE, true)).toBe('Anna Nguyenfic');
    });
});

async function inboxOther() {
    const body = await (await listConversations()).json();
    return { raw: JSON.stringify(body), other: body.conversations[0].otherUser };
}

async function threadOther() {
    const res = await openConversation(new NextRequest('http://localhost:3000/api/conversations/conv-1'), {
        params: Promise.resolve({ id: 'conv-1' }),
    });
    const body = await res.json();
    return { raw: JSON.stringify(body), other: body.conversation.otherUser };
}

describe.each([
    ['the inbox', inboxOther],
    ['the thread', threadOther],
])('%s, seen by the employer', (_label, load) => {
    it('shows first name and last initial, and no company, after an employer message alone', async () => {
        const { raw, other } = await load();
        expect(other).toMatchObject({ name: 'Anna N.', initials: 'AN', company: null });
        expect(raw).not.toContain('Nguyenfic');
        expect(raw).not.toContain('Current Clinicfic');
    });

    it('shows the full name once the candidate has written in the conversation', async () => {
        candidateWrote = true;
        expect((await load()).other).toMatchObject({ name: 'Anna Nguyenfic', company: 'Current Clinicfic' });
        expect(db.employerMessage.groupBy.mock.calls.find(([args]) => args.by.includes('senderId'))?.[0].where).toEqual({
            conversationId: { in: ['conv-1'] },
            senderId: { in: [CANDIDATE.id] },
        });
    });

    it('shows the full name once the employer has unlocked the candidate', async () => {
        unlocked = true;
        expect((await load()).other.name).toBe('Anna Nguyenfic');
        expect(db.profileView.findMany.mock.calls[0][0].where).toEqual({
            viewerId: EMPLOYER.supabaseId,
            candidateId: { in: [CANDIDATE.supabaseId] },
        });
    });

    it.each([
        ['a posting it owns', OWN_POSTING],
        ['an unclaimed legacy posting filed under its confirmed email', LEGACY_POSTING],
    ])('shows the full name once the candidate applied to %s', async (_posting, posting) => {
        applications = [{ userId: CANDIDATE.supabaseId, posting }];
        expect((await load()).other.name).toBe('Anna Nguyenfic');
    });

    it('an application to another employer\'s posting discloses nothing', async () => {
        applications = [{ userId: CANDIDATE.supabaseId, posting: FOREIGN_POSTING }];
        expect((await load()).other).toMatchObject({ name: 'Anna N.', company: null, avatarUrl: null, licenseStates: null });
    });

    it('sends no photo and no license states before disclosure to an employer without a posting', async () => {
        const { raw, other } = await load();
        expect(other).toMatchObject({ avatarUrl: null, licenseStates: null, initials: 'AN' });
        expect(raw).not.toContain(ANNA_KEY);
        expect(raw).not.toContain(ANNA_STATES);
        // A photo the rule withholds is never signed either.
        expect(store.signedKeys).toEqual([]);
    });

    it('sends license states, and still no photo, to an employer with an active posting', async () => {
        activePosting = true;
        expect((await load()).other).toMatchObject({ avatarUrl: null, licenseStates: ANNA_STATES });
        expect(db.employerJob.findMany.mock.calls[0][0].where).toMatchObject({ userId: EMPLOYER.supabaseId });
    });

    it.each([
        ['the candidate has written in the conversation', () => { candidateWrote = true; }],
        ['the employer has unlocked the candidate', () => { unlocked = true; }],
        ['the candidate applied to one of its postings', () => { applications = [{ userId: CANDIDATE.supabaseId, posting: OWN_POSTING }]; }],
    ])('sends the photo and license states once %s', async (_label, disclose) => {
        disclose();
        const { raw, other } = await load();
        expect(other).toMatchObject({ avatarUrl: ANNA_PHOTO, licenseStates: ANNA_STATES });
        // A link that expires, never the stored public URL.
        expect(raw).not.toContain('/object/public/avatars/');
        expect(store.signedKeys).toEqual([ANNA_KEY]);
    });
});

describe.each([
    ['the inbox', inboxOther],
    ['the thread', threadOther],
])('%s, seen by anyone else', (_label, load) => {
    it('the candidate sees the employer by full name and photo, with no extra lookups', async () => {
        asViewer(CANDIDATE);
        const { raw, other } = await load();
        expect(other).toMatchObject({ name: 'Riley Hiringfic', avatarUrl: RILEY_PHOTO });
        expect(raw).not.toContain('/object/public/avatars/');
        expect(db.profileView.findMany).not.toHaveBeenCalled();
        expect(db.jobApplication.findMany).not.toHaveBeenCalled();
        expect(db.employerJob.findMany).not.toHaveBeenCalled();
    });

    it('an admin sees the candidate by full name, with the photo and license states', async () => {
        asViewer({ id: EMPLOYER.id, supabaseId: EMPLOYER.supabaseId, role: 'admin' });
        expect((await load()).other).toMatchObject({
            name: 'Anna Nguyenfic', company: 'Current Clinicfic', avatarUrl: ANNA_PHOTO, licenseStates: ANNA_STATES,
        });
        expect(db.profileView.findMany).not.toHaveBeenCalled();
        expect(db.jobApplication.findMany).not.toHaveBeenCalled();
        expect(db.employerJob.findMany).not.toHaveBeenCalled();
    });
});

describe('GET /api/employer/messages (the sent list)', () => {
    function sent(recipient: Record<string, unknown>) {
        db.employerMessage.findMany.mockResolvedValue([{
            id: 'msg-1', subject: 'Family NP role', body: 'Hello.', sentAt: new Date('2026-11-20T10:00:00Z'), readAt: null,
            conversationId: 'conv-1', recipient, job: null,
        }]);
    }
    const names = async () =>
        (await (await sentMessages(new NextRequest('http://localhost/api/employer/messages'))).json())
            .messages.map((m: { recipientName: string }) => m.recipientName);

    it('never selects or shows the recipient email', async () => {
        sent({ ...CANDIDATE, firstName: null, lastName: null, email: 'anna.private.handle@example.com' });
        const shown = await names();
        expect(shown).toEqual(['Candidate']);
        expect(JSON.stringify(shown)).not.toContain('anna.private');
        expect(db.employerMessage.findMany.mock.calls[0][0].include.recipient.select).not.toHaveProperty('email');
    });

    it('withholds the surname of a candidate the employer has not unlocked', async () => {
        sent(CANDIDATE);
        expect(await names()).toEqual(['Anna N.']);
        unlocked = true;
        expect(await names()).toEqual(['Anna Nguyenfic']);
    });

    it('names an applicant to one of its own postings in full', async () => {
        sent(CANDIDATE);
        applications = [{ userId: CANDIDATE.supabaseId, posting: OWN_POSTING }];
        expect(await names()).toEqual(['Anna Nguyenfic']);
    });
});
