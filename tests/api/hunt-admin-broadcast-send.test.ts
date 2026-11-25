/**
 * POST /api/admin/email/send, the rules around a broadcast:
 *  - the emergency brake (OUTBOUND_MESSAGING_PAUSED=1) answers 503 before an
 *    audience is built or a row is written, and only after the admin gate;
 *  - every broadcast created is audited once, with ids and counts only;
 *  - a second send of the same subject, body and audience is refused (409)
 *    while the first is still sending; for a typed list, only when one of its
 *    addresses is waiting on the first;
 *  - the duplicate check and the create are one transaction under a
 *    transaction lock on the content and audience, so two identical requests
 *    sent together create one broadcast and the second is refused;
 *  - every send is charged to the admin's high-impact budget, after the gate
 *    and before anything is built or written;
 *  - a test send (isTest) creates no broadcast row, so it is neither
 *    duplicate checked nor audited;
 *  - small lists send inside the request, large ones go to Inngest.
 *
 * The admin user actions that shared this file's source test (role change,
 * hard delete) are pinned in tests/regressions/p10-admin-users-gates.test.ts.
 * All addresses are fictional.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
    requireApiAdminActor: vi.fn(),
    limitHighImpactAdminAction: vi.fn(),
    logAudit: vi.fn(),
    executeBroadcast: vi.fn(),
    inngestSend: vi.fn(),
    sendBroadcastEmail: vi.fn(),
    buildSegmentRecipients: vi.fn(),
    broadcastCreate: vi.fn(),
    broadcastFindFirst: vi.fn(),
    transaction: vi.fn(),
    executeRaw: vi.fn(),
}));

vi.mock('@/lib/auth/require-api-admin', () => ({
    requireApiAdminActor: mocks.requireApiAdminActor,
    limitHighImpactAdminAction: mocks.limitHighImpactAdminAction,
}));
vi.mock('@/lib/audit-log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/broadcast-sender', () => ({
    executeBroadcast: mocks.executeBroadcast,
    markdownToEmailHtml: vi.fn((md: string) => `<p>${md}</p>`),
    personalize: vi.fn((text: string) => text),
}));
vi.mock('@/lib/email-service', () => ({
    buildBroadcastHtml: vi.fn(() => '<html></html>'),
    sendBroadcastEmail: mocks.sendBroadcastEmail,
}));
vi.mock('@/lib/inngest/client', () => ({
    inngest: { send: mocks.inngestSend },
    BROADCAST_REQUESTED_EVENT: 'admin/broadcast.requested',
}));
vi.mock('@/lib/admin/broadcast-recipients', () => ({ buildSegmentRecipients: mocks.buildSegmentRecipients }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        emailBroadcast: { create: mocks.broadcastCreate, findFirst: mocks.broadcastFindFirst },
        $transaction: mocks.transaction,
    },
}));

/** The client the claim transaction hands its work: the lock statement and the broadcast rows. */
const txClient = () => ({
    $executeRaw: mocks.executeRaw,
    emailBroadcast: { create: mocks.broadcastCreate, findFirst: mocks.broadcastFindFirst },
});

import { POST as SEND } from '@/app/api/admin/email/send/route';
import { OUTBOUND_PAUSED_MESSAGE } from '@/lib/outbound-kill-switch';

