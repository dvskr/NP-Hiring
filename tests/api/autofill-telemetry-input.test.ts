/**
 * AUTOFILL-TELEMETRY-1: POST /api/autofill/telemetry stored pageDomain,
 * atsName, matchMethod and profileKey as sent, so one free account could
 * write megabytes per request (200 rows, 60 requests a minute) into
 * production. A non-string value, a null entry or an unparseable timestamp
 * failed the whole batch with a 500.
 *
 * Locks in:
 *   - every stored string is typed, cut to a fixed length and NUL-free;
 *   - matchMethod is one of the three values the extension sends (absent
 *     means 'unmatched'; anything else drops that entry only);
 *   - confidence is clamped to 0..1, filled is a real boolean, and a bad or
 *     out-of-window timestamp falls back to the server time;
 *   - a bad entry never fails the batch, and a batch with nothing left still
 *     answers 200 (the extension resends its queue on any non-2xx);
 *   - a per-user limit runs before the body is read.
 *
 * Prisma is mocked throughout: the only database is production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { checkRateLimit } from '@/lib/rate-limit';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        autofillTelemetry: { createMany: vi.fn() },
    },
}));

vi.mock('@/lib/verify-extension-token', () => ({
    verifyExtensionToken: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    checkRateLimit: vi.fn(async () => ({ success: true, reset: Date.now() + 60_000, remaining: 5 })),
    RATE_LIMITS: { telemetry: { limit: 60, windowSeconds: 60 } },
}));

import { POST, normalizeTelemetryEntry, redactValueSample } from '@/app/api/autofill/telemetry/route';

const USER = { userId: 'user-7', supabaseId: 'sb-7', email: 'u@example.com', role: 'job_seeker' };

function request(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/autofill/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

/** An entry shaped exactly like pmhnp-autofill-extension/src/shared/telemetry.ts FieldTelemetryEntry. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        timestamp: new Date().toISOString(),
        atsName: 'Greenhouse',
        pageDomain: 'boards.greenhouse.io',
        fieldName: 'years_experience',
        fieldId: 'question_123',
        fieldLabel: 'Years of NP experience',
        fieldType: 'text',
        matchMethod: 'deterministic',
        profileKey: 'yearsExperience',
        valueSample: '5',
        confidence: 1,
        filled: true,
        ...overrides,
    };
}

/** Rows handed to autofillTelemetry.createMany (empty when it was never called). */
function storedRows(): Array<Record<string, unknown>> {
    const calls = vi.mocked(prisma.autofillTelemetry.createMany).mock.calls;
    if (calls.length === 0) return [];
    expect(calls).toHaveLength(1);
    return (calls[0][0] as { data: Array<Record<string, unknown>> }).data;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyExtensionToken).mockResolvedValue(USER as never);
    vi.mocked(prisma.autofillTelemetry.createMany).mockImplementation((async (args: { data: unknown[] }) => ({
        count: args.data.length,
    })) as never);
});

describe('POST /api/autofill/telemetry keeps what the extension really sends', () => {
    it('stores deterministic, AI and unmatched entries with their nulls and extra keys', async () => {
        const res = await POST(request({
            entries: [
                entry(),
                entry({ matchMethod: 'ai', profileKey: null, atsName: null, valueSample: 'Outpatient', confidence: 0.85, fieldName: 'setting', fieldLabel: 'Preferred setting' }),
                entry({ matchMethod: 'unmatched', profileKey: null, valueSample: '', confidence: 0, filled: false, fieldName: '', fieldLabel: 'Anything else?' }),
            ],
        }));

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ received: 3, truncated: false });
        const rows = storedRows();
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            userId: USER.userId,
            atsDomain: 'boards.greenhouse.io',
            fieldName: 'years_experience',
            fieldLabel: 'Years of NP experience',
            fieldType: 'text',
            matchMethod: 'deterministic',
            profileKey: 'yearsExperience',
            valueSample: '5',
            confidence: 1,
            filled: true,
        });
        expect(rows[1]).toMatchObject({ matchMethod: 'ai', profileKey: null, valueSample: 'Outpatient', confidence: 0.85 });
        expect(rows[2]).toMatchObject({ matchMethod: 'unmatched', profileKey: null, valueSample: null, confidence: 0, filled: false, fieldName: '' });
        for (const row of rows) expect(row).not.toHaveProperty('fieldId');
    });

    it('treats an absent matchMethod as unmatched and falls back from pageDomain to atsName', async () => {
        const res = await POST(request({ entries: [entry({ matchMethod: undefined, pageDomain: '', atsName: 'Workday' })] }));
        expect(res.status).toBe(200);
        expect(storedRows()[0]).toMatchObject({ matchMethod: 'unmatched', atsDomain: 'Workday' });
    });

    it('still drops PII samples (B94)', async () => {
        await POST(request({ entries: [entry({ fieldName: 'email', profileKey: 'email', valueSample: 'jane@example.com' })] }));
        expect(storedRows()[0].valueSample).toBeNull();
    });
});

