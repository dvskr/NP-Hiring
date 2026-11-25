/**
 * Broadcast audiences reach only people who asked for mail, and the count the
 * operator approves is the list the send builds.
 *
 * The "subscribers" audience and the mailing list half of "all" used to reach
 * every subscribed EmailLead row, including entries created only to hold an
 * unsubscribe token (source 'auto', getOrCreateUnsubToken) or written by a
 * receipt with no source: people who never opted in. The account audiences
 * counted suppressed and deleted accounts and anyone who unsubscribed by
 * hand. Now one predicate set (lib/admin/broadcast-audience.ts) and one
 * builder (lib/admin/broadcast-recipients.ts) drive both
 * /api/admin/email/audience and /api/admin/email/send.
 *
 * The database is an in-memory list that applies the routes' own `where`. A
 * filter like `not: 'auto'` on a nullable column is `source <> 'auto'` in
 * SQL, which drops null rows; written another way a filter can keep them. The
 * predicate is checked under both readings, so it does not depend on which
 * one Prisma produces. All addresses are fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
/** 'sql': `not: x` is false for a null value. 'keepNulls': it is true. */
type NotReading = 'sql' | 'keepNulls';

function matches(row: Row, where: Where | undefined, reading: NotReading): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => {
        if (key === 'AND') return ([] as Where[]).concat(cond as Where).every((w) => matches(row, w, reading));
        if (key === 'OR') return (cond as Where[]).some((w) => matches(row, w, reading));
        if (key === 'NOT') return !([] as Where[]).concat(cond as Where).some((w) => matches(row, w, reading));
        if (key === 'jobAlerts') {
            const alerts = (row.jobAlerts as unknown[] | undefined) ?? [];
            const filter = cond as { some?: object; none?: object };
            if (filter.some) return alerts.length > 0;
            if (filter.none) return alerts.length === 0;
            throw new Error('unsupported relation filter');
        }
        return fieldMatches(row[key] ?? null, cond, reading);
    });
}

function fieldMatches(value: unknown, cond: unknown, reading: NotReading): boolean {
    if (cond === null || typeof cond !== 'object') return value === cond;
    return Object.entries(cond as Record<string, unknown>).every(([op, arg]) => {
        switch (op) {
            case 'equals': return value === arg;
            case 'not':
                if (arg === null) return value !== null;
                if (value === null) return reading === 'keepNulls';
                return value !== arg;
            case 'in': return value !== null && (arg as unknown[]).includes(value);
            case 'notIn':
                if (value === null) return reading === 'keepNulls';
                return !(arg as unknown[]).includes(value);
            default: throw new Error(`unsupported operator ${op}`);
        }
    });
}

const lead = (email: string, over: Row = {}): Row => ({
    email, source: null, isSubscribed: true, isSuppressed: false, newsletterOptIn: false, jobAlerts: [], ...over,
});
const ALERT = [{ id: 'alert-fic' }];

const LEADS: Row[] = [
    lead('auto-only@example.com', { source: 'auto' }),
    lead('no-source@example.com'),
    lead('auto-newsletter@example.com', { source: 'auto', newsletterOptIn: true }),
    lead('no-source-alert@example.com', { jobAlerts: ALERT }),
    lead('auto-alert@example.com', { source: 'auto', jobAlerts: ALERT }),
    lead('newsletter@example.com', { source: 'newsletter', newsletterOptIn: true }),
    lead('alert-form@example.com', { source: 'job_alert', jobAlerts: ALERT }),
    lead('guide@example.com', { source: 'salary-guide' }),
    lead('signup@example.com', { source: 'signup' }),
    lead('unsubscribed@example.com', { source: 'newsletter', newsletterOptIn: true, isSubscribed: false }),
    lead('suppressed@example.com', { source: 'job_alert', jobAlerts: ALERT, isSuppressed: true }),
    lead('no-source-unsubscribed@example.com', { jobAlerts: ALERT, isSubscribed: false }),
    // An account holder who pressed Unsubscribe: the profile carries no flag.
    lead('seeker-unsubscribed@example.com', { source: 'signup', isSubscribed: false }),
];

