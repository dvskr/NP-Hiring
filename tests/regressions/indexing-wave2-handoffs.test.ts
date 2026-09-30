/**
 * Indexing audit, wave 2 handoffs that have no suite of their own:
 *
 *   CQ-15  every statement of the salary publishing rule in the shared pSEO
 *          copy names the employer-share cap, and no below-gate sentence
 *          claims a reason the facts cannot support. The builder stays pure:
 *          it reads the cap from the import-free lib/salary-guide-policy.ts.
 *   CQ-14  one predicate per category: the market report and the company
 *          profile's similar-employer module count a category with
 *          categoryPredicate, the clause its landing and state pages use.
 *   M-06   the category landing H1 reads with a space before its sub line.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_EMPLOYER_SHARE_PERCENT } from '@/lib/salary-guide-policy';
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

const CAP = `with no single employer above ${MAX_EMPLOYER_SHARE_PERCENT}% of them`;

describe('CQ-15: the shared pay copy names the employer-share cap', () => {
    it('the below-gate hub and metro sentences state the cap wherever they state the rule', () => {
        // Too few postings.
        expect(buildHubPayParagraph({ scopeName: 'Ohio', scopeNoun: 'state', facts: facts({ salaryDisclosedCount: 2 }) })).toContain(CAP);
        // Both counts clear: the rule or the cap failed, and the sentence claims neither.
        const cleared = buildHubPayParagraph({ scopeName: 'Virginia', scopeNoun: 'state', facts: facts({ salaryDisclosedCount: 26, salaryDisclosedEmployers: 5 }) });
        expect(cleared).toContain(CAP);
        expect(cleared).not.toMatch(/fewer than \d+ of them/);
        // No employer count at all.
        expect(buildHubPayParagraph({ scopeName: 'Ohio', scopeNoun: 'state', facts: facts({ salaryDisclosedCount: 9 }) })).toContain(CAP);
    });

    it('a withheld city figure states the whole rule instead of claiming too few listings', () => {
        const text = buildCityPayParagraph({ city: 'Richmond', benchmark: null });
        expect(text).toContain(CAP);
        expect(text).toContain('does not publish a local figure');
        expect(text).not.toMatch(/^Fewer than/);
    });

    it('a withheld category pool in a city never claims too few disclose pay', () => {
        const bench = { key: 'Richmond', postings: 6, employers: 3, median: 132000, p25: 118000, p75: 150000 };
        const text = buildCategoryCityPayParagraph({ slug: 'remote', labelSentence: 'remote', city: 'Richmond', categoryBenchmark: null, cityBenchmark: bench as never });
        expect(text).toMatch(/^No median is published for remote listings alone\./);
        expect(text).not.toContain('Not enough');
    });

    it('the landing pay sentence, the nearby-states caption and cell and the salary meta line name the cap', () => {
        expect(buildPostedPaySentence({ slug: 'outpatient', facts: facts({ total: 5, salaryDisclosedCount: 2 }) })).toContain(CAP);
        expect(buildSalaryNearbyCaption(NLC_VERIFIED_LABEL)).toContain(`${CAP}.`);
        expect(SALARY_NEARBY_NOT_PUBLISHED).not.toContain('below minimum');
        // The meta line is the last part of the description and is dropped
        // when it does not fit, so the pin is on the builder's own part.
        expect(read('lib/pseo/listing-narrative.ts')).toContain(
            '`Pay median published at ${BENCHMARK_MIN_POSTINGS} or more disclosed postings${CAP_CLAUSE}.`,',
        );
        const env = getPracticeEnvironment('Texas');
        expect(env).not.toBeNull();
        const description = buildSalaryStateDescription({ env: env!, facts: facts({ total: 3, distinctEmployers: 2 }) });
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

    it('the license guide snapshot and body state the whole rule, cap included', () => {
        const below = buildSnapshotPaySentence('Virginia', { gatePassed: false, median: null, postings: 26, employers: 5 } as never);
        expect(below).toContain(CAP);
        expect(below).not.toMatch(/because fewer than/);
        const guides = read('lib/blog-license-guides.ts');
        expect(guides.split('employers support it, with no single employer above ${MAX_EMPLOYER_SHARE_PERCENT}% of them.').length - 1).toBe(2);
        expect(guides).not.toContain('employers support it.');
        expect(guides).toContain("import { MAX_EMPLOYER_SHARE_PERCENT } from './salary-guide-policy';");
    });

    it('the builder stays pure: the cap comes from the import-free policy module', () => {
        const src = read('lib/pseo/listing-narrative.ts');
        expect(src).toContain("import { MAX_EMPLOYER_SHARE_PERCENT } from '@/lib/salary-guide-policy';");
        expect(src).not.toContain('@/lib/salary-guide-gate');
        expect(src).toContain('const CAP_CLAUSE = `, with no single employer above ${MAX_EMPLOYER_SHARE_PERCENT}% of them`;');
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
    // The employer republish and the plan resume are pinned behaviourally in
    // tests/api/employer-toggle-publish.test.ts and tests/lib/employer-plan.test.ts.
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
