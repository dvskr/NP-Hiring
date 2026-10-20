/**
 * POST /api/push-subscribe: an endpoint registered to one account cannot be
 * taken over by another caller, and only a real push subscription is stored
 * (security sweep PUSH-1).
 *
 * The POST upserted on the caller's endpoint and its update branch rewrote
 * userId, p256dh and auth with no session required. A request without a
 * session that named an endpoint already stored for a signed-in user set the
 * row's userId to null and replaced its keys: the device could no longer
 * decrypt notifications, the owner-only DELETE stopped applying, and the row
 * dropped out of the account purge. Endpoint and keys were stored with no
 * format check, and the push cron POSTs to every stored endpoint.
 *
 * Pinned (against a small in-memory fake of the table, so the checks are on
 * the row afterwards, not on which Prisma call was used):
 *   - another caller, signed out or signed in, cannot rebind or rekey a row;
 *     only the owner, or the browser that holds the same keys, may write it;
 *   - the same keys never clear a bound owner;
 *   - new endpoints are created for signed-in users and for guests;
 *   - the endpoint must be a canonical https URL on a known push service and
 *     the keys must be what web-push can encrypt to; anything else is a 400
 *     before any database work;
 *   - DELETE answers 400 (not 500) for a bad endpoint and is still owner-gated.
 */
import { createECDH, randomBytes } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: {
        subscribe: { limit: 10, windowSeconds: 60 },
        general: { limit: 60, windowSeconds: 60 },
    },
}));
vi.mock('@/lib/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST, DELETE } from '@/app/api/push-subscribe/route';

interface Row { id: string; userId: string | null; endpoint: string; p256dh: string; auth: string }
type Where = Record<string, unknown>;

function matches(row: Row, where: Where): boolean {
    return Object.entries(where).every(([field, expected]) => {
        if (expected && typeof expected === 'object' && 'in' in expected) {
            return (expected as { in: unknown[] }).in.includes(row[field as keyof Row]);
        }
        return row[field as keyof Row] === expected;
    });
}

/** A push_subscriptions table with a unique endpoint, as Prisma would see it. */
function fakePushTable() {
    const rows = new Map<string, Row>();
    let nextId = 1;
    const insert = (data: Omit<Row, 'id'>): Row => {
        const row = { id: `sub-${nextId++}`, ...data, userId: data.userId ?? null };
        rows.set(row.endpoint, row);
        return row;
    };
    const methods = {
        // The whole row whatever the select: the route reads only what it selected.
        findUnique: vi.fn(async ({ where }: { where: { endpoint: unknown } }): Promise<Row | null> => {
            const row = rows.get(where.endpoint as string);
            return row ? { ...row } : null;
        }),
        create: vi.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
            if (rows.has(data.endpoint)) {
                throw Object.assign(new Error('Unique constraint failed on the fields: (`endpoint`)'), { code: 'P2002' });
            }
            return insert(data);
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
            const hits = [...rows.values()].filter((row) => matches(row, where));
            for (const row of hits) rows.set(row.endpoint, { ...row, ...data });
            return { count: hits.length };
        }),
        upsert: vi.fn(async ({ where, create, update }: { where: { endpoint: string }; create: Omit<Row, 'id'>; update: Partial<Row> }) => {
            const row = rows.get(where.endpoint);
            if (!row) return insert(create);
            const next = { ...row, ...update };
            rows.set(row.endpoint, next);
            return next;
        }),
        deleteMany: vi.fn(async ({ where }: { where: Where }) => {
            const hits = [...rows.values()].filter((row) => matches(row, where));
            for (const row of hits) rows.delete(row.endpoint);
            return { count: hits.length };
        }),
    };
    return { rows, insert, methods };
}

let table: ReturnType<typeof fakePushTable>;

