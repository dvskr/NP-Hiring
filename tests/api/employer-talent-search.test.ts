/**
 * Smoke tests for /api/employer/talent/search — Sprint 1.3.
 *
 * Locks the gates that the route MUST enforce regardless of LLM availability:
 *   - Auth (401 for anon)
 *   - Role check (403 for non-employer)
 *   - Feature flag (404 when disabled)
 *   - Active posting (403 needs_active_posting without one; admins pass),
 *     the owner's decision of 2026-11-25
 *   - Body validation (400 on bad input)
 *   - Daily cost cap (429 when ≥10 reranks already used today)
 *
 * Happy-path scoring is exercised by the eval suite (talent_search_rerank).
 * That layer hits real models; this layer locks the cheap defensive checks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

interface MockUser { id: string }
let mockUser: MockUser | null = null;
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: mockUser }, error: null }) },
    }),
}));

const isFlagEnabledMock = vi.fn<(flag: string, tenant: unknown) => Promise<boolean>>();
vi.mock('@/lib/ai/feature-flags', () => ({
    isAiFeatureEnabled: (flag: string, tenant: unknown) => isFlagEnabledMock(flag, tenant),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: async () => null,
    RATE_LIMITS: { employer: { limit: 100, windowSeconds: 60 } },
}));

const findUniqueMock = vi.fn();
const aiCallLogCountMock = vi.fn();
vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
        aiCallLog:   { count:      (...args: unknown[]) => aiCallLogCountMock(...args) },
        userProfile_findMany: vi.fn(), // unused but referenced in route after gateway path
    },
}));

const activePostingsMock = vi.fn<(employerId: string) => Promise<Array<{ id: string }>>>();
vi.mock('@/lib/tier-limits', () => ({
    getEmployerTier: async () => 'pro',
    getEmployerActivePostings: (employerId: string) => activePostingsMock(employerId),
}));

import { POST } from '@/app/api/employer/talent/search/route';

function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/employer/talent/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

beforeEach(() => {
    mockUser = null;
    isFlagEnabledMock.mockReset();
    findUniqueMock.mockReset();
    aiCallLogCountMock.mockReset();
    activePostingsMock.mockReset();
    activePostingsMock.mockResolvedValue([{ id: 'job-1' }]);
});

describe('POST /api/employer/talent/search', () => {
    it('returns 401 when caller is anonymous', async () => {
        mockUser = null;
        const res = await POST(makeRequest({ query: 'experienced PMHNP' }));
        expect(res.status).toBe(401);
    });

    it('returns 403 when caller is not an employer or admin', async () => {
        mockUser = { id: 'u1' };
        findUniqueMock.mockResolvedValue({ role: 'job_seeker' });
        const res = await POST(makeRequest({ query: 'experienced PMHNP' }));
        expect(res.status).toBe(403);
    });

    it('returns 404 when ai.employer.talent_search flag is off', async () => {
        mockUser = { id: 'u1' };
        findUniqueMock.mockResolvedValue({ role: 'employer' });
        isFlagEnabledMock.mockResolvedValue(false);
        const res = await POST(makeRequest({ query: 'experienced PMHNP' }));
        expect(res.status).toBe(404);
    });

    it('refuses an employer without an active posting before the daily cap or any search', async () => {
        mockUser = { id: 'u1' };
        findUniqueMock.mockResolvedValue({ role: 'employer' });
        isFlagEnabledMock.mockResolvedValue(true);
        activePostingsMock.mockResolvedValue([]);

        const res = await POST(makeRequest({ query: 'experienced nurse practitioner' }));

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'AI search needs an active job posting.', reason: 'needs_active_posting' });
        expect(activePostingsMock).toHaveBeenCalledWith('u1');
        // The cap is counted only past the gate, so a refused call spends nothing.
        expect(aiCallLogCountMock).not.toHaveBeenCalled();
    });

    it.each([
        ['an employer with an active posting', 'employer', [{ id: 'job-1' }]],
        ['an admin without one', 'admin', []],
    ])('lets %s through to the search', async (_label, role, postings) => {
        mockUser = { id: 'u1' };
        findUniqueMock.mockResolvedValue({ role });
        isFlagEnabledMock.mockResolvedValue(true);
        activePostingsMock.mockResolvedValue(postings);
        aiCallLogCountMock.mockResolvedValue(0);

        const res = await POST(makeRequest({ query: 'experienced nurse practitioner' }));

        expect(res.status).not.toBe(403);
        expect(aiCallLogCountMock).toHaveBeenCalledTimes(1);
    });

    it('returns 400 on a too-short query', async () => {
        mockUser = { id: 'u1' };
        findUniqueMock.mockResolvedValue({ role: 'employer' });
        isFlagEnabledMock.mockResolvedValue(true);
        const res = await POST(makeRequest({ query: 'ab' }));
        expect(res.status).toBe(400);
    });

    it('returns 400 on malformed JSON body', async () => {
        mockUser = { id: 'u1' };
        findUniqueMock.mockResolvedValue({ role: 'employer' });
        isFlagEnabledMock.mockResolvedValue(true);
        const res = await POST(makeRequest('{not json'));
        expect(res.status).toBe(400);
    });

    it('returns 429 with reset-time message when daily rerank cap is reached', async () => {
        mockUser = { id: 'u1' };
        findUniqueMock.mockResolvedValue({ role: 'employer' });
        isFlagEnabledMock.mockResolvedValue(true);
        aiCallLogCountMock.mockResolvedValue(10); // at cap

        const res = await POST(makeRequest({ query: 'experienced PMHNP' }));
        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.error).toBeTruthy();
        expect(body.message).toMatch(/midnight Central Time/i);
        // upgrade CTA was deliberately removed — UI shows a clean
        // reset-time message instead of pushing a paywall.
        expect(body.upgradeCta).toBeUndefined();
    });

    it('does NOT return 429 when caller is below the daily cap', async () => {
        // Confirms the cap is a comparison, not a typo (e.g. >= vs >).
        // The route will continue past the cap branch and we don't care
        // what happens next — only that it isn't 429.
        mockUser = { id: 'u1' };
        findUniqueMock.mockResolvedValue({ role: 'employer' });
        isFlagEnabledMock.mockResolvedValue(true);
        aiCallLogCountMock.mockResolvedValue(9); // one below cap

        const res = await POST(makeRequest({ query: 'experienced PMHNP' }));
        expect(res.status).not.toBe(429);
    });
});
