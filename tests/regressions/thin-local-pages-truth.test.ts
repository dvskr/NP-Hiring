/**
 * Thin-content truth pins for the category x city template (PLAN.md C.1,
 * C.4 item 6, C.5; thin-spec 2 section 4; package W2-CITYTPL).
 *
 * The 45 category x city slugs used to carry four classes of invented
 * figure, each repeated across thousands of near-identical URLs:
 *   1. a posting MEAN ("average salary" from `_avg` over min/max, and the
 *      cost-of-living adjusted variant of it) at any sample size;
 *   2. a "demand" / page-quality SCORE that no source publishes;
 *   3. a cost-of-living index and an unqualified HPSA shortage claim;
 *   4. hand-typed pay bands on the config objects.
 * Pay now comes from the gated median (5 postings from 3 employers) or the
 * cited BLS figure, and from nothing else; the rest are deleted outright.
 *
 * Also pinned here, because both are easy to regress silently:
 *   - the APRN-axis labels take NO credential suffix, so the titles read
 *     "Nurse Anesthetist Jobs in ...", never "Nurse Anesthetist NP Jobs";
 *   - ONE FAQ array feeds the visible accordion and the FAQPage JSON-LD,
 *     the retired "Is {City} a good place" question is gone, and the
 *     employers question appears exactly when its facts clear the floor.
 *
 * Source-level assertions read the template with comments stripped, so a
 * banned term surviving only in prose does not fail the build.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';
import { labelNoun, labelSentence } from '@/lib/pseo/category-metadata';
import {
    buildCategoryCityFaqs,
    buildCategoryCityTitle,
    receivesNpMedian,
} from '@/lib/pseo/listing-narrative';
import { emptyListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import { getPracticeEnvironment } from '@/lib/pseo/practice-environment';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import { STAT_SOURCES } from '@/lib/stats-sources';
import type { BenchmarkRow } from '@/components/tools/benchmark-model';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CITY_TEMPLATE = 'lib/pseo/category-city-template.tsx';
const code = (): string => stripComments(read(CITY_TEMPLATE));

/**
 * The one permitted occurrence of the string "average" in the template: the
 * BLS entry in lib/stats-sources.ts is keyed `averageSalary` for historical
 * reasons while the `source` string it renders says "median annual wage".
 * Anything else is a pay claim the gated helpers did not produce.
 */
const ALLOWED_AVERAGE_READ = 'STAT_SOURCES.averageSalary.source';

/** En dash and em dash, built from code points so this file carries neither byte. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
/** "$95K", "$129,210", "$95,000": a dollar figure typed by hand in code. */
const DOLLAR_LITERAL = /\$\d{2,3}(?:,\d{3})*K?\b/;

const BENCHMARK: BenchmarkRow = { scope: 'Austin', median: 128_000, p25: 115_000, p75: 142_000, postings: 6, employers: 3 };

const NOW = new Date('2026-09-21T00:00:00Z');

function facts(over: Partial<ListingFacts> = {}): ListingFacts {
    return { ...emptyListingFacts(NOW), ...over };
}

// ─── 1. no mean, no score, no cost of living ────────────────────────────────

