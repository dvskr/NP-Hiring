/**
 * P6 #9 — SalaryComparisonWidget provenance (content-fill package).
 *
 * The widget was the only salary display without a source/vintage stamp
 * (competitive teardown A4 wired components/SalaryProvenance.tsx onto the
 * hub, 51 state pages, specialty pages, and calculator — this job-detail
 * widget was excluded without documentation). Pins:
 *
 *   1. The stamp's cited sentence comes from the shared pure helper
 *      (buildProvenanceSentences) fed STAT_SOURCES.averageSalary — source
 *      + vintage from lib/stats-sources.ts metadata, never re-typed.
 *   2. The national figure the card displays still derives from
 *      config/niche/stats.ts (which itself derives from the same
 *      STAT_SOURCES entry), so stamp and figure cannot disagree.
 *   3. The state-average clause states its live-postings basis WITHOUT a
 *      fabricated posting count — no N is passed to this widget, so none
 *      may be claimed (omit, never fabricate).
 *   4. No render-time dates and no hand-typed dollar figures (B54 / P0 #23
 *      rules carried over from the A4 surfaces).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { buildProvenanceSentences } from '@/components/SalaryProvenance';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const WIDGET = 'components/SalaryComparisonWidget.tsx';
const src = read(WIDGET);

/** Comments naming the guarded defects must not satisfy code assertions. */
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('P6 #9 — the widget stamps its figures with real provenance', () => {
    it('builds the cited sentence from the shared helper + STAT_SOURCES', () => {
        expect(src).toMatch(/from '@\/lib\/stats-sources'/);
        expect(src).toMatch(/from '@\/components\/SalaryProvenance'/);
        expect(src).toContain('buildProvenanceSentences({');
        expect(src).toContain('cited: [STAT_SOURCES.averageSalary]');
    });

    it('renders the provenance line with the shared testid', () => {
        expect(src).toContain('data-testid="salary-provenance"');
    });

    it('states the state-average basis as live postings on the board, count-free', () => {
        expect(src).toContain(
            'average computed from live postings with disclosed salary on {brand.name}',
        );
        // No live-count sentence: the widget receives no N, so it must not
        // claim one (the "Based on N…" clause is reserved for surfaces that
        // pass a real aggregate count through the shared component).
        const code = stripComments(src);
        expect(code).not.toContain('Based on');
    });

    it('the national figure still derives from config/niche/stats.ts', () => {
        expect(src).toContain(
            "import { SALARY_COMPARISON_NATIONAL_AVG_K } from '@/config/niche/stats'",
        );
        expect(src).toContain('const NATIONAL_AVG_SALARY = SALARY_COMPARISON_NATIONAL_AVG_K');
    });

    it('carries no hand-typed dollar figures and no render-time dates', () => {
        const code = stripComments(src);
        expect(code).not.toMatch(/\$\d/);
        expect(code).not.toContain('new Date(');
        expect(code).not.toContain('Date.now(');
    });

    it('the cited sentence names the BLS source with its vintage exactly once', () => {
        // Same behavior pin as the A4 suite: the OEWS source string already
        // names "May 2024", so the helper must not double-render it.
        const [sentence] = buildProvenanceSentences({
            cited: [STAT_SOURCES.averageSalary],
        });
        expect(sentence).toContain(STAT_SOURCES.averageSalary.source);
        expect(sentence.startsWith('Source: ')).toBe(true);
    });

    it('the full stamp is assembled from cited sentence + state clause', () => {
        // The rendered line is "<cited sentence> <state clause>" — both
        // halves must be present in the JSX.
        expect(src).toContain('{NATIONAL_CITED_SENTENCE}');
        expect(src).toContain(`on {brand.name}`);
        expect(brand.name.length).toBeGreaterThan(0);
    });
});

describe('P6 #9 hardening — job-page call site keeps the widget alive ($k units)', () => {
    // Pre-existing defect (initial commit ec7f4ba, fixed in this package):
    // getStateSalaryAverage already returns thousands ("/ 2 / 1000"), but the
    // call site divided by 1000 AGAIN — the widget received 0, its
    // `stateAvgSalary <= 0` guard returned null, and the entire A21 surface
    // (provenance line included) was dead on every job page. These pins hold
    // the units contract at both ends so the double division cannot return.
    const PAGE = 'app/jobs/[slug]/page.tsx';
    const pageSrc = read(PAGE);

    it('getStateSalaryAverage still returns $k (thousands)', () => {
        // If this ever changes to raw dollars, the call-site pin below must
        // be reconciled in the same commit — this failure is the tripwire.
        expect(pageSrc).toMatch(
            /return Math\.round\(\(avgMin \+ avgMax\) \/ 2 \/ 1000\);/,
        );
    });

    it('the widget receives stateAvgSalary verbatim — no second /1000', () => {
        expect(pageSrc).toContain('stateAvgSalary={stateAvgSalary}');
        expect(pageSrc).not.toContain('stateAvgSalary={Math.round(stateAvgSalary / 1000)}');
        // No re-scaling of the already-$k value anywhere in the file.
        expect(stripComments(pageSrc)).not.toMatch(/stateAvgSalary\s*\/\s*1000/);
    });

    it('the widget prop is documented as $k, matching what the page now passes', () => {
        // Both sides of the contract: the prop comment in the widget says
        // thousands, and the guard that killed the dead surface is intact.
        expect(src).toMatch(/stateAvgSalary: number; \/\/ in thousands/);
        expect(src).toContain('if (!stateName || stateAvgSalary <= 0) return null;');
    });
});
