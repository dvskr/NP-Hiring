/**
 * Part of AUTOFILL-CLASSIFY-1's proposed fix, narrowed by its reviews:
 * POST /api/autofill/extract-resume-sections answered 500 for a null body or
 * a `sections` value that is not an array, and relied on
 * scripts/extract-pdf-text.js alone to keep the resume text at 6,000
 * characters. The route now types `sections` and cuts the text again before
 * it builds the prompt.
 *
 * Prisma, storage, the PDF child process and the gateway are mocked: the
 * only database is production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { complete } from '@/lib/ai/gateway';

const { resumeStdout } = vi.hoisted(() => ({ resumeStdout: { value: '' } }));

vi.mock('child_process', () => {
    const execFile = (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
        callback(null, resumeStdout.value, '');
    };
    return { execFile, default: { execFile } };
});

vi.mock('@/lib/prisma', () => ({
    prisma: {
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

vi.mock('@/lib/resume-storage', () => ({
    mintResumeReadUrl: vi.fn(async () => 'https://project.supabase.co/storage/v1/object/sign/resumes/r.pdf?token=t'),
    extractRequestContext: vi.fn(() => ({})),
}));

import { POST } from '@/app/api/autofill/extract-resume-sections/route';

const USER = { userId: 'user-5', supabaseId: 'sb-5', email: 'u@example.com', role: 'job_seeker' };

function request(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/autofill/extract-resume-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

function promptSent(): string {
    const calls = vi.mocked(complete).mock.calls;
    expect(calls).toHaveLength(1);
    const messages = (calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages;
    return messages.find((m) => m.role === 'user')?.content ?? '';
}

beforeEach(() => {
    vi.clearAllMocks();
    resumeStdout.value = 'Jane Doe, MSN, Family Nurse Practitioner. Experience: Acme Clinic 2019 to present.';
    vi.mocked(verifyExtensionToken).mockResolvedValue(USER as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({
        role: 'pro', resumeUrl: 'resumes/sb-5/r.pdf', supabaseId: 'sb-5',
    } as never);
    vi.mocked(prisma.autofillUsage.aggregate).mockResolvedValue({ _sum: { aiGenerations: 0 } } as never);
    vi.mocked(prisma.autofillUsage.create).mockResolvedValue({} as never);
    vi.mocked(complete).mockResolvedValue({ content: '{"education":[],"experience":[]}', model: 'test-model' } as never);
});

describe('extract-resume-sections request handling', () => {
    it('asks for the sections the extension requests', async () => {
        const res = await POST(request({ sections: ['education'] }));
        expect(res.status).toBe(200);
        const prompt = promptSent();
        expect(prompt).toContain('"education": Array of education entries');
        expect(prompt).not.toContain('"experience": Array of work experience entries');
    });

    it.each([
        ['a null body', 'null'],
        ['a numeric sections value', '{"sections":5}'],
        ['a sections string', '{"sections":"education"}'],
        ['malformed JSON', '{"sections":['],
    ])('falls back to both sections for %s instead of answering 500', async (_label, raw) => {
        const res = await POST(request(raw));
        expect(res.status).toBe(200);
        const prompt = promptSent();
        expect(prompt).toContain('"education": Array of education entries');
        expect(prompt).toContain('"experience": Array of work experience entries');
    });

    it('cuts resume text over 6,000 characters before it reaches the prompt', async () => {
        resumeStdout.value = 'r'.repeat(50_000);
        const res = await POST(request({ sections: ['education', 'experience'] }));
        expect(res.status).toBe(200);
        const prompt = promptSent();
        expect(prompt).toContain('r'.repeat(6_000));
        expect(prompt).not.toContain('r'.repeat(6_001));
    });
});
