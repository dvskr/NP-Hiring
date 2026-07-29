/**
 * P1 gsc-ops: week-over-week movers math (lib/gsc-movers.ts).
 *
 * The admin/seo-health movers panel joins the two 7-day dimension windows
 * the gsc-health-check cron stores per snapshot. These tests pin the join,
 * ranking, and the defensive extraction from persisted raw JSON.
 */
import { describe, test, expect } from 'vitest';
import { computeMovers, extractSnapshotDimensions } from '@/lib/gsc-movers';
import type { GscDimensionRow } from '@/lib/gsc-client';

function row(key: string, clicks: number, impressions: number): GscDimensionRow {
    return { key, clicks, impressions, ctr: 0, position: 0 };
}

describe('computeMovers', () => {
    test('ranks gainers by clicks delta descending', () => {
        // Arrange
        const current = [row('a', 30, 100), row('b', 10, 50), row('c', 5, 20)];
        const previous = [row('a', 10, 80), row('b', 2, 40), row('c', 5, 30)];

        // Act
        const { gainers } = computeMovers(current, previous);

        // Assert
        expect(gainers.map((r) => r.key)).toEqual(['a', 'b']);
        expect(gainers[0].clicksDelta).toBe(20);
        expect(gainers[1].clicksDelta).toBe(8);
    });

    test('ranks losers by clicks delta ascending (worst first)', () => {
        // Arrange
        const current = [row('a', 1, 10), row('b', 8, 40)];
        const previous = [row('a', 20, 100), row('b', 10, 50)];

        // Act
        const { losers } = computeMovers(current, previous);

        // Assert
        expect(losers.map((r) => r.key)).toEqual(['a', 'b']);
        expect(losers[0].clicksDelta).toBe(-19);
    });

    test('treats keys missing from an empty previous window as new (prev = 0)', () => {
        const { gainers } = computeMovers([row('brand-new', 12, 60)], []);
        expect(gainers).toHaveLength(1);
        expect(gainers[0]).toMatchObject({
            key: 'brand-new',
            prevClicks: 0,
            clicksDelta: 12,
            estimated: false,
            // Empty window = GSC returned nothing for the range, so zero
            // impressions is proven too.
            prevImpressions: 0,
            impressionsDelta: 60,
        });
    });

    test('surfaces keys that disappeared entirely as losers', () => {
        const { losers } = computeMovers([], [row('lost-page', 15, 90)]);
        expect(losers).toHaveLength(1);
        expect(losers[0]).toMatchObject({
            key: 'lost-page',
            clicks: 0,
            prevClicks: 15,
            clicksDelta: -15,
            estimated: false,
            impressionsDelta: -90,
        });
    });

    test('zero click delta falls back to impressions delta for direction', () => {
        const current = [row('impr-up', 5, 500), row('impr-down', 5, 100)];
        const previous = [row('impr-up', 5, 100), row('impr-down', 5, 500)];

        const { gainers, losers } = computeMovers(current, previous);

        expect(gainers.map((r) => r.key)).toEqual(['impr-up']);
        expect(losers.map((r) => r.key)).toEqual(['impr-down']);
    });

    test('respects the limit and returns empty for empty inputs', () => {
        const current = Array.from({ length: 25 }, (_, i) => row(`k${i}`, i + 1, 10));
        const { gainers } = computeMovers(current, [], 10);
        expect(gainers).toHaveLength(10);

        const empty = computeMovers([], []);
        expect(empty.gainers).toEqual([]);
        expect(empty.losers).toEqual([]);
    });
});

/**
 * Both windows are GSC's top-N-by-clicks, so a key can leave one of them by
 * crossing the row cut rather than by losing traffic. Reading that absence as
 * "0 clicks" manufactures movers — and because both tables rank by click
 * delta, the biggest fabrications land in the top rows. These pin the
 * truncation-aware behaviour.
 */
