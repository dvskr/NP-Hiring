/**
 * Shared, deduplicated loader for the signed-in user's header profile.
 *
 * The header renders HeaderAuth in several slots (desktop, compact, mobile
 * drawer). Each instance used to fetch /api/auth/profile on mount AND again
 * in onAuthStateChange (INITIAL_SESSION / SIGNED_IN fire right away), and
 * UserMenu fetched it once more: 8 to 9 serial round trips per page load.
 * Every caller now shares one in-flight request and one short-lived cached
 * result per Supabase user id.
 */

export interface HeaderProfilePayload {
  role: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  [key: string]: unknown;
}

type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** A cached profile is reused for this long before a remount refetches. */
export const HEADER_PROFILE_TTL_MS = 60_000;

interface CacheEntry {
  userId: string;
  promise: Promise<HeaderProfilePayload | null>;
  settledAt: number | null;
}

let entry: CacheEntry | null = null;

function isFresh(current: CacheEntry, userId: string, now: number): boolean {
  if (current.userId !== userId) return false;
  if (current.settledAt === null) return true; // still in flight
  return now - current.settledAt < HEADER_PROFILE_TTL_MS;
}

/**
 * Profile for `userId`. Concurrent and repeated calls within the TTL share a
 * single request. `force` bypasses the cache (for example after USER_UPDATED).
 * Resolves null when the request fails; a failed result is not cached.
 */
export function loadHeaderProfile(
  userId: string,
  options: { force?: boolean; fetcher?: Fetcher; now?: () => number } = {},
): Promise<HeaderProfilePayload | null> {
  const now = options.now ?? Date.now;
  const fetcher: Fetcher = options.fetcher ?? ((url) => fetch(url));

  if (!options.force && entry && isFresh(entry, userId, now())) {
    return entry.promise;
  }

  const next: CacheEntry = { userId, promise: Promise.resolve(null), settledAt: null };
  next.promise = (async () => {
    try {
      const res = await fetcher('/api/auth/profile');
      if (!res.ok) return null;
      const data = (await res.json()) as HeaderProfilePayload;
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  })().then((result) => {
    if (entry === next) {
      if (result === null) entry = null; // do not cache failures
      else next.settledAt = now();
    }
    return result;
  });
  entry = next;
  return next.promise;
}

/** Drop the cached profile (sign out, account switch). */
export function clearHeaderProfile(): void {
  entry = null;
}
