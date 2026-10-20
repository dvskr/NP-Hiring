/**
 * GET /api/newsletter/status: answers only for the caller's own address (NL-2).
 *
 * The route looked up whatever ?email= it was given, with no session, and
 * answered { optIn: true } when that address was opted in. Anyone could
 * confirm that a named person subscribes to the newsletter, which is also how
 * an attacker would pick targets for the opt-out in NL-1. Only an IP rate
 * limit stood in the way.
 *
 * Pinned:
 *   - no session, an unconfirmed session, a session without an email or a
 *     getUser error: 401 and no lookup at all;
 *   - a signed-in caller asking about another address is refused and that
 *     address is never looked up (a version that only required a login but
 *     still queried the parameter would leave the oracle open to any account);
 *   - the owner's answer is keyed on the session address, lowercased, with
 *     the parameter matched case-insensitively or left out;
 *   - the answer depends on the cookie, so it is never cacheable.
 *
 * Mocked only: no database call can leave this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    findUnique: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/prisma', () => ({
    prisma: { emailLead: { findUnique: h.findUnique } },
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { general: { limit: 60, windowSeconds: 60 } },
}));

import { GET } from '@/app/api/newsletter/status/route';

const CONFIRMED_AT = '2026-09-01T00:00:00Z';

function get(email?: string): NextRequest {
    const base = 'http://localhost:3000/api/newsletter/status';
    return new NextRequest(email === undefined ? base : `${base}?${new URLSearchParams({ email })}`);
}

function anonymous(): void {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Auth session missing!' } });
}

function signedIn(user: { id: string; email?: string; email_confirmed_at?: string | null }): void {
    h.getUser.mockResolvedValue({ data: { user }, error: null });
}

beforeEach(() => {
    vi.clearAllMocks();
    // Every lookup that does run answers "opted in", so any answer that came
    // from a lookup it should not have made shows up as optIn true.
    h.findUnique.mockResolvedValue({ newsletterOptIn: true });
});

describe('GET /api/newsletter/status: no answer without the owner session', () => {
    it('an anonymous caller gets the same 401 for a subscriber and a stranger, and nothing is looked up', async () => {
        anonymous();
        const subscriber = await GET(get('subscriber@example.com'));
        const stranger = await GET(get('nobody-xyz@example.invalid'));
        expect(subscriber.status).toBe(401);
        expect(stranger.status).toBe(401);
        const subscriberBody = await subscriber.text();
        expect(subscriberBody).toBe(await stranger.text());
        expect(subscriberBody).not.toContain('true');
        expect(h.findUnique).not.toHaveBeenCalled();
    });

    it('a signed-in caller asking about another address is refused, and that address is never looked up', async () => {
        signedIn({ id: 'sb-attacker', email: 'attacker@example.com', email_confirmed_at: CONFIRMED_AT });
        const res = await GET(get('victim@example.com'));
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain('true');
        expect(h.findUnique).not.toHaveBeenCalled();
    });

    it('a getUser error fails closed, even when a user object comes back with it', async () => {
        h.getUser.mockResolvedValue({
            data: { user: { id: 'sb-1', email: 'victim@example.com', email_confirmed_at: CONFIRMED_AT } },
            error: { message: 'invalid JWT' },
        });
        const res = await GET(get('victim@example.com'));
        expect(res.status).toBe(401);
        expect(h.findUnique).not.toHaveBeenCalled();
    });

    it('an unconfirmed session is refused', async () => {
        signedIn({ id: 'sb-1', email: 'victim@example.com', email_confirmed_at: null });
        const res = await GET(get('victim@example.com'));
        expect(res.status).toBe(401);
        expect(h.findUnique).not.toHaveBeenCalled();
    });

    it('a session without an email is refused without a lookup, never a 500', async () => {
        signedIn({ id: 'sb-1', email_confirmed_at: CONFIRMED_AT });
        const res = await GET(get());
        expect(res.status).toBe(401);
        expect(h.findUnique).not.toHaveBeenCalled();
    });
});

describe("GET /api/newsletter/status: the owner's own answer", () => {
    it('is keyed on the lowercased session address, with the parameter matched case-insensitively', async () => {
        signedIn({ id: 'sb-owner', email: 'Owner@Example.com', email_confirmed_at: CONFIRMED_AT });
        const res = await GET(get(' owner@EXAMPLE.com '));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ optIn: true });
        expect(h.findUnique).toHaveBeenCalledTimes(1);
        expect(h.findUnique).toHaveBeenCalledWith({
            where: { email: 'owner@example.com' },
            select: { newsletterOptIn: true },
        });
    });

    it.each([
        ['no parameter', undefined],
        ['a blank parameter', ' '],
    ])('answers for the session address when %s is sent', async (_label, email) => {
        signedIn({ id: 'sb-owner', email: 'owner@example.com', email_confirmed_at: CONFIRMED_AT });
        const res = await GET(get(email));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ optIn: true });
        expect(h.findUnique).toHaveBeenCalledWith({
            where: { email: 'owner@example.com' },
            select: { newsletterOptIn: true },
        });
    });

    it('reports false when the owner has no lead row or opted out', async () => {
        signedIn({ id: 'sb-owner', email: 'owner@example.com', email_confirmed_at: CONFIRMED_AT });
        h.findUnique.mockResolvedValueOnce(null);
        expect(await (await GET(get('owner@example.com'))).json()).toEqual({ optIn: false });
        h.findUnique.mockResolvedValueOnce({ newsletterOptIn: false });
        expect(await (await GET(get('owner@example.com'))).json()).toEqual({ optIn: false });
    });

    it('is marked private and never stored by a cache', async () => {
        signedIn({ id: 'sb-owner', email: 'owner@example.com', email_confirmed_at: CONFIRMED_AT });
        const res = await GET(get('owner@example.com'));
        expect(res.headers.get('cache-control')).toContain('no-store');
        expect(res.headers.get('cache-control')).toContain('private');
    });
});
