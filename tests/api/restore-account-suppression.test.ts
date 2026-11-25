/**
 * POST /api/auth/restore-account lifts only the email suppression the
 * deletion set.
 *
 * Deleting an account suppresses its email (emailSuppressed true, and
 * emailSuppressedAt overwritten). The restore used to clear both for every
 * account, which re-enabled mail to an address that had bounced, drawn a
 * complaint or unsubscribed before the deletion. The profile cannot tell the
 * two apart, so the address's own records decide: a suppressed mailing list
 * entry (bounce, complaint, unsubscribe, each with its reason), or an email
 * to it that bounced or drew a complaint.
 *
 * Pinned:
 *   - an address with no suppression of its own is mailable again after the
 *     restore, as before;
 *   - a suppressed entry, or a bounced or complained send, keeps the profile
 *     suppressed, while the rest of the restore still happens;
 *   - the address is matched as stored and lowercased;
 *   - the audit entry says which it was.
 *
 * All addresses are fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    logAudit: vi.fn(),
    prisma: {
        userProfile: { findUnique: vi.fn(), update: vi.fn() },
        emailLead: { findFirst: vi.fn() },
        emailSend: { findFirst: vi.fn() },
    },
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/audit-log', () => ({ logAudit: h.logAudit }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { POST } from '@/app/api/auth/restore-account/route';

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL = 'Seeker.Fic@Example.com';

function restore() {
    return POST(new NextRequest('https://example.com/api/auth/restore-account', { method: 'POST' }));
}

/** The data the restore wrote to the profile. */
const written = () => h.prisma.userProfile.update.mock.calls[0][0].data as Record<string, unknown>;

beforeEach(() => {
    vi.clearAllMocks();
    h.getUser.mockResolvedValue({ data: { user: { id: 'sb-seeker-fic' } }, error: null });
    h.prisma.userProfile.findUnique.mockResolvedValue({
        id: 'profile-fic',
        email: EMAIL,
        deletedAt: new Date(Date.now() - DAY_MS),
        purgeAt: new Date(Date.now() + 29 * DAY_MS),
    });
    h.prisma.userProfile.update.mockResolvedValue({});
    h.prisma.emailLead.findFirst.mockResolvedValue(null);
    h.prisma.emailSend.findFirst.mockResolvedValue(null);
    h.logAudit.mockResolvedValue(undefined);
});

describe('an address with no suppression of its own', () => {
    it('is mailable again after the restore', async () => {
        const res = await restore();

        expect(res.status).toBe(200);
        expect(written()).toEqual({
            deletedAt: null,
            purgeAt: null,
            profileVisible: true,
            openToOffers: true,
            emailSuppressed: false,
            emailSuppressedAt: null,
        });
        expect(h.logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'account.restore',
            metadata: { emailSuppressionKept: false },
        }));
    });

    it('is looked up as stored and lowercased, on the entry and on the sends', async () => {
        await restore();

        const addresses = [EMAIL, EMAIL.toLowerCase()];
        expect(h.prisma.emailLead.findFirst).toHaveBeenCalledWith({
            where: { email: { in: addresses }, isSuppressed: true },
            select: { id: true },
        });
        expect(h.prisma.emailSend.findFirst).toHaveBeenCalledWith({
            where: { to: { in: addresses }, status: { in: ['bounced', 'complained'] } },
            select: { id: true },
        });
    });
});

describe('an address with a suppression of its own stays suppressed', () => {
    it.each([
        ['its mailing list entry is suppressed (a bounce, a complaint or an unsubscribe)', 'lead'],
        ['an email to it bounced or drew a complaint', 'send'],
    ])('when %s', async (_label, source) => {
        if (source === 'lead') h.prisma.emailLead.findFirst.mockResolvedValue({ id: 'lead-fic' });
        else h.prisma.emailSend.findFirst.mockResolvedValue({ id: 'send-fic' });

        const res = await restore();

        expect(res.status).toBe(200);
        // The rest of the restore happens...
        expect(written()).toMatchObject({ deletedAt: null, purgeAt: null, profileVisible: true, openToOffers: true });
        // ...but the suppression is left exactly as it is.
        expect(written()).not.toHaveProperty('emailSuppressed');
        expect(written()).not.toHaveProperty('emailSuppressedAt');
        expect(h.logAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { emailSuppressionKept: true } }));
    });
});

describe('what the restore refuses, as before', () => {
    it('an account that is not deleted, and one past its window, write nothing', async () => {
        h.prisma.userProfile.findUnique.mockResolvedValueOnce({ id: 'profile-fic', email: EMAIL, deletedAt: null, purgeAt: null });
        expect((await restore()).status).toBe(400);

        h.prisma.userProfile.findUnique.mockResolvedValueOnce({
            id: 'profile-fic', email: EMAIL, deletedAt: new Date(Date.now() - 31 * DAY_MS), purgeAt: new Date(Date.now() - DAY_MS),
        });
        expect((await restore()).status).toBe(410);

        expect(h.prisma.userProfile.update).not.toHaveBeenCalled();
    });

    it('answers 500 and writes nothing when the suppression lookup fails', async () => {
        h.prisma.emailSend.findFirst.mockRejectedValueOnce(new Error('db down'));

        expect((await restore()).status).toBe(500);
        expect(h.prisma.userProfile.update).not.toHaveBeenCalled();
    });
});
