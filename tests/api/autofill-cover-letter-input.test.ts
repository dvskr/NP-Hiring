/**
 * Sibling of AUTOFILL-CLASSIFY-1 and AUTOFILL-BULK-1 (flagged by both fix
 * reviews): POST /api/autofill/generate-cover-letter put jobTitle and
 * employerName into a cover_letter prompt (the costliest autofill task)
 * uncut, and answered 500 for malformed JSON or a non-string
 * jobDescription. The route is behind a flag that defaults off and is
 * paid-only; the caps land before the flag is turned on.
 *
 * Prisma and the gateway are mocked: the only database is production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { complete } from '@/lib/ai/gateway';

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

import { POST } from '@/app/api/autofill/generate-cover-letter/route';

const USER = { userId: 'user-4', supabaseId: 'sb-4', email: 'u@example.com', role: 'pro' };

function request(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/autofill/generate-cover-letter', {
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
    vi.mocked(verifyExtensionToken).mockResolvedValue(USER as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({
        role: 'pro', firstName: 'Jane', lastName: 'Doe', licenses: [], certificationRecords: [], education: [], workExperience: [],
    } as never);
    vi.mocked(prisma.autofillUsage.aggregate).mockResolvedValue({ _sum: { aiGenerations: 0 } } as never);
    vi.mocked(prisma.autofillUsage.create).mockResolvedValue({} as never);
    vi.mocked(complete).mockResolvedValue({ content: 'Dear hiring team,', model: 'test-model' } as never);
});

describe('generate-cover-letter request handling', () => {
    it('writes a letter for the request the extension sends', async () => {
        const res = await POST(request({ jobTitle: 'Family Nurse Practitioner', employerName: 'Acme Health', jobDescription: 'Primary care clinic.' }));
        expect(res.status).toBe(200);
        const prompt = promptSent();
        expect(prompt).toContain('**Position:** Family Nurse Practitioner');
        expect(prompt).toContain('**Employer:** Acme Health');
        expect(prompt).toContain('**Job Description (excerpt):** Primary care clinic.');
    });

    it('cuts an oversized jobTitle and employerName instead of sending them whole', async () => {
        const res = await POST(request({ jobTitle: 't'.repeat(1_000_000), employerName: 'e'.repeat(1_000_000) }));
        expect(res.status).toBe(200);
        const prompt = promptSent();
        expect(prompt).toContain(`**Position:** ${'t'.repeat(300)}\n`);
        expect(prompt).not.toContain('t'.repeat(301));
        expect(prompt).not.toContain('e'.repeat(301));
    });

    it('ignores a non-string jobDescription instead of answering 500', async () => {
        const res = await POST(request({ jobTitle: 'FNP', employerName: 'Acme Health', jobDescription: { text: 'x' } }));
        expect(res.status).toBe(200);
        expect(promptSent()).not.toContain('Job Description');
    });

    it.each([
        ['malformed JSON', '{"jobTitle":'],
        ['a null body', 'null'],
        ['a missing jobTitle', '{"employerName":"Acme"}'],
        ['a numeric jobTitle', '{"jobTitle":5,"employerName":"Acme"}'],
    ])('answers %s with 400 and makes no model call', async (_label, raw) => {
        const res = await POST(request(raw));
        expect(res.status).toBe(400);
        expect(complete).not.toHaveBeenCalled();
    });

    it('keeps cover letters paid-only', async () => {
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'job_seeker' } as never);
        const res = await POST(request({ jobTitle: 'FNP', employerName: 'Acme Health' }));
        expect(res.status).toBe(403);
        expect(complete).not.toHaveBeenCalled();
    });
});
