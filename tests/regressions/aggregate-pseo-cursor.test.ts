/**
 * Regression guards for F7: the aggregate-pseo cron restarted at offset 0 on
 * every scheduled run, so ~95% of the 4,135 cities never got fresh PseoStats
 * rows and the 36h sitemap staleness gates capped the pSEO surface to the
 * top-200 cities.
 *
 * The fix persists a rotating cursor in a sentinel PseoStats row (advanced
 * by however many cities actually completed, wrapping at the end of the
 * list), self-chains the remainder of the rotation with CRON_SECRET, and
 * alerts Discord when category-city staleness exceeds the 36h window.
 *
 * Part 1: unit tests for the cursor module (pure math + persistence).
 * Part 2: static source guards so a future edit can't silently undo the fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Local prisma mock: the shared tests/setup.ts mock has no pseoStats model,
// and shared test files must not be edited. This file-level mock overrides
// the setup-level one for this module graph only.
vi.mock('@/lib/prisma', () => ({
    prisma: {
        pseoStats: {
            findUnique: vi.fn(),
            upsert: vi.fn(),
            count: vi.fn(),
            aggregate: vi.fn(),
        },
        cronRun: {
            create: vi.fn().mockResolvedValue({ id: 'cron-run-test' }),
            update: vi.fn(),
        },
    },
}));

import { prisma } from '@/lib/prisma';
import {
    computeNextOffset,
    clampOffset,
    readCityCursor,
    persistCityCursor,
    CURSOR_TYPE,
    CURSOR_CATEGORY,
    CURSOR_LOCATION,
} from '@/app/api/cron/aggregate-pseo/cursor';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TOTAL_CITIES = 4135;

describe('computeNextOffset — rotation math', () => {
    it('advances by the number of completed cities', () => {
        expect(computeNextOffset(0, 200, TOTAL_CITIES)).toBe(200);
        expect(computeNextOffset(200, 200, TOTAL_CITIES)).toBe(400);
    });

    it('advances by PARTIAL progress when the time budget aborts a batch', () => {
        // The "offset-0 batch itself may not complete" case: 37 of 200 done.
        expect(computeNextOffset(0, 37, TOTAL_CITIES)).toBe(37);
        expect(computeNextOffset(3800, 12, TOTAL_CITIES)).toBe(3812);
    });

    it('stays put when zero cities completed (Phase 1 ate the budget)', () => {
        expect(computeNextOffset(1400, 0, TOTAL_CITIES)).toBe(1400);
    });

    it('wraps to 0 exactly at the end of the list', () => {
        expect(computeNextOffset(4000, 135, TOTAL_CITIES)).toBe(0);
    });

    it('wraps to 0 when the batch would overshoot the end', () => {
        expect(computeNextOffset(4000, 200, TOTAL_CITIES)).toBe(0);
    });

    it('returns 0 for an empty city list', () => {
        expect(computeNextOffset(0, 0, 0)).toBe(0);
    });
});

describe('clampOffset — stored/user-supplied offsets', () => {
    it('passes through valid in-range offsets', () => {
        expect(clampOffset(0, TOTAL_CITIES)).toBe(0);
        expect(clampOffset(4134, TOTAL_CITIES)).toBe(4134);
    });

    it('resets out-of-range and malformed offsets to 0', () => {
        expect(clampOffset(-5, TOTAL_CITIES)).toBe(0);
        expect(clampOffset(TOTAL_CITIES, TOTAL_CITIES)).toBe(0); // list shrank
        expect(clampOffset(99999, TOTAL_CITIES)).toBe(0);
        expect(clampOffset(NaN, TOTAL_CITIES)).toBe(0);
        expect(clampOffset(3.5, TOTAL_CITIES)).toBe(0);
    });
});

describe('cursor persistence — sentinel PseoStats row', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sentinel type is invisible to the category-city/setting-state consumers', () => {
        expect(CURSOR_TYPE).toBe('meta');
        expect(CURSOR_TYPE).not.toBe('category-city');
        expect(CURSOR_TYPE).not.toBe('setting-state');
    });

    it('readCityCursor returns 0 on first run (no sentinel row yet)', async () => {
        vi.mocked(prisma.pseoStats.findUnique).mockResolvedValue(null as never);
        expect(await readCityCursor(TOTAL_CITIES)).toBe(0);
    });

    it('readCityCursor resumes from the persisted offset', async () => {
        vi.mocked(prisma.pseoStats.findUnique).mockResolvedValue({ totalJobs: 1234 } as never);
        expect(await readCityCursor(TOTAL_CITIES)).toBe(1234);
        expect(vi.mocked(prisma.pseoStats.findUnique)).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    type_categorySlug_locationSlug: {
                        type: CURSOR_TYPE,
                        categorySlug: CURSOR_CATEGORY,
                        locationSlug: CURSOR_LOCATION,
                    },
                },
            }),
        );
    });

    it('readCityCursor clamps a stale out-of-range cursor back to 0', async () => {
        vi.mocked(prisma.pseoStats.findUnique).mockResolvedValue({ totalJobs: 99999 } as never);
        expect(await readCityCursor(TOTAL_CITIES)).toBe(0);
    });

    it('readCityCursor falls back to 0 when the read fails (cron must not die)', async () => {
        vi.mocked(prisma.pseoStats.findUnique).mockRejectedValue(new Error('db down') as never);
        expect(await readCityCursor(TOTAL_CITIES)).toBe(0);
    });

    it('persistCityCursor upserts the sentinel row with the next offset', async () => {
        vi.mocked(prisma.pseoStats.upsert).mockResolvedValue({} as never);
        expect(await persistCityCursor(2600)).toBe(true);
        expect(vi.mocked(prisma.pseoStats.upsert)).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    type_categorySlug_locationSlug: {
                        type: CURSOR_TYPE,
                        categorySlug: CURSOR_CATEGORY,
                        locationSlug: CURSOR_LOCATION,
                    },
                },
                update: { totalJobs: 2600 },
                create: expect.objectContaining({ type: CURSOR_TYPE, totalJobs: 2600 }),
            }),
        );
    });

    it('persistCityCursor returns false (not throw) when the write fails', async () => {
        vi.mocked(prisma.pseoStats.upsert).mockRejectedValue(new Error('db down') as never);
        expect(await persistCityCursor(2600)).toBe(false);
    });
});

describe('route wires the rotating cursor (static guards)', () => {
    const src = () => read('app/api/cron/aggregate-pseo/route.ts');

    it('reads the persisted cursor when no explicit offset is given', () => {
        expect(src()).toContain('readCityCursor(totalCities)');
        // The old behaviour — silently defaulting the offset to 0 — is gone.
        expect(src()).not.toMatch(/parseInt\(url\.searchParams\.get\('offset'\) \|\| '0'/);
    });

    it('persists the cursor from actual progress and wraps around', () => {
        expect(src()).toContain('computeNextOffset(startOffset, citiesCompleted, totalCities)');
        expect(src()).toContain('persistCityCursor(nextOffset)');
    });

    it('a time-budget abort still advances the cursor by completed cities', () => {
        // The break happens BEFORE processing the city, and citiesCompleted
        // increments only after a city's categories are done.
        expect(src()).toMatch(/timedOut = true\s*\n\s*break/);
        expect(src()).toContain('citiesCompleted++');
    });

    it('Phase 1 is no longer gated on offset === 0 (runs every scheduled entry)', () => {
        expect(src()).not.toContain('offset === 0');
        expect(src()).toContain("if (mode !== 'city')");
    });

    it('Phase 1 has its own budget check that leaves the city cursor untouched', () => {
        expect(src()).toMatch(/Timeout safety in Phase 1[\s\S]{0,200}persistCityCursor\(startOffset\)/);
    });

    it('reports coverage progress in the cron metrics for withCronTracking', () => {
        for (const field of ['startOffset', 'citiesCompleted', 'nextOffset', 'totalCities', 'rotationPercent']) {
            expect(src(), `metrics must include ${field}`).toContain(field);
        }
    });

    it('dispatches the self-chain and probes staleness on entry runs only', () => {
        expect(src()).toContain('dispatchSelfChain({ nextOffset, chainDepth })');
        expect(src()).toMatch(/chainDepth === 0\s*\n?\s*\? await checkCategoryCityStaleness/);
    });
});

describe('self-chain dispatch (static guards)', () => {
    const src = () => read('app/api/cron/aggregate-pseo/chain.ts');

    it('authorizes the follow-up request with CRON_SECRET', () => {
        expect(src()).toContain('process.env.CRON_SECRET');
        expect(src()).toContain('authorization: `Bearer ${cronSecret}`');
    });

    it('stops at rotation end and caps chain depth against runaway recursion', () => {
        expect(src()).toContain('if (nextOffset <= 0) return false');
        expect(src()).toContain('chainDepth >= MAX_CHAIN_DEPTH');
    });

    it('chained links skip Phase 1 via mode=city and increment the depth', () => {
        expect(src()).toContain('mode=city');
        expect(src()).toContain('chain=${chainDepth + 1}');
    });

    it('uses after() so the dispatch is not frozen with the invocation', () => {
        expect(src()).toMatch(/after\(\s*\n?\s*fetch\(/);
    });
});

describe('staleness alert (static guards)', () => {
    const src = () => read('app/api/cron/aggregate-pseo/staleness.ts');

    it('matches the 36h window used by the sitemap consumers', () => {
        expect(src()).toContain('PSEO_STALENESS_HOURS = 36');
        // and the sitemap side still uses the same constant value
        expect(read('app/api/sitemaps/cities/[batch]/route.ts')).toContain('PSEO_STALENESS_HOURS = 36');
    });

    it('alerts through the existing Discord webhook helper', () => {
        expect(src()).toContain("from '@/lib/discord-notifier'");
        expect(src()).toContain('sendDiscordMessage(');
    });

    it('measures the OLDEST category-city row, not just recent ones', () => {
        expect(src()).toMatch(/_min: \{ updatedAt: true \}/);
        expect(src()).toMatch(/type: 'category-city'/);
    });
});

describe('sentinel row cannot leak into downstream surfaces (static guards)', () => {
    it('city sitemap batches filter on the category-city type', () => {
        expect(read('app/api/sitemaps/cities/[batch]/route.ts')).toMatch(/type: 'category-city'/);
    });

    it('index-pseo cron filters on the category-city type', () => {
        expect(read('app/api/cron/index-pseo/route.ts')).toMatch(/type: 'category-city'/);
    });
});