const ADMIN = { profileId: 'admin-profile-fic', supabaseId: 'sb-admin-fic' };
const emails = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@example.com`);

function post(body: unknown): NextRequest {
    return new NextRequest('https://example.com/api/admin/email/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const sendCustom = (customEmails: string[], extra: Record<string, unknown> = {}) =>
    SEND(post({ subject: 'News', body: 'Hello', audience: 'custom', customEmails, ...extra }));

const ORIGINAL_INNGEST_EVENT_KEY = process.env.INNGEST_EVENT_KEY;

afterEach(() => {
    delete process.env.OUTBOUND_MESSAGING_PAUSED;
    if (ORIGINAL_INNGEST_EVENT_KEY === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = ORIGINAL_INNGEST_EVENT_KEY;
});

beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OUTBOUND_MESSAGING_PAUSED;
    process.env.INNGEST_EVENT_KEY = 'test-event-key';
    mocks.requireApiAdminActor.mockResolvedValue({ error: null, actor: ADMIN });
    mocks.limitHighImpactAdminAction.mockResolvedValue(null);
    mocks.executeRaw.mockResolvedValue(1);
    mocks.transaction.mockImplementation(async (work: (tx: ReturnType<typeof txClient>) => Promise<unknown>) => work(txClient()));
    mocks.executeBroadcast.mockResolvedValue({ broadcastId: 'b1', total: 1, sent: 1, failed: 0, skipped: 0, status: 'sent' });
    mocks.inngestSend.mockResolvedValue({ ids: ['evt-1'] });
    mocks.sendBroadcastEmail.mockResolvedValue({ success: true });
    mocks.buildSegmentRecipients.mockResolvedValue([
        { email: 'a@example.com', firstName: 'Ann' },
        { email: 'b@example.com' },
    ]);
    mocks.broadcastFindFirst.mockResolvedValue(null);
    mocks.broadcastCreate.mockResolvedValue({ id: 'b1' });
});

describe('the emergency brake', () => {
    it('answers 503 with the reason and touches nothing while OUTBOUND_MESSAGING_PAUSED=1', async () => {
        process.env.OUTBOUND_MESSAGING_PAUSED = '1';
        const res = await SEND(post({ subject: 'News', body: 'Hello', audience: 'all' }));

        expect(res.status).toBe(503);
        expect((await res.json()).error).toBe(OUTBOUND_PAUSED_MESSAGE);
        expect(mocks.buildSegmentRecipients).not.toHaveBeenCalled();
        expect(mocks.broadcastFindFirst).not.toHaveBeenCalled();
        expect(mocks.broadcastCreate).not.toHaveBeenCalled();
        expect(mocks.executeBroadcast).not.toHaveBeenCalled();
        expect(mocks.inngestSend).not.toHaveBeenCalled();
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });

    it('holds a test send back as well', async () => {
        process.env.OUTBOUND_MESSAGING_PAUSED = '1';
        const res = await sendCustom(['me@example.com'], { isTest: true });
        expect(res.status).toBe(503);
        expect(mocks.sendBroadcastEmail).not.toHaveBeenCalled();
    });

    it('is read only after the admin gate, so a stranger still gets the gate answer', async () => {
        process.env.OUTBOUND_MESSAGING_PAUSED = '1';
        mocks.requireApiAdminActor.mockResolvedValue({
            error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
            actor: null,
        });
        const res = await SEND(post({ subject: 'News', body: 'Hello', audience: 'all' }));
        expect(res.status).toBe(401);
    });

    it("is engaged by 'true' or 'yes' in any case as well as by 1", async () => {
        for (const value of [' TRUE ', 'yes']) {
            process.env.OUTBOUND_MESSAGING_PAUSED = value;
            const res = await SEND(post({ subject: 'News', body: 'Hello', audience: 'all' }));
            expect(res.status, value).toBe(503);
        }
        expect(mocks.broadcastCreate).not.toHaveBeenCalled();
    });

    it("is off for any other value, 'false' and '0' included", async () => {
        for (const value of ['false', '0']) {
            process.env.OUTBOUND_MESSAGING_PAUSED = value;
            const res = await SEND(post({ subject: `News ${value}`, body: 'Hello', audience: 'all' }));
            expect(res.status, value).toBe(200);
        }
        expect(mocks.broadcastCreate).toHaveBeenCalledTimes(2);
    });
});

describe('the audit entry', () => {
    it('records one entry per broadcast with ids and counts, never an address or the message', async () => {
        await sendCustom(emails(120));

        expect(mocks.logAudit).toHaveBeenCalledTimes(1);
        const entry = mocks.logAudit.mock.calls[0][0];
        expect(entry).toEqual({
            action: 'admin.email.broadcast',
            actorType: 'admin',
            actorId: ADMIN.profileId,
            targetType: 'email_broadcast',
            targetId: 'b1',
            metadata: { audience: 'custom', recipientCount: 120 },
        });
        const serialized = JSON.stringify(entry);
        expect(serialized).not.toContain('@example.com');
        expect(serialized).not.toContain('News');
        expect(serialized).not.toContain('Hello');
    });

    it('is not written when the send is refused before a broadcast exists', async () => {
        mocks.broadcastFindFirst.mockResolvedValue({ id: 'b-old' });
        await sendCustom(emails(3));
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });
});

describe('where the send runs', () => {
    it('a list of 50 or fewer is sent inside the request', async () => {
        const res = await sendCustom(emails(10));
        expect(res.status).toBe(200);
        expect(mocks.executeBroadcast).toHaveBeenCalledWith('b1');
        expect(mocks.inngestSend).not.toHaveBeenCalled();
    });

    it('a larger list goes to Inngest and the response says it is sending', async () => {
        const res = await sendCustom(emails(120));
        const body = await res.json();
        expect(body).toMatchObject({ success: true, broadcastId: 'b1', total: 120, status: 'sending' });
        expect(mocks.inngestSend).toHaveBeenCalledWith({ name: 'admin/broadcast.requested', data: { broadcastId: 'b1' } });
        expect(mocks.executeBroadcast).not.toHaveBeenCalled();
    });

    it('falls back to the in-process send when Inngest is not configured', async () => {
        delete process.env.INNGEST_EVENT_KEY;
        await sendCustom(emails(120));
        expect(mocks.inngestSend).not.toHaveBeenCalled();
        expect(mocks.executeBroadcast).toHaveBeenCalledWith('b1');
    });
});

describe('the duplicate guard', () => {
    it('refuses a second send of the same content to a named audience while the first is sending', async () => {
        mocks.broadcastFindFirst.mockResolvedValue({ id: 'b-old' });
        const res = await SEND(post({ subject: 'News', body: 'Hello', audience: 'subscribers' }));

        expect(res.status).toBe(409);
        expect((await res.json()).broadcastId).toBe('b-old');
        expect(mocks.broadcastCreate).not.toHaveBeenCalled();
        expect(mocks.executeBroadcast).not.toHaveBeenCalled();
        const where = mocks.broadcastFindFirst.mock.calls[0][0].where;
        expect(where).toEqual({ subject: 'News', body: 'Hello', audience: 'subscribers', status: 'sending' });
    });

    it('lets a different subject, body or audience through', async () => {
        const res = await SEND(post({ subject: 'Other news', body: 'Hello', audience: 'subscribers' }));
        expect(res.status).toBe(200);
        expect(mocks.broadcastCreate).toHaveBeenCalledTimes(1);
    });

    describe('identical custom content to a different list', () => {
        // An unfinished custom broadcast of 'News'/'Hello' to two addresses,
        // answered the way the database would answer the route's query.
        const inFlight = { id: 'b-old', subject: 'News', body: 'Hello', audience: 'custom', recipients: ['p0@example.com', 'p1@example.com'] };
        beforeEach(() => {
            type Where = {
                subject?: string; body?: string; audience?: string; status?: string;
                recipients?: { some?: { email?: { in?: string[] } } };
            };
            mocks.broadcastFindFirst.mockImplementation(async ({ where }: { where: Where }) => {
                const sameContent = where.subject === inFlight.subject && where.body === inFlight.body
                    && where.audience === inFlight.audience && where.status === 'sending';
                const wanted: string[] | undefined = where.recipients?.some?.email?.in;
                const overlaps = wanted === undefined || wanted.some((e) => inFlight.recipients.includes(e));
                return sameContent && overlaps ? { id: inFlight.id } : null;
            });
        });

        it('is sent: nobody on the new list is waiting on the first one', async () => {
            const res = await sendCustom(['q0@example.com', 'q1@example.com']);
            expect(res.status).toBe(200);
            expect(mocks.broadcastCreate).toHaveBeenCalledTimes(1);
        });

        it('is refused when an address on it is still pending in the first one, whatever its case', async () => {
            const res = await sendCustom(['q0@example.com', 'P1@example.com']);
            expect(res.status).toBe(409);
            expect(mocks.broadcastCreate).not.toHaveBeenCalled();
        });
    });
});

describe('the duplicate check and the create share one transaction', () => {
    const named = (subject: string, body: string, audience: string) => SEND(post({ subject, body, audience }));

    it('takes a transaction lock first, then checks, then creates', async () => {
        await named('News', 'Hello', 'subscribers');

        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        const [sql, key] = mocks.executeRaw.mock.calls[0] as [TemplateStringsArray, unknown];
        expect(sql.join('$1')).toBe('SELECT pg_advisory_xact_lock(hashtext($1))');
        expect(typeof key).toBe('string');
        const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0];
        expect(order(mocks.executeRaw)).toBeLessThan(order(mocks.broadcastFindFirst));
        expect(order(mocks.broadcastFindFirst)).toBeLessThan(order(mocks.broadcastCreate));
    });

    it('locks identical content on one key, and other content on another, however the text splits', async () => {
        await named('News', 'Hello', 'subscribers');
        await named('News', 'Hello', 'subscribers');
        await named('News', 'Hello', 'newsletter');
        await named('New', 'sHello', 'subscribers');

        const keys = mocks.executeRaw.mock.calls.map((call) => call[1]);
        expect(keys[1]).toBe(keys[0]);
        expect(keys[2]).not.toBe(keys[0]);
        expect(keys[3]).not.toBe(keys[0]);
    });

    it('gives the transaction more than the 5 second default, since the create writes every recipient', async () => {
        await named('News', 'Hello', 'subscribers');

        const options = mocks.transaction.mock.calls[0][1] as { timeout: number };
        expect(options.timeout).toBeGreaterThan(5_000);
    });

    it('writes the recipients as one batched insert', async () => {
        await sendCustom(emails(3));

        const data = mocks.broadcastCreate.mock.calls[0][0].data;
        expect(data.recipients.createMany.data).toEqual([
            { email: 'p0@example.com', firstName: null },
            { email: 'p1@example.com', firstName: null },
            { email: 'p2@example.com', firstName: null },
        ]);
        expect(data.audienceCount).toBe(3);
    });

    it('answers 500 and audits nothing when the transaction fails', async () => {
        mocks.transaction.mockRejectedValueOnce(new Error('lock wait timed out'));

        const res = await named('News', 'Hello', 'subscribers');

        expect(res.status).toBe(500);
        expect(mocks.logAudit).not.toHaveBeenCalled();
        expect(mocks.executeBroadcast).not.toHaveBeenCalled();
    });

    describe('two identical requests sent together', () => {
        type Stored = { id: string; subject: string; body: string; audience: string; status: string };
        let rows: Stored[];
        /** The transaction locks held right now, by key, as the database would hold them. */
        let held: Map<string, Promise<void>>;

        beforeEach(() => {
            rows = [];
            held = new Map();
            mocks.broadcastFindFirst.mockImplementation(async ({ where }: { where: Omit<Stored, 'id'> }) =>
                rows.find((row) => row.subject === where.subject && row.body === where.body
                    && row.audience === where.audience && row.status === where.status) ?? null);
            mocks.broadcastCreate.mockImplementation(async ({ data }: { data: Omit<Stored, 'id'> }) => {
                // The insert takes a moment, as it does in the database.
                await new Promise((resolve) => setTimeout(resolve, 5));
                const row = { id: `b-${rows.length + 1}`, subject: data.subject, body: data.body, audience: data.audience, status: data.status };
                rows.push(row);
                return { id: row.id };
            });
            mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => {
                const releases: Array<() => void> = [];
                const lock = async (_sql: TemplateStringsArray, key: unknown) => {
                    const k = String(key);
                    while (held.has(k)) await held.get(k);
                    held.set(k, new Promise<void>((resolve) => releases.push(() => { held.delete(k); resolve(); })));
                    return 1;
                };
                try {
                    return await work({ ...txClient(), $executeRaw: lock });
                } finally {
                    releases.forEach((release) => release());
                }
            });
        });

        it('create one broadcast, and the second waits for it and is refused', async () => {
            const [first, second] = await Promise.all([
                named('News', 'Hello', 'subscribers'),
                named('News', 'Hello', 'subscribers'),
            ]);

            expect([first.status, second.status].sort()).toEqual([200, 409]);
            expect(rows).toHaveLength(1);
            expect(mocks.executeBroadcast).toHaveBeenCalledTimes(1);
            expect(mocks.logAudit).toHaveBeenCalledTimes(1);
        });

        it('still both go out when their content differs', async () => {
            const [first, second] = await Promise.all([
                named('News', 'Hello', 'subscribers'),
                named('Other news', 'Hello', 'subscribers'),
            ]);

            expect([first.status, second.status]).toEqual([200, 200]);
            expect(rows).toHaveLength(2);
        });
    });
});

describe('the high-impact budget', () => {
    it('charges every send to the admin as an email send', async () => {
        await SEND(post({ subject: 'News', body: 'Hello', audience: 'all' }));
        await sendCustom(['me@example.com'], { isTest: true });

        expect(mocks.limitHighImpactAdminAction).toHaveBeenCalledTimes(2);
        expect(mocks.limitHighImpactAdminAction).toHaveBeenCalledWith('email-send', ADMIN);
    });

    it('answers its 429 before an audience is built, a row is written or a message leaves', async () => {
        mocks.limitHighImpactAdminAction.mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));

        const res = await SEND(post({ subject: 'News', body: 'Hello', audience: 'all' }));

        expect(res.status).toBe(429);
        expect(mocks.buildSegmentRecipients).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.executeBroadcast).not.toHaveBeenCalled();
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });

    it('is not charged for a caller the admin gate refuses', async () => {
        mocks.requireApiAdminActor.mockResolvedValue({
            error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
            actor: null,
        });

        expect((await SEND(post({ subject: 'News', body: 'Hello', audience: 'all' }))).status).toBe(401);
        expect(mocks.limitHighImpactAdminAction).not.toHaveBeenCalled();
    });
});

describe('a test send', () => {
    it('mails the typed address and creates no broadcast, duplicate check or audit entry', async () => {
        const res = await sendCustom(['me@example.com'], { subject: '[TEST] News', isTest: true });
        const body = await res.json();

        expect(body).toMatchObject({ success: true, isTest: true, sent: 1, failed: 0 });
        expect(mocks.sendBroadcastEmail).toHaveBeenCalledTimes(1);
        expect(mocks.sendBroadcastEmail.mock.calls[0][0]).toBe('me@example.com');
        expect(mocks.broadcastCreate).not.toHaveBeenCalled();
        expect(mocks.broadcastFindFirst).not.toHaveBeenCalled();
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });

    it('is refused for a named audience or more than five addresses', async () => {
        const named = await SEND(post({ subject: 'News', body: 'Hello', audience: 'all', isTest: true }));
        expect(named.status).toBe(400);
        const wide = await sendCustom(emails(6), { isTest: true });
        expect(wide.status).toBe(400);
        expect(mocks.sendBroadcastEmail).not.toHaveBeenCalled();
    });

    it('reports a failed delivery instead of claiming success', async () => {
        mocks.sendBroadcastEmail.mockResolvedValue({ success: false, error: 'provider refused' });
        const body = await (await sendCustom(['me@example.com'], { isTest: true })).json();
        expect(body.success).toBe(false);
        expect(body.failed).toBe(1);
        expect(body.error).toContain('provider refused');
    });
});

describe('input checks', () => {
    it('answers 400 for a missing subject, body or audience, and for a body that is not JSON', async () => {
        expect((await SEND(post({ body: 'Hello', audience: 'all' }))).status).toBe(400);
        expect((await SEND(post({ subject: 'News', audience: 'all' }))).status).toBe(400);
        expect((await SEND(post({ subject: 'News', body: 'Hello' }))).status).toBe(400);
        expect((await SEND(post({ subject: { not: '' }, body: 'Hello', audience: 'all' }))).status).toBe(400);
        const notJson = new NextRequest('https://example.com/api/admin/email/send', { method: 'POST', body: 'not json' });
        expect((await SEND(notJson)).status).toBe(400);
        expect(mocks.broadcastCreate).not.toHaveBeenCalled();
    });

    it('answers 400 when a named audience has nobody in it', async () => {
        mocks.buildSegmentRecipients.mockResolvedValue([]);
        const res = await SEND(post({ subject: 'News', body: 'Hello', audience: 'newsletter' }));
        expect(res.status).toBe(400);
        expect(mocks.broadcastCreate).not.toHaveBeenCalled();
    });

    it('answers 500, with nothing swallowed, when the audience cannot be built', async () => {
        mocks.buildSegmentRecipients.mockRejectedValue(new Error('db down'));
        const res = await SEND(post({ subject: 'News', body: 'Hello', audience: 'all' }));
        expect(res.status).toBe(500);
        expect((await res.json()).success).toBe(false);
    });
});
