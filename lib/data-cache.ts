/**
 * Reads through Next.js's shared data cache (`unstable_cache`).
 *
 * On Vercel that cache is one store for every function instance and region,
 * so a read cached here runs against the database once per window, not once
 * per render. It also keeps the last value: when a refresh fails, a page that
 * is being regenerated gets the previous value back instead of an error, and
 * a per-request page gets it straight away while the refresh runs behind it.
 *
 * Why it exists (2026-11-23): the database is a small instance and the
 * listing reads carry the board's whole exclusion predicate, so they take
 * 0.8 to 2.4 seconds each. Repeated on every render through a two-connection
 * pool, a crawler burst or a few quick filter clicks filled the pool and
 * pages answered "timeout exceeded when trying to connect".
 *
 * A page's cache window is the shortest one in its tree, so a read used by a
 * cached (ISR) page must be cached at least as long as that page
 * (tests/regressions/job-page-isr-window.test.ts).
 */
import { unstable_cache } from 'next/cache';

/** What `unstable_cache` throws when called outside a Next.js request (tests, scripts). */
const NO_DATA_CACHE_MESSAGE = 'incrementalCache missing in unstable_cache';

/** True when the error says there is no data cache to read through. */
export function isDataCacheUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.includes(NO_DATA_CACHE_MESSAGE);
}

let hasWarnedNoDataCache = false;

/**
 * Says once per instance that reads are going to the database uncached. In
 * production that means the protection this file exists for is off, which
 * nothing else would show.
 */
function warnNoDataCache(keyParts: readonly string[]): void {
  if (hasWarnedNoDataCache || process.env.NODE_ENV !== 'production') return;
  hasWarnedNoDataCache = true;
  console.warn(`[data-cache] no data cache here: "${keyParts.join(',')}" and other shared reads go to the database each time`);
}

/** Reads under way in this instance, by cache key parts and arguments. */
const readsInFlight = new Map<string, Promise<unknown>>();

/**
 * `read`, one at a time per argument list: a caller that arrives while the
 * same read is running joins it instead of starting another. Many requests
 * share one instance, and the cache refreshes an old entry once per request
 * that finds it old, so without this a burst ran the same slow query several
 * times at the moment an entry expired.
 */
function singleFlight<A extends unknown[], R>(
  name: string,
  read: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args: A): Promise<R> => {
    const key = `${name}|${JSON.stringify(args)}`;
    const running = readsInFlight.get(key) as Promise<R> | undefined;
    if (running) return running;
    const started: Promise<R> = read(...args).finally(() => {
      if (readsInFlight.get(key) === started) readsInFlight.delete(key);
    });
    readsInFlight.set(key, started);
    return started;
  };
}

/** A read through the shared data cache, with a way past the cached copy. */
export interface SharedCachedRead<A extends unknown[], R> {
  /** The value through the data cache. */
  (...args: A): Promise<R>;
  /**
   * The value from its source, never the cached copy. It joins a read of the
   * same arguments that is already running, which includes the refresh the
   * data cache starts behind a response it has just answered from an old
   * entry: a caller that finds that entry too old waits for the same query
   * instead of running it a second time.
   */
  fresh: (...args: A) => Promise<R>;
}

/**
 * `read`, cached for `revalidateSeconds` under `keyParts` plus its arguments
 * (which must be JSON-serializable, as must the value it resolves to: a Date
 * comes back as a string). Outside a Next.js request it reads directly.
 *
 * The key is `keyParts` and the arguments, nothing else, and the data cache
 * outlives a deploy. So `keyParts` is a name and then a version of the
 * value's shape (`'v1'`): raise the version whenever the read returns a
 * different shape, or the new release is handed values the old one cached
 * (tests/regressions/shared-read-cache-windows.test.ts checks every call).
 */
export function sharedCachedRead<A extends unknown[], R>(
  read: (...args: A) => Promise<R>,
  keyParts: readonly string[],
  revalidateSeconds: number,
): SharedCachedRead<A, R> {
  const fresh = singleFlight(keyParts.join(','), read);
  const cached = unstable_cache(fresh, [...keyParts], { revalidate: revalidateSeconds });
  const throughCache = async (...args: A): Promise<R> => {
    try {
      return await cached(...args);
    } catch (error) {
      if (!isDataCacheUnavailable(error)) throw error;
      warnNoDataCache(keyParts);
      return fresh(...args);
    }
  };
  return Object.assign(throughCache, { fresh });
}