describe('POST /api/autofill/telemetry bounds every stored string', () => {
    it('cuts over-long pageDomain, profileKey, fieldName, fieldLabel and fieldType', async () => {
        const res = await POST(request({
            entries: [entry({
                pageDomain: 'd'.repeat(10_000),
                profileKey: 'k'.repeat(10_000),
                fieldName: 'n'.repeat(10_000),
                fieldLabel: 'l'.repeat(10_000),
                fieldType: 't'.repeat(10_000),
            })],
        }));
        expect(res.status).toBe(200);
        const row = storedRows()[0];
        expect(row.atsDomain).toBe('d'.repeat(255));
        expect(row.profileKey).toBe('k'.repeat(100));
        expect(row.fieldName).toBe('n'.repeat(255));
        expect(row.fieldLabel).toBe('l'.repeat(255));
        expect(row.fieldType).toBe('t'.repeat(50));
    });

    it('cuts an over-long atsName used as the domain', async () => {
        await POST(request({ entries: [entry({ pageDomain: undefined, atsName: 'a'.repeat(5_000) })] }));
        expect(storedRows()[0].atsDomain).toBe('a'.repeat(255));
    });

    it('strips NUL characters, which Postgres rejects in TEXT columns', async () => {
        await POST(request({
            entries: [entry({ pageDomain: 'boards.\u0000greenhouse.io', fieldLabel: 'Years\u0000 of experience', profileKey: 'years\u0000Experience' })],
        }));
        const row = storedRows()[0];
        expect(row.atsDomain).toBe('boards.greenhouse.io');
        expect(row.fieldLabel).toBe('Years of experience');
        expect(row.profileKey).toBe('yearsExperience');
    });
});

describe('POST /api/autofill/telemetry types every field instead of failing the batch', () => {
    it('normalises wrong types', async () => {
        const res = await POST(request({
            entries: [entry({
                fieldName: 123,
                fieldLabel: ['x'],
                fieldType: { t: 1 },
                profileKey: 7,
                pageDomain: 42,
                atsName: 'Lever',
                confidence: '0.9',
                filled: 'yes',
                valueSample: { v: 1 },
            })],
        }));
        expect(res.status).toBe(200);
        expect(storedRows()[0]).toMatchObject({
            fieldName: '',
            fieldLabel: '',
            fieldType: 'unknown',
            profileKey: null,
            atsDomain: 'Lever',
            confidence: 0,
            filled: false,
            valueSample: null,
        });
    });

    it.each([
        [7, 1],
        [-3, 0],
        [0.42, 0.42],
    ])('clamps confidence %j to %j', async (confidence, expected) => {
        await POST(request({ entries: [entry({ confidence })] }));
        expect(storedRows()[0].confidence).toBe(expected);
    });

    it('drops an entry whose matchMethod the extension never sends, and keeps the rest', async () => {
        const res = await POST(request({
            entries: [entry({ matchMethod: 'x'.repeat(5_000) }), entry({ matchMethod: 42 }), entry({ matchMethod: 'ai' })],
        }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ received: 1, dropped: 2 });
        const rows = storedRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].matchMethod).toBe('ai');
    });

    it('keeps a recent timestamp and replaces a bad or out-of-window one with the server time', async () => {
        const before = Date.now();
        const recent = new Date(before - 60 * 60 * 1000).toISOString();
        const res = await POST(request({
            entries: [
                entry({ timestamp: recent }),
                entry({ timestamp: 'garbage' }),
                entry({ timestamp: '+275760-09-13T00:00:00.000Z' }),
                entry({ timestamp: new Date(before - 2 * 365 * 24 * 60 * 60 * 1000).toISOString() }),
                entry({ timestamp: new Date(before + 7 * 24 * 60 * 60 * 1000).toISOString() }),
                entry({ timestamp: { iso: recent } }),
            ],
        }));
        const after = Date.now();
        expect(res.status).toBe(200);
        const rows = storedRows();
        expect(rows).toHaveLength(6);
        expect((rows[0].timestamp as Date).toISOString()).toBe(recent);
        for (const row of rows.slice(1)) {
            const ts = row.timestamp as Date;
            expect(ts).toBeInstanceOf(Date);
            expect(ts.getTime()).toBeGreaterThanOrEqual(before);
            expect(ts.getTime()).toBeLessThanOrEqual(after);
        }
    });

    it('drops null and non-object elements instead of answering 500', async () => {
        const res = await POST(request({ entries: [null, 'x', 7, ['a'], entry()] }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ received: 1, dropped: 4 });
        expect(storedRows()).toHaveLength(1);
    });

    it('answers 200 with received 0 and skips the insert when every entry is dropped', async () => {
        const res = await POST(request({ entries: [null, entry({ matchMethod: 'bogus' })] }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ received: 0, dropped: 2 });
        expect(prisma.autofillTelemetry.createMany).not.toHaveBeenCalled();
    });

    it('keeps at most 200 entries per request', async () => {
        const res = await POST(request({ entries: Array.from({ length: 250 }, () => entry()) }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ received: 200, truncated: true });
        expect(storedRows()).toHaveLength(200);
    });
});

