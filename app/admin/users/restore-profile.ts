/**
 * Restoring a deactivated profile from /admin/users.
 *
 * Deactivating hides a profile from employers (profileVisible false, and
 * openToOffers off; DELETE /api/admin/users/:id). Restoring is the PATCH that
 * makes it visible again; the API already accepts profileVisible: true.
 *
 * profileVisible is also the member's own privacy switch in their settings,
 * so a hidden profile is not always one an admin deactivated, and restoring
 * one the member hid themselves overrides their choice. The admin is asked
 * every time, and told so. openToOffers stays off: that is the member's own
 * preference, not the console's to switch back on.
 */
import { adminFetch } from '@/lib/admin/admin-fetch';

export const RESTORE_PROFILE_CONFIRMATION =
    'Make this profile visible to employers again? If the member hid it themselves in their own settings, restoring it overrides their privacy choice.';

export type RestoreProfileOutcome =
    | { status: 'cancelled' }
    | { status: 'restored' }
    | { status: 'failed'; error: string };

/**
 * Ask, then restore. Nothing is sent unless the admin confirms. Never throws:
 * a refused or failed request comes back as 'failed' with its reason.
 */
export async function restoreProfileVisibility(
    userId: string,
    confirmRestore: (message: string) => boolean,
): Promise<RestoreProfileOutcome> {
    if (!confirmRestore(RESTORE_PROFILE_CONFIRMATION)) return { status: 'cancelled' };

    const result = await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileVisible: true }),
    });
    return result.ok ? { status: 'restored' } : { status: 'failed', error: result.error };
}
