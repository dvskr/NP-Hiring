/**
 * POST /api/newsletter: opting out needs the address owner's session (NL-1).
 *
 * The route took `email` and `optIn` from an anonymous body. Any falsy optIn
 * (false, 0, '', null) reached the opt-out branch, which set
 * EmailLead.newsletterOptIn to false for whatever address was posted and
 * marked that address inactive in Beehiiv. Anyone who knew a subscriber's
 * address could take them off the newsletter.
 *
 * Pinned:
 *   - opting out needs a signed-in, confirmed session whose own address is
 *     the one posted (case and padding ignored); 401 without one, 403 for a
 *     different address, and a getUser error fails closed;
 *   - a refused opt-out touches neither the database nor Beehiiv;
 *   - optIn must be a real boolean, so 0, '', null and the string 'false'
 *     no longer pick a branch by truthiness;
 *   - the anonymous opt-in the public forms use (BlogEmailSignup,
 *     ResourceDownloadGate) still subscribes, signed in or not.
 *
 * Mocked only: no database or Beehiiv call can leave this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    syncToBeehiiv: vi.fn(),
    unsubscribeFromBeehiiv: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/prisma', () => ({
    prisma: { emailLead: { upsert: h.upsert, update: h.update } },
}));
vi.mock('@/lib/beehiiv', () => ({
    syncToBeehiiv: h.syncToBeehiiv,
    unsubscribeFromBeehiiv: h.unsubscribeFromBeehiiv,
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { jobAlerts: { limit: 10, windowSeconds: 60 } },
}));

import { POST } from '@/app/api/newsletter/route';

const CONFIRMED_AT = '2026-09-01T00:00:00Z';

function post(body: unknown): NextRequest {
    return new NextRequest('http://localhost:3000/api/newsletter', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify(body),
    });
}

function anonymous(): void {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Auth session missing!' } });
}

function signedIn(user: { id: string; email?: string; email_confirmed_at?: string | null }): void {
    h.getUser.mockResolvedValue({ data: { user }, error: null });
}

function expectNoWrites(): void {
    expect(h.update).not.toHaveBeenCalled();
    expect(h.unsubscribeFromBeehiiv).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.syncToBeehiiv).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.clearAllMocks();
    h.upsert.mockResolvedValue({});
    h.update.mockResolvedValue({});
});

describe('POST /api/newsletter: a refused opt-out writes nothing', () => {
    it('an anonymous opt-out gets 401 and touches neither the database nor Beehiiv', async () => {
        anonymous();
        const res = await POST(post({ email: 'victim@example.com', optIn: false }));
        expect(res.status).toBe(401);
        expectNoWrites();
    });

    it('a session for a different address gets 403 and nothing is written', async () => {
        signedIn({ id: 'sb-attacker', email: 'attacker@example.com', email_confirmed_at: CONFIRMED_AT });
        const res = await POST(post({ email: 'victim@example.com', optIn: false }));
        expect(res.status).toBe(403);
        expectNoWrites();
    });

    it('a getUser error fails closed, even when a user object comes back with it', async () => {
        h.getUser.mockResolvedValue({
            data: { user: { id: 'sb-1', email: 'victim@example.com', email_confirmed_at: CONFIRMED_AT } },
            error: { message: 'invalid JWT' },
        });
        const res = await POST(post({ email: 'victim@example.com', optIn: false }));
        expect(res.status).toBe(401);
        expectNoWrites();
    });

    it('a getUser that throws writes nothing', async () => {
        h.getUser.mockRejectedValue(new Error('auth service unreachable'));
        const res = await POST(post({ email: 'victim@example.com', optIn: false }));
        expect(res.status).toBeGreaterThanOrEqual(400);
        expectNoWrites();
    });

    it('an unconfirmed session is refused', async () => {
        signedIn({ id: 'sb-1', email: 'victim@example.com', email_confirmed_at: null });
        const res = await POST(post({ email: 'victim@example.com', optIn: false }));
        expect(res.status).toBe(401);
        expectNoWrites();
    });

    it('a session that carries no email is refused', async () => {
        signedIn({ id: 'sb-1', email_confirmed_at: CONFIRMED_AT });
        const res = await POST(post({ email: 'victim@example.com', optIn: false }));
        expect(res.status).toBe(401);
        expectNoWrites();
    });
});

describe('POST /api/newsletter: optIn must be a real boolean', () => {
    it.each([
        ['0', 0],
        ['an empty string', ''],
        ['null', null],
        ["the string 'false'", 'false'],
    ])('optIn %s from an anonymous caller is a 400 with no writes', async (_label, optIn) => {
        anonymous();
        const res = await POST(post({ email: 'victim@example.com', optIn }));
        expect(res.status).toBe(400);
        expectNoWrites();
    });
});

describe('POST /api/newsletter: the owner can still opt out', () => {
    it('matches case and padding, and both writes use the lowercased session address', async () => {
        signedIn({ id: 'sb-owner', email: 'Owner@Example.com', email_confirmed_at: CONFIRMED_AT });
        const res = await POST(post({ email: '  OWNER@example.COM ', optIn: false, source: 'settings_toggle' }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(h.update).toHaveBeenCalledTimes(1);
        expect(h.update).toHaveBeenCalledWith({
            where: { email: 'owner@example.com' },
            data: { newsletterOptIn: false },
        });
        expect(h.unsubscribeFromBeehiiv).toHaveBeenCalledWith('owner@example.com');
        expect(h.upsert).not.toHaveBeenCalled();
        expect(h.syncToBeehiiv).not.toHaveBeenCalled();
    });

    it('an owner with no lead row still gets 200 (the missing row is ignored)', async () => {
        signedIn({ id: 'sb-owner', email: 'owner@example.com', email_confirmed_at: CONFIRMED_AT });
        h.update.mockRejectedValue(new Error('Record to update not found.'));
        const res = await POST(post({ email: 'owner@example.com', optIn: false }));
        expect(res.status).toBe(200);
        expect(h.unsubscribeFromBeehiiv).toHaveBeenCalledWith('owner@example.com');
    });
});

describe('POST /api/newsletter: the public opt-in keeps working', () => {
    it.each([
        ['BlogEmailSignup', { email: 'New@Example.com', source: 'blog_post' }, 'blog_post'],
        ['ResourceDownloadGate', { email: ' new@example.com', source: 'resource_download' }, 'resource_download'],
        ['an explicit optIn true', { email: 'new@example.com', optIn: true, source: 'settings_toggle' }, 'settings_toggle'],
        ['no source', { email: 'new@example.com' }, 'newsletter'],
    ])('%s: an anonymous caller subscribes', async (_label, body, utmSource) => {
        anonymous();
        const res = await POST(post(body));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(h.upsert).toHaveBeenCalledWith({
            where: { email: 'new@example.com' },
            update: { newsletterOptIn: true },
            create: { email: 'new@example.com', source: utmSource, newsletterOptIn: true },
        });
        expect(h.syncToBeehiiv).toHaveBeenCalledWith('new@example.com', { utmSource });
        expect(h.update).not.toHaveBeenCalled();
        expect(h.unsubscribeFromBeehiiv).not.toHaveBeenCalled();
    });

    it('an invalid address is still a 400 with no writes', async () => {
        anonymous();
        const res = await POST(post({ email: 'not-an-address', optIn: false }));
        expect(res.status).toBe(400);
        expectNoWrites();
    });
});
