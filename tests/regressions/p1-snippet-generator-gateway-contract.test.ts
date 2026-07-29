/**
 * P1 #10 — Layer-2 snippet generator: gateway contract regressions.
 *
 * Companion to p1-snippet-generator-prompt-niche.test.ts (which covers the
 * PROMPT text). This file covers how the script TALKS TO THE GATEWAY — three
 * defects that each silently neutered a paid run:
 *
 *   1. Cache-key drift. lib/ai/cache.ts hashes only (task, cacheKey);
 *      `promptVersion` is logged, never keyed. seo_content has a 30-day TTL,
 *      so bumping the prompt version WITHOUT touching the cacheKey replays
 *      every response written under the previous prompt — the rebuild never
 *      reaches the model, and the DB fills with the old copy reported as '✓'.
 *   2. Tenant shape. `tenant` is an AiTenant object; passing a bare string
 *      makes tenant.id / tenant.type undefined, so recordAiCall's insert into
 *      ai_call_log's non-null tenant columns throws and is swallowed by the
 *      cost tracker's catch — a whole run logs zero cost rows.
 *   3. Throughput. seo_content allows a fixed number of live calls per window;
 *      an unpaced sequential loop starts failing the moment it's exhausted.
 *
 * Everything asserts against the LIVE registry / LIVE cache hasher so the
 * numbers can't drift out from under the script.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    PROMPT_VERSION,
    AI_TENANT,
    MIN_CALL_INTERVAL_MS,
    buildCityRequest,
    buildTaxonomyRequest,
    isReRollMode,
    isRateLimitError,
    estimateWallClockMs,
    formatDuration,
    completePaced,
    toCityFactBlock,
    __resetRateLimitLedger,
} from '@/scripts/generate-city-snippets';
import { buildCityFacts } from '@/lib/pseo/city-narrative';
import { TASK_REGISTRY } from '@/lib/ai/tasks';
import { __testing as cacheTesting } from '@/lib/ai/cache';
import { AiGatewayError, type CompleteResponse } from '@/lib/ai/types';
import type { CityData } from '@/lib/pseo/city-data/types';

const ROOT = process.cwd();
const src = fs.readFileSync(path.join(ROOT, 'scripts/generate-city-snippets.ts'), 'utf8');

const RATE_LIMIT = TASK_REGISTRY.seo_content.rateLimit;
const WINDOW_MS = RATE_LIMIT.windowSeconds * 1000;

const FIXTURE_CITY: CityData = {
    name: 'Springfield',
    state: 'Illinois',
    stateCode: 'IL',
    slug: 'springfield-il',
    population: 195_000,
    costOfLivingIndex: 92,
    lat: 39.78,
    lng: -89.65,
    metroArea: 'Springfield Metro',
    mentalHealthShortage: true,
    healthcareSystems: ['Example Health System', 'Sample Medical Center'],
    nearbyCities: [],
    providerRatio: 'moderate',
    medianIncome: 62_000,
    stateRank: 7,
};

const narrativeFacts = buildCityFacts(FIXTURE_CITY);
const factBlock = toCityFactBlock(narrativeFacts);
const CITY_SLUG = FIXTURE_CITY.slug;
const TOTAL_JOBS = 17;

const cityReq = (mode: Parameters<typeof isReRollMode>[0] = 'skip-approved') =>
    buildCityRequest(CITY_SLUG, factBlock, TOTAL_JOBS, mode);
const taxReq = (mode: Parameters<typeof isReRollMode>[0] = 'skip-approved') =>
    buildTaxonomyRequest(CITY_SLUG, factBlock, narrativeFacts, 'remote', TOTAL_JOBS, mode);

describe('P1 #10 — prompt version is part of the cache key (bump actually invalidates)', () => {
    it('both requests key on the same constant they report as promptVersion', () => {
        for (const req of [cityReq(), taxReq()]) {
            expect(req.promptVersion).toBe(PROMPT_VERSION);
            expect(
                req.cacheKey,
                'promptVersion missing from cacheKey — lib/ai/cache.ts does not hash it, so a bump would replay stale copy',
            ).toContain(PROMPT_VERSION);
        }
    });

    it('the live cache hasher yields a different key than the pre-bump shape', () => {
        // Exactly the key shape shipped alongside promptVersion 'v1'. If the
        // current key still hashes to this, a 30-day-old v1 response is served
        // verbatim for the v2 prompt.
        const preBumpCity = cacheTesting.buildCacheKey('seo_content', ['city', CITY_SLUG, TOTAL_JOBS]);
        const preBumpTax = cacheTesting.buildCacheKey('seo_content', ['taxcity', 'remote', CITY_SLUG, TOTAL_JOBS]);
        expect(cacheTesting.buildCacheKey('seo_content', cityReq().cacheKey!)).not.toBe(preBumpCity);
        expect(cacheTesting.buildCacheKey('seo_content', taxReq().cacheKey!)).not.toBe(preBumpTax);
    });

    it('city and taxonomy namespaces stay distinct, and inputs still vary the key', () => {
        const build = (parts: readonly unknown[]) => cacheTesting.buildCacheKey('seo_content', parts);
        expect(build(cityReq().cacheKey!)).not.toBe(build(taxReq().cacheKey!));
        expect(build(buildCityRequest(CITY_SLUG, factBlock, TOTAL_JOBS + 1, 'skip-approved').cacheKey!))
            .not.toBe(build(cityReq().cacheKey!));
        expect(build(buildCityRequest('other-city', factBlock, TOTAL_JOBS, 'skip-approved').cacheKey!))
            .not.toBe(build(cityReq().cacheKey!));
    });

    it('cache-key parts stay within the gateway-allowed primitive types (and carry no PII)', () => {
        for (const req of [cityReq(), taxReq()]) {
            for (const part of req.cacheKey!) {
                expect(['string', 'number', 'boolean']).toContain(typeof part);
            }
        }
    });
});

describe('P1 #10 — re-roll modes actually re-roll', () => {
    it('classifies the two documented re-spend modes as re-rolls', () => {
        expect(isReRollMode('all')).toBe(true);
        expect(isReRollMode('only-unapproved')).toBe(true);
        expect(isReRollMode('skip-approved')).toBe(false);
        expect(isReRollMode('only-missing')).toBe(false);
    });

    it('--all and --only-unapproved skip the cache read; the additive modes do not', () => {
        for (const mode of ['all', 'only-unapproved'] as const) {
            expect(
                cityReq(mode).options?.skipCacheRead,
                `${mode} must bypass the cache or "re-roll" returns byte-identical copy at $0`,
            ).toBe(true);
            expect(taxReq(mode).options?.skipCacheRead).toBe(true);
        }
        for (const mode of ['skip-approved', 'only-missing'] as const) {
            expect(cityReq(mode).options?.skipCacheRead).toBeUndefined();
            expect(taxReq(mode).options?.skipCacheRead).toBeUndefined();
        }
    });
});

describe('P1 #10 — tenant is an AiTenant object, not a string', () => {
    it('AI_TENANT satisfies the system-tenant shape', () => {
        expect(typeof AI_TENANT).toBe('object');
        expect(AI_TENANT.type).toBe('system');
        expect(typeof AI_TENANT.id).toBe('string');
        expect(AI_TENANT.id.length).toBeGreaterThan(0);
    });

    it('every request carries it, so ai_call_log and the rate-limit bucket resolve', () => {
        for (const req of [cityReq(), taxReq()]) {
            expect(req.tenant).toEqual(AI_TENANT);
            // Mirrors lib/ai/cost-tracker.ts — these map to non-null columns.
            expect(req.tenant.id).toBeDefined();
            expect(req.tenant.type).toBeDefined();
            // Mirrors the key template in lib/ai/rate-limiter.ts.
            expect(`ai:rl:${req.task}:${req.tenant.type}:${req.tenant.id}`).not.toContain('undefined');
        }
    });

    it('the source no longer passes a string literal for tenant', () => {
        expect(src, 'tenant must be { type, id } — a string breaks tsc and drops every cost-log row')
            .not.toMatch(/tenant:\s*['"]/);
    });
});

describe('P1 #10 — throughput pacing tracks the live rate limit', () => {
    it('derives the call interval from the registry rather than a hardcoded number', () => {
        expect(MIN_CALL_INTERVAL_MS).toBe(Math.ceil(WINDOW_MS / RATE_LIMIT.limit));
    });

    it('the documented ceiling and cadence match the registry', () => {
        expect(src, 'header no longer documents the live-call ceiling')
            .toContain(`at ${RATE_LIMIT.limit} per hour`);
        expect(RATE_LIMIT.windowSeconds, 'header says "per hour" — window is no longer an hour').toBe(3600);
        expect(src, 'documented pacing interval drifted from the registry')
            .toContain(`currently ${MIN_CALL_INTERVAL_MS / 1000}s`);
    });

    it('estimates wall clock: free under the cap, paced above it', () => {
        expect(estimateWallClockMs(RATE_LIMIT.limit)).toBe(0);
        expect(estimateWallClockMs(RATE_LIMIT.limit + 1)).toBe(MIN_CALL_INTERVAL_MS);
        // The documented handover run: 50 cities x (1 + 45 categories).
        const taxonomySweep = 2_300;
        expect(estimateWallClockMs(taxonomySweep))
            .toBe((taxonomySweep - RATE_LIMIT.limit) * MIN_CALL_INTERVAL_MS);
        expect(estimateWallClockMs(taxonomySweep)).toBeGreaterThan(24 * 3_600_000);
    });

    it('formats durations for the plan block', () => {
        expect(formatDuration(0)).toBe('immediate');
        expect(formatDuration(30_000)).toBe('30s');
        expect(formatDuration(40 * 60_000)).toBe('40m');
        expect(formatDuration(76 * 3_600_000)).toContain('h');
    });

    it('recognises only the gateway rate-limit rejection', () => {
        expect(isRateLimitError(new AiGatewayError('x', 'rate_limited'))).toBe(true);
        expect(isRateLimitError(new AiGatewayError('x', 'all_providers_failed'))).toBe(false);
        expect(isRateLimitError(new Error('rate_limited'))).toBe(false);
        expect(isRateLimitError('rate_limited')).toBe(false);
        expect(isRateLimitError(undefined)).toBe(false);
    });
});

describe('P1 #10 — completePaced keeps a long run inside the window', () => {
    const response = (cacheHit = false): CompleteResponse => ({
        content: 'x'.repeat(80),
        provider: 'openai',
        model: 'gpt-5.4',
        usage: { inputTokens: 500, cachedTokens: 0, outputTokens: 250, costUsd: 0.005 },
        latencyMs: 10,
        cacheHit,
        fallbackUsed: false,
    });
    const noop = () => {};

    beforeEach(() => __resetRateLimitLedger());
    afterEach(() => vi.useRealTimers());

    it('runs the first full window of live calls with no delay', async () => {
        const waits: number[] = [];
        const fn = vi.fn(async () => response());
        for (let i = 0; i < RATE_LIMIT.limit; i++) {
            await completePaced(fn, cityReq(), (ms) => waits.push(ms));
        }
        expect(fn).toHaveBeenCalledTimes(RATE_LIMIT.limit);
        expect(waits, 'calls inside the cap must not be throttled').toHaveLength(0);
    });

    it('waits for a slot once the window is saturated, then proceeds', async () => {
        vi.useFakeTimers();
        const waits: { ms: number; reason: string }[] = [];
        const report = (ms: number, reason: string) => waits.push({ ms, reason });
        const fn = vi.fn(async () => response());

        for (let i = 0; i < RATE_LIMIT.limit; i++) await completePaced(fn, cityReq(), report);
        expect(waits).toHaveLength(0);

        const pending = completePaced(fn, cityReq(), report);
        await vi.advanceTimersByTimeAsync(WINDOW_MS + 5_000);
        await pending;

        expect(fn).toHaveBeenCalledTimes(RATE_LIMIT.limit + 1);
        expect(waits.filter((w) => w.reason === 'slot')).toHaveLength(1);
        expect(waits[0].ms).toBeGreaterThan(0);
    });

    it('cache hits never consume the window (the gateway serves them before the limiter)', async () => {
        const waits: number[] = [];
        const fn = vi.fn(async () => response(true));
        for (let i = 0; i < RATE_LIMIT.limit * 2; i++) {
            await completePaced(fn, cityReq(), (ms) => waits.push(ms));
        }
        expect(fn).toHaveBeenCalledTimes(RATE_LIMIT.limit * 2);
        expect(waits).toHaveLength(0);
    });

    it('backs off and retries when the gateway still reports rate_limited', async () => {
        vi.useFakeTimers();
        const waits: { ms: number; reason: string }[] = [];
        const fn = vi.fn(async () => response());
        fn.mockRejectedValueOnce(new AiGatewayError('AI rate limit exceeded', 'rate_limited'));

        const pending = completePaced(fn, cityReq(), (ms, reason) => waits.push({ ms, reason }));
        await vi.advanceTimersByTimeAsync(MIN_CALL_INTERVAL_MS + 5_000);
        await expect(pending).resolves.toMatchObject({ cacheHit: false });

        expect(fn).toHaveBeenCalledTimes(2);
        const backoffs = waits.filter((w) => w.reason === 'backoff');
        expect(backoffs).toHaveLength(1);
        expect(backoffs[0].ms).toBe(MIN_CALL_INTERVAL_MS);
    });

    it('gives up after the retry budget instead of looping forever', async () => {
        vi.useFakeTimers();
        const fn = vi.fn(async () => { throw new AiGatewayError('AI rate limit exceeded', 'rate_limited'); });
        const pending = completePaced(fn, cityReq(), noop);
        const assertion = expect(pending).rejects.toThrow('rate limit');
        // Budget is bounded: exhaust well past the largest back-off.
        await vi.advanceTimersByTimeAsync(WINDOW_MS * 4);
        await assertion;
        expect(fn.mock.calls.length).toBeGreaterThan(1);
        expect(fn.mock.calls.length).toBeLessThanOrEqual(6);
    });

    it('propagates non-rate-limit failures immediately (no silent retry spend)', async () => {
        const fn = vi.fn(async () => { throw new AiGatewayError('providers down', 'all_providers_failed'); });
        await expect(completePaced(fn, cityReq(), noop)).rejects.toThrow('providers down');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
