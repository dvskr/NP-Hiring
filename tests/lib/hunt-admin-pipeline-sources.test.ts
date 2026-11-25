/**
 * Hunt ADMIN-06 / INGEST note: the pipeline page lists the registry's sources
 * and marks the ones with no source_stats row in the window, so a source
 * whose cron stopped is visible.
 *
 * This board's registry also holds sources it deliberately does not schedule
 * (DISABLED_SOURCES). They can never have a row, so they are split out and
 * named as unscheduled instead of being reported as silent every day.
 */
import { describe, it, expect } from 'vitest';
import { describeRegistrySources, splitScheduledSources } from '@/lib/admin/pipeline-sources';

describe('describeRegistrySources', () => {
    it('marks a registry source with no row in the window as silent', () => {
        const rows = describeRegistrySources(['alpha', 'beta', 'gamma'], [
            { source: 'alpha', fetched: 40, added: 3 },
            { source: 'gamma', fetched: 0, added: 0 },
        ]);
        expect(rows).toEqual([
            { source: 'beta', hasStats: false, fetched: 0, added: 0 },
            { source: 'alpha', hasStats: true, fetched: 40, added: 3 },
            { source: 'gamma', hasStats: true, fetched: 0, added: 0 },
        ]);
    });

    it('lists silent sources first and keeps the registry order inside each group', () => {
        const rows = describeRegistrySources(['a', 'b', 'c', 'd'], [{ source: 'b', fetched: 1, added: 1 }]);
        expect(rows.map((r) => r.source)).toEqual(['a', 'c', 'd', 'b']);
    });

    it('does not invent a row for a funnel source the registry no longer has', () => {
        const rows = describeRegistrySources(['a'], [{ source: 'retired', fetched: 9, added: 9 }]);
        expect(rows.map((r) => r.source)).toEqual(['a']);
        expect(rows[0].hasStats).toBe(false);
    });

    it('handles an empty registry', () => {
        expect(describeRegistrySources([], [])).toEqual([]);
    });
});

describe('splitScheduledSources', () => {
    it('keeps registry order on both sides', () => {
        expect(splitScheduledSources(['a', 'off1', 'b', 'off2'], ['off2', 'off1'])).toEqual({
            scheduled: ['a', 'b'],
            unscheduled: ['off1', 'off2'],
        });
    });

    it('ignores an unscheduled name the registry does not have', () => {
        expect(splitScheduledSources(['a'], ['gone'])).toEqual({ scheduled: ['a'], unscheduled: [] });
    });

    it('never reports an unscheduled source as silent', () => {
        const { scheduled, unscheduled } = splitScheduledSources(['a', 'off'], ['off']);
        const rows = describeRegistrySources(scheduled, []);
        expect(rows.map((r) => r.source)).toEqual(['a']);
        expect(unscheduled).toEqual(['off']);
    });
});
