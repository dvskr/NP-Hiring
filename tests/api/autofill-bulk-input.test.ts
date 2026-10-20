/**
 * AUTOFILL-BULK-1: POST /api/autofill/generate-bulk put questionText,
 * jobTitle and employerName into up to ten model prompts uncut, used
 * maxLength as sent, and answered 500 for a non-string questionText or a
 * null entry. The single-question route already validates the same fields
 * with generateAnswerRequestSchema (audit B96); the bulk route now parses
 * every question with that schema and uses only the parsed values.
 *
 * Prisma and the gateway are mocked: the only database is production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { complete } from '@/lib/ai/gateway';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        candidateOpenEndedResponse: { findMany: vi.fn() },
        userProfile: { findUnique: vi.fn() },
        autofillUsage: { aggregate: vi.fn(), create: vi.fn() },
    },
}));

vi.mock('@/lib/verify-extension-token', () => ({
    verifyExtensionToken: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    checkRateLimit: vi.fn(async () => ({ success: true, reset: 0, remaining: 1 })),
    RATE_LIMITS: { autofill: { limit: 30, windowSeconds: 60 } },
}));

vi.mock('@/lib/ai/feature-flags', () => ({
    isAiFeatureEnabled: vi.fn(async () => true),
}));

vi.mock('@/lib/ai/gateway', () => ({
    complete: vi.fn(),
}));

import { POST } from '@/app/api/autofill/generate-bulk/route';

const USER = { userId: 'user-9', supabaseId: 'sb-9', email: 'u@example.com', role: 'job_seeker' };

const STORED = [
    { questionKey: 'why_us', questionText: 'Why do you want to work for us?', response: 'Stored answer about mission.' },
];

function request(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/autofill/generate-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

/** User messages handed to the gateway, one per model call. */
function promptsSent(): string[] {
    return vi.mocked(complete).mock.calls.map((call) => {
        const messages = (call[0] as { messages: Array<{ role: string; content: string }> }).messages;
        return messages.find((m) => m.role === 'user')?.content ?? '';
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyExtensionToken).mockResolvedValue(USER as never);
    vi.mocked(prisma.candidateOpenEndedResponse.findMany).mockResolvedValue(STORED as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'pro', firstName: 'Jane', lastName: 'Doe' } as never);
    vi.mocked(prisma.autofillUsage.aggregate).mockResolvedValue({ _sum: { aiGenerations: 0 } } as never);
    vi.mocked(prisma.autofillUsage.create).mockResolvedValue({} as never);
    vi.mocked(complete).mockResolvedValue({ content: ' Generated answer. ', model: 'test-model' } as never);
});

describe('generate-bulk answers well-formed questions as before', () => {
    it('uses a stored answer where one matches and generates the rest', async () => {
        const res = await POST(request({
            questions: [
                { questionText: 'Why do you want to work for us?', questionKey: 'why_us' },
                { questionText: 'Describe your clinical experience.', questionKey: 'experience', jobTitle: 'FNP', employerName: 'Acme Health', maxLength: 500 },
            ],
        }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([
            { answer: 'Stored answer about mission.', questionKey: 'why_us', model: 'stored', basedOnStoredResponse: true },
            { answer: 'Generated answer.', questionKey: 'experience', model: 'test-model', basedOnStoredResponse: false },
        ]);
        const prompts = promptsSent();
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain('**Question:** Describe your clinical experience.');
        expect(prompts[0]).toContain('**Position:** FNP');
        expect(prompts[0]).toContain('Write approximately 500 characters.');
        expect(prisma.autofillUsage.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ userId: USER.userId, aiGenerations: 1 }),
        });
    });

    it('does not match a stored row on an empty questionKey', async () => {
        vi.mocked(prisma.candidateOpenEndedResponse.findMany).mockResolvedValue([
            { questionKey: '', questionText: 'An unrelated stored question', response: 'Wrong answer' },
        ] as never);
        const res = await POST(request({ questions: [{ questionText: 'What is your availability to start?' }] }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body[0]).toMatchObject({ basedOnStoredResponse: false, answer: 'Generated answer.' });
        expect(complete).toHaveBeenCalledTimes(1);
    });
});

describe('generate-bulk validates every question before any model call', () => {
    it('rejects a 1 MB questionText with 400 and makes no model call', async () => {
        const res = await POST(request({ questions: [{ questionText: 'q'.repeat(1_000_000) }] }));
        expect(res.status).toBe(400);
        expect(complete).not.toHaveBeenCalled();
    });

    it('never sends an oversized jobTitle, employerName or jobDescription to the model', async () => {
        const res = await POST(request({
            questions: [{
                questionText: 'Describe your clinical experience.',
                jobTitle: 't'.repeat(1_000_000),
                employerName: 'e'.repeat(1_000_000),
                jobDescription: 'j'.repeat(1_000_000),
            }],
        }));
        expect(res.status).toBe(200);
        const [prompt] = promptsSent();
        expect(prompt).not.toContain('t'.repeat(301));
        expect(prompt).not.toContain('e'.repeat(301));
        expect(prompt).not.toContain('j'.repeat(501));
    });

    it.each([999_999_999, -50, 'DROP TABLE', { a: 1 }])('clamps maxLength %j to the 300 default', async (maxLength) => {
        const res = await POST(request({ questions: [{ questionText: 'Describe your clinical experience.', maxLength }] }));
        expect(res.status).toBe(200);
        expect(promptsSent()[0]).toContain('Write approximately 300 characters.');
    });

    it.each([
        ['a numeric questionText', [{ questionText: 42 }]],
        ['an object questionText', [{ questionText: { text: 'x' } }]],
        ['an empty questionText', [{ questionText: '   ' }]],
        ['a null question', [null]],
        ['a string question', ['Why us?']],
    ])('answers %s with 400, not 500, even with stored answers present', async (_label, questions) => {
        const res = await POST(request({ questions }));
        expect(res.status).toBe(400);
        expect(complete).not.toHaveBeenCalled();
        expect(prisma.autofillUsage.create).not.toHaveBeenCalled();
    });

    it.each([
        ['malformed JSON', '{"questions":['],
        ['a null body', 'null'],
        ['a missing questions array', '{}'],
        ['an empty questions array', '{"questions":[]}'],
        ['a questions string', '{"questions":"x"}'],
        ['eleven questions', JSON.stringify({ questions: Array.from({ length: 11 }, () => ({ questionText: 'Why us?' })) })],
    ])('answers %s with 400', async (_label, raw) => {
        const res = await POST(request(raw));
        expect(res.status).toBe(400);
        expect(complete).not.toHaveBeenCalled();
    });

    it('checks the monthly quota for the whole batch before any model call', async () => {
        vi.mocked(prisma.autofillUsage.aggregate).mockResolvedValue({ _sum: { aiGenerations: 99 } } as never);
        const res = await POST(request({
            questions: [{ questionText: 'Describe your clinical experience.' }, { questionText: 'What are your salary expectations?' }],
        }));
        expect(res.status).toBe(429);
        expect(complete).not.toHaveBeenCalled();
    });

    it('imports the shared request schema from _lib, not from another route', () => {
        const src = fs.readFileSync(path.join(process.cwd(), 'app/api/autofill/generate-bulk/route.ts'), 'utf8');
        expect(src).toContain("from '../_lib/answer-request'");
        expect(src).not.toContain("from '../generate-answer/route'");
    });
});