describe('normalizeTelemetryEntry', () => {
    it('cuts the value sample before the PII patterns run (the email pattern is quadratic without an @)', () => {
        const normalized = normalizeTelemetryEntry(entry({ fieldName: 'notes', profileKey: null, valueSample: 'a'.repeat(1_000_000) }));
        expect(normalized?.valueSample).toHaveLength(256);
        expect(redactValueSample(normalized!)).toBe('a'.repeat(40));
    });

    it('still drops a sample whose PII sits inside the scanned part', () => {
        const normalized = normalizeTelemetryEntry(entry({
            fieldName: 'notes',
            profileKey: null,
            valueSample: `${'x'.repeat(30)} 555-010-0199 ${'y'.repeat(5_000)}`,
        }));
        expect(redactValueSample(normalized!)).toBeNull();
    });

    it('treats a falsy matchMethod as unmatched, as the route always has', () => {
        for (const matchMethod of [undefined, null, '']) {
            expect(normalizeTelemetryEntry(entry({ matchMethod }))?.matchMethod).toBe('unmatched');
        }
    });

    it('returns null only for a non-object entry or an unknown matchMethod', () => {
        expect(normalizeTelemetryEntry(null)).toBeNull();
        expect(normalizeTelemetryEntry('x')).toBeNull();
        expect(normalizeTelemetryEntry(entry({ matchMethod: 'promoted' }))).toBeNull();
        expect(normalizeTelemetryEntry({})).toMatchObject({
            atsDomain: null,
            fieldName: '',
            fieldLabel: '',
            fieldType: 'unknown',
            matchMethod: 'unmatched',
            profileKey: null,
            valueSample: null,
            confidence: 0,
            filled: false,
        });
    });

    it('accepts an epoch-millisecond timestamp inside the window', () => {
        const now = new Date('2026-10-14T12:00:00.000Z');
        const earlier = now.getTime() - 5 * 60 * 1000;
        expect(normalizeTelemetryEntry(entry({ timestamp: earlier }), now)?.timestamp.getTime()).toBe(earlier);
        expect(normalizeTelemetryEntry(entry({ timestamp: 1e20 }), now)?.timestamp.getTime()).toBe(now.getTime());
    });
});

describe('POST /api/autofill/telemetry request handling', () => {
    it.each([
        ['malformed JSON', '{"entries":['],
        ['a null body', 'null'],
        ['a missing entries array', '{}'],
        ['an entries string', '{"entries":"x"}'],
        ['an empty entries array', '{"entries":[]}'],
    ])('answers %s with 400, not 500', async (_label, raw) => {
        const res = await POST(request(raw));
        expect(res.status).toBe(400);
        expect(prisma.autofillTelemetry.createMany).not.toHaveBeenCalled();
    });

    it('returns 401 without a valid extension token', async () => {
        vi.mocked(verifyExtensionToken).mockResolvedValue(null);
        const res = await POST(request({ entries: [entry()] }));
        expect(res.status).toBe(401);
        expect(prisma.autofillTelemetry.createMany).not.toHaveBeenCalled();
    });

    it('limits each user, keyed on the token user id, before reading the body', async () => {
        vi.mocked(checkRateLimit).mockResolvedValueOnce({ success: false, reset: Date.now() + 60_000, remaining: 0 });
        const res = await POST(request({ entries: [entry()] }));
        expect(res.status).toBe(429);
        expect(prisma.autofillTelemetry.createMany).not.toHaveBeenCalled();
        expect(checkRateLimit).toHaveBeenCalledWith(
            expect.stringContaining(USER.userId),
            expect.objectContaining({ limit: expect.any(Number), windowSeconds: expect.any(Number) }),
        );
    });
});

describe('POST /api/autofill/telemetry body size', () => {
    it('refuses a body over 2,000,000 characters with 413 and stores nothing', async () => {
        // 200 entries with 12,000 character names: about 2.4 MB of JSON.
        const res = await POST(request({ entries: Array.from({ length: 200 }, () => entry({ fieldName: 'n'.repeat(12_000) })) }));
        expect(res.status).toBe(413);
        expect(prisma.autofillTelemetry.createMany).not.toHaveBeenCalled();
    });

    it('accepts the largest queue the extension builds', async () => {
        // The extension queues at most 500 entries, cuts labels to 120 and
        // samples to 50 characters, and sends names and ids as the page has
        // them; 255 characters each here, the length the server keeps.
        const entries = Array.from({ length: 500 }, () => entry({
            pageDomain: `${'d'.repeat(240)}.example.com`,
            fieldName: 'n'.repeat(255),
            fieldId: 'i'.repeat(255),
            fieldLabel: 'L'.repeat(120),
            valueSample: 'v'.repeat(50),
        }));
        const res = await POST(request({ entries }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ received: 200, truncated: true });
    });

    it('checks the token before reading the body', async () => {
        vi.mocked(verifyExtensionToken).mockResolvedValue(null);
        const res = await POST(request({ entries: Array.from({ length: 200 }, () => entry({ fieldName: 'n'.repeat(12_000) })) }));
        expect(res.status).toBe(401);
    });
});