const MAILING_LIST = [
    'auto-newsletter@example.com',
    'no-source-alert@example.com',
    'auto-alert@example.com',
    'newsletter@example.com',
    'alert-form@example.com',
    'guide@example.com',
    'signup@example.com',
];

const NEWSLETTER = ['auto-newsletter@example.com', 'newsletter@example.com'];

const PROFILES: Row[] = [
    { email: 'seeker@example.com', firstName: 'Sam', role: 'job_seeker', emailSuppressed: false, deletedAt: null },
    // An account holder whose only mailing list entry was made automatically:
    // still reached through the account half of "all".
    { email: 'auto-only@example.com', firstName: null, role: 'employer', emailSuppressed: false, deletedAt: null },
    { email: 'bounced@example.com', firstName: null, role: 'job_seeker', emailSuppressed: true, deletedAt: null },
    { email: 'deleted@example.com', firstName: null, role: 'job_seeker', emailSuppressed: false, deletedAt: new Date('2026-11-01T00:00:00Z') },
    { email: 'seeker-unsubscribed@example.com', firstName: 'Una', role: 'job_seeker', emailSuppressed: false, deletedAt: null },
];

const db = vi.hoisted(() => ({
    reading: 'sql' as 'sql' | 'keepNulls',
    leads: [] as Row[],
    profiles: [] as Row[],
    leadFindMany: vi.fn(),
    profileFindMany: vi.fn(),
    broadcastCreate: vi.fn(),
    broadcastFindFirst: vi.fn(),
    executeBroadcast: vi.fn(),
}));

vi.mock('@/lib/auth/require-api-admin', () => ({
    requireApiAdmin: vi.fn().mockResolvedValue(null),
    requireApiAdminActor: vi.fn().mockResolvedValue({
        error: null,
        actor: { profileId: 'admin-profile-fic', supabaseId: 'sb-admin-fic' },
    }),
    limitHighImpactAdminAction: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/audit-log', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/broadcast-sender', () => ({
    executeBroadcast: db.executeBroadcast,
    markdownToEmailHtml: vi.fn((md: string) => md),
    personalize: vi.fn((text: string) => text),
}));
vi.mock('@/lib/email-service', () => ({
    buildBroadcastHtml: vi.fn(() => '<html></html>'),
    sendBroadcastEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/inngest/client', () => ({
    inngest: { send: vi.fn() },
    BROADCAST_REQUESTED_EVENT: 'admin/broadcast.requested',
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        emailLead: { findMany: db.leadFindMany },
        userProfile: { findMany: db.profileFindMany },
        emailBroadcast: { create: db.broadcastCreate, findFirst: db.broadcastFindFirst },
        // The send checks for a duplicate and creates the broadcast in one
        // transaction under a lock; here the work simply runs.
        $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({
            $executeRaw: vi.fn().mockResolvedValue(1),
            emailBroadcast: { create: db.broadcastCreate, findFirst: db.broadcastFindFirst },
        })),
    },
}));

import { MAILING_LIST_LEADS } from '@/lib/admin/broadcast-audience';
import { GET as AUDIENCE } from '@/app/api/admin/email/audience/route';
import { POST as SEND } from '@/app/api/admin/email/send/route';

beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OUTBOUND_MESSAGING_PAUSED;
    db.reading = 'sql';
    db.leads = LEADS;
    db.profiles = PROFILES;
    db.leadFindMany.mockImplementation(async ({ where }: { where: Where }) =>
        db.leads.filter((r) => matches(r, where, db.reading)));
    db.profileFindMany.mockImplementation(async ({ where }: { where: Where }) =>
        db.profiles.filter((r) => matches(r, where, db.reading)));
    db.broadcastFindFirst.mockResolvedValue(null);
    db.broadcastCreate.mockResolvedValue({ id: 'b-fic' });
    db.executeBroadcast.mockResolvedValue({ status: 'sent' });
});