function browserKeys(): { p256dh: string; auth: string } {
    const ecdh = createECDH('prime256v1');
    return { p256dh: ecdh.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

function fcmEndpoint(): string {
    return `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString('base64url')}:APA91b${randomBytes(48).toString('base64url')}`;
}

function request(method: 'POST' | 'DELETE', body: unknown): NextRequest {
    return new NextRequest('http://localhost:3000/api/push-subscribe', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

/** The body components/PushNotificationPrompt.tsx sends: { subscription: subscription.toJSON() }. */
function subscribe(endpoint: string, keys: unknown): Promise<Response> {
    return POST(request('POST', { subscription: { endpoint, expirationTime: null, keys } }));
}

function signIn(userId: string | null): void {
    mocks.getUser.mockResolvedValue({ data: { user: userId ? { id: userId, email: `${userId}@example.com` } : null }, error: null });
}

function expectNoDatabaseWork(): void {
    for (const method of Object.values(table.methods)) expect(method).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.clearAllMocks();
    table = fakePushTable();
    Object.assign(prisma.pushSubscription, table.methods);
    signIn(null);
});

describe('POST /api/push-subscribe: a bound endpoint keeps its owner', () => {
    it('refuses a signed-out caller with other keys and leaves the row alone', async () => {
        const endpoint = fcmEndpoint();
        const owned = table.insert({ userId: 'owner', endpoint, ...browserKeys() });

        const res = await subscribe(endpoint, browserKeys());

        expect(res.status).toBe(401);
        expect(table.rows.get(endpoint)).toEqual(owned);
    });

    it('refuses another signed-in account with other keys and leaves the row alone', async () => {
        const endpoint = fcmEndpoint();
        const owned = table.insert({ userId: 'owner', endpoint, ...browserKeys() });
        signIn('intruder');

        const res = await subscribe(endpoint, browserKeys());

        expect(res.status).toBe(401);
        expect(table.rows.get(endpoint)).toEqual(owned);
    });

    it('lets the owner change the keys', async () => {
        const endpoint = fcmEndpoint();
        table.insert({ userId: 'owner', endpoint, ...browserKeys() });
        const fresh = browserKeys();
        signIn('owner');

        const res = await subscribe(endpoint, fresh);

        expect(res.status).toBe(200);
        expect(table.rows.get(endpoint)).toMatchObject({ userId: 'owner', ...fresh });
    });

    it('treats the same keys signed out as the same browser: success, and the owner is never cleared', async () => {
        const endpoint = fcmEndpoint();
        const keys = browserKeys();
        const owned = table.insert({ userId: 'owner', endpoint, ...keys });

        const res = await subscribe(endpoint, keys);

        expect(res.status).toBe(200);
        expect(table.rows.get(endpoint)).toEqual(owned);
    });

    it('moves the row to the account now signed in on the browser that holds the keys', async () => {
        const endpoint = fcmEndpoint();
        const keys = browserKeys();
        table.insert({ userId: 'owner', endpoint, ...keys });
        signIn('second-account');

        const res = await subscribe(endpoint, keys);

        expect(res.status).toBe(200);
        expect(table.rows.get(endpoint)).toMatchObject({ userId: 'second-account', ...keys });
    });

    it('holds an anonymous row to its keys as well', async () => {
        const endpoint = fcmEndpoint();
        const keys = browserKeys();
        const anonymous = table.insert({ userId: null, endpoint, ...keys });
        signIn('someone');

        const refused = await subscribe(endpoint, browserKeys());
        expect(refused.status).toBe(401);
        expect(table.rows.get(endpoint)).toEqual(anonymous);

        const claimed = await subscribe(endpoint, keys);
        expect(claimed.status).toBe(200);
        expect(table.rows.get(endpoint)).toMatchObject({ userId: 'someone', ...keys });
    });

    it('cannot unbind a row with a signed-out POST, so a signed-out DELETE still fails afterwards', async () => {
        const endpoint = fcmEndpoint();
        const owned = table.insert({ userId: 'owner', endpoint, ...browserKeys() });

        const post = await subscribe(endpoint, browserKeys());
        const del = await DELETE(request('DELETE', { endpoint }));

        expect(post.status).toBe(401);
        expect(del.status).toBe(401);
        expect(table.rows.get(endpoint)).toEqual(owned);
    });
});

describe('POST /api/push-subscribe: new endpoints', () => {
    it('creates a row bound to the signed-in user', async () => {
        const endpoint = fcmEndpoint();
        const keys = browserKeys();
        signIn('seeker');

        const res = await subscribe(endpoint, keys);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(table.rows.get(endpoint)).toMatchObject({ userId: 'seeker', endpoint, ...keys });
    });

    it('creates an anonymous row for a guest', async () => {
        const endpoint = fcmEndpoint();
        const keys = browserKeys();

        const res = await subscribe(endpoint, keys);

        expect(res.status).toBe(200);
        expect(table.rows.get(endpoint)).toMatchObject({ userId: null, ...keys });
    });

    it('re-reads the row when a create loses a race to the same browser, and still succeeds', async () => {
        const endpoint = fcmEndpoint();
        const keys = browserKeys();
        // A second tab inserted the row between this request's read and its insert.
        table.insert({ userId: null, endpoint, ...keys });
        table.methods.findUnique.mockResolvedValueOnce(null);
        signIn('seeker');

        const res = await subscribe(endpoint, keys);

        expect(res.status).toBe(200);
        expect(table.rows.get(endpoint)).toMatchObject({ userId: 'seeker', ...keys });
    });

    it('accepts the endpoints Chrome, Firefox, Safari and Edge issue', async () => {
        const endpoints = [
            fcmEndpoint(),
            'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABmFh5jKPUKnoHcFzYZ0uAIyD4Ce6FQNAlXmcNjhWkGJbZTCgYRZ6zXMXRCLD0_Y5bJ5oUyG7Hi0Q-vNXo',
            'https://web.push.apple.com/QOnPzq9Qx8mGvnI9P5mQyLy4vTbg3fZXnZZB0g2wIp4vY3B9C3D5E7F9',
            'https://wns2-par02p.notify.windows.com/w/?token=BQYAAABexample%2bkey%3d',
        ];
        for (const endpoint of endpoints) {
            const res = await subscribe(endpoint, browserKeys());
            expect(res.status, endpoint).toBe(200);
            expect(table.rows.has(endpoint), endpoint).toBe(true);
        }
    });

    it('uses the subscribe rate limit (a browser subscribes once)', async () => {
        await subscribe(fcmEndpoint(), browserKeys());
        const [, bucket, config] = vi.mocked(rateLimit).mock.calls[0];
        expect(bucket).toBe('push-sub');
        expect(config).toBe(RATE_LIMITS.subscribe);
    });
});

describe('POST /api/push-subscribe: the subscription is checked before any database work', () => {
    it('refuses endpoints that are not a canonical https URL on a known push service', async () => {
        const path = '/fcm/send/abc:APA91bXYZ';
        const bad: unknown[] = [
            `http://fcm.googleapis.com${path}`,
            'https://evil.example/push',
            'https://127.0.0.1/push',
            'https://localhost/push',
            'https://169.254.169.254/latest/meta-data/',
            `https://fcm.googleapis.com.evil.example${path}`,
            `https://evilfcm.googleapis.com.example${path}`,
            `https://user:secret@fcm.googleapis.com${path}`,
            `https://fcm.googleapis.com@evil.example${path}`,
            `https://fcm.googleapis.com:8443${path}`,
            `https://fcm.googleapis.com:443${path}`,
            `https://FCM.googleapis.com${path}`,
            ` https://fcm.googleapis.com${path}`,
            `https://fcm.googleapis.com${path}\t`,
            `https://fcm.googleapis.com\\@evil.example${path}`,
            `https://fcm.googleapis.com/fcm/../..${path}`,
            `https://fcm.googleapis.com${path}${'a'.repeat(2100)}`,
            'not a url',
            '',
            42,
            { href: `https://fcm.googleapis.com${path}` },
            null,
        ];
        for (const endpoint of bad) {
            const res = await subscribe(endpoint as string, browserKeys());
            expect(res.status, JSON.stringify(endpoint)).toBe(400);
        }
        expectNoDatabaseWork();
    });

    it('logs the host of a refused push service, never the endpoint itself', async () => {
        await subscribe('https://push.unknown-browser.example/token-that-is-a-credential', browserKeys());
        expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { host: 'push.unknown-browser.example' });
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('token-that-is-a-credential');
    });

    it('refuses keys that web-push could never encrypt to', async () => {
        const good = browserKeys();
        const bad: unknown[] = [
            { ...good, p256dh: randomBytes(64).toString('base64url') },
            { ...good, p256dh: randomBytes(66).toString('base64url') },
            { ...good, p256dh: `${good.p256dh.slice(0, -1)}*` },
            { ...good, p256dh: randomBytes(65).toString('hex') },
            { ...good, auth: randomBytes(8).toString('base64url') },
            { ...good, auth: randomBytes(4096).toString('base64url') },
            { ...good, auth: 'not base64!' },
            { ...good, auth: 1234567890 },
            { p256dh: good.p256dh },
            { auth: good.auth },
            'keys',
            null,
        ];
        for (const keys of bad) {
            const res = await subscribe(fcmEndpoint(), keys);
            expect(res.status, JSON.stringify(keys)).toBe(400);
        }
        expectNoDatabaseWork();
    });

    it('refuses a missing subscription and a body that is not JSON', async () => {
        for (const body of [{}, { subscription: null }, { subscription: 'x' }, '{"subscription": ', 'null']) {
            const res = await POST(request('POST', body));
            expect(res.status, JSON.stringify(body)).toBe(400);
        }
        expectNoDatabaseWork();
    });
});

describe('DELETE /api/push-subscribe', () => {
    it('answers 400, not 500, for a missing, non-string or oversized endpoint', async () => {
        const bad: unknown[] = [
            {},
            { endpoint: '' },
            { endpoint: 42 },
            { endpoint: { contains: 'fcm' } },
            { endpoint: `https://fcm.googleapis.com/fcm/send/${'a'.repeat(3000)}` },
            '{"endpoint": ',
            'null',
        ];
        for (const body of bad) {
            const res = await DELETE(request('DELETE', body));
            expect(res.status, JSON.stringify(body)).toBe(400);
        }
        expectNoDatabaseWork();
    });

    it('lets the owner remove a bound row and refuses anyone else', async () => {
        const endpoint = fcmEndpoint();
        table.insert({ userId: 'owner', endpoint, ...browserKeys() });

        signIn('intruder');
        expect((await DELETE(request('DELETE', { endpoint }))).status).toBe(401);
        expect(table.rows.has(endpoint)).toBe(true);

        signIn('owner');
        expect((await DELETE(request('DELETE', { endpoint }))).status).toBe(200);
        expect(table.rows.has(endpoint)).toBe(false);
    });

    it('still removes a row stored before the push service list, for its owner', async () => {
        const endpoint = 'https://push.legacy-service.example/subscription/123';
        table.insert({ userId: 'owner', endpoint, ...browserKeys() });
        signIn('owner');

        const res = await DELETE(request('DELETE', { endpoint }));

        expect(res.status).toBe(200);
        expect(table.rows.has(endpoint)).toBe(false);
    });
});
