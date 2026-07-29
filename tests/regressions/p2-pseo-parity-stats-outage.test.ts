/**
 * P2 pSEO-parity — DB-outage behaviour of the two pSEO stats readers.
 *
 * The parity pass wrapped `getStats` (setting×state) and `getCityStats`
 * (category×city) in try/catch so a failed LIVE RECOUNT could fall back to a
 * stale-but-positive cached row. The catch also swallowed the case where the
 * FIRST query — the cached-row read — is what failed, and in that case
 * returned EMPTY_STATS. EMPTY_STATS means totalJobs === 0, and both callers
 * treat 0 as "this page has no jobs":
 *
 *   • setting×state → notFound()          (~663 indexed URLs)
 *   • category×city → permanentRedirect()  (a 308 to the parent category)
 *
 * Every route carries `export const revalidate = 3600`, so either verdict is
 * written into the full route cache. A DB blip therefore deindexed the
 * surface for an hour — the inverse of the comment's promise that "transient
 * DB errors must not remove live pages". `cachedRow` is only ever assigned
 * INSIDE the try after a successful findUnique, so the fallback can never fire
 * for the failure mode that actually matters (the first query throwing).
 *
 * Correct behaviour: rethrow. A 5xx is retried by crawlers and never removes a
 * URL. Absence of data is not evidence of an empty page.
 *
 * These are behavioural tests: they drive the real exported metadata builders
 * with a rejecting prisma and assert the ORIGINAL error escapes, rather than
 * asserting on source text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Own module mock: the shared tests/setup.ts prisma stub has no `pseoStats`
// model, and these paths are entirely pseoStats-driven.
vi.mock('@/lib/prisma', () => ({
    prisma: {
        pseoStats: {
            findUnique: vi.fn(),
            findMany: vi.fn(),
        },
        job: {
            count: vi.fn(),
            aggregate: vi.fn(),
            groupBy: vi.fn(),
            findMany: vi.fn(),
        },
    },
}));

import { prisma } from '@/lib/prisma';
import { buildSettingStateMetadata } from '@/lib/pseo/setting-state-template';
import { buildCategoryCityMetadata } from '@/lib/pseo/category-city-template';

/**
 * Distinct sentinel so a passing assertion can't be satisfied by Next's own
 * NEXT_NOT_FOUND / NEXT_REDIRECT control-flow throws. Pre-fix, the city
 * builder rejected with NEXT_REDIRECT (the 308) and the state builder RESOLVED
 * with a "0 jobs" title — neither matches this message.
 */
const OUTAGE = 'PSEO_DB_OUTAGE_SENTINEL';
const outage = () => new Error(OUTAGE);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const SETTING_KEY = 'inpatient';
const STATE_SLUG = 'texas';
const CATEGORY_KEY = 'psychiatric-mental-health';
const CITY_SLUG = 'houston-tx';

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

beforeEach(() => {
    vi.clearAllMocks();
    // Default: silence the templates' console.error diagnostics.
    vi.spyOn(console, 'error').mockImplementation(() => { });
});

// ─── the regression itself ──────────────────────────────────────────────────

describe('a pseoStats read failure surfaces as 5xx, not as a cacheable 404/308', () => {
    it('setting×state: buildSettingStateMetadata rejects instead of returning a 0-job page', async () => {
        db.pseoStats.findUnique.mockRejectedValue(outage());
        db.job.count.mockRejectedValue(outage());

        await expect(
            buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1),
        ).rejects.toThrow(OUTAGE);
    });

    it('category×city: buildCategoryCityMetadata rejects instead of 308-ing to the parent', async () => {
        db.pseoStats.findUnique.mockRejectedValue(outage());
        db.job.count.mockRejectedValue(outage());

        const rejection = await buildCategoryCityMetadata(CATEGORY_KEY, CITY_SLUG, 1)
            .then(() => null, (e: unknown) => e);

        expect(rejection).toBeInstanceOf(Error);
        // Specifically NOT a NEXT_REDIRECT control-flow throw.
        expect((rejection as Error).message).toContain(OUTAGE);
        expect((rejection as Error).message).not.toContain('NEXT_REDIRECT');
    });

    it('setting×state: a live-count failure alone still rejects when no cached row exists', async () => {
        // findUnique succeeds but the combo has never been aggregated, so
        // there is no row to fall back on. The recount is the failure.
        db.pseoStats.findUnique.mockResolvedValue(null);
        db.job.count.mockRejectedValue(outage());

        await expect(
            buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1),
        ).rejects.toThrow(OUTAGE);
    });
});

// ─── the fallback the try/catch was actually added for ──────────────────────

describe('a stale-but-positive cached row still rescues a failed live recount', () => {
    it('setting×state: renders the cached count when only the recount fails', async () => {
        // Positive but STALE (older than the 36h window), so the code path
        // goes on to the live recount — which then fails.
        db.pseoStats.findUnique.mockResolvedValue({
            totalJobs: 42,
            rawAvgSalary: 131,
            updatedAt: hoursAgo(72),
        });
        db.job.count.mockRejectedValue(outage());
        db.job.groupBy.mockResolvedValue([]);

        const meta = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1);

        expect(meta.title).toContain('42');
        // 42 ≥ 3, so the thin-page noindex gate must NOT have fired.
        expect(meta.robots).toBeUndefined();
    });

    it('category×city: renders the cached count when only the recount fails', async () => {
        db.pseoStats.findUnique.mockResolvedValue({
            totalJobs: 37,
            rawAvgSalary: 128,
            colAdjustedSalary: 134,
            updatedAt: hoursAgo(72),
        });
        db.job.count.mockRejectedValue(outage());
        db.job.groupBy.mockResolvedValue([]);

        const meta = await buildCategoryCityMetadata(CATEGORY_KEY, CITY_SLUG, 1);

        expect(meta.title).toContain('37');
    });
});

// ─── a genuinely empty combo is still an empty combo ────────────────────────

describe('a successful read of zero jobs is unaffected', () => {
    it('setting×state: no row + a live count of 0 resolves to a 0-job (noindex) metadata', async () => {
        db.pseoStats.findUnique.mockResolvedValue(null);
        db.job.count.mockResolvedValue(0);

        const meta = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1);

        expect(meta.title).toContain('0');
        expect(meta.robots).toEqual({ index: false, follow: true });
    });
});
