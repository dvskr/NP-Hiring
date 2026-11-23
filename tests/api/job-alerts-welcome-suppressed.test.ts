/**
 * Register 2.26: the job alert welcome email never goes to a suppressed address.
 *
 * POST /api/job-alerts lifts an Unsubscribe suppression on an explicit signup
 * (owner decision D26 covers whether it should), but a bounce or a complaint
 * stays suppressed, so the digests never send. The welcome email went out
 * anyway: a marketing send to an address that bounced or reported spam, the
 * deliverability risk the suppression exists for. The route now asks
 * isEmailSuppressed (the lead or the profile) after any lift, before it sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    emailLead: { upsert: vi.fn(), update: vi.fn() },
    userProfile: { updateMany: vi.fn() },
    txJobAlert: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    sendWelcomeEmail: vi.fn(),
    isEmailSuppressed: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    prisma: { emailLead: h.emailLead, userProfile: h.userProfile, $transaction: h.$transaction },
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { jobAlerts: { limit: 10, windowSeconds: 60 }, general: { limit: 60, windowSeconds: 60 } },
}));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({ sendWelcomeEmail: h.sendWelcomeEmail, isEmailSuppressed: h.isEmailSuppressed }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
// Whether the caller is signed in as the address (lib/job-alerts/alert-access.ts).
const access = vi.hoisted(() => ({ provesControlOf: vi.fn() }));
vi.mock('@/lib/job-alerts/alert-access', () => ({ provesControlOf: access.provesControlOf }));

import { POST } from '@/app/api/job-alerts/route';

const EMAIL = 'seeker@example.com';

function signup(): NextRequest {
    return new NextRequest('http://localhost/api/job-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, keyword: 'Telehealth', frequency: 'daily' }),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    access.provesControlOf.mockResolvedValue(false);
    h.emailLead.upsert.mockResolvedValue({ isSuppressed: false, suppressionReason: null });
    h.$executeRaw.mockResolvedValue(1);
    h.$transaction.mockImplementation((arg: unknown) =>
        typeof arg === 'function'
            ? (arg as (tx: unknown) => Promise<unknown>)({ $executeRaw: h.$executeRaw, jobAlert: h.txJobAlert })
            : Promise.resolve([]),
    );
    h.txJobAlert.findFirst.mockResolvedValue(null);
    h.txJobAlert.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'alert-1', ...data }));
    h.sendWelcomeEmail.mockResolvedValue({ success: true });
    h.isEmailSuppressed.mockResolvedValue(false);
});

describe('POST /api/job-alerts: the welcome email and suppression', () => {
    it('stores the alert but sends no welcome email to an address suppressed after a bounce or a complaint', async () => {
        h.emailLead.upsert.mockResolvedValue({ isSuppressed: true, suppressionReason: 'bounce' });
        h.isEmailSuppressed.mockResolvedValue(true);
        const res = await POST(signup());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, isNew: true, checkInbox: true });
        expect(h.txJobAlert.create).toHaveBeenCalledTimes(1);
        expect(h.isEmailSuppressed).toHaveBeenCalledWith(EMAIL);
        expect(h.sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('still welcomes an address that is not suppressed', async () => {
        await POST(signup());
        expect(h.sendWelcomeEmail).toHaveBeenCalledWith(EMAIL);
    });

    it('a stranger\'s signup lifts no unsubscribe and sends that address nothing', async () => {
        h.emailLead.upsert.mockResolvedValue({ isSuppressed: true, suppressionReason: 'unsubscribe' });
        h.isEmailSuppressed.mockResolvedValue(true);
        const res = await POST(signup());
        expect(await res.json()).toEqual({ success: true, isNew: true, checkInbox: true });
        expect(h.$transaction.mock.calls.filter((c) => Array.isArray(c[0]))).toHaveLength(0);
        expect(h.userProfile.updateMany).not.toHaveBeenCalled();
        expect(h.sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('asks only after the owner\'s unsubscribe lift, so a lifted address is welcomed', async () => {
        access.provesControlOf.mockResolvedValue(true);
        h.emailLead.upsert.mockResolvedValue({ isSuppressed: true, suppressionReason: 'unsubscribe' });
        await POST(signup());
        expect(h.$transaction.mock.invocationCallOrder[0]).toBeLessThan(h.isEmailSuppressed.mock.invocationCallOrder[0]);
        expect(h.sendWelcomeEmail).toHaveBeenCalledWith(EMAIL);
    });

    // Security review of 2.26: the check reads the database and can throw,
    // and the alert is already stored by then. The send used to be the last
    // step and never threw, so a failed check must not turn a stored alert
    // into a 500 the visitor would retry.
    it('stores the alert and answers 200, sending nothing, when the suppression check fails', async () => {
        h.isEmailSuppressed.mockRejectedValue(new Error('db down'));
        const res = await POST(signup());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, isNew: true, checkInbox: true });
        expect(h.sendWelcomeEmail).not.toHaveBeenCalled();
    });

    // Security review of 2.26: the lift cleared the profile flag of a deleted
    // account too (the deletion sets it), so an anonymous signup reopened
    // mail to it. The subscription routes already leave deleted profiles alone.
    it('the owner\'s unsubscribe lift leaves a deleted account suppressed', async () => {
        access.provesControlOf.mockResolvedValue(true);
        h.emailLead.upsert.mockResolvedValue({ isSuppressed: true, suppressionReason: 'unsubscribe' });
        await POST(signup());
        expect(h.userProfile.updateMany).toHaveBeenCalledWith({
            where: { email: { in: [EMAIL], mode: 'insensitive' }, deletedAt: null },
            data: { emailSuppressed: false, emailSuppressedAt: null },
        });
    });
});
