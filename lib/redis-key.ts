/**
 * The one place a Redis key gets this board's namespace.
 *
 * This board was forked from a donor template and inherited its Redis key
 * names verbatim. The donor board writes the same names with no prefix, so
 * two boards pointed at one Upstash database would share IP rate-limit
 * windows, could serve each other's cached AI answers and would overwrite
 * each other's source-presence chunk payloads: the Greenhouse and Workday
 * chunk crons run at the same minutes on both boards, so the check that
 * strikes a job as gone from its source would run on a mix of two boards'
 * id lists. The prefix was added (2026-11-10) before the two boards ever
 * shared a database, so that never happened in production.
 *
 * Every module that talks to Upstash builds its key (or its rate-limiter
 * prefix) through `redisKey`, so this board's keys can never be another
 * board's keys, whichever database it is pointed at.
 *
 * Callers: lib/rate-limit.ts, lib/ai/rate-limiter.ts, lib/ai/cache.ts,
 * lib/health/chunked-presence.ts. A new Redis caller must go through here
 * too; tests/regressions/redis-key-namespace.test.ts drives every one of
 * them against a recording client and fails on a key without the prefix.
 */

/**
 * This board's Redis key prefix: a DURABLE IDENTITY, not a display string,
 * like INNGEST_APP_ID in lib/inngest/client.ts.
 *
 * It must be unique per deployed board and must never be empty: the donor
 * board runs unprefixed, so an empty namespace is the donor's identity.
 *
 * Do NOT derive this from a brand/display token. Changing it is a migration,
 * not a rename: live rate-limit windows, cached AI answers and an in-flight
 * presence run stay behind under the old prefix until they expire.
 */
export const REDIS_NAMESPACE = 'nphiring';

export function redisKey(key: string): string {
    return `${REDIS_NAMESPACE}:${key}`;
}
