/**
 * Drift guard: vercel.json's `crons` array is GENERATED from
 * config/cron-schedule.ts (via scripts/generate-vercel-crons.ts). This
 * test compares the generator's in-memory output against the committed
 * vercel.json, so it fails CI when:
 *
 *   - vercel.json's crons were hand-edited without updating the config,
 *   - the config (or a *_TOTAL_CHUNKS constant it derives from) changed
 *     without running `npm run crons:generate`,
 *   - an ingest source exists in the registry but has no cron, or a
 *     cron references a source the registry doesn't know.
 *
 * Complements tests/aggregators/chunk-count.test.ts, which checks the
 * chunk-entry counts specifically.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CRON_ENTRIES } from '@/config/cron-schedule';
import type { CronEntry } from '@/config/cron-schedule';
import { aggregators } from '@/lib/aggregators/registry';
import { GREENHOUSE_TOTAL_CHUNKS } from '@/lib/aggregators/greenhouse';
import { WORKDAY_TOTAL_CHUNKS } from '@/lib/aggregators/workday';

/**
 * Count of non-chunked entries in config/cron-schedule.ts (waves,
 * summaries, housekeeping). Chunked entries scale with the aggregator
 * constants; this literal tail is fixed. Bump it deliberately when
 * adding/removing a non-chunked cron.
 */
const NON_CHUNKED_CRON_COUNT = 51;

const INGEST_PREFIX = '/api/cron/ingest?';

function loadVercelCrons(): CronEntry[] {
    const file = path.join(process.cwd(), 'vercel.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf-8')) as { crons: CronEntry[] };
    return config.crons;
}

function sourceOf(entry: CronEntry): string | null {
    if (!entry.path.startsWith(INGEST_PREFIX)) return null;
    return new URLSearchParams(entry.path.slice(INGEST_PREFIX.length)).get('source');
}

describe('cron schedule drift guard', () => {
    const actualCrons = loadVercelCrons();
    const registrySources = Object.keys(aggregators);

    it('vercel.json crons deep-equal the generated schedule (same order)', () => {
        expect(actualCrons).toEqual(CRON_ENTRIES);
    });

    it('total count = non-chunked entries + both waves of greenhouse/workday chunks', () => {
        const expectedTotal =
            NON_CHUNKED_CRON_COUNT + 2 * (GREENHOUSE_TOTAL_CHUNKS + WORKDAY_TOTAL_CHUNKS);
        expect(CRON_ENTRIES.length).toBe(expectedTotal);
        expect(actualCrons.length).toBe(expectedTotal);
    });

    it('every registry source has at least one ingest cron entry', () => {
        const scheduledSources = new Set(
            actualCrons.map(sourceOf).filter((s): s is string => s !== null),
        );
        for (const source of registrySources) {
            expect(scheduledSources, `registry source "${source}" has no cron entry`)
                .toContain(source);
        }
    });

    it('every ingest cron entry references a known registry source', () => {
        for (const entry of actualCrons) {
            const source = sourceOf(entry);
            if (source === null) continue; // not an ingest?source= entry
            expect(registrySources, `cron path "${entry.path}" references unknown source`)
                .toContain(source);
        }
    });
});