describe('the category x city template states no figure it cannot source', () => {
    it('reads no posting mean under any of its retired names', () => {
        const src = code();
        for (const reader of ['rawAvgSalary', 'colAdjustedSalary', 'avgSalary', '_avg', 'MedianFigure', 'salaryRange']) {
            expect(src, `${CITY_TEMPLATE} still reads ${reader}`).not.toContain(reader);
        }
        // "median", never "average": the gated helpers are the only pay source.
        expect(src.split(ALLOWED_AVERAGE_READ).join('').toLowerCase()).not.toContain('average');
        // The permitted read really is the BLS cite, and that cite says median.
        expect(src).toContain(ALLOWED_AVERAGE_READ);
        expect(STAT_SOURCES.averageSalary.source).toContain('median annual wage');
        expect(STAT_SOURCES.averageSalary.source.toLowerCase()).not.toContain('average');
    });

    it('computes no demand or page-quality score', () => {
        const src = code();
        for (const reader of ['getPageQualityScore', 'isHighQuality', 'demandScore', 'qualityScore']) {
            expect(src, `${CITY_TEMPLATE} still reads ${reader}`).not.toContain(reader);
        }
        expect(src.toLowerCase()).not.toContain('demand score');
    });

    it('renders no cost-of-living index and no shortage designation', () => {
        const src = code().toLowerCase();
        expect(src).not.toContain('cost of living');
        expect(src).not.toContain('costofliving');
        expect(src).not.toContain('health professional shortage');
        // A bare pointer to HRSA's own lookup tool asserts nothing about this
        // city, so it is the one permitted mention of the acronym.
        const hpsaLines = code()
            .split('\n')
            .filter((line) => /hpsa/i.test(line))
            .filter((line) => !line.includes('hpsa.hrsa.gov'));
        expect(hpsaLines, `${CITY_TEMPLATE} still claims a shortage designation`).toEqual([]);
    });

    it('types no dollar figure and no growth or freshness claim by hand', () => {
        const src = code();
        expect(src).not.toMatch(DOLLAR_LITERAL);
        expect(src.toLowerCase()).not.toContain('added daily');
        expect(src.toLowerCase()).not.toContain('updated daily');
    });

    it('carries no dash and no spaced hyphen in a rendered string', () => {
        // Arithmetic (`page - 1`) is not user-facing; string and JSX literals are.
        const literals = code().match(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g) ?? [];
        for (const literal of literals) {
            expect(literal, `${CITY_TEMPLATE} literal carries a dash`).not.toMatch(DASHES);
        }
        expect(read(CITY_TEMPLATE)).not.toMatch(DASHES);
    });

    it('takes its robots from the shared index gate, not a bespoke score', () => {
        const src = code();
        expect(src).toContain('shouldIndexLocalListingPage({ activeJobs: stats.totalJobs, distinctEmployers, page })');
        // A noindex page keeps a self canonical and stays crawlable.
        expect(src).toContain('robots: { index: shouldIndex, follow: true }');
        expect(src).toMatch(/canonical: `\$\{brand\.baseUrl\}\$\{basePath\}`/);
        // No keywords metadata (thin-spec section 6). `CategoryConfig.keywords`
        // survives as a routing/config field, but nothing hands it to Next.
        const start = src.indexOf('export async function buildCategoryCityMetadata');
        const end = src.indexOf('const clayCard', start);
        expect(start, 'metadata builder not found').toBeGreaterThan(-1);
        expect(end, 'page chrome not found after the metadata builder').toBeGreaterThan(start);
        expect(src.slice(start, end)).not.toMatch(/\bkeywords\b/);
    });

    it('reads the employer gate column through a raw query, never a regenerated client', () => {
        const src = code();
        expect(src).toContain('prisma.$queryRaw<StoredCategoryCityRow[]>');
        expect(src).toContain('storedRow?.distinctEmployers ?? facts.distinctEmployers');
    });

    it('states pay only through the shared gated section', () => {
        const src = code();
        expect(src).toMatch(/<PostedPay[\s\S]{0,200}variant=\{\{ kind: 'category', slug: config\.slug \}\}/);
        expect(src).not.toMatch(/prisma\.job\.aggregate/);
        // The board median is never called national; the BLS line is the cite.
        expect(src).not.toContain('national median');
    });

    it('withholds the NP median from the APRN roles that do not earn it', () => {
        for (const slug of ['anesthesia', 'midwifery']) {
            expect(receivesNpMedian(slug), slug).toBe(false);
        }
        expect(receivesNpMedian('remote')).toBe(true);
    });

    it('prints no padded zero in the hero stats', () => {
        const src = code();
        // Each optional stat is spread from a guarded branch, never zero-filled.
        expect(src).toContain('facts.distinctEmployers >= 2');
        expect(src).toContain('facts.recency.last30 > 0');
        expect(src).not.toContain("'N/A'");
        expect(src).not.toContain('$0');
    });
});

// ─── 2. APRN labels take no credential suffix ───────────────────────────────