describe('computeMovers — row-limit truncation', () => {
    /** A window cut while rows still had clicks: its floor is > 0. */
    const truncated = [row('kept-1', 40, 400), row('kept-2', 8, 90)];
    /** A window that reached the zero-click tail: its floor is 0. */
    const complete = [row('kept-1', 40, 400), row('tail', 0, 12)];

    test('reports each window floor and flags a click-truncated window', () => {
        const movers = computeMovers(truncated, complete);
        expect(movers.currentFloor).toBe(8);
        expect(movers.previousFloor).toBe(0);
    });

    test('does NOT invent a "0 -> 50" gainer for a key that merely crossed the cut', () => {
        // 'churner' ranked below the previous window's 8-click cut. The naive
        // join called that 0 clicks and reported a fabricated +50.
        const current = [row('churner', 50, 500), ...truncated];
        const { gainers } = computeMovers(current, truncated);

        const churner = gainers.find((r) => r.key === 'churner');
        expect(churner).toBeDefined();
        // prevClicks is unknown — never rendered as a factual 0.
        expect(churner?.prevClicks).toBeNull();
        expect(churner?.estimated).toBe(true);
        // Guaranteed-minimum gain: 50 now, at most 8 before.
        expect(churner?.clicksDelta).toBe(42);
        // Impressions are not bounded by a click-ordered cut.
        expect(churner?.impressionsDelta).toBeNull();
    });

    test('does NOT invent a "40 -> 0" total loss for a key that merely crossed the cut', () => {
        // 'slipped' had 40 clicks and fell past the current window's 8-click cut.
        const previous = [row('slipped', 40, 400), ...truncated];
        const { losers } = computeMovers(truncated, previous);

        const slipped = losers.find((r) => r.key === 'slipped');
        expect(slipped).toBeDefined();
        expect(slipped?.clicks).toBeNull();
        expect(slipped?.estimated).toBe(true);
        // At most 8 clicks now, 40 before → loss of at least 32, not 40.
        expect(slipped?.clicksDelta).toBe(-32);
        expect(slipped?.impressionsDelta).toBeNull();
    });

    test('drops rows whose direction the cut leaves unknowable instead of guessing', () => {
        // 5 clicks now, unranked in a window that cut off at 8: it could have
        // risen from 1 or fallen from 8. Neither table may claim it.
        const current = [row('ambiguous', 5, 50), ...truncated];
        const movers = computeMovers(current, truncated);

        expect(movers.gainers.map((r) => r.key)).not.toContain('ambiguous');
        expect(movers.losers.map((r) => r.key)).not.toContain('ambiguous');
        expect(movers.indeterminate).toBe(1);
    });

    test('a phantom mover never outranks a real one', () => {
        // Naive math scored the phantom at +50 and floated it above the
        // genuine +45; the bound scores it +42 and puts it second.
        const current = [row('phantom', 50, 500), row('real', 60, 600), ...truncated];
        const previous = [row('real', 15, 200), ...truncated];
        const { gainers } = computeMovers(current, previous);

        expect(gainers[0]).toMatchObject({ key: 'real', clicksDelta: 45, estimated: false });
        expect(gainers[1]).toMatchObject({ key: 'phantom', clicksDelta: 42, estimated: true });
    });

    test('a window that reached the zero-click tail proves zero clicks but not zero impressions', () => {
        const { gainers } = computeMovers([row('newcomer', 20, 200)], complete);

        expect(gainers[0]).toMatchObject({
            key: 'newcomer',
            prevClicks: 0,
            clicksDelta: 20,
            estimated: false,
        });
        // A zero-click key can still have impressions and still sit past the
        // cut, so the impressions side stays unknown.
        expect(gainers[0].prevImpressions).toBeNull();
        expect(gainers[0].impressionsDelta).toBeNull();
    });

    test('derives the floor from the minimum, not from stored row order', () => {
        // Persisted JSON ordering is not something the math may assume.
        const shuffled = [row('b', 8, 90), row('a', 40, 400)];
        expect(computeMovers(shuffled, []).currentFloor).toBe(8);
    });

    test('keys matched in both windows stay exact regardless of truncation', () => {
        const { gainers } = computeMovers(
            [row('kept-1', 60, 600), row('kept-2', 8, 90)],
            truncated,
        );
        expect(gainers[0]).toMatchObject({
            key: 'kept-1',
            prevClicks: 40,
            clicksDelta: 20,
            estimated: false,
            impressionsDelta: 200,
        });
    });
});

describe('extractSnapshotDimensions', () => {
    const validRaw = {
        searchAnalytics: { today: { clicks: 1 } },
        dimensions: {
            window: { startDate: '2026-07-22', endDate: '2026-07-28' },
            prevWindow: { startDate: '2026-07-15', endDate: '2026-07-21' },
            queries: {
                current: [{ key: 'np jobs', clicks: 10, impressions: 100, ctr: 0.1, position: 4.2 }],
                previous: [{ key: 'np jobs', clicks: 5, impressions: 80, ctr: 0.06, position: 6.1 }],
            },
            pages: {
                current: [{ key: 'https://example.com/jobs', clicks: 3, impressions: 40, ctr: 0.07, position: 8 }],
                previous: [],
            },
        },
    };

    test('extracts a well-formed dimensions payload', () => {
        const dims = extractSnapshotDimensions(validRaw);
        expect(dims).not.toBeNull();
        expect(dims?.window?.startDate).toBe('2026-07-22');
        expect(dims?.queries?.current[0].key).toBe('np jobs');
        expect(dims?.pages?.current).toHaveLength(1);
    });

    test('returns null for snapshots that predate dimension capture', () => {
        expect(extractSnapshotDimensions({ searchAnalytics: { today: {} } })).toBeNull();
        expect(extractSnapshotDimensions(null)).toBeNull();
        expect(extractSnapshotDimensions('garbage')).toBeNull();
        expect(extractSnapshotDimensions({ dimensions: { queries: { current: [], previous: [] } } })).toBeNull();
    });

    test('drops malformed rows and coerces missing numerics to 0', () => {
        const dims = extractSnapshotDimensions({
            dimensions: {
                queries: {
                    current: [
                        { key: 'ok-row' }, // missing numerics → 0
                        { clicks: 9 }, // no key → dropped
                        null,
                        'not-a-row',
                    ],
                    previous: 'not-an-array',
                },
            },
        });
        expect(dims?.queries?.current).toEqual([
            { key: 'ok-row', clicks: 0, impressions: 0, ctr: 0, position: 0 },
        ]);
        expect(dims?.queries?.previous).toEqual([]);
    });
});
