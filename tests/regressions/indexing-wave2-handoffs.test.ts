/**
 * Indexing audit, wave 2 handoffs that have no suite of their own:
 *
 *   CQ-15  retired 2026-11-25. The 40% employer-share cap existed because
 *          a figure counted postings, so one employer could be most of a
 *          sample. The salary engine (lib/salary-report/stats.ts) counts
 *          each employer once, so no employer can be more than 1 in n and
 *          the cap is gone. Every statement of the publishing rule now names
 *          the engine's employer floor, none names the cap, and no
 *          below-gate sentence claims a reason the facts cannot support.
 *   CQ-14  one predicate per category: the market report and the company
 *          profile's similar-employer module count a category with
 *          categoryPredicate, the clause its landing and state pages use.
 *   M-06   the category landing H1 reads with a space before its sub line.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BENCHMARK_MIN_EMPLOYERS } from '@/components/tools/benchmark-model';
import { emptyListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import {
    buildCategoryCityPayParagraph,
    buildCityPayParagraph,
    buildHubPayParagraph,
    buildPostedPaySentence,
    buildSalaryNearbyCaption,
    buildSalaryStateDescription,
    SALARY_NEARBY_NOT_PUBLISHED,
} from '@/lib/pseo/listing-narrative';
import { getPracticeEnvironment, NLC_VERIFIED_LABEL } from '@/lib/pseo/practice-environment';
import { buildPlainStateNarrative } from '@/lib/pseo/state-narrative';
import { buildSnapshotPaySentence } from '@/components/blog/LicenseGuideMarketSnapshot';
import { categoryPredicateWhere } from '@/lib/pseo/category-tagger';
import { specialtyCountWhere } from '@/lib/reports/queries';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
const NOW = new Date('2026-09-29T12:00:00Z');
const facts = (over: Partial<ListingFacts> = {}): ListingFacts => ({ ...emptyListingFacts(NOW), ...over });

/** Comments blanked, so a note explaining the retired cap is not read as copy. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The retired cap in any wording: the sentence, the share, or a percentage. */
const RETIRED_CAP = /no single employer|employer share|\d+%/i;

/** The engine's floor stated in a sentence: "5 employers" in any phrasing ("at least 5 employers", "5 or more employers"). */
const EMPLOYER_FLOOR = new RegExp(`\\b${BENCHMARK_MIN_EMPLOYERS}\\b[^.]*\\bemployers\\b`);

/** A rule-stating sentence: the employer floor, and never the cap. */
function expectEngineRule(text: string | null, where: string): void {
    expect(text, where).toBeTruthy();
    expect(text, `${where}: names the employer floor`).toMatch(EMPLOYER_FLOOR);
    expect(text, `${where}: names no retired cap`).not.toMatch(RETIRED_CAP);
}