const emailsOf = (rows: Row[]) => rows.map((r) => String(r.email)).sort();

async function audienceCount(segment: string): Promise<number> {
    const res = await AUDIENCE(new NextRequest(`https://example.com/api/admin/email/audience?segment=${segment}`));
    const body = await res.json();
    expect(body.success).toBe(true);
    return body.count;
}

function sendRequest(audience: string): NextRequest {
    return new NextRequest('https://example.com/api/admin/email/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: 'News', body: 'Hello', audience }),
    });
}

async function sentTo(audience: string): Promise<string[]> {
    const res = await SEND(sendRequest(audience));
    expect(res.status).toBe(200);
    const created = db.broadcastCreate.mock.calls[0][0].data;
    const rows = created.recipients.createMany.data as Array<{ email: string }>;
    expect(created.audienceCount).toBe(rows.length);
    return rows.map((r) => r.email).sort();
}

describe('the mailing list predicate', () => {
    it.each(['sql', 'keepNulls'] as const)('leaves out automatic entries that never asked for mail (not read as %s)', (reading) => {
        const reached = LEADS.filter((r) => matches(r, MAILING_LIST_LEADS, reading));
        expect(emailsOf(reached)).toEqual([...MAILING_LIST].sort());
    });

    it('needs its explicit null case: a bare not: \'auto\' keeps null sources under one reading', () => {
        const bare: Where = { isSubscribed: true, isSuppressed: false, source: { not: 'auto' } };
        const kept = (reading: NotReading) =>
            LEADS.filter((r) => matches(r, bare, reading)).map((r) => r.email);
        expect(kept('sql')).not.toContain('no-source@example.com');
        expect(kept('keepNulls')).toContain('no-source@example.com');
    });
});

describe('"subscribers" audience', () => {
    it.each(['sql', 'keepNulls'] as const)('the count and the send reach the same entries (not read as %s)', async (reading) => {
        db.reading = reading;
        const count = await audienceCount('subscribers');
        const recipients = await sentTo('subscribers');

        expect(recipients).toEqual([...MAILING_LIST].sort());
        expect(count).toBe(recipients.length);
    });

    it('leaves out an automatic entry, with or without a source, and an opted-out one', async () => {
        const recipients = await sentTo('subscribers');
        for (const out of [
            'auto-only@example.com', 'no-source@example.com', 'unsubscribed@example.com',
            'suppressed@example.com', 'no-source-unsubscribed@example.com', 'seeker-unsubscribed@example.com',
        ]) {
            expect(recipients).not.toContain(out);
        }
    });

    it('keeps an automatic entry that later opted into the newsletter or holds a job alert', async () => {
        const recipients = await sentTo('subscribers');
        expect(recipients).toEqual(expect.arrayContaining([
            'auto-newsletter@example.com', 'no-source-alert@example.com', 'auto-alert@example.com',
        ]));
    });
});

describe('"newsletter" audience', () => {
    it('reaches subscribed, unsuppressed opt-ins only, and the count agrees', async () => {
        const count = await audienceCount('newsletter');
        const recipients = await sentTo('newsletter');
        expect(recipients).toEqual([...NEWSLETTER].sort());
        expect(count).toBe(recipients.length);
    });
});

describe('account audiences', () => {
    it('"job seekers" leaves out suppressed, deleted and hand-unsubscribed accounts, and the count agrees', async () => {
        const count = await audienceCount('job_seekers');
        const recipients = await sentTo('job_seekers');
        expect(recipients).toEqual(['seeker@example.com']);
        expect(count).toBe(1);
    });

    it('"employers" reaches mailable employer accounts', async () => {
        const count = await audienceCount('employers');
        const recipients = await sentTo('employers');
        expect(recipients).toEqual(['auto-only@example.com']);
        expect(count).toBe(1);
    });
});