describe('APRN-axis titles name the role, not the role plus a credential', () => {
    const APRN = ['anesthesia', 'midwifery', 'clinical-nurse-specialist'] as const;

    it('the three APRN slugs are the ones the registry lists', () => {
        expect([...CATEGORY_AXES.aprn]).toEqual([...APRN]);
    });

    for (const slug of APRN) {
        it(`${slug}: labelNoun returns the bare label`, () => {
            const config = ALL_CATEGORY_CONFIGS[slug];
            expect(config, `${slug} missing from ALL_CATEGORY_CONFIGS`).toBeDefined();
            const noun = labelNoun(slug, config.label);
            expect(noun).toBe(config.label);
            expect(noun).not.toMatch(/\bNP\b/);
        });

        it(`${slug}: the page title and H1 carry no credential suffix`, () => {
            const config = ALL_CATEGORY_CONFIGS[slug];
            const noun = labelNoun(slug, config.label);
            const title = buildCategoryCityTitle({ labelNoun: noun, city: 'Austin', stateCode: 'TX', total: 12 });
            expect(title).toBe(`${config.label} Jobs in Austin, TX (12 Open)`);
            expect(title).not.toContain('NP Jobs');
            expect(title).not.toMatch(DASHES);
            // The layout appends the brand suffix; the title never does.
            expect(title).not.toContain('NP Hiring');
        });
    }

    it('a non-APRN label still gains the niche token exactly once', () => {
        const noun = labelNoun('remote', ALL_CATEGORY_CONFIGS.remote.label);
        expect(noun).toBe('Remote NP');
        expect(noun.match(/\bNP\b/g)).toHaveLength(1);
    });

    it('the count joins the title only at the display floor', () => {
        const noun = labelNoun('anesthesia', ALL_CATEGORY_CONFIGS.anesthesia.label);
        expect(buildCategoryCityTitle({ labelNoun: noun, city: 'Austin', stateCode: 'TX', total: 4 }))
            .toBe('Nurse Anesthetist Jobs in Austin, TX');
    });

    it('the template builds its hero and metadata from labelNoun', () => {
        const src = code();
        expect(src).toContain('const noun = labelNoun(config.slug, config.label);');
        expect(src).toContain('headlineLine1={noun}');
        expect(src).toContain('buildCategoryCityTitle({ labelNoun: noun');
        expect(src).toContain('const sentenceLabel = labelSentence(config.label);');
        expect(labelSentence('Remote')).toBe('remote');
        expect(labelSentence('LGBTQ+')).toBe('LGBTQ+');
    });
});

// ─── 3. one FAQ array feeds the accordion and the schema ────────────────────

