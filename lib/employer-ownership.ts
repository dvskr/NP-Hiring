import type { Prisma } from '@prisma/client';

/**
 * Employer-job ownership, built in one place.
 *
 * An EmployerJob row belongs to a signed-in user when
 *   - its userId is the user's Supabase id (a claimed row), or
 *   - it is an unclaimed legacy row (userId null, posted before accounts were
 *     linked) filed under the user's sign-in email.
 *
 * P5.A (2026-06-01) limited the email fallback to unclaimed rows, so signing
 * up with an existing employer's contact email cannot reach rows another
 * account claimed. This module adds the other half: the fallback exists only
 * when the session has an email. Prisma reads an undefined value as "no
 * condition", so the inline `{ userId: null, contactEmail: user.email! }`
 * the employer routes used to build matched EVERY unclaimed row for a session
 * without one. That is unreachable today (every profile-creation path refuses
 * an email-less user, and the profile gate runs first), but it was one sign-in
 * method away from an authorization bypass. A blank email counts as none.
 *
 * The email is matched exactly as given, as the routes always matched it.
 *
 * SECURITY (register 2.26): the email counts only once Supabase has confirmed
 * it (`email_confirmed_at`). An unconfirmed address proves nothing about who
 * holds the inbox, and the fallback hands the session every unclaimed post
 * filed under it, with its applicants. The auth callback's legacy claim and
 * the profile relink apply the same rule. Every caller passes the user from
 * `supabase.auth.getUser()`, which carries the stamp.
 * tests/lib/employer-ownership.test.ts
 */

/** What the ownership clause reads from a Supabase session user. */
export interface EmployerJobOwner {
    /** The Supabase auth user id; EmployerJob.userId holds it once a row is claimed. */
    readonly id: string;
    /** The sign-in email. Supabase leaves it unset for some sign-in methods. */
    readonly email?: string | null;
    /** When Supabase confirmed that email; unset until it is confirmed. */
    readonly email_confirmed_at?: string | null;
}

/**
 * The branches of the ownership OR, used as
 * `where: { jobId, OR: employerJobOwnershipBranches(user) }`.
 *
 * It returns the array, not a spreadable `{ OR }` object, so the key stays
 * written at every call site: a second `OR` in the same object literal is a
 * compile error, where a later key would silently overwrite a spread.
 *
 * Throws on a missing user id rather than return `{ userId: undefined }`,
 * which would match every row.
 */
export function employerJobOwnershipBranches(user: EmployerJobOwner): Prisma.EmployerJobWhereInput[] {
    requireUserId(user);
    const claimed: Prisma.EmployerJobWhereInput = { userId: user.id };
    const email = legacyOwnerEmail(user);
    return email === null ? [claimed] : [claimed, { userId: null, contactEmail: email }];
}

/**
 * The same rule for a row a route has already loaded: claimed by the user,
 * or unclaimed and filed under the user's confirmed email. Register 2.26: the
 * applicants PATCH and the notification settings PATCH wrote the legacy rule
 * inline and skipped the confirmation.
 * tests/lib/employer-ownership.test.ts, tests/api/employer-legacy-owner-patch.test.ts
 */
export function isEmployerJobOwner(
    row: { readonly userId: string | null; readonly contactEmail: string | null },
    user: EmployerJobOwner,
): boolean {
    requireUserId(user);
    if (row.userId !== null) return row.userId === user.id;
    const email = legacyOwnerEmail(user);
    return email !== null && row.contactEmail === email;
}

function requireUserId(user: EmployerJobOwner): void {
    if (typeof user.id !== 'string' || user.id.trim() === '') {
        throw new TypeError('Employer job ownership needs the signed-in user id.');
    }
}

/** The email the legacy branch may match: confirmed and not blank, otherwise none. */
function legacyOwnerEmail(user: EmployerJobOwner): string | null {
    const isConfirmed = typeof user.email_confirmed_at === 'string' && user.email_confirmed_at !== '';
    return isConfirmed && typeof user.email === 'string' && user.email.trim() !== '' ? user.email : null;
}
