/**
 * AUTOFILL-TRACK-1: POST /api/autofill/track wrote `aiGenerations` from the
 * request body, and the monthly AI quota is the SUM of that column. A token
 * holder could send `{ pageUrl: 'x', aiGenerations: -100000 }`, drive the sum
 * negative, and lift the free (10) and pro (100) caps on every AI route.
 *
 * Locks in:
 *   - the handler always stores aiGenerations 0 (the AI routes record their
 *     own usage server-side; the extension always sends 0);
 *   - fieldsFilled is an integer clamped to 0..500, pageUrl and atsName are
 *     strings cut to fixed lengths, and a malformed body is a 400, not a 500;
 *   - the quota SUM ignores rows at or below zero, so a negative row already
 *     stored cannot lift the cap either;
 *   - GET /api/autofill/usage counts autofills instead of loading every row,
 *     and is rate limited like its sibling routes.
 *
 * Prisma is mocked throughout: the only database is production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { rateLimit } from '@/lib/rate-limit';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        autofillUsage: {
            create: vi.fn(),
            aggregate: vi.fn(),
            count: vi.fn(),
            findMany: vi.fn(),
        },
        userProfile: { findUnique: vi.fn() },
    },
}));

vi.mock('@/lib/verify-extension-token', () => ({
    verifyExtensionToken: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    checkRateLimit: vi.fn(async () => ({ success: true, reset: 0, remaining: 1 })),
    RATE_LIMITS: {
        telemetry: { limit: 60, windowSeconds: 60 },
        general: { limit: 60, windowSeconds: 60 },
        autofill: { limit: 30, windowSeconds: 60 },
    },
}));

import { POST as trackPOST } from '@/app/api/autofill/track/route';
import { GET as usageGET } from '@/app/api/autofill/usage/route';
import { checkAutofillAiQuota, getMonthlyAiGenerations } from '@/app/api/autofill/_lib/quota';

const USER = { userId: 'user-1', supabaseId: 'sb-1', email: 'u@example.com', role: 'job_seeker' };

function trackRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/autofill/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

/** The `data` object of the single autofillUsage.create call. */
function storedRow(): Record<string, unknown> {
    const calls = vi.mocked(prisma.autofillUsage.create).mock.calls;
    expect(calls).toHaveLength(1);
    return (calls[0][0] as { data: Record<string, unknown> }).data;
}

interface UsageRow { aiGenerations: number; fieldsFilled: number }

/**
 * Backs autofillUsage.create/aggregate with an in-memory table whose
 * aggregate honours the `aiGenerations: { gt }` filter the way Postgres
 * would, so the tests exercise the real SUM semantics.
 */
function useInMemoryUsageTable(rows: UsageRow[]): void {
    vi.mocked(prisma.autofillUsage.create).mockImplementation((async (args: { data: UsageRow }) => {
        rows.push({ aiGenerations: args.data.aiGenerations, fieldsFilled: args.data.fieldsFilled });
        return args.data;
    }) as never);
    vi.mocked(prisma.autofillUsage.aggregate).mockImplementation((async (args: {
        where?: { aiGenerations?: { gt?: number } };
    }) => {
        const gt = args?.where?.aiGenerations?.gt;
        const kept = rows.filter((r) => gt === undefined || r.aiGenerations > gt);
        const sum = kept.reduce((acc, r) => acc + r.aiGenerations, 0);
        return { _sum: { aiGenerations: kept.length > 0 ? sum : null } };
    }) as never);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyExtensionToken).mockResolvedValue(USER as never);
    vi.mocked(prisma.autofillUsage.create).mockResolvedValue({} as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'job_seeker' } as never);
});

describe('POST /api/autofill/track never takes aiGenerations from the client', () => {
    it('stores aiGenerations 0 when the body sends -100000', async () => {
        const res = await trackPOST(trackRequest({ pageUrl: 'https://ats.example.com/apply', aiGenerations: -100000 }));
        expect(res.status).toBe(200);
        expect(storedRow().aiGenerations).toBe(0);
    });

    it.each([5, 2.5, '9', 1e9, null, { n: 1 }])('stores aiGenerations 0 when the body sends %j', async (aiGenerations) => {
        const res = await trackPOST(trackRequest({ pageUrl: 'https://ats.example.com/apply', aiGenerations }));
        expect(res.status).toBe(200);
        expect(storedRow().aiGenerations).toBe(0);
    });

    it('a track call with -100000 does not lift the free cap', async () => {
        const rows: UsageRow[] = [];
        useInMemoryUsageTable(rows);
        // Ten real generations recorded by the AI routes: the free cap (10) is used up.
        for (let i = 0; i < 10; i += 1) rows.push({ aiGenerations: 1, fieldsFilled: 0 });

        await trackPOST(trackRequest({ pageUrl: 'x', aiGenerations: -100000 }));

        const quota = await checkAutofillAiQuota(USER.userId, 1);
        expect(quota.used).toBe(10);
        expect(quota.allowed).toBe(false);
    });
});

