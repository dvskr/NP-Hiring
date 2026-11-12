/**
 * aggregate-pseo: the category x city grouping must match the batch's states.
 *
 * From 2026-09-20 to 2026-11-12 the grouping filtered with
 * `state: { in: stateNames, mode: 'insensitive' }`. Prisma 7 compiles that to
 * LOWER("state") IN (...) and leaves the names in their stored case, so the
 * query matched no row (checked against production: 0 groups, against 44
 * groups and 124 jobs for the same two states with one case-insensitive
 * equality per state). Every category x city row was written with
 * totalJobs = 0, which noindexed all of those pages, emptied the cities
 * sitemap and left index-pseo with nothing to submit.
 *
 * The route's query runs only against a database, so the shape is pinned on
 * the source, here and for every other query under app/ and lib/.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

/** `in:` / `notIn:` and `mode: 'insensitive'` inside one filter object. */
const IN_WITH_INSENSITIVE = /\{[^{}]*\b(?:in|notIn):[^{}]*mode:\s*['"]insensitive['"][^{}]*\}|\{[^{}]*mode:\s*['"]insensitive['"][^{}]*\b(?:in|notIn):[^{}]*\}/;

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(rel, out);
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
    }
    return out;
}

describe('aggregate-pseo category x city grouping', () => {
    const route = read('app/api/cron/aggregate-pseo/route.ts');
    const start = route.indexOf('async function groupCategoryByCity(');
    const fn = route.slice(start, route.indexOf('\n}\n', start));

    it('filters the batch states with one case-insensitive equality per state', () => {
        expect(start).toBeGreaterThan(-1);
        expect(fn).toMatch(/OR: stateNames\.map\(\(name\) => \(\{ state: \{ equals: name, mode: 'insensitive' as const \} \}\)\)/);
        expect(fn).toContain('canonicalBucketWhere({ AND: [category, inBatchStates] }, now)');
    });

    it('does not combine `in` with a case-insensitive mode', () => {
        expect(IN_WITH_INSENSITIVE.test(fn.replace(/\/\/.*$/gm, ''))).toBe(false);
    });
});

describe('no query combines `in` with mode: insensitive', () => {
    it('across app/ and lib/', () => {
        const offenders = [...sourceFiles('app'), ...sourceFiles('lib')].filter((rel) =>
            IN_WITH_INSENSITIVE.test(read(rel).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
        );
        expect(offenders, 'Prisma lowercases the column but not the list, so this filter matches nothing').toEqual([]);
    });
});
