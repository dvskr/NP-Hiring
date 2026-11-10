/**
 * Redis key namespace ownership lock (2026-11-10).
 *
 * This board was forked from the PMHNP template and inherited its Redis key
 * names verbatim: `@upstash/ratelimit:...`, `ai-gateway:...`, `ai:cache:...`
 * and `presence:<source>:run:<bucket>`. The donor board writes those same
 * names with no prefix. Pointed at one Upstash database, the two boards
 * share IP rate-limit windows, can serve each other's cached AI answers and,
 * worst, overwrite each other's Greenhouse and Workday chunk payloads: both
 * boards run those crons at the same minutes, so the source-presence check
 * that strikes a job as gone from its source runs on a mix of two boards' id
 * lists.
 *
 * It is the same class of bug as the inherited Inngest app id
 * (tests/regressions/inngest-app-id.test.ts). The lock has three parts:
 *
 *   1. The namespace is this board's own and is never empty. The donor board
 *      runs unprefixed, so "no prefix" IS the foreign identity here.
 *   2. Every key that reaches Redis starts with it. Asserted on the key each
 *      module actually sends to a recording client, not on a helper's return
 *      value, so a call site that forgets the helper fails here.
 *   3. Any production module that imports @upstash takes its keys from
 *      lib/redis-key.ts, which covers the caller somebody adds next.
 *
 * Changing REDIS_NAMESPACE is a MIGRATION, not a rename: live rate-limit
 * windows, cached AI answers and an in-flight presence run stay behind under
 * the old prefix until they expire. Update this test in the same commit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const NAMESPACE = 'nphiring';

/** Every key any fake client was asked to touch, in call order. */
let seenKeys: string[] = [];

class RecordingRedis {
    async get(key: string) { seenKeys.push(key); return null; }
    async set(key: string) { seenKeys.push(key); return 'OK'; }
    async exists(key: string) { seenKeys.push(key); return 0; }
    async del(...keys: string[]) { seenKeys.push(...keys); return keys.length; }
}

/** Stands in for @upstash/ratelimit, which stores under `<prefix>:<key>`. */
class RecordingRatelimit {
    static slidingWindow() { return {}; }
    private readonly prefix: string;
    constructor(config: { prefix: string }) { this.prefix = config.prefix; }
    async limit(key: string) {
        seenKeys.push(`${this.prefix}:${key}`);
        return { success: true, reset: Date.now() + 60_000, remaining: 1 };
    }
}

const NOW = new Date('2026-06-15T18:00:00Z');
const IP = '203.0.113.9';
const USER = 'user-fixture-1';
const CACHE_PARTS = ['v1', 'job_fixture', 'cand_fixture'] as const;

async function loadModules() {
    vi.resetModules();
    vi.doMock('@upstash/redis', () => ({ Redis: RecordingRedis }));
    vi.doMock('@upstash/ratelimit', () => ({ Ratelimit: RecordingRatelimit }));

    const [redisKeyModule, rateLimit, aiRateLimiter, aiCache, presence] = await Promise.all([
        import('@/lib/redis-key'),
        import('@/lib/rate-limit'),
        import('@/lib/ai/rate-limiter'),
        import('@/lib/ai/cache'),
        import('@/lib/health/chunked-presence'),
    ]);
    return { redisKeyModule, rateLimit, aiRateLimiter, aiCache, presence };
}

/** Drive every Redis caller once, through its public entry point. */
async function exerciseEveryCaller(mods: Awaited<ReturnType<typeof loadModules>>) {
    const request = new Request('https://board.example/api/contact', {
        headers: { 'x-forwarded-for': IP },
    });
    await mods.rateLimit.rateLimit(request, 'contact', { limit: 5, windowSeconds: 60 });
    // A caller-built key: routes that limit by user id, not by IP, call this.
    await mods.rateLimit.checkRateLimit(`ratelimit:restore-account:${USER}`, { limit: 5, windowSeconds: 60 });

    await mods.aiRateLimiter.checkAiRateLimit(
        'candidate_scoring',
        { type: 'candidate', id: USER },
        { limit: 5, windowSeconds: 60 },
    );

    await mods.aiCache.writeCache(
        'candidate_scoring',
        CACHE_PARTS,
        { content: '{}', provider: 'openai', model: 'fixture-model' },
        60,
    );
    await mods.aiCache.readCache('candidate_scoring', CACHE_PARTS);

    // The recording client reports no other chunk as present, so this records
    // one chunk and stops before the aggregate, the only part that needs a
    // database.
    const result = await mods.presence.recordChunkAndMaybeAggregate({
        prisma: {} as never,
        source: 'greenhouse',
        chunkIndex: 0,
        fetchedExternalIds: ['ext-1'],
        fetchedCount: 1,
        nowMs: NOW.getTime(),
    });
    expect(result.outcome).toBe('chunk_recorded_waiting_for_more');
}

