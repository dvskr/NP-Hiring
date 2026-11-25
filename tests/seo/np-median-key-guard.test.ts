/**
 * The BLS national figure is a MEDIAN, and its key says so (ported from the
 * sister board's published-facts guard, salary build 2026-11). It was keyed
 * `averageSalary`, a median filed under "average", and the salary guide's
 * calculator offered "National Average" beside it. The key is gone, and no
 * source introduces the figure to a reader as an average.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { STAT_SOURCES } from '@/lib/stats-sources';

const ROOT = process.cwd();

/** Every .ts and .tsx file under the given folders, as repo-relative paths. */
function sourceFiles(dirs: readonly string[]): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(rel);
            } else if (/\.(ts|tsx)$/.test(entry.name)) {
                out.push(rel);
            }
        }
    };
    dirs.forEach(walk);
    return out;
}

const SOURCES = sourceFiles(['app', 'lib', 'components', 'config', 'scripts']);

/** A file's code with comments removed: a note naming the retired key is history, not a read. */
const code = (rel: string): string =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the BLS national median is keyed and introduced as a median', () => {
    it('has the median key and no longer the average key', () => {
        expect(STAT_SOURCES).toHaveProperty('npMedianWageBls');
        expect(STAT_SOURCES).not.toHaveProperty('averageSalary');
        expect(STAT_SOURCES.npMedianWageBls.source).toMatch(/median annual wage/);
    });

    it('no source file reads the retired key', () => {
        const offenders = SOURCES.filter((rel) => /\baverageSalary\b/.test(code(rel)));
        expect(offenders).toEqual([]);
    });

    it('no source file calls the BLS median an average', () => {
        const pattern = /average (?:of |is |was |salary of )?\$\{STAT_SOURCES\.npMedianWageBls/i;
        const offenders = SOURCES.filter((rel) => pattern.test(code(rel)));
        expect(offenders).toEqual([]);
    });

    it('no source file says practitioners earn a median: a statement of the BLS figure names it a wage', () => {
        // A question may still ask what NPs earn, since that is what people search; an answer says wage.
        const pattern = /\bearns? a median\b/i;
        const offenders = SOURCES.filter((rel) => pattern.test(code(rel)));
        expect(offenders).toEqual([]);
    });

    it('the salary calculator offers the national median, not an average', () => {
        const calculator = fs.readFileSync(path.join(ROOT, 'components/SalaryCalculator.tsx'), 'utf8');
        expect(calculator).toContain('National median');
        expect(calculator).not.toMatch(/National Average/i);
    });
});
