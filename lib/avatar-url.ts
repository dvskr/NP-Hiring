import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { isOwnStoragePath } from '@/lib/supabase-storage';

/**
 * Short-lived signed links for profile photos: the one way an avatar leaves
 * the server (owner, 2026-11-25).
 *
 * The avatars bucket holds personal photos only. Its one writer is
 * uploadAvatar (lib/supabase-storage.ts), behind the profile photo upload of
 * /api/upload, with keys `<prefix>/<uploader's supabase id>/<file>`; company
 * logos, site images and email images each have their own public bucket. A
 * photo was served at its permanent public URL, so anyone who saw it once
 * (an employer before the unlock rule of 2026-11-25, a forwarded link) kept
 * it for good. Every avatar a response carries is now a signed URL that
 * expires, minted only where the route has already decided to show the
 * photo: showsPhoto (app/api/conversations/_lib/surname-disclosure.ts) for an
 * employer, and the person's own views and an admin's.
 *
 * The avatarUrl column keeps what it holds: the public URL that /api/upload
 * and PATCH /api/auth/profile write names the object, and a bare key works
 * as well. Signing works while the bucket is public and after it is made
 * private (docs/runbooks/private-avatars.md).
 *
 *   - A public or signed URL of an object in the avatars bucket, on any
 *     host, and a bare key are signed, inside the owner's own upload folder
 *     only (isOwnStoragePath, the rule every reader of the column applies):
 *     a value naming another account's photo shows none.
 *   - Any other URL, a Google sign-in picture, passes through untouched.
 *   - Anything else, and a signing that fails, is null: the UI draws
 *     initials.
 * tests/lib/avatar-url.test.ts
 */

export const AVATAR_BUCKET = 'avatars';

/** An hour: a page left open keeps its photos, and a copied link soon stops working. */
export const AVATAR_URL_TTL_SECONDS = 60 * 60;

/** The key of an avatars object in its public or signed URL. */
const AVATAR_OBJECT_URL = /^https?:\/\/[^/?#]+\/storage\/v1\/object\/(?:public|sign)\/avatars\/([^?#]+)/;
const ANY_HTTP_URL = /^https?:\/\//i;

export interface StoredAvatar {
    /** The avatarUrl column as stored. */
    readonly stored: string | null | undefined;
    /** The profile's Supabase id: only a key in this account's own upload folder is signed. */
    readonly ownerId: string;
}

type Plan =
    | { readonly kind: 'none' }
    | { readonly kind: 'as-is'; readonly url: string }
    | { readonly kind: 'sign'; readonly key: string };

function planFor({ stored, ownerId }: StoredAvatar): Plan {
    if (typeof stored !== 'string' || stored.trim() === '') return { kind: 'none' };
    const value = stored.trim();
    const objectUrl = AVATAR_OBJECT_URL.exec(value);
    if (!objectUrl && ANY_HTTP_URL.test(value)) return { kind: 'as-is', url: value };
    const key = objectUrl ? objectUrl[1] : value.replace(/^avatars\//, '');
    return isOwnStoragePath(key, ownerId) ? { kind: 'sign', key } : { kind: 'none' };
}

/** Signed URLs for `keys`, in one request; a key the store did not sign is left out. */
async function signKeys(keys: readonly string[]): Promise<Map<string, string>> {
    const signed = new Map<string, string>();
    try {
        const { data, error } = await createAdminClient()
            .storage.from(AVATAR_BUCKET)
            .createSignedUrls([...keys], AVATAR_URL_TTL_SECONDS);
        if (error || !data) {
            logger.error('signAvatarUrls: the store refused to sign', error, { count: keys.length });
            return signed;
        }
        data.forEach((entry, i) => {
            const key = entry.path ?? keys[i];
            if (!entry.error && entry.signedUrl && keys.includes(key)) signed.set(key, entry.signedUrl);
        });
    } catch (err) {
        logger.error('signAvatarUrls: signing failed', err, { count: keys.length });
    }
    return signed;
}

/**
 * The avatar each response should carry, in order: a signed URL, a foreign
 * URL as stored, or null. One signing request for the whole list, none when
 * nothing needs signing.
 */
export async function signAvatarUrls(avatars: readonly StoredAvatar[]): Promise<Array<string | null>> {
    const plans = avatars.map(planFor);
    const keys = [...new Set(plans.flatMap((plan) => (plan.kind === 'sign' ? [plan.key] : [])))];
    const signed = keys.length > 0 ? await signKeys(keys) : new Map<string, string>();
    return plans.map((plan) => {
        if (plan.kind === 'as-is') return plan.url;
        if (plan.kind === 'sign') return signed.get(plan.key) ?? null;
        return null;
    });
}

/** One avatar: signAvatarUrls for a list of one. */
export async function signAvatarUrl(stored: string | null | undefined, ownerId: string): Promise<string | null> {
    const [url] = await signAvatarUrls([{ stored, ownerId }]);
    return url;
}

/**
 * A copy of a profile row whose avatarUrl is signed for its owner, for the
 * routes that answer with the whole row (the person's own profile, an
 * admin's view of it). A row without the field comes back as it is.
 */
export async function withSignedAvatar<T extends { readonly avatarUrl?: string | null; readonly supabaseId?: string }>(
    profile: T,
): Promise<T> {
    if (typeof profile !== 'object' || profile === null || !('avatarUrl' in profile)) return profile;
    return { ...profile, avatarUrl: await signAvatarUrl(profile.avatarUrl, profile.supabaseId ?? '') };
}
