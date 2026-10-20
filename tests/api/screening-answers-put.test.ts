/**
 * PUT /api/profile/screening-answers: the body is held to the questions the
 * settings page asks (security sweep SCR-1).
 *
 * The handler checked only Array.isArray(answers) and then ran one upsert per
 * element inside a single transaction. A signed-in caller could send tens of
 * thousands of entries under distinct keys: one request held a pooled
 * connection for the whole function lifetime and wrote that many rows to the
 * caller's profile, and questionKey, questionText, answerType and category
 * were stored exactly as sent. The PUT had no rate limit.
 *
 * Pinned:
 *   - the payload components/settings/ScreeningAnswersSection.tsx really
 *     sends still saves, and the stored question text, type and category come
 *     from the server's copy of the questions, never from the body;
 *   - an unknown key, a repeated key, an oversized list, a non-array, wrong
 *     types and invalid JSON are 400 with no write;
 *   - answer text is still cut to 2000 characters (the inputs have no
 *     maxLength), and the cut happens before sanitizeText, whose regexes are
 *     quadratic on long runs;
 *   - the PUT is rate limited, and 401 and 404 are unchanged;
 *   - the GET reads only the configured questions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeText } from '@/lib/sanitize';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), upsert: vi.fn(), findMany: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { profile: { limit: 20, windowSeconds: 60 } },
}));
vi.mock('@/lib/sanitize', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/sanitize')>();
    return { ...actual, sanitizeText: vi.fn(actual.sanitizeText) };
});

import { GET, PUT } from '@/app/api/profile/screening-answers/route';

// The global prisma fake has no candidateScreeningAnswer model.
Object.assign(prisma, { candidateScreeningAnswer: { upsert: mocks.upsert, findMany: mocks.findMany } });

const PROFILE_ID = 'profile-seeker';
const URL_PATH = 'http://localhost:3000/api/profile/screening-answers';

interface ClientQuestion { questionKey: string; questionText: string; answerType: string; category: string }

/** The questions exactly as the settings page defines and sends them. */
function clientQuestions(): ClientQuestion[] {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/settings/ScreeningAnswersSection.tsx'), 'utf8');
    const entry = /\{ questionKey: '([^']+)', questionText: '([^']+)', answerType: '([^']+)', category: '([^']+)' \}/g;
    const questions = [...src.matchAll(entry)].map(([, questionKey, questionText, answerType, category]) => (
        { questionKey, questionText, answerType, category }
    ));
    // Every QUESTIONS entry must have parsed, or the parity checks below would be vacuous.
    expect(questions.length).toBeGreaterThan(0);
    expect(questions).toHaveLength((src.match(/questionKey: '/g) ?? []).length);
    return questions;
}

/** One entry shaped the way handleSaveAll in the settings page builds it. */
function clientEntry(q: ClientQuestion, answerBool: boolean | null, answerText: string | null): Record<string, unknown> {
    return {
        questionKey: q.questionKey, questionText: q.questionText,
        answerType: q.answerType, answerBool,
        answerText, category: q.category,
    };
}

/** A client-shaped entry for the question with this key (or a made-up key). */
function entryFor(questionKey: string, answerBool: boolean | null, answerText: string | null): Record<string, unknown> {
    const q = clientQuestions().find((c) => c.questionKey === questionKey)
        ?? { questionKey, questionText: 'Made up question', answerType: 'text', category: 'Background' };
    return clientEntry(q, answerBool, answerText);
}

function put(body: unknown): NextRequest {
    return new NextRequest(URL_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

function signedInWithProfile(): void {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'supabase-seeker', email: 'np@example.com' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: PROFILE_ID } as never);
}

type UpsertArgs = {
    where: { userId_questionKey: { userId: string; questionKey: string } };
    update: { answerBool: boolean | null; answerText: string | null };
    create: { userId: string; questionKey: string; questionText: string; answerType: string; answerBool: boolean | null; answerText: string | null; category: string };
};

function upsertCalls(): UpsertArgs[] {
    return mocks.upsert.mock.calls.map(([args]) => args as UpsertArgs);
}

function expectNoWrite(): void {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockImplementation(async (args: UpsertArgs) => ({ id: `row-${args.create.questionKey}`, ...args.create }));
    mocks.findMany.mockResolvedValue([]);
    signedInWithProfile();
});

describe('PUT /api/profile/screening-answers: the real client payload', () => {
    it('saves every question the settings page sends, in one transaction', async () => {
        const questions = clientQuestions();
        const body = {
            answers: questions.map((q) => (q.answerType === 'text'
                ? clientEntry(q, null, 'Two weeks')
                : clientEntry(q, q.answerType === 'boolean_with_details' ? false : true, null))),
        };

        const res = await PUT(put(body));

        expect(res.status).toBe(200);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        const calls = upsertCalls();
        expect(calls.map((c) => c.create.questionKey)).toEqual(questions.map((q) => q.questionKey));
        for (const [i, q] of questions.entries()) {
            expect(calls[i].where).toEqual({ userId_questionKey: { userId: PROFILE_ID, questionKey: q.questionKey } });
            // Server copy of the question matches what the page shows the user.
            expect(calls[i].create).toMatchObject({
                userId: PROFILE_ID,
                questionText: q.questionText,
                answerType: q.answerType,
                category: q.category,
            });
        }
        expect(calls.find((c) => c.create.answerType === 'text')?.create.answerText).toBe('Two weeks');
    });

    it('stores the server copy of the question text, type and category, not the body copy', async () => {
        const res = await PUT(put({
            answers: [{
                questionKey: 'felony_conviction',
                questionText: 'Injected question text',
                answerType: 'anything',
                category: 'Made up',
                answerBool: true,
                answerText: 'Details',
            }],
        }));

        expect(res.status).toBe(200);
        const [call] = upsertCalls();
        const felony = clientQuestions().find((q) => q.questionKey === 'felony_conviction');
        expect(call.create).toMatchObject({
            questionKey: 'felony_conviction',
            questionText: felony?.questionText,
            answerType: felony?.answerType,
            category: felony?.category,
            answerBool: true,
            answerText: 'Details',
        });
        expect(call.update).toEqual({ answerBool: true, answerText: 'Details' });
    });

    it('needs only the key and the answer from the body', async () => {
        const res = await PUT(put({ answers: [{ questionKey: 'notice_period', answerBool: null, answerText: '30 days' }] }));
        expect(res.status).toBe(200);
        expect(upsertCalls()[0].create).toMatchObject({ answerBool: null, answerText: '30 days' });
    });

    it('answers 200 with nothing written for an empty list (the page sends one when nothing is answered)', async () => {
        const res = await PUT(put({ answers: [] }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([]);
        expect(mocks.upsert).not.toHaveBeenCalled();
    });
});

describe('PUT /api/profile/screening-answers: the body is bounded', () => {
    it('refuses thousands of entries under distinct keys, with no write', async () => {
        const answers = Array.from({ length: 5000 }, (_, i) => ({
            questionKey: `junk_${i}`, questionText: 'x', answerType: 'text', answerBool: null, answerText: 'x', category: 'x',
        }));
        const res = await PUT(put({ answers }));
        expect(res.status).toBe(400);
        expectNoWrite();
    });

    it('refuses a key the settings page does not ask', async () => {
        const res = await PUT(put({ answers: [entryFor('not_a_question', null, 'x')] }));
        expect(res.status).toBe(400);
        expectNoWrite();
    });

    it('refuses an over-long key the same way', async () => {
        const res = await PUT(put({ answers: [entryFor('k'.repeat(100_000), null, 'x')] }));
        expect(res.status).toBe(400);
        expectNoWrite();
    });

    it('refuses a repeated key', async () => {
        const res = await PUT(put({
            answers: [entryFor('willing_to_relocate', true, null), entryFor('willing_to_relocate', false, null)],
        }));
        expect(res.status).toBe(400);
        expectNoWrite();
    });

    it('refuses more entries than there are questions, even when every key is real', async () => {
        const keys = clientQuestions().map((q) => q.questionKey);
        const answers = [...keys, keys[0]].map((questionKey) => entryFor(questionKey, true, null));
        const res = await PUT(put({ answers }));
        expect(res.status).toBe(400);
        expectNoWrite();
    });

    it('refuses wrong types and a body that is not a list', async () => {
        const bad: unknown[] = [
            { answers: 'felony_conviction' },
            { answers: null },
            {},
            { answers: [null] },
            { answers: ['felony_conviction'] },
            { answers: [{ ...entryFor('felony_conviction', true, null), questionKey: 42 }] },
            { answers: [entryFor('felony_conviction', 'yes' as never, null)] },
            { answers: [entryFor('notice_period', null, 42 as never)] },
            { answers: [entryFor('notice_period', null, { long: 'object' } as never)] },
            ['felony_conviction'],
            null,
        ];
        for (const body of bad) {
            const res = await PUT(put(body));
            expect(res.status, JSON.stringify(body)).toBe(400);
        }
        expectNoWrite();
    });

    it('answers 400, not 500, for a body that is not JSON', async () => {
        const res = await PUT(put('{"answers": [ not json'));
        expect(res.status).toBe(400);
        expectNoWrite();
    });

    it('still cuts answer text to 2000 characters instead of refusing it', async () => {
        const res = await PUT(put({ answers: [entryFor('notice_period', null, 'a'.repeat(5000))] }));
        expect(res.status).toBe(200);
        const [call] = upsertCalls();
        expect(call.create.answerText).toHaveLength(2000);
        expect(call.update.answerText).toHaveLength(2000);
    });

    it('cuts the raw text before sanitizing it, so a huge string costs no more than 2000 characters', async () => {
        // sanitizeText's event-handler regex is quadratic on a whitespace run:
        // 40,000 spaces take seconds, and a body can carry megabytes of them.
        const res = await PUT(put({ answers: [entryFor('license_revoked', true, `${' '.repeat(30_000)}x`)] }));
        expect(res.status).toBe(200);
        const lengths = vi.mocked(sanitizeText).mock.calls.map(([input]) => input.length);
        expect(lengths.length).toBeGreaterThan(0);
        expect(Math.max(...lengths)).toBeLessThanOrEqual(2000);
    });
});

describe('PUT /api/profile/screening-answers: rate limit and access', () => {
    it('is rate limited before any other work', async () => {
        vi.mocked(rateLimit).mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));
        const res = await PUT(put({ answers: [] }));
        expect(res.status).toBe(429);
        expect(vi.mocked(rateLimit).mock.calls[0][1]).toBe('profile-screening');
        expect(mocks.getUser).not.toHaveBeenCalled();
        expectNoWrite();
    });

    it('answers 401 without a session', async () => {
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const res = await PUT(put({ answers: [] }));
        expect(res.status).toBe(401);
        expectNoWrite();
    });

    it('answers 404 without a profile', async () => {
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(null as never);
        const res = await PUT(put({ answers: [] }));
        expect(res.status).toBe(404);
        expectNoWrite();
    });
});

describe('GET /api/profile/screening-answers', () => {
    it('reads only the questions the page asks, for the caller\'s own profile', async () => {
        const res = await GET();
        expect(res.status).toBe(200);
        expect(mocks.findMany).toHaveBeenCalledWith({
            where: { userId: PROFILE_ID, questionKey: { in: clientQuestions().map((q) => q.questionKey) } },
            orderBy: { createdAt: 'asc' },
        });
    });
});