describe('the category x city FAQ array is the FAQPage graph', () => {
    const env = getPracticeEnvironment('Texas');
    if (!env) throw new Error('fixture: Texas is missing from the practice dataset');

    const QUALIFICATIONS = 'To work as a nurse practitioner in Austin, TX, you need an accredited graduate program, national certification, an active RN and APRN license in Texas, and DEA registration where the role prescribes.';

    const build = (over: Partial<ListingFacts>, cityBenchmark: BenchmarkRow | null = null) =>
        buildCategoryCityFaqs({
            slug: 'remote',
            label: 'Remote',
            labelSentence: 'remote',
            city: 'Austin',
            stateName: 'Texas',
            facts: facts(over),
            cityBenchmark,
            env,
            qualifications: QUALIFICATIONS,
        });

    const RICH: Partial<ListingFacts> = {
        total: 7,
        distinctEmployers: 3,
        topEmployers: [
            { name: 'Lakeside Health', count: 4, companyPath: null },
            { name: 'Northwind Clinics', count: 2, companyPath: null },
            { name: 'Riverbend Care', count: 1, companyPath: null },
        ],
        benchmark: BENCHMARK,
        recency: { total: 7, datedCount: 7, last7: 2, last30: 5, newestPostedAt: new Date('2026-09-18T00:00:00Z') },
    };

    it('drops the retired "is a good place" question entirely', () => {
        for (const entry of build(RICH)) {
            expect(entry.question.toLowerCase()).not.toContain('good place');
        }
    });

    it('asks who is hiring once the employer floor is met, and not before', () => {
        const withEmployers = build(RICH).map((f) => f.question);
        expect(withEmployers).toContain('Which employers are hiring remote roles in Austin?');

        const alone = build({
            ...RICH,
            distinctEmployers: 1,
            topEmployers: [{ name: 'Lakeside Health', count: 7, companyPath: null }],
        }).map((f) => f.question);
        expect(alone).not.toContain('Which employers are hiring remote roles in Austin?');
    });

    it('every entry carries a non-empty answer and no dash', () => {
        const entries = build(RICH);
        expect(entries.length).toBeGreaterThanOrEqual(2);
        for (const entry of entries) {
            expect(entry.answer.trim().length, entry.question).toBeGreaterThan(0);
            expect(entry.question).not.toMatch(DASHES);
            expect(entry.answer).not.toMatch(DASHES);
            expect(entry.answer).not.toContain(' - ');
            expect(entry.answer.toLowerCase()).not.toContain('average');
        }
    });

    it('never fabricates a pay answer: below the gate the only figure is the cited BLS one', () => {
        const pay = build({ ...RICH, benchmark: null })
            .find((f) => f.question === 'What do remote listings in Austin pay?');
        expect(pay).toBeDefined();
        // No local median is published, and the one dollar figure that remains
        // names its source in the same sentence.
        expect(pay!.answer).toContain('does not publish a local figure');
        expect(pay!.answer.match(/\$[\d,]+/g)).toHaveLength(1);
        expect(pay!.answer).toContain('BLS OEWS');
    });

    it('the board median is scoped to the city and never called national', () => {
        const pay = build(RICH).find((f) => f.question === 'What do remote listings in Austin pay?');
        expect(pay).toBeDefined();
        // The figure this board computed says where it came from...
        expect(pay!.answer).toContain('the median in Austin is $128,000');
        // ...and "national" attaches only to the cited BLS wage.
        const national = pay!.answer.slice(pay!.answer.indexOf('national'));
        expect(national).toContain('BLS OEWS');
        expect(pay!.answer.match(/national/g)).toHaveLength(1);
    });

    it('withholds even the BLS reference from the APRN roles it does not describe', () => {
        for (const slug of ['anesthesia', 'midwifery']) {
            const config = ALL_CATEGORY_CONFIGS[slug];
            const entries = buildCategoryCityFaqs({
                slug,
                label: config.label,
                labelSentence: labelSentence(config.label),
                city: 'Austin',
                stateName: 'Texas',
                facts: facts({ ...RICH, benchmark: null }),
                cityBenchmark: null,
                env,
                qualifications: QUALIFICATIONS,
            });
            const pay = entries.find((f) => /pay\?$/.test(f.question));
            expect(pay, slug).toBeDefined();
            expect(pay!.answer, slug).not.toMatch(/\$[\d,]+/);
        }
    });

    it('the template builds the array once and renders it twice', () => {
        const src = code();
        // ONE build call.
        expect(src.match(/buildCategoryCityFaqs\(/g)).toHaveLength(1);
        // The schema half and the accordion half read the same identifier.
        expect(src).toContain('mainEntity: categoryCityFaqs.map(faq => ({');
        expect(src).toContain('{categoryCityFaqs.map((faq, i) => (');
        // Schema only at 2 or more entries; the answers render from 1.
        expect(src).toContain('categoryCityFaqs.length >= FAQ_SCHEMA_MIN_ENTRIES && (');
        expect(src).toContain('{categoryCityFaqs.length > 0 && (');
        // The answers are in the server HTML with the Speakable class.
        expect(src).toContain('<p className="faq-answer"');
        expect(src).toContain("cssSelector: ['#answer-summary', '.faq-answer']");
        expect(src).toContain('id="answer-summary"');
    });

    it('emits exactly one alert CTA and one copy of each shared block', () => {
        const src = code();
        // Any spelling of the destination counts, including the hero's
        // `secondaryCtaHref`: an href= only regex would miss a second CTA
        // passed as a prop and report one of two.
        expect(src.match(/\/job-alerts/g)).toHaveLength(1);
        expect(src.match(/config\.tips\.map\(/g)).toHaveLength(1);
        expect(src.match(/config\.benefits\.map\(/g)).toHaveLength(1);
        expect(src.match(/config\.heroSubtitle/g)).toHaveLength(1);
    });
});
