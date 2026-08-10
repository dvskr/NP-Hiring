/**
 * P5 A7/A8 — model-level guards for the /reports honesty gates.
 *
 * The reports publish live percentages and distributions on a citable
 * surface, so the gates that keep small samples off the page are pinned
 * here rather than only exercised by rendering:
 *
 *   - computeShare never yields a percentage under the sample floor, and
 *     refuses incoherent inputs instead of clamping them plausible.
 *   - summarizeCountGroups folds below-floor rows into an honest
 *     remainder and never invents rows from zero-count groups.
 *   - summarizeDisclosureTrend refuses to draw a line through too few
 *     qualifying months, and treats disclosed > total as a query bug that
 *     disqualifies the whole series.
 *   - The threshold constants can tighten but never silently loosen.
 *   - Every configured report edition has a physical route folder, so the
 *     hub and /press can never link a report that 404s.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
    computeShare,
    summarizeCountGroups,
    summarizeDisclosureTrend,
    REPORT_MIN_SHARE_SAMPLE,
    REPORT_MIN_GROUP_COUNT,
    TREND_MIN_MONTH_SAMPLE,
    TREND_MIN_MONTHS,
    type CountGroup,
    type MonthlyDisclosureRow,
} from '@/lib/reports/report-model';
import {
    ALL_REPORTS,
    STATE_OF_HIRING_EDITIONS,
    CURRENT_STATE_OF_HIRING_EDITION,
    PAY_TRANSPARENCY_REPORT,
    REPORTS_HUB_PATH,
} from '@/lib/reports/editions';
import { brand } from '@/config/brand';

const ROOT = process.cwd();

describe('P5 reports — share gating (computeShare)', () => {
    it('returns null below the minimum sample, a rate at it', () => {
        // Arrange / Act / Assert
        expect(computeShare(10, REPORT_MIN_SHARE_SAMPLE - 1)).toBeNull();
        const share = computeShare(25, REPORT_MIN_SHARE_SAMPLE);
        expect(share).not.toBeNull();
        expect(share!.pct).toBe(Math.round((25 / REPORT_MIN_SHARE_SAMPLE) * 100));
        expect(share!.denominator).toBe(REPORT_MIN_SHARE_SAMPLE);
    });

    it('refuses incoherent inputs instead of clamping them plausible', () => {
        expect(computeShare(150, 100)).toBeNull(); // numerator > denominator
        expect(computeShare(-1, 200)).toBeNull(); // negative numerator
    });

    it('rounds to a whole percentage, never fabricating precision', () => {
        const share = computeShare(1, 300);
        expect(share!.pct).toBe(0);
        expect(Number.isInteger(share!.pct)).toBe(true);
    });
});

describe('P5 reports — distribution folding (summarizeCountGroups)', () => {
    const groups: CountGroup[] = [
        { key: 'a', label: 'A', count: 40 },
        { key: 'b', label: 'B', count: REPORT_MIN_GROUP_COUNT }, // exactly at floor
        { key: 'c', label: 'C', count: REPORT_MIN_GROUP_COUNT - 1 }, // below floor
        { key: 'd', label: 'D', count: 1 },
        { key: 'e', label: 'E', count: 0 }, // absence, not data
    ];

    it('shows at-or-above-floor rows sorted descending, folds the rest', () => {
        const summary = summarizeCountGroups(groups);
        expect(summary.shown.map((g) => g.key)).toEqual(['a', 'b']);
        expect(summary.otherGroups).toBe(2); // c and d, NOT the zero row
        expect(summary.otherCount).toBe(REPORT_MIN_GROUP_COUNT - 1 + 1);
    });

    it('totals across shown + folded, excluding zero-count rows', () => {
        const summary = summarizeCountGroups(groups);
        expect(summary.total).toBe(
            summary.shown.reduce((s, g) => s + g.count, 0) + summary.otherCount,
        );
        expect(summary.total).toBe(40 + REPORT_MIN_GROUP_COUNT + REPORT_MIN_GROUP_COUNT - 1 + 1);
    });

    it('does not mutate the input array (immutability contract)', () => {
        const copy = groups.map((g) => ({ ...g }));
        summarizeCountGroups(groups);
        expect(groups).toEqual(copy);
    });
});

describe('P5 reports — disclosure trend gating (summarizeDisclosureTrend)', () => {
    const month = (m: string, total: number, disclosed: number): MonthlyDisclosureRow => ({
        month: m,
        total,
        disclosed,
    });

    it('drops months under the sample floor before deciding on a trend', () => {
        const rows = [
            month('2026-02', TREND_MIN_MONTH_SAMPLE, 10),
            month('2026-03', TREND_MIN_MONTH_SAMPLE - 1, 40), // noise month
            month('2026-04', TREND_MIN_MONTH_SAMPLE, 20),
            month('2026-05', TREND_MIN_MONTH_SAMPLE, 30),
        ];
        const trend = summarizeDisclosureTrend(rows);
        expect(trend).not.toBeNull();
        expect(trend!.map((p) => p.month)).toEqual(['2026-02', '2026-04', '2026-05']);
    });

    it('publishes no trend when fewer than the minimum qualifying months remain', () => {
        const rows = Array.from({ length: TREND_MIN_MONTHS - 1 }, (_, i) =>
            month(`2026-0${i + 1}`, TREND_MIN_MONTH_SAMPLE, 10),
        );
        expect(summarizeDisclosureTrend(rows)).toBeNull();
    });

    it('sorts ascending and computes whole-number rates', () => {
        const rows = [
            month('2026-05', 100, 33),
            month('2026-03', 100, 50),
            month('2026-04', 200, 100),
        ];
        const trend = summarizeDisclosureTrend(rows)!;
        expect(trend.map((p) => p.month)).toEqual(['2026-03', '2026-04', '2026-05']);
        expect(trend.map((p) => p.pct)).toEqual([50, 50, 33]);
    });

    it('treats disclosed > total as a query bug that voids the whole series', () => {
        const rows = [
            month('2026-03', 100, 50),
            month('2026-04', 100, 101), // impossible — must not publish around it
            month('2026-05', 100, 50),
        ];
        expect(summarizeDisclosureTrend(rows)).toBeNull();
    });
});

describe('P5 reports — thresholds can tighten but never silently loosen', () => {
    it('pins the floors at their published minimums', () => {
        expect(REPORT_MIN_SHARE_SAMPLE).toBeGreaterThanOrEqual(100);
        expect(REPORT_MIN_GROUP_COUNT).toBeGreaterThanOrEqual(5);
        expect(TREND_MIN_MONTH_SAMPLE).toBeGreaterThanOrEqual(50);
        expect(TREND_MIN_MONTHS).toBeGreaterThanOrEqual(3);
    });
});

describe('P5 reports — edition configs match physical routes', () => {
    it('every listed report has a real page folder (no dead hub/press links)', () => {
        for (const report of ALL_REPORTS) {
            expect(report.path, report.slug).toBe(`/reports/${report.slug}`);
            const page = path.join(ROOT, 'app', 'reports', report.slug, 'page.tsx');
            expect(fs.existsSync(page), page).toBe(true);
        }
        expect(fs.existsSync(path.join(ROOT, 'app', 'reports', 'page.tsx'))).toBe(true);
        expect(REPORTS_HUB_PATH).toBe('/reports');
    });

    it('state-of-hiring editions are year-stamped and the current one is newest', () => {
        for (const edition of STATE_OF_HIRING_EDITIONS) {
            expect(edition.slug.endsWith(String(edition.year)), edition.slug).toBe(true);
            expect(edition.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        const years = STATE_OF_HIRING_EDITIONS.map((e) => e.year);
        expect(CURRENT_STATE_OF_HIRING_EDITION.year).toBe(Math.max(...years));
    });

    it('titles derive from brand tokens, so a fork re-niches them automatically', () => {
        expect(CURRENT_STATE_OF_HIRING_EDITION.title).toContain(brand.niche.short);
        expect(PAY_TRANSPARENCY_REPORT.title).toContain(brand.niche.short);
    });

    it('hub lists exactly the current edition plus the standing report', () => {
        expect(ALL_REPORTS.map((r) => r.slug)).toEqual([
            CURRENT_STATE_OF_HIRING_EDITION.slug,
            PAY_TRANSPARENCY_REPORT.slug,
        ]);
    });
});
