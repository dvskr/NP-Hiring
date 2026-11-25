/**
 * Where an account stands in its deletion, for the admin page guard
 * (requireAdmin in lib/auth/protect.ts) and the login form that explains
 * where it sent the person.
 *
 * Deleting an account (Settings, or a deletion request on /data-request)
 * soft-deletes it: deletedAt is set, purgeAt is when the purge cron
 * (app/api/cron/purge-soft-deleted) erases it, and the session is signed out.
 * Inside that window, signing in again with the account's email and password
 * restores it (components/auth/LoginContent.tsx posts
 * /api/auth/restore-account). There is no separate restore page. A Google
 * sign-in does not restore (the OAuth callback never calls that route), so an
 * account that only signs in with Google, or a person who no longer has the
 * password, is pointed to support, which restores it by hand.
 *
 * No database or server imports here, so the client login form can share it.
 */
import { brand } from '@/config/brand';

/**
 * 'active': not deleted. 'deletion_scheduled': deleted, inside its window,
 * restorable. 'purge_pending': the purge may erase it now, so it is neither
 * usable nor restorable.
 */
export type AccountDeletionState = 'active' | 'deletion_scheduled' | 'purge_pending';

/** The two columns that decide it, as a profile row carries them. */
export interface AccountDeletionFields {
    deletedAt?: Date | null;
    purgeAt?: Date | null;
}

export function accountDeletionState(
    account: AccountDeletionFields | null | undefined,
    now: Date = new Date(),
): AccountDeletionState {
    if (!account?.deletedAt) return 'active';
    const purgeAt = account.purgeAt ?? null;
    // The purge cron's own rule (purgeAt <= now), so an account it may take
    // this minute is never sent to sign in and restore.
    return purgeAt !== null && purgeAt.getTime() <= now.getTime() ? 'purge_pending' : 'deletion_scheduled';
}

/** The ?error= codes a guard sends to /login and the form explains. */
export const LOGIN_ERROR_CODES = {
    deletionScheduled: 'deletion_scheduled',
    accountUnavailable: 'account_unavailable',
} as const;

/**
 * Where a guarded page sends an account it will not serve because of its
 * deletion.
 *
 * Inside the window: the login form, keeping the page it was after, because
 * signing in restores the account and returns there. Past it: the login form
 * with the account-unavailable message and nowhere to return to.
 */
export function deletedAccountLoginPath(
    state: Exclude<AccountDeletionState, 'active'>,
    returnTo?: string,
): string {
    if (state === 'purge_pending') return `/login?error=${LOGIN_ERROR_CODES.accountUnavailable}`;
    const scheduled = `/login?error=${LOGIN_ERROR_CODES.deletionScheduled}`;
    return returnTo ? `${scheduled}&next=${encodeURIComponent(returnTo)}` : scheduled;
}

/**
 * What the login form tells an account in its deletion window: true whether
 * it signs in with a password or only with Google. Signing in with the
 * password restores it here; anyone else writes to support.
 */
export const DELETION_SCHEDULED_MESSAGE =
    `This account is scheduled for deletion. To restore it, sign in below with its email and password. If you sign in with Google, or no longer have the password, email ${brand.email.support} and we will restore it.`;

/** The sentence the login form shows for an ?error= a guard sent, or null for any other value. */
export function loginErrorMessage(code: string | null | undefined): string | null {
    if (code === LOGIN_ERROR_CODES.deletionScheduled) return DELETION_SCHEDULED_MESSAGE;
    if (code === LOGIN_ERROR_CODES.accountUnavailable) {
        return 'This account is no longer available. Its restore window has closed. Create a new account to continue.';
    }
    return null;
}