describe('"all" audience', () => {
    it.each(['sql', 'keepNulls'] as const)('the count and the send reach the same addresses (not read as %s)', async (reading) => {
        db.reading = reading;
        const count = await audienceCount('all');
        const recipients = await sentTo('all');

        // Accounts (opt-out basis) plus the mailing list. A suppressed, a
        // deleted and a hand-unsubscribed account and the automatic list-only
        // entry are not in it.
        expect(recipients).toEqual(['auto-only@example.com', 'seeker@example.com', ...MAILING_LIST].sort());
        expect(count).toBe(recipients.length);
        for (const out of ['no-source@example.com', 'bounced@example.com', 'deleted@example.com', 'seeker-unsubscribed@example.com']) {
            expect(recipients).not.toContain(out);
        }
    });

    it('names an address once when the account and the list entry differ only in case', async () => {
        db.profiles = [
            { email: 'Newsletter@Example.com', firstName: 'Nia', role: 'employer', emailSuppressed: false, deletedAt: null },
        ];
        const count = await audienceCount('all');
        const recipients = await sentTo('all');
        const lowered = recipients.map((e) => e.toLowerCase());
        expect(lowered.filter((e) => e === 'newsletter@example.com')).toHaveLength(1);
        // The account row wins, so the first name travels with it.
        const rows = db.broadcastCreate.mock.calls[0][0].data.recipients.createMany.data as Array<{ email: string; firstName: string | null }>;
        expect(rows.find((r) => r.email === 'Newsletter@Example.com')?.firstName).toBe('Nia');
        expect(count).toBe(recipients.length);
    });
});

describe('a list entry whose address belongs to an account that must not be mailed', () => {
    // List entries that would qualify on their own flags, for the account
    // fixtures that are suppressed ('bounced@') and deleted ('deleted@').
    const accountLeads: Row[] = [
        lead('bounced@example.com', { source: 'newsletter', newsletterOptIn: true }),
        lead('Deleted@Example.com', { source: 'job_alert', newsletterOptIn: true, jobAlerts: ALERT }),
    ];

    beforeEach(() => {
        db.leads = [...LEADS, ...accountLeads];
    });

    it.each(['subscribers', 'newsletter', 'all'])('is left out of "%s", in any case, and the count agrees', async (segment) => {
        const count = await audienceCount(segment);
        const recipients = await sentTo(segment);
        const lowered = recipients.map((email) => email.toLowerCase());

        expect(lowered).not.toContain('bounced@example.com');
        expect(lowered).not.toContain('deleted@example.com');
        expect(count).toBe(recipients.length);
    });

    it('leaves the rest of the list as it was', async () => {
        expect(await sentTo('subscribers')).toEqual([...MAILING_LIST].sort());
    });

    it('asks for those accounts by the suppressed or deleted rule', async () => {
        await sentTo('newsletter');

        expect(db.profileFindMany).toHaveBeenCalledWith({
            where: { OR: [{ emailSuppressed: true }, { deletedAt: { not: null } }] },
            select: { email: true },
        });
    });
});

describe('an audience name the routes do not know', () => {
    it('the send refuses it instead of mailing everyone', async () => {
        const res = await SEND(sendRequest('job_seeker'));
        expect(res.status).toBe(400);
        expect(db.broadcastCreate).not.toHaveBeenCalled();
        expect(db.leadFindMany).not.toHaveBeenCalled();
        expect(db.profileFindMany).not.toHaveBeenCalled();
    });

    it('the count refuses it too, and a missing name still means "all"', async () => {
        const unknown = await AUDIENCE(new NextRequest('https://example.com/api/admin/email/audience?segment=everyone'));
        expect(unknown.status).toBe(400);

        const fallback = await AUDIENCE(new NextRequest('https://example.com/api/admin/email/audience'));
        const body = await fallback.json();
        expect(body.segment).toBe('all');
        expect(body.count).toBe(2 + MAILING_LIST.length);
    });
});
