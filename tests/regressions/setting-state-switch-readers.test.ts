/**
 * FB-1 step 5 (indexing audit): every reader of the stored setting x state
 * verdict (PseoStats.indexable on 'setting-state' rows) goes through
 * isSettingStateIndexable (lib/pseo/render-gate.ts), which also reads the
 * SETTING_STATE_INDEXING_ENABLED switch. A reader that used the raw flag
 * would, while the switch is off, link a page as indexable that renders
 * `noindex, follow`, list it in a sitemap, or count it as indexable in the
 * admin coverage view.
 *
 * The scan finds readers by what they select (the quoted "indexable" column
 * of a raw read, or `indexable: true` in a Prisma select) in files that read
 * 'setting-state' rows, so a new reader is caught the day it is written.
 *
 * Handoffs pending at the time of writing (owners outside package PSEO-A):
 * app/salary-guide/[state]/page.tsx, app/salary-guide/specialty/[specialty]/page.tsx
 * and lib/gsc-coverage.ts. Those cases fail until the handoffs land.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isSettingStateIndexable, SETTING_STATE_INDEXING_ENABLED } from '@/lib/pseo/render-gate';

const ROOT = process.cwd();
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The writer stores the verdict; it never reads it back to decide anything. */
const WRITERS = new Set(['app/api/cron/aggregate-pseo/route.ts']);

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...sourceFiles(rel));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
            out.push(rel);
        }
    }
    return out;
}

function readsStoredSettingStateVerdict(code: string): boolean {
    return /['"]setting-state['"]/.test(code) && (/"indexable"/.test(code) || /\bindexable: true\b/.test(code));
}

const readers = ['app', 'lib', 'components']
    .flatMap(sourceFiles)
    .filter((rel) => !WRITERS.has(rel))
    .map((rel) => ({ rel, code: stripComments(fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')) }))
    .filter(({ code }) => readsStoredSettingStateVerdict(code));

describe('the FB-1 switch', () => {
    it('is off: no stored verdict indexes while it is', () => {
        expect(SETTING_STATE_INDEXING_ENABLED).toBe(false);
        expect(isSettingStateIndexable(true)).toBe(false);
        expect(isSettingStateIndexable(true, true)).toBe(true);
        expect(isSettingStateIndexable(false, true)).toBe(false);
    });
});

describe('every reader of the stored setting x state verdict goes through isSettingStateIndexable', () => {
    it('the scan finds the known readers', () => {
        const found = readers.map(({ rel }) => rel);
        for (const known of [
            'app/api/sitemaps/cities/[batch]/route.ts',
            'app/api/sitemaps/index/route.ts',
            'lib/pseo/setting-state-template.tsx',
            'app/salary-guide/[state]/page.tsx',
            'app/salary-guide/specialty/[specialty]/page.tsx',
            'app/admin/seo-health/page.tsx',
        ]) {
            expect(found, known).toContain(known);
        }
    });

    it.each(readers.map(({ rel }) => rel))('%s reads the verdict through the switch', (rel) => {
        const { code } = readers.find((reader) => reader.rel === rel)!;
        // A reader either calls the switch-aware gate itself or hands its rows
        // to lib/gsc-coverage.ts, whose own case below pins the switch.
        const throughSwitch = code.includes('isSettingStateIndexable(') || code.includes('computeSettingStateCoverage(');
        expect(throughSwitch, `${rel} reads PseoStats.indexable for setting-state rows without isSettingStateIndexable`).toBe(true);
        expect(code, rel).not.toMatch(/\.filter\(\(row\) => row\.indexable\)/);
    });

    it('lib/gsc-coverage.ts counts a setting x state row as indexable only through the switch', () => {
        const code = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'gsc-coverage.ts'), 'utf8'));
        expect(code).toContain('isSettingStateIndexable(row.indexable');
        expect(code).not.toMatch(/if \(row\.indexable &&/);
    });
});
