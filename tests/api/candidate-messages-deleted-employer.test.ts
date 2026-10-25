/**
 * POST /api/candidate/messages: no message to a deleted employer account.
 *
 * The employer profile behind a posting was looked up without deletedAt, so a
 * candidate's message to the job of an employer in its deletion grace period
 * was stored and emailed to that account. It is refused with the answer an
 * unreachable employer already gets, the rule the employer side applies to a
 * deleted recipient (POST /api/employer/messages, the reply route).
 *
 * Also here: the body values (jobId, subject, body) must be plain strings. The
 * job id is the lookup key of job.findUnique, and subject.trim() and
 * messageBody.trim() threw on anything else, which answered 500. A request
 * whose body is not a JSON object, or whose values are not strings, now
 * answers 400 before the job is looked up (lib/request-body.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendCandidateInquiryNotification } from '@/lib/email-service';

const h = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { candidateMessage: { limit: 10, windowSeconds: 60 } },
}));
vi.mock('@/lib/email-service', () => ({ sendCandidateInquiryNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// `after` throws outside a real request scope; the rest of next/server stays real.
vi.mock('next/server', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/server')>()),
    after: vi.fn(),
}));

import { GET, POST } from '@/app/api/candidate/messages/route';

const extra = {
    jobFindUnique: vi.fn(),
    employerJobFindUnique: vi.fn(),
    conversationFindFirst: vi.fn(async () => null),
    conversationCreate: vi.fn(async () => ({ id: 'conversation-1' })),
    conversationUpdate: vi.fn(async () => ({})),
    messageCreate: vi.fn(async () => ({ id: 'message-1', sentAt: new Date() })),
    messageCount: vi.fn(async () => 0),
};
Object.assign(prisma, {
    job: { findUnique: extra.jobFindUnique },
    employerJob: { findUnique: extra.employerJobFindUnique },
    conversation: { findFirst: extra.conversationFindFirst, create: extra.conversationCreate, update: extra.conversationUpdate },
    employerMessage: { create: extra.messageCreate, count: extra.messageCount },
});

const CANDIDATE = { id: 'candidate-1', role: 'job_seeker', firstName: 'Sam', lastName: 'R', headline: null, specialties: null, email: 'sam@example.com' };

function send(): NextRequest {
    return new NextRequest('https://nphiring.com/api/candidate/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: 'job-1', subject: 'Question', body: 'Is the role hybrid?' }),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    h.getUser.mockResolvedValue({ data: { user: { id: 'auth-candidate' } }, error: null });
    extra.jobFindUnique.mockResolvedValue({ id: 'job-1', title: 'FNP', slug: 'fnp', isPublished: true, sourceType: 'employer' });
    extra.employerJobFindUnique.mockResolvedValue({ userId: 'auth-employer', contactEmail: 'hiring@clinic.example' });
});

function employerIs(deletedAt: Date | null) {
    vi.mocked(prisma.userProfile.findUnique).mockImplementation((async (args: { where: { supabaseId: string } }) =>
        args.where.supabaseId === 'auth-candidate'
            ? CANDIDATE
            : { id: 'employer-1', email: 'hiring@clinic.example', firstName: 'Ana', company: 'Clinic', deletedAt }) as never);
}

describe('POST /api/candidate/messages: the employer behind the posting', () => {
    it('refuses a deleted employer account, storing and emailing nothing', async () => {
        employerIs(new Date('2026-10-10'));
        const res = await POST(send());
        expect(res.status).toBe(404);
        expect(extra.conversationCreate).not.toHaveBeenCalled();
        expect(extra.messageCreate).not.toHaveBeenCalled();
        expect(vi.mocked(sendCandidateInquiryNotification)).not.toHaveBeenCalled();
    });

    it('still delivers to a live employer', async () => {
        employerIs(null);
        const res = await POST(send());
        expect(res.status).toBe(201);
        expect(extra.messageCreate).toHaveBeenCalledTimes(1);
    });

    it('the email fallback finds an employer profile only, never a job seeker who shares the address', async () => {
        extra.employerJobFindUnique.mockResolvedValue({ userId: null, contactEmail: 'hiring@clinic.example' });
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(CANDIDATE as never);
        vi.mocked(prisma.userProfile.findFirst).mockResolvedValue(null as never);
        const res = await POST(send());
        expect(res.status).toBe(404);
        expect(vi.mocked(prisma.userProfile.findFirst)).toHaveBeenCalledWith(
            expect.objectContaining({ where: { email: 'hiring@clinic.example', role: 'employer' } }),
        );
    });
});

const VALID_MESSAGE = { jobId: 'job-1', subject: 'Question', body: 'Is the role hybrid?' };

function sendJson(body: string): NextRequest {
    return new NextRequest('https://nphiring.com/api/candidate/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
    });
}

/** Values a JSON body can carry that are not a string, or an empty one. */
const NOT_A_STRING: Array<[string, unknown]> = [
    ['a not filter', { not: '' }],
    ['a startsWith filter', { startsWith: 'a' }],
    ['an array', ['a']],
    ['a number', 12345],
    ['a boolean', true],
    ['null', null],
    ['no value', undefined],
    ['an empty string', ''],
];
/** A string with nothing in it once trimmed: refused for the subject and the body, which are trimmed. */
const BLANK_STRING: [string, unknown] = ['a blank string', '   '];

