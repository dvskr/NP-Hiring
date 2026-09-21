/**
 * Email-change policy.
 *
 * Every per-domain pricing rule is anchored on `EmployerJob.quotaDomain` —
 * an immutable snapshot of the SIGNUP email's domain, written at posting
 * time on every path (promo, plan, checkout):
 *
 *   - the launch-promo cap (config.promoMaxActivePostsPerDomain) counts
 *     live 'promo' rows per domain;
 *   - the intro price (config.introPrice) is for the first PAID post per
 *     company domain — the allowance is "zero 'paid' rows at this domain".
 *
 * If we let a user freely change their account email's *domain*, they can
 * post from @acme.com, change their account to @example.com, and start over
 * at the new domain: a fresh promo cap and a fresh intro price. To prevent
 * that, this helper enforces:
 *
 *   - Local-part changes (bob@acme.com → bob.smith@acme.com) → allowed
 *   - Domain changes when NO posts exist at the old domain (and none owned
 *     by this user) → allowed
 *   - Domain changes when ANY EmployerJob row exists at the old domain (or
 *     is owned by this user) with a paymentStatus that carries an
 *     entitlement — legacy 'free', 'promo', 'paid', 'plan' → BLOCKED.
 *     Abandoned 'pending' / 'expired' checkouts and 'refunded' rows never
 *     lock a domain.
 *
 * **Where to call this:**
 * Anywhere we accept an email-change request — `/api/auth/change-email`,
 * Supabase email-change webhooks, admin override flows. Today there is no
 * user-facing email-change endpoint (audit #27), but this helper exists so
 * the rule is enforced whenever one is added.
 *
 * Returns { allowed: true } or { allowed: false, reason }.
 */

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';

interface EmailChangeDecision {
    allowed: boolean;
    reason?: string;
    /** the domain we'd block them from leaving, if any */
    lockedDomain?: string;
}

/**
 * paymentStatus values that tie a domain to a pricing entitlement. Legacy
 * 'free' rows are included because they still exist in the table; they are
 * never written again.
 */
export const DOMAIN_LOCKING_STATUSES: readonly string[] = ['free', 'promo', 'paid', 'plan'];

function emailDomain(email: string): string | null {
    const parts = email.toLowerCase().trim().split('@');
    if (parts.length !== 2 || !parts[1]) return null;
    return parts[1];
}

/**
 * Given a user's supabaseId, current email, and proposed new email, decide
 * whether the change can proceed under the per-domain pricing policy.
 *
 * @param userId   Supabase auth user id (matches UserProfile.supabaseId and EmployerJob.userId)
 * @param oldEmail Current email on the auth user
 * @param newEmail Proposed new email
 */
export async function evaluateEmailChange(
    userId: string,
    oldEmail: string,
    newEmail: string,
): Promise<EmailChangeDecision> {
    const oldDomain = emailDomain(oldEmail);
    const newDomain = emailDomain(newEmail);

    if (!newDomain) {
        return { allowed: false, reason: 'Invalid email address.' };
    }

    // Same domain (including identical email) → always fine.
    if (oldDomain === newDomain) {
        return { allowed: true };
    }

    // Domain change → only allowed if nothing would let the employer carry
    // an entitlement across to a new domain. One count covers both:
    //   1. Rows snapshotted at the old domain (quotaDomain match) — the
    //      per-domain anchor itself, regardless of who posted them; and
    //   2. Rows this user personally posted (userId match), in case
    //      quotaDomain is null on a legacy row or userId got nulled by a
    //      prior account deletion + re-creation flow.
    const lockingRows = await prisma.employerJob.count({
        where: {
            paymentStatus: { in: [...DOMAIN_LOCKING_STATUSES] },
            OR: [
                { userId },
                ...(oldDomain ? [{ quotaDomain: oldDomain }] : []),
            ],
        },
    });

    if (lockingRows > 0) {
        const domainLabel = oldDomain ?? 'your current domain';
        return {
            allowed: false,
            reason: `Email domain changes aren't allowed once jobs have been posted from ${domainLabel} — posting terms are per company domain. Contact ${brand.email.support} if your company domain has actually changed.`,
            lockedDomain: oldDomain ?? undefined,
        };
    }

    return { allowed: true };
}
