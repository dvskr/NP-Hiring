/**
 * lib/data-cache.ts: reads through Next's shared data cache, and reads
 * directly where there is none (tests, scripts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cache = vi.hoisted(() => ({
    wrap: null as null | ((fn: (...args: unknown[]) => Promise<unknown>) => (...args: unknown[]) => Promise<unknown>),
    calls: [] as Array<{ keyParts: string[]; options: { revalidate?: number } }>,
}));

vi.mock('next/cache', () => ({
    unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keyParts: string[], options: { revalidate?: number }) => {
        cache.calls.push({ keyParts, options });
        return (...args: unknown[]) => (cache.wrap ? cache.wrap(fn)(...args) : fn(...args));
    },
}));

import { isDataCacheUnavailable, sharedCachedRead } from '@/lib/data-cache';

const missingCache = () => new Error('Invariant: incrementalCache missing in unstable_cache async function read(){}');

beforeEach(() => {
    cache.wrap = null;
    cache.calls.length = 0;
});

describe('sharedCachedRead', () => {
    it('registers the read with its key parts and window', async () => {
        const read = vi.fn(async (state: string) => `${state}:1`);
        const cached = sharedCachedRead(read, ['top-states'], 3600);
        expect(await cached('Texas')).toBe('Texas:1');
        expect(cache.calls).toEqual([{ keyParts: ['top-states'], options: { revalidate: 3600 } }]);
    });

    it('returns what the data cache returns without reading again', async () => {
        cache.wrap = () => async () => 'from cache';
        const read = vi.fn(async () => 'from database');
        expect(await sharedCachedRead(read, ['k'], 60)()).toBe('from cache');
        expect(read).not.toHaveBeenCalled();
    });

    it('reads directly when there is no data cache (outside a Next.js request)', async () => {
        cache.wrap = () => async () => { throw missingCache(); };
        const read = vi.fn(async (n: number) => n * 2);
        expect(await sharedCachedRead(read, ['k'], 60)(21)).toBe(42);
        expect(read).toHaveBeenCalledWith(21);
    });

    it('lets a failed read through: a database error is never swallowed', async () => {
        cache.wrap = (fn) => (...args) => fn(...args);
        const read = vi.fn(async () => { throw new Error('timeout exceeded when trying to connect'); });
        await expect(sharedCachedRead(read, ['k'], 60)()).rejects.toThrow('timeout exceeded when trying to connect');
        expect(read).toHaveBeenCalledTimes(1);
    });
});

describe('fresh: past the cached copy, one query at a time', () => {
    function slowRead() {
        const answers: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }> = [];
        const read = vi.fn<(view: string) => Promise<string>>(
            () => new Promise<string>((resolve, reject) => { answers.push({ resolve, reject }); }),
        );
        return { read, answers };
    }

    it('joins a read of the same arguments that is already running', async () => {
        const { read, answers } = slowRead();
        const shared = sharedCachedRead(read, ['joined'], 60);
        const [first, second, other] = [shared.fresh('texas'), shared.fresh('texas'), shared.fresh('ohio')];
        expect(read).toHaveBeenCalledTimes(2);
        answers[0].resolve('texas jobs');
        answers[1].resolve('ohio jobs');
        expect(await Promise.all([first, second, other])).toEqual(['texas jobs', 'texas jobs', 'ohio jobs']);
    });

    it('reads again once that read has finished', async () => {
        const read = vi.fn(async (view: string) => `${view} jobs`);
        const shared = sharedCachedRead(read, ['again'], 60);
        await shared.fresh('texas');
        await shared.fresh('texas');
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('does not keep a failed read: every waiting caller gets the error, the next one reads again', async () => {
        const { read, answers } = slowRead();
        const shared = sharedCachedRead(read, ['failed'], 60);
        const [first, second] = [shared.fresh('texas'), shared.fresh('texas')];
        answers[0].reject(new Error('timeout exceeded when trying to connect'));
        await expect(first).rejects.toThrow('timeout exceeded');
        await expect(second).rejects.toThrow('timeout exceeded');
        const third = shared.fresh('texas');
        answers[1].resolve('texas jobs');
        expect(await third).toBe('texas jobs');
    });

    it('is the read the data cache itself runs, so a refresh behind an answer and a caller share one query', async () => {
        // The cache answers from an old entry and refreshes it behind the answer.
        cache.wrap = (fn) => async (...args) => {
            void fn(...args).catch(() => undefined);
            return 'old copy';
        };
        const { read, answers } = slowRead();
        const shared = sharedCachedRead(read, ['refresh'], 60);
        expect(await shared('texas')).toBe('old copy');
        const joined = shared.fresh('texas');
        expect(read).toHaveBeenCalledTimes(1);
        answers[0].resolve('new copy');
        expect(await joined).toBe('new copy');
    });

    it('keeps two reads registered under different key parts apart', async () => {
        const hourly = sharedCachedRead(vi.fn(async () => 'hourly'), ['directory'], 3600);
        const recheck = sharedCachedRead(vi.fn(async () => 'recheck'), ['directory-recheck'], 300);
        expect(await Promise.all([hourly.fresh(), recheck.fresh()])).toEqual(['hourly', 'recheck']);
    });
});

describe('with no data cache in production', () => {
    it('says so once, however many reads fall through to the database', async () => {
        vi.resetModules();
        vi.stubEnv('NODE_ENV', 'production');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        try {
            const fresh = await import('@/lib/data-cache');
            cache.wrap = () => async () => { throw missingCache(); };
            expect(await fresh.sharedCachedRead(async () => 1, ['first'], 60)()).toBe(1);
            expect(await fresh.sharedCachedRead(async () => 2, ['second'], 60)()).toBe(2);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain('first');
        } finally {
            vi.unstubAllEnvs();
            warn.mockRestore();
        }
    });

    it('stays quiet outside production (tests, scripts)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        cache.wrap = () => async () => { throw missingCache(); };
        await sharedCachedRead(async () => 1, ['quiet'], 60)();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('isDataCacheUnavailable', () => {
    it('matches only the missing-cache invariant', () => {
        expect(isDataCacheUnavailable(missingCache())).toBe(true);
        expect(isDataCacheUnavailable(new Error('timeout exceeded when trying to connect'))).toBe(false);
        expect(isDataCacheUnavailable('incrementalCache missing in unstable_cache')).toBe(false);
        expect(isDataCacheUnavailable(null)).toBe(false);
    });
});