function expectNothingLookedUpOrStored(): void {
    expect(extra.jobFindUnique).not.toHaveBeenCalled();
    expect(extra.conversationCreate).not.toHaveBeenCalled();
    expect(extra.messageCreate).not.toHaveBeenCalled();
    expect(vi.mocked(sendCandidateInquiryNotification)).not.toHaveBeenCalled();
}

describe('POST /api/candidate/messages: the body values are plain strings', () => {
    beforeEach(() => employerIs(null));

    it.each([...NOT_A_STRING, ['an overlong string', 'a'.repeat(201)]])(
        'refuses %s as the job id with 400 and no job lookup',
        async (_label, jobId) => {
            const res = await POST(sendJson(JSON.stringify({ ...VALID_MESSAGE, jobId })));
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: 'jobId is required' });
            expectNothingLookedUpOrStored();
        },
    );

    it.each([...NOT_A_STRING, BLANK_STRING])('refuses %s as the subject with 400 and no job lookup', async (_label, subject) => {
        const res = await POST(sendJson(JSON.stringify({ ...VALID_MESSAGE, subject })));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Subject is required' });
        expectNothingLookedUpOrStored();
    });

    it.each([...NOT_A_STRING, BLANK_STRING])('refuses %s as the message body with 400 and no job lookup', async (_label, body) => {
        const res = await POST(sendJson(JSON.stringify({ ...VALID_MESSAGE, body })));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Message body is required' });
        expectNothingLookedUpOrStored();
    });

    it.each([
        ['malformed JSON', '{"jobId":'],
        ['an empty body', ''],
        ['a null body', 'null'],
        ['an array body', JSON.stringify([VALID_MESSAGE])],
        ['a string body', '"job-1"'],
    ])('refuses %s with 400 and no job lookup', async (_label, body) => {
        const res = await POST(sendJson(body));
        expect(res.status).toBe(400);
        expectNothingLookedUpOrStored();
    });

    it('still looks a string job id up by equality and stores the message', async () => {
        const res = await POST(sendJson(JSON.stringify(VALID_MESSAGE)));
        expect(res.status).toBe(201);
        expect(extra.jobFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-1' } }));
        expect(extra.messageCreate).toHaveBeenCalledTimes(1);
    });

    it('still refuses a message over 2000 characters with its own answer', async () => {
        const res = await POST(sendJson(JSON.stringify({ ...VALID_MESSAGE, body: 'b'.repeat(2001) })));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Message must be under 2000 characters' });
        expectNothingLookedUpOrStored();
    });

    it('still cuts a long subject to 200 characters instead of refusing it', async () => {
        const res = await POST(sendJson(JSON.stringify({ ...VALID_MESSAGE, subject: 'S'.repeat(300) })));
        expect(res.status).toBe(201);
        expect(extra.messageCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({ subject: 'S'.repeat(200) }),
        });
    });
});

describe('GET /api/candidate/messages: whether the compose box is offered', () => {
    const check = () => GET(new NextRequest('https://nphiring.com/api/candidate/messages?jobId=job-1'));

    it('offers no compose box for a deleted employer, whose POST would refuse', async () => {
        employerIs(new Date('2026-10-10'));
        vi.mocked(prisma.userProfile.findUnique).mockImplementation((async (args: { where: { supabaseId: string } }) =>
            args.where.supabaseId === 'auth-candidate'
                ? { id: 'candidate-1', role: 'job_seeker' }
                : { id: 'employer-1', deletedAt: new Date('2026-10-10') }) as never);
        const res = await check();
        expect(await res.json()).toEqual({ canMessage: false });
    });

    it('still offers it for a live employer with no thread yet', async () => {
        vi.mocked(prisma.userProfile.findUnique).mockImplementation((async (args: { where: { supabaseId: string } }) =>
            args.where.supabaseId === 'auth-candidate'
                ? { id: 'candidate-1', role: 'job_seeker' }
                : { id: 'employer-1', deletedAt: null }) as never);
        const res = await check();
        expect((await res.json()).canMessage).toBe(true);
    });
});
