/**
 * The one reading of JOB_HEALTH_MIN_PRESENCE_MISSES (lib/health/
 * presence-unpublish-threshold.ts). source-presence-unpublish takes a job down
 * at this miss count and deindex-expired sends the same rows as removals, so
 * both read this helper; tests/regressions/deindex-expired-cursor.test.ts runs
 * the two crons over the same values end to end.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES,
    presenceUnpublishMinMisses,
} from '@/lib/health/presence-unpublish-threshold';
import * as cursor from '@/app/api/cron/deindex-expired/cursor';

const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), ...rel.split('/')), 'utf8');

describe('presenceUnpublishMinMisses', () => {
    it.each([
        [undefined, DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES],
        ['', DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES],
        ['abc', DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES],
        ['0', DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES],
        ['-2', DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES],
        ['1', 1],
        ['5', 5],
        ['7 runs', 7],
    ])('%j gives %i', (raw, expected) => {
        expect(presenceUnpublishMinMisses(raw)).toBe(expected);
    });

    it('defaults to 3 misses', () => {
        expect(DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES).toBe(3);
    });
});

describe('both crons read the one helper', () => {
    it('the deindex-expired cursor re-exports the shared names, not a copy', () => {
        expect(cursor.presenceUnpublishMinMisses).toBe(presenceUnpublishMinMisses);
        expect(cursor.DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES).toBe(DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES);
    });

    it('source-presence-unpublish has no threshold of its own', () => {
        const route = read('app/api/cron/source-presence-unpublish/route.ts');
        expect(route).toContain("import { presenceUnpublishMinMisses } from '@/lib/health/presence-unpublish-threshold';");
        expect(route).toContain('return presenceUnpublishMinMisses(raw);');
        expect(route).not.toContain('DEFAULT_MIN_MISSES');
    });
});
