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
 * WAVE 2 (PLAN C.3, thin-content program): the setting×state template stopped
 * reading PseoStats.totalJobs altogether. Its counts now come from
 * getListingFacts() over the canonical predicate, where the total count is
 * the ONE query allowed to throw (lib/pseo/listing-facts.ts: a failed
 * section query logs and comes back empty, a failed TOTAL count rethrows).
 * The rule above is therefore now applied uniformly instead of only to the
 * first query: every count failure rejects, including the one a stale
 * cached row used to paper over. That is deliberate on both counts. A stale
 * row is a figure the page can no longer trace to live listings, which the
 * copy rules (PLAN C.5) retire, and the alternative under the new data
 * layer is not "render the cached number" but "render 0 jobs", which is
 * exactly the cacheable false-404 this file was written to prevent. The
 * cases below pin the rethrow AND pin the removal of the rescue. PseoStats
 * is still read for setting×state, but only for the stored robots verdict,
 * and that read fails soft (p10-platform-routing-db-fixes.test.ts #5).
 *
 * The category×city half keeps its cached-count rescue and is unchanged.
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
        // getListingFacts (PLAN C.3) resolves employer company links and
        // the template reads its stored robots verdict through raw SQL;
        // both must exist on the stub or the real path is never exercised.
        company: { findMany: vi.fn() },
        $queryRaw: vi.fn(),
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

    /*
     * The case that used to sit under "a stale-but-positive cached row still
     * rescues a failed live recount". PLAN C.3 retired that rescue for this
     * template, so the removal itself is what is worth pinning: a positive
     * but stale row, present and readable, must NOT turn a failed count into
     * a rendered page. If a cached-count fallback is ever reinstated here the
     * page would print a figure it cannot trace, and this case goes red.
     */
    it('setting×state: a stale positive cached row does not rescue a failed recount', async () => {
        const stale = { totalJobs: 42, indexable: true, updatedAt: hoursAgo(72) };
        db.pseoStats.findUnique.mockResolvedValue(stale);
        // Offered through the raw projection too, so the pin holds whichever
        // read a future fallback would come back through.
        db.$queryRaw.mockResolvedValue([stale]);
        db.job.count.mockRejectedValue(outage());
        db.job.groupBy.mockResolvedValue([]);
        db.job.findMany.mockResolvedValue([]);

        await expect(
            buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1),
        ).rejects.toThrow(OUTAGE);
    });
});

// ─── the fallback the try/catch was actually added for ──────────────────────

/*
 * Still true for category×city: lib/pseo/category-city-template.tsx keeps
 * getCityStats and its cachedRow fallback. Only the setting×state half moved
 * to getListingFacts in wave 2, so the two templates now answer a partial
 * outage differently. That asymmetry is recorded, not asserted away.
 */
describe('category×city: a stale-but-positive cached row still rescues a recount', () => {
    it('renders the cached count when only the recount fails', async () => {
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
    /*
     * The counterweight to the rethrow: a successful read that genuinely
     * finds nothing must still resolve, not throw, or the gate would be
     * unreachable. Two things changed with PLAN C.3 and C.2, neither of
     * which is this case relaxing:
     *   - the title no longer prints the count below COUNT_DISPLAY_FLOOR,
     *     so "0" is not fabricated into the tab (the old pin looked for it);
     *   - robots are always emitted now, index true or false, through
     *     resolveSettingStateIndexable, so the noindex verdict is explicit
     *     rather than inferred from an absent robots key.
     */
    it('setting×state: no row + a live count of 0 resolves to a noindex page, not a throw', async () => {
        db.pseoStats.findUnique.mockResolvedValue(null);
        // No cron row at all, so robots come from the live facts.
        db.$queryRaw.mockResolvedValue([]);
        db.job.count.mockResolvedValue(0);
        // getListingFacts iterates the row sample; an unmocked findMany
        // returns undefined and fails inside the tally, which would mask
        // the very distinction this case exists to draw.
        db.job.findMany.mockResolvedValue([]);

        const meta = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1);

        expect(meta.title).toBe('Inpatient NP Jobs in Texas');
        // No count is invented anywhere in the title at zero inventory.
        expect(String(meta.title)).not.toMatch(/[0-9]/);
        expect(meta.robots).toEqual({ index: false, follow: true });
    });
});
