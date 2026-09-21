/**
 * Tests for lib/auth/email-change-policy.ts (audit #27).
 *
 * Every per-domain pricing rule (launch-promo cap, intro price = the first
 * PAID post per company domain, plan slots) is anchored on
 * EmployerJob.quotaDomain. If a user could change their account email's
 * domain freely after posting, they could start over at the new domain with
 * a fresh promo cap and a fresh intro price. This helper enforces that domain
 * changes are only allowed when no entitlement-carrying row (legacy 'free',
 * 'promo', 'paid', 'plan') exists at the old domain or under this user.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { evaluateEmailChange, DOMAIN_LOCKING_STATUSES } from '@/lib/auth/email-change-policy';

const USER_ID = 'user-123';

describe('evaluateEmailChange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allows local-part change at the same domain (bob@acme.com → bob.smith@acme.com)', async () => {
        // No DB calls expected — same-domain short-circuits before any count
        const result = await evaluateEmailChange(USER_ID, 'bob@acme.com', 'bob.smith@acme.com');
        expect(result.allowed).toBe(true);
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it('allows identical email (no-op change)', async () => {
        const result = await evaluateEmailChange(USER_ID, 'bob@acme.com', 'bob@acme.com');
        expect(result.allowed).toBe(true);
    });

    it('is case-insensitive on domain comparison', async () => {
        const result = await evaluateEmailChange(USER_ID, 'bob@Acme.com', 'bob@acme.COM');
        expect(result.allowed).toBe(true);
    });

    it('rejects an invalid new email (no @)', async () => {
        const result = await evaluateEmailChange(USER_ID, 'bob@acme.com', 'not-an-email');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/invalid/i);
    });

    it('allows domain change when no posting row locks the old domain', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);

        const result = await evaluateEmailChange(USER_ID, 'bob@acme.com', 'bob@example.com');
        expect(result.allowed).toBe(true);
    });

    it('blocks domain change when at least one row locks the old domain', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(1 as never);

        const result = await evaluateEmailChange(USER_ID, 'bob@acme.com', 'bob@example.com');
        expect(result.allowed).toBe(false);
        // Wording covers every locking status (promo / paid / plan too), so
        // it names the domain and the per-domain rule rather than "free posts".
        expect(result.reason).toMatch(/once jobs have been posted from acme\.com/i);
        expect(result.reason).toMatch(/per company domain/i);
        expect(result.lockedDomain).toBe('acme.com');
    });

    it('blocks domain change with any locking rows (defensive: count >= 1)', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(2 as never);

        const result = await evaluateEmailChange(USER_ID, 'bob@hcahealthcare.com', 'bob@elsewhere.com');
        expect(result.allowed).toBe(false);
    });

    it('locks on every entitlement-carrying status and never on abandoned or refunded rows', () => {
        expect([...DOMAIN_LOCKING_STATUSES].sort()).toEqual(['free', 'paid', 'plan', 'promo']);
        for (const status of ['pending', 'expired', 'refunded']) {
            expect(DOMAIN_LOCKING_STATUSES).not.toContain(status);
        }
    });

    it('counts rows at the old domain OR owned by this user, filtered to the locking statuses', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);

        await evaluateEmailChange(USER_ID, 'bob@acme.com', 'bob@example.com');

        expect(prisma.employerJob.count).toHaveBeenCalledOnce();
        const callArg = vi.mocked(prisma.employerJob.count).mock.calls[0][0]!;
        expect(callArg.where).toEqual({
            paymentStatus: { in: ['free', 'promo', 'paid', 'plan'] },
            OR: [{ userId: USER_ID }, { quotaDomain: 'acme.com' }],
        });
    });

    it('handles empty old email (e.g., user with no prior email) by allowing if newEmail valid', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);

        // Empty old email gives null oldDomain. New email is at example.com.
        // Different "domains" (null vs example.com) → check freebies → 0 → allowed.
        const result = await evaluateEmailChange(USER_ID, '', 'bob@example.com');
        expect(result.allowed).toBe(true);
        // No old domain → only the user's own rows can lock the change.
        const callArg = vi.mocked(prisma.employerJob.count).mock.calls[0][0]!;
        expect(callArg.where).toMatchObject({ OR: [{ userId: USER_ID }] });
    });
});
