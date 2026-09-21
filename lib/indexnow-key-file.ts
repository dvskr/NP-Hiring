/**
 * IndexNow key-file verification (P10 platform-routing-db #2).
 *
 * IndexNow engines fetch https://<host>/<key>.txt and expect the key as the
 * body. This used to be served by app/[indexnow]/route.ts, a Route Handler
 * whose single dynamic segment matched EVERY top-level path. For any path
 * that was not the key it called notFound(), which inside a Route Handler
 * yields a 0-byte 404 with no content-type, so every mistyped top-level URL
 * (/nope, /this-page-does-not-exist) showed a blank tab instead of the
 * branded app/not-found.tsx page.
 *
 * The key file is now answered by middleware.ts for the exact key path only;
 * every other path falls through to normal routing and, when unmatched, to
 * the branded 404. Edge-safe: no Node APIs, no logger import.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** Same env precedence and minimum length as lib/indexnow.ts getKey(). */
export function resolveIndexNowKey(env: Env): string | null {
    const key = (env.INDEXNOW_KEY || env.INDEXNOW_API_KEY || '').trim();
    if (key.length < 8) return null;
    // Protocol keys are 8 to 128 chars of [a-zA-Z0-9-]. Anything else could
    // never be a valid key file name, so refuse to serve it.
    if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) return null;
    return key;
}

/**
 * Returns the key when `pathname` is exactly `/<key>.txt` or `/<key>`
 * (the two spellings the retired route answered), else null.
 */
export function matchIndexNowKeyPath(pathname: string, env: Env): string | null {
    const key = resolveIndexNowKey(env);
    if (!key) return null;
    return pathname === `/${key}.txt` || pathname === `/${key}` ? key : null;
}