describe('CQ-15 retired: the shared pay copy states the engine rule, never the employer-share cap', () => {
    it('the below-gate hub and metro sentences state the employer floor wherever they state the rule', () => {
        // Too few postings.
        expectEngineRule(buildHubPayParagraph({ scopeName: 'Ohio', scopeNoun: 'state', facts: facts({ salaryDisclosedCount: 2 }) }), 'hub, 2 postings');
        // Twenty-six postings from four employers: the employer floor failed,
        // and the sentence never claims too few postings.
        const crowded = buildHubPayParagraph({ scopeName: 'Virginia', scopeNoun: 'state', facts: facts({ salaryDisclosedCount: 26, salaryDisclosedEmployers: 4 }) });
        expectEngineRule(crowded, 'hub, 26 postings from 4 employers');
        expect(crowded).not.toMatch(/fewer than \d+ of them/);
        // No employer count at all.
        expectEngineRule(buildHubPayParagraph({ scopeName: 'Ohio', scopeNoun: 'state', facts: facts({ salaryDisclosedCount: 9 }) }), 'hub, no employer count');
    });

    it('a withheld city figure states the whole rule instead of claiming too few listings', () => {
        const text = buildCityPayParagraph({ city: 'Richmond', benchmark: null });
        expectEngineRule(text, 'city');
        // States the rule a local median needs, positively, with no narration.
        expect(text).toContain('A local median appears once');
        expect(text).not.toContain('does not publish');
        expect(text).not.toMatch(/^Fewer than/);
    });

    it('a withheld category pool in a city never claims too few disclose pay', () => {
        const bench = { scope: 'Richmond', tier: 'median', postings: 9, employers: 6, median: 132000, p25: null, p75: null };
        const text = buildCategoryCityPayParagraph({ slug: 'remote', labelSentence: 'remote', city: 'Richmond', categoryBenchmark: null, cityBenchmark: bench as never });
        expect(text).toMatch(/^No median is published for remote listings alone\./);
        expect(text).not.toContain('Not enough');
        expect(text).not.toMatch(/null|NaN|\$0K/);
    });

    it('the landing pay sentence, the nearby-states caption and cell and the salary meta line state the engine rule', () => {
        expectEngineRule(buildPostedPaySentence({ slug: 'outpatient', facts: facts({ total: 5, salaryDisclosedCount: 2 }) }), 'landing');
        expectEngineRule(buildSalaryNearbyCaption(NLC_VERIFIED_LABEL), 'nearby caption');
        expect(SALARY_NEARBY_NOT_PUBLISHED).not.toContain('below minimum');
        // The meta line is the last part of the description and is dropped
        // when it does not fit; the builder may state no posting floor and no cap.
        const src = code(read('lib/pseo/listing-narrative.ts'));
        expect(src).not.toMatch(/CAP_CLAUSE|MAX_EMPLOYER_SHARE_PERCENT|BENCHMARK_MIN_POSTINGS/);
        const env = getPracticeEnvironment('Texas');
        expect(env).not.toBeNull();
        const description = buildSalaryStateDescription({ env: env!, facts: facts({ total: 3, distinctEmployers: 2 }) });
        expect(description).not.toMatch(RETIRED_CAP);
        expect(description).not.toContain('Pay median published at 5 or more disclosed postings.');
    });

    it('the state hub narrative never claims too few postings when no median is published', () => {
        const text = buildPlainStateNarrative({
            stateName: 'Virginia',
            stateCode: 'VA',
            totalJobs: 33,
            uniqueEmployerCount: 5,
            topCategoryLabels: [],
            topCityNames: ['Richmond'],
            medianSalaryK: 0,
        });
        expect(text).toContain('No median is published for Virginia postings yet');
        expect(text).not.toContain('Not enough');
    });

    it('the license guide snapshot and body state the engine rule, and no cap', () => {
        // Twenty-six postings from four employers is below the median tier.
        const below = buildSnapshotPaySentence('Virginia', { tier: 'countOnly', gatePassed: false, median: null, postings: 26, employers: 4 } as never);
        expect(below).toBe(`A Virginia median appears here once at least ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay, each counted once however many postings it has.`);
        expect(below).not.toMatch(/because fewer than/);
        const guides = read('lib/blog-license-guides.ts');
        // One rule sentence, used by the pay FAQ and the pay section alike.
        expect(guides.match(/\$\{statePayRuleSentence\(s\)\}/g) ?? []).toHaveLength(2);
        expect(code(guides)).not.toMatch(/MAX_EMPLOYER_SHARE_PERCENT|salary-guide-policy|BENCHMARK_MIN_POSTINGS|no single employer/);
    });

    it('the builder stays pure, and the retired cap modules are gone', () => {
        const src = read('lib/pseo/listing-narrative.ts');
        expect(src).not.toContain('@/lib/salary-guide-gate');
        expect(src).not.toContain('@/lib/salary-guide-policy');
        expect(src).not.toMatch(/from '@\/lib\/prisma'|from '@\/lib\/salary-analytics'/);
        expect(fs.existsSync(path.join(ROOT, 'lib', 'salary-guide-gate.ts'))).toBe(false);
        expect(fs.existsSync(path.join(ROOT, 'lib', 'salary-guide-policy.ts'))).toBe(false);
    });
});

describe('CQ-14: one predicate per category outside the landing pages', () => {
    it('the market report nests the category predicate beside the active-job gate', () => {
        const base = { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] };
        expect(specialtyCountWhere(base, 'psychiatric-mental-health')).toEqual({
            AND: [base, categoryPredicateWhere('psychiatric-mental-health')],
        });
        expect(read('lib/reports/queries.ts')).not.toContain('categoryTags: { has: slug }');
    });

    it('the company profile matches similar employers with the category predicate', () => {
        const src = read('app/companies/[slug]/page.tsx');
        expect(src).toContain('...(dominantCategory ? [categoryPredicateWhere(dominantCategory as CategoryTag)] : []),');
        expect(src).not.toContain('categoryTags: { has: dominantCategory }');
    });
});

describe('fixSoon 5: every revival stamps contentChangedAt', () => {
    // The employer republish is pinned behaviourally in
    // tests/api/employer-toggle-publish.test.ts (the plan resume went with
    // the retired Employer plan's code).
    it('the NULL backfill script is a dry run by default and never moves updatedAt', () => {
        // Read as text: importing it would load the repo .env (production).
        const src = read('scripts/indexing-fixes/backfill-content-changed-at.ts');
        expect(src).toContain("import { ENV_FILE } from './lib/load-env';");
        expect(src).toContain('const opts = parseCli(argv);');
        expect(src).toContain('if (opts.apply) await applyPlannedWrites(prisma, writes);');
        expect(src).toContain('where: { contentChangedAt: null, ...rowFilter(opts) },');
        expect(src).toContain('guard: { contentChangedAt: null, updatedAt: row.updatedAt },');
        expect(src).toContain('data: { contentChangedAt: row.createdAt, updatedAt: row.updatedAt },');
        // applyPlannedWrites is the one guarded transaction every fix uses.
        expect(read('scripts/indexing-fixes/lib/runtime.ts')).toContain('await prisma.$transaction(');
    });

    it('an FP-recovery resurrection stamps it with the republish', () => {
        const src = read('lib/inngest/functions/fp-recovery.ts');
        expect(src).toContain('data: { isPublished: true, contentChangedAt: new Date() },');
        expect(src).not.toContain('data: { isPublished: true },');
    });
});

describe('M-06: the category landing H1 text reads with a space before its sub line', () => {
    it('puts a space between the second line and the sub line span', () => {
        const src = read('components/CategoryHero.tsx');
        expect(src).toMatch(/\{headlineLine2\}[\s\S]{0,300}?\{' '\}\s*<span className="cath5-h1-sub">/);
    });
});