describe('POST /api/autofill/track bounds the other fields', () => {
    it.each([
        [-5, 0],
        [10_000_000, 500],
        [3.9, 3],
        ['7', 0],
        [null, 0],
        [{ n: 3 }, 0],
    ])('fieldsFilled %j is stored as %j', async (fieldsFilled, expected) => {
        const res = await trackPOST(trackRequest({ pageUrl: 'https://ats.example.com/apply', fieldsFilled }));
        expect(res.status).toBe(200);
        expect(storedRow().fieldsFilled).toBe(expected);
    });

    it('cuts a 5,000 character pageUrl to 2,048 instead of rejecting it', async () => {
        const pageUrl = `https://ats.example.com/apply?token=${'a'.repeat(5_000)}`;
        const res = await trackPOST(trackRequest({ pageUrl, fieldsFilled: 4 }));
        expect(res.status).toBe(200);
        expect(storedRow().pageUrl).toBe(pageUrl.slice(0, 2_048));
    });

    it('cuts atsName to 100 characters and stores a non-string atsName as null', async () => {
        await trackPOST(trackRequest({ pageUrl: 'x', atsName: 'W'.repeat(1_000) }));
        expect(storedRow().atsName).toBe('W'.repeat(100));

        vi.mocked(prisma.autofillUsage.create).mockClear();
        await trackPOST(trackRequest({ pageUrl: 'x', atsName: { name: 'Workday' } }));
        expect(storedRow().atsName).toBeNull();
    });

    it('strips NUL characters, which Postgres rejects in TEXT columns', async () => {
        await trackPOST(trackRequest({ pageUrl: 'https://ats.example.com/\u0000apply', atsName: 'Work\u0000day' }));
        const row = storedRow();
        expect(row.pageUrl).toBe('https://ats.example.com/apply');
        expect(row.atsName).toBe('Workday');
    });

    it.each([123, { href: 'x' }, ['x'], '', null])('rejects pageUrl %j with 400 and writes nothing', async (pageUrl) => {
        const res = await trackPOST(trackRequest({ pageUrl, fieldsFilled: 3 }));
        expect(res.status).toBe(400);
        expect(prisma.autofillUsage.create).not.toHaveBeenCalled();
    });

    it.each([
        ['malformed JSON', '{"pageUrl":'],
        ['a null body', 'null'],
        ['an array body', '["x"]'],
    ])('answers %s with 400, not 500', async (_label, raw) => {
        const res = await trackPOST(trackRequest(raw));
        expect(res.status).toBe(400);
        expect(prisma.autofillUsage.create).not.toHaveBeenCalled();
    });

    it('returns 401 without a valid extension token and writes nothing', async () => {
        vi.mocked(verifyExtensionToken).mockResolvedValue(null);
        const res = await trackPOST(trackRequest({ pageUrl: 'x', aiGenerations: -100000 }));
        expect(res.status).toBe(401);
        expect(prisma.autofillUsage.create).not.toHaveBeenCalled();
    });

    it('stores the payload the extension really sends unchanged', async () => {
        // pmhnp-autofill-extension/src/background/index.ts RECORD_AUTOFILL:
        // recordAutofill(pageUrl, null, fieldsFilled, 0)
        const res = await trackPOST(trackRequest({
            pageUrl: 'https://boards.greenhouse.io/acme/jobs/123',
            atsName: null,
            fieldsFilled: 17,
            aiGenerations: 0,
        }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(storedRow()).toEqual({
            userId: USER.userId,
            pageUrl: 'https://boards.greenhouse.io/acme/jobs/123',
            atsName: null,
            fieldsFilled: 17,
            aiGenerations: 0,
        });
    });
});

describe('getMonthlyAiGenerations ignores rows at or below zero', () => {
    it('filters the SUM to aiGenerations > 0 for this user and month', async () => {
        vi.mocked(prisma.autofillUsage.aggregate).mockResolvedValue({ _sum: { aiGenerations: 4 } } as never);
        await getMonthlyAiGenerations(USER.userId);
        expect(prisma.autofillUsage.aggregate).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                userId: USER.userId,
                aiGenerations: { gt: 0 },
                createdAt: expect.objectContaining({ gte: expect.any(Date) }),
            }),
        }));
    });

    it('a negative row already stored does not lift the free cap', async () => {
        const rows: UsageRow[] = [{ aiGenerations: -100000, fieldsFilled: 0 }];
        for (let i = 0; i < 10; i += 1) rows.push({ aiGenerations: 1, fieldsFilled: 0 });
        useInMemoryUsageTable(rows);

        const quota = await checkAutofillAiQuota(USER.userId, 1);
        expect(quota.used).toBe(10);
        expect(quota.allowed).toBe(false);
    });

    it('never reports usage below zero', async () => {
        vi.mocked(prisma.autofillUsage.aggregate).mockResolvedValue({ _sum: { aiGenerations: -50 } } as never);
        expect(await getMonthlyAiGenerations(USER.userId)).toBe(0);
    });
});

describe('GET /api/autofill/usage', () => {
    function usageRequest(): NextRequest {
        return new NextRequest('http://localhost/api/autofill/usage', {
            headers: { Authorization: 'Bearer test' },
        });
    }

    it('counts autofills in the database instead of loading every row', async () => {
        vi.mocked(prisma.autofillUsage.count).mockResolvedValue(3 as never);
        vi.mocked(prisma.autofillUsage.aggregate).mockResolvedValue({ _sum: { aiGenerations: 4 } } as never);

        const res = await usageGET(usageRequest());
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(prisma.autofillUsage.findMany).not.toHaveBeenCalled();
        expect(prisma.autofillUsage.count).toHaveBeenCalledWith({
            where: expect.objectContaining({
                userId: USER.userId,
                fieldsFilled: { gt: 0 },
                createdAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
            }),
        });
        expect(body).toMatchObject({
            autofillsUsed: 3,
            autofillsRemaining: 7,
            aiGenerationsUsed: 4,
            aiGenerationsRemaining: 6,
            tier: 'free',
        });
    });

    it('is rate limited like the other autofill routes', async () => {
        vi.mocked(rateLimit).mockResolvedValueOnce(
            new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }) as never,
        );
        const res = await usageGET(usageRequest());
        expect(res.status).toBe(429);
        expect(rateLimit).toHaveBeenCalledWith(expect.anything(), 'autofill-usage', expect.any(Object));
        expect(prisma.autofillUsage.count).not.toHaveBeenCalled();
    });
});
