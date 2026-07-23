/**
 * Regression (audit B101) — the cron/admin bearer check compared the
 * Authorization header against `Bearer ${CRON_SECRET}` with plain `===`,
 * which short-circuits at the first mismatching character and leaks how
 * many leading characters of the secret matched (timing side-channel).
 *
 * Fix: verifyCronOrAdmin now uses crypto.timingSafeEqual on equal-length
 * buffers. These tests lock in behavior (correct secret passes, wrong
 * secret falls through to the admin-session path) and pin the source so
 * the comparison cannot silently regress to `===`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn().mockImplementation(async () => ({
        auth: { getUser: getUserMock },
    })),
}));

import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';

const SECRET = 'test-cron-secret-0123456789';

function makeRequest(authorization?: string): Request {
    const headers = new Headers();
    if (authorization) headers.set('authorization', authorization);
    return new Request('https://nphiring.com/api/cron/check-dead-links', {
        method: 'GET',
        headers,
    });
}

describe('verifyCronOrAdmin — timing-safe bearer comparison (B101)', () => {
    beforeEach(() => {
        process.env.CRON_SECRET = SECRET;
        // No admin session by default — wrong bearers must end at 401.
        getUserMock.mockResolvedValue({ data: { user: null } });
    });

    afterEach(() => {
        delete process.env.CRON_SECRET;
    });

    it('accepts the correct bearer token', async () => {
        const res = await verifyCronOrAdmin(makeRequest(`Bearer ${SECRET}`));
        expect(res).toBeNull();
    });

    it('rejects a same-length wrong bearer token', async () => {
        const wrong = SECRET.slice(0, -1) + 'X';
        expect(wrong.length).toBe(SECRET.length);
        const res = await verifyCronOrAdmin(makeRequest(`Bearer ${wrong}`));
        expect(res?.status).toBe(401);
    });

    it('rejects a different-length wrong bearer token', async () => {
        const res = await verifyCronOrAdmin(makeRequest('Bearer nope'));
        expect(res?.status).toBe(401);
    });

    it('rejects a missing Authorization header without an admin session', async () => {
        const res = await verifyCronOrAdmin(makeRequest());
        expect(res?.status).toBe(401);
    });

    it('rejects the bare secret without the Bearer prefix', async () => {
        const res = await verifyCronOrAdmin(makeRequest(SECRET));
        expect(res?.status).toBe(401);
    });
});

describe('source pin — comparison stays constant-time', () => {
    const source = readFileSync(
        path.join(process.cwd(), 'lib', 'auth', 'verify-cron-or-admin.ts'),
        'utf-8'
    );

    it('uses crypto.timingSafeEqual', () => {
        expect(source).toContain('timingSafeEqual');
    });

    it('no longer compares the header with template-string equality', () => {
        expect(source).not.toMatch(/===\s*`Bearer \$\{cronSecret\}`/);
    });
});