/** The keys as they were before the namespace existed, built independently. */
function inheritedKeys() {
    const cacheHash = createHash('sha256')
        .update(CACHE_PARTS.map((p) => JSON.stringify(p ?? null)).join('|'))
        .digest('hex');
    const runBucket = Math.floor(NOW.getTime() / (2 * 60 * 60 * 1000));
    return {
        rateLimit: `@upstash/ratelimit:ratelimit:contact:${IP}`,
        callerBuilt: `@upstash/ratelimit:ratelimit:restore-account:${USER}`,
        aiRateLimit: `ai-gateway:ai:rl:candidate_scoring:candidate:${USER}`,
        aiCache: `ai:cache:v1:candidate_scoring:${cacheHash}`,
        presenceChunk: `presence:greenhouse:run:${runBucket}:chunk:0`,
    };
}

beforeEach(() => {
    seenKeys = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.fixture.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fixture-token');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.doUnmock('@upstash/redis');
    vi.doUnmock('@upstash/ratelimit');
    vi.resetModules();
});

describe('Redis key namespace ownership', () => {
    it('is this board’s own namespace', async () => {
        const { redisKeyModule } = await loadModules();
        expect(redisKeyModule.REDIS_NAMESPACE).toBe(NAMESPACE);
    });

    it('is never empty: the donor board runs unprefixed, so no prefix is the foreign identity', async () => {
        const { redisKeyModule } = await loadModules();
        expect(redisKeyModule.REDIS_NAMESPACE).toMatch(/^[a-z0-9]{2,24}$/);
        expect(redisKeyModule.redisKey('some:key')).toBe(`${NAMESPACE}:some:key`);
    });
});

describe('every key that reaches Redis carries the namespace', () => {
    it('prefixes every key, from every caller', async () => {
        const mods = await loadModules();
        await exerciseEveryCaller(mods);

        // Each caller must have been heard from, or the sweep below would
        // pass on an empty list.
        for (const fragment of ['ratelimit:contact', 'ratelimit:restore-account', 'ai:rl:', 'ai:cache:', 'presence:greenhouse']) {
            expect(seenKeys.some((k) => k.includes(fragment)), `no key seen for ${fragment}`).toBe(true);
        }
        expect(seenKeys.filter((k) => !k.startsWith(`${NAMESPACE}:`))).toEqual([]);
    });

    it('is exactly the inherited key with the prefix in front', async () => {
        const mods = await loadModules();
        await exerciseEveryCaller(mods);

        for (const key of Object.values(inheritedKeys())) {
            expect(seenKeys).toContain(`${NAMESPACE}:${key}`);
        }
    });

    it('never sends a key the donor board would also write', async () => {
        const mods = await loadModules();
        await exerciseEveryCaller(mods);

        for (const key of Object.values(inheritedKeys())) {
            expect(seenKeys, `sent the donor board's own key ${key}`).not.toContain(key);
        }
    });

    it('prefixes what each exported key builder returns', async () => {
        const mods = await loadModules();
        const built = [
            mods.aiCache.__testing.buildCacheKey('candidate_scoring', CACHE_PARTS),
            mods.presence.buildRunKey('greenhouse', NOW.getTime()),
        ];
        for (const key of built) {
            expect(key.startsWith(`${NAMESPACE}:`), key).toBe(true);
        }
    });
});

describe('no Redis caller can skip the namespace', () => {
    // The recording test above only covers the callers it knows about. This
    // covers the one somebody adds next: any production module that talks to
    // Upstash has to take its keys from lib/redis-key.ts.
    const SOURCE_FILE = /\.(ts|tsx)$/;
    const SKIP_DIRS = new Set(['node_modules', '.next']);

    function sourceFilesUnder(dir: string): string[] {
        const absolute = path.join(ROOT, dir);
        if (!fs.existsSync(absolute)) return [];
        const found: string[] = [];
        for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
            const relative = `${dir}/${entry.name}`;
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) found.push(...sourceFilesUnder(relative));
            } else if (SOURCE_FILE.test(entry.name)) {
                found.push(relative);
            }
        }
        return found;
    }

    /** The file's code with comments blanked, so prose cannot satisfy a check. */
    function readCode(file: string): string {
        return fs
            .readFileSync(path.join(ROOT, file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
    }

    // Every place production code can live: the three source roots, plus the
    // root-level files Next.js and Sentry load at runtime.
    const ROOT_RUNTIME_FILES = [
        'middleware.ts',
        'instrumentation.ts',
        'instrumentation-client.ts',
        'sentry.server.config.ts',
        'sentry.edge.config.ts',
    ].filter((file) => fs.existsSync(path.join(ROOT, file)));
    const candidates = [...['app', 'components', 'lib'].flatMap(sourceFilesUnder), ...ROOT_RUNTIME_FILES];
    const upstashCallers = candidates.filter((file) =>
        /from\s+['"]@upstash\/(redis|ratelimit)['"]/.test(readCode(file)),
    );

    it('finds the known callers', () => {
        expect(upstashCallers).toEqual(
            expect.arrayContaining([
                'lib/rate-limit.ts',
                'lib/ai/rate-limiter.ts',
                'lib/ai/cache.ts',
                'lib/health/chunked-presence.ts',
            ]),
        );
    });

    it.each(upstashCallers)('%s builds its keys through redisKey()', (file) => {
        const code = readCode(file);
        expect(code).toMatch(/import\s*\{[^}]*\bredisKey\b[^}]*\}\s*from\s+['"][^'"]*redis-key['"]/);
        expect(code).toMatch(/\bredisKey\(/);
    });
});
