/**
 * Salary specialty index rule (indexing audit CQ-09, plan FB-2):
 * /salary-guide/specialty/<slug> indexes only when it publishes pay it can
 * back, a gated posted median (5+ postings from 3+ employers, no employer
 * above the CQ-15 share cap) or the role's own cited BLS OEWS median (29-1151
 * nurse anesthetists, 29-1161 nurse midwives). The page's robots meta and
 * the sitemap read the same verdict (lib/salary-guide-specialty.ts), and the
 * title claims only the sections that render.
 *
 * Prisma is the global mock from tests/setup.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import {
    getIndexableSalarySpecialtySlugs,
    getSalarySpecialtyIndexBasis,
    getSpecialtyExperienceBands,
    getSpecialtyLiveStats,
    getSpecialtyTopPayingStates,
    SALARY_SPECIALTY_SLUGS_INDEXABLE_WITHOUT_DB,
    shouldIndexSalarySpecialty,
} from '@/lib/salary-guide-specialty';
import { OCCUPATION_WAGES } from '@/lib/salary-guide-occupation-wages';
import { STAT_SOURCES } from '@/lib/stats-sources';
import {
    getSpecialtySalaryPage,
    SALARY_SPECIALTY_PAGES,
} from '@/app/salary-guide/specialty/specialty-config';
import {
    buildOccupationWageDescription,
    buildSpecialtyFaqs,
    buildSpecialtyHeadline,
    buildSpecialtyTitle,
    citedMedian,
    medianSentence,
    specialtyIndexBasis,
} from '@/app/salary-guide/specialty/specialty-content';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

interface FixtureRow {
    state: string | null;
    employer: string | null;
    title: string | null;
    normalizedMinSalary: number | null;
    normalizedMaxSalary: number | null;
}

function row(employer: string, min: number, state: string | null = 'Texas'): FixtureRow {
    return { state, employer, title: 'Nurse Practitioner', normalizedMinSalary: min, normalizedMaxSalary: min };
}

/** 5 postings from 3 employers, 2 + 2 + 1: clears the gate and the cap. */
const MIXED: FixtureRow[] = [
    row('Alpha Health', 100_000), row('Alpha Health', 110_000),
    row('Beta Clinic', 120_000), row('Gamma Care', 130_000), row('Gamma Care', 140_000),
];
/** 5 postings from 3 employers, 3 + 1 + 1: clears the old gate, not the cap. */
const DOMINATED: FixtureRow[] = [
    row('Alpha Health', 100_000), row('Alpha Health', 110_000), row('Alpha Health', 120_000),
    row('Beta Clinic', 130_000), row('Gamma Care', 140_000),
];
const NO_LIVE = { gatePassed: false, medianSalary: 0 } as const;
const LIVE = { gatePassed: true, medianSalary: 120_000 } as const;
const HOUSE_STYLE_DASH = /[–—]| - /;

const findMany = vi.mocked(prisma.job.findMany);

beforeEach(() => {
    findMany.mockReset();
});

describe('cited occupation wages (lib/salary-guide-occupation-wages.ts)', () => {
    it.each(Object.entries(OCCUPATION_WAGES))('%s is a self-consistent cited BLS OEWS median', (_key, wage) => {
        expect(wage.formatted).toBe(`$${Number(wage.value).toLocaleString('en-US')}`);
        expect(wage.source).toContain(`(${wage.soc})`);
        expect(wage.source).toMatch(/^BLS OEWS, .+, median annual wage, May \d{4}$/);
        expect(wage.asOf).toMatch(/^\d{4}-05$/);
        expect(wage.source).toContain(String(Number(wage.asOf.slice(0, 4))));
        expect(wage.sourceUrl).toMatch(/^https:\/\/www\.bls\.gov\//);
    });

    it('carries the two occupation codes the audit named', () => {
        expect(OCCUPATION_WAGES.nurseAnesthetists.soc).toBe('29-1151');
        expect(OCCUPATION_WAGES.nurseMidwives.soc).toBe('29-1161');
    });

    it('only the non-niche APRN pages carry one, and each carries its own', () => {
        expect(getSpecialtySalaryPage('anesthesia')).toMatchObject({ occupationWage: OCCUPATION_WAGES.nurseAnesthetists });
        expect(getSpecialtySalaryPage('midwifery')).toMatchObject({ occupationWage: OCCUPATION_WAGES.nurseMidwives });
        for (const page of SALARY_SPECIALTY_PAGES) {
            expect('occupationWage' in page, page.slug).toBe(!page.isNicheRole);
        }
    });

    it('a niche page still leads with the all-niche BLS median', () => {
        expect(citedMedian(getSpecialtySalaryPage('family-practice')!)).toBe(STAT_SOURCES.averageSalary);
    });
});

describe('specialtyIndexBasis (pure)', () => {
    it('a niche page indexes only on a gated posted median', () => {
        const derm = getSpecialtySalaryPage('dermatology')!;
        expect(specialtyIndexBasis(derm, NO_LIVE)).toBeNull();
        expect(specialtyIndexBasis(derm, LIVE)).toBe('posted-median');
        // A gate that passed with an unusable figure is not pay data.
        expect(specialtyIndexBasis(derm, { gatePassed: true, medianSalary: 0 })).toBeNull();
    });

    it('the premium estimate and the all-niche median never qualify a page on their own', () => {
        for (const page of SALARY_SPECIALTY_PAGES.filter((p) => p.isNicheRole)) {
            expect(specialtyIndexBasis(page, NO_LIVE), page.slug).toBeNull();
        }
    });

    it('the CRNA and CNM pages qualify on their cited occupation median (FB-2 midwifery)', () => {
        expect(specialtyIndexBasis(getSpecialtySalaryPage('midwifery')!, NO_LIVE)).toBe('occupation-wage');
        expect(specialtyIndexBasis(getSpecialtySalaryPage('anesthesia')!, NO_LIVE)).toBe('occupation-wage');
        expect(specialtyIndexBasis(getSpecialtySalaryPage('anesthesia')!, LIVE)).toBe('posted-median');
    });

    it('the DB-free list is exactly the pages that index without a posted median', () => {
        expect([...SALARY_SPECIALTY_SLUGS_INDEXABLE_WITHOUT_DB].sort()).toEqual(['anesthesia', 'midwifery']);
    });
});

describe('titles claim only what the page renders', () => {
    const cnm = getSpecialtySalaryPage('midwifery')!;
    const derm = getSpecialtySalaryPage('dermatology')!;

    it('drops "Pay and Top States" from a page with neither', () => {
        expect(buildSpecialtyTitle(derm, 2026, { hasPay: false, hasTopStates: false }))
            .toBe(`${derm.shortTitle} Salary Guide 2026`);
    });

    it('the CNM page with its cited median and no state table claims pay only', () => {
        const title = buildSpecialtyTitle(cnm, 2026, { hasPay: true, hasTopStates: false });
        expect(title).toBe('CNM (Certified Nurse Midwife) Salary Guide 2026: Median Pay');
        expect(title).not.toContain('Top States');
    });

    it('keeps the full claim when both sections render', () => {
        expect(buildSpecialtyTitle(derm, 2026, { hasPay: true, hasTopStates: true }))
            .toBe(`${derm.shortTitle} Salary Guide 2026: Pay and Top States`);
        expect(buildSpecialtyTitle(derm, 2026, { hasPay: false, hasTopStates: true }))
            .toBe(`${derm.shortTitle} Salary Guide 2026: Top-Paying States`);
    });

    it('the Article headline names only rendered sections', () => {
        expect(buildSpecialtyHeadline(cnm, { hasPay: true, hasTopStates: false })).toBe('Certified Nurse Midwife (CNM) Salary Guide: Pay');
        expect(buildSpecialtyHeadline(derm, { hasPay: false, hasTopStates: false }))
            .toBe(`${derm.role} Salary Guide: Premium Estimate`);
        expect(buildSpecialtyHeadline(derm, { hasPay: true, hasTopStates: true }))
            .toBe(`${derm.role} Salary Guide: Pay, Premium Estimate and Top States`);
        expect(buildSpecialtyHeadline(getSpecialtySalaryPage('pediatric')!, { hasPay: false, hasTopStates: false }))
            .toBe(`${getSpecialtySalaryPage('pediatric')!.role} Salary Guide`);
    });
});

describe('the CRNA and CNM copy cites their own median in house style', () => {
    for (const slug of ['anesthesia', 'midwifery'] as const) {
        const page = getSpecialtySalaryPage(slug)!;
        const wage = citedMedian(page);

        it(`${slug}: meta description leads with the cited occupation median`, () => {
            const description = buildOccupationWageDescription(page, { total: 2, posted: null })!;
            expect(description.startsWith(`${page.credential} salary: national median ${wage.formatted} (BLS OEWS, May 2025).`)).toBe(true);
            expect(description).toContain('2 open roles on');
            expect(description).not.toMatch(HOUSE_STYLE_DASH);
            const withPosted = buildOccupationWageDescription(page, { total: 9, posted: { median: 180_000, postings: 6 } })!;
            expect(withPosted).toContain('posted median $180,000 from 6 postings');
        });

        it(`${slug}: sentence, FAQ and title carry no dash, no average and no uncited figure`, () => {
            const faqs = buildSpecialtyFaqs(page, null, []);
            const copy = [medianSentence(page), ...faqs.flatMap((f) => [f.q, f.a])].join(' ');
            expect(copy).not.toMatch(HOUSE_STYLE_DASH);
            expect(copy).not.toMatch(/\baverage\b/i);
            // The FAQ repeats the sentence, so compare the distinct figures.
            expect([...new Set(copy.match(/\$[\d,]+K?/g))]).toEqual([wage.formatted]);
        });
    }

    it('niche pages get no occupation description (they keep the shared builder)', () => {
        expect(buildOccupationWageDescription(getSpecialtySalaryPage('family-practice')!, { total: 3, posted: null })).toBeNull();
    });

    it('the premium FAQ labels the estimate as editorial, not survey data', () => {
        const faq = buildSpecialtyFaqs(getSpecialtySalaryPage('dermatology')!, null, [])[0];
        expect(faq.a).toContain('editorial premium');
        expect(faq.a).toContain('not survey data');
        expect(faq.a).not.toMatch(HOUSE_STYLE_DASH);
    });

    it('no FAQ question presupposes that a premium exists (the questions ship into FAQPage JSON-LD)', () => {
        for (const page of SALARY_SPECIALTY_PAGES) {
            for (const faq of buildSpecialtyFaqs(page, null, [])) {
                expect(faq.q).not.toMatch(/earn a premium/i);
            }
        }
    });

    it('the premium question asks what the guide estimates, and its answer says it is not survey data', () => {
        const page = getSpecialtySalaryPage('dermatology')!;
        const faq = buildSpecialtyFaqs(page, null, []).find((f) => /premium/i.test(f.q))!;
        expect(faq.q).toMatch(/^What premium does this guide estimate for .+\?$/);
        expect(faq.a).toContain(`This guide's editorial estimate is ${page.premium!.minPct} to ${page.premium!.maxPct}% over the all-`);
        expect(faq.a).toContain('It is not survey data.');
        expect(`${faq.q} ${faq.a}`).not.toMatch(HOUSE_STYLE_DASH);
    });

    it('pages without a premium ask no premium question', () => {
        for (const page of SALARY_SPECIALTY_PAGES.filter((p) => !p.premium)) {
            expect(buildSpecialtyFaqs(page, null, []).some((f) => /premium/i.test(f.q))).toBe(false);
        }
    });
});

describe('the shared verdict over the gated pool (page robots and sitemap)', () => {
    it('a niche page with a mixed gated sample indexes', async () => {
        findMany.mockResolvedValueOnce(MIXED as never);
        expect(await shouldIndexSalarySpecialty('dermatology')).toBe(true);
    });

    it('CQ-15: a niche page whose sample one employer dominates does not index', async () => {
        findMany.mockResolvedValueOnce(DOMINATED as never);
        expect(await getSalarySpecialtyIndexBasis('dermatology')).toBeNull();
    });

    it('a niche page below the gate does not index; a CNM page with no postings does', async () => {
        findMany.mockResolvedValueOnce(MIXED.slice(0, 3) as never);
        expect(await shouldIndexSalarySpecialty('pediatric')).toBe(false);
        findMany.mockResolvedValueOnce([] as never);
        expect(await getSalarySpecialtyIndexBasis('midwifery')).toBe('occupation-wage');
    });

    it('an unknown slug never indexes', async () => {
        expect(await shouldIndexSalarySpecialty('not-a-specialty')).toBe(false);
        expect(findMany).not.toHaveBeenCalled();
    });

    it('a failed query leaves niche pages out and keeps the cited-median pages', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        findMany.mockRejectedValue(new Error('db down'));
        expect(await shouldIndexSalarySpecialty('family-practice')).toBe(false);
        expect(await shouldIndexSalarySpecialty('anesthesia')).toBe(true);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('getIndexableSalarySpecialtySlugs returns the indexable slugs in config order', async () => {
        const dermatology = SALARY_SPECIALTY_PAGES.findIndex((p) => p.slug === 'dermatology');
        findMany.mockImplementation((async () => {
            const call = findMany.mock.calls.length - 1;
            return (call === dermatology ? MIXED : []) as never;
        }) as never);
        const slugs = await getIndexableSalarySpecialtySlugs();
        expect(slugs).toEqual(
            SALARY_SPECIALTY_PAGES
                .filter((p) => p.slug === 'dermatology' || !p.isNicheRole)
                .map((p) => p.slug),
        );
    });

    it('the live loaders run the capped gate over the specialty tag pool', async () => {
        findMany.mockResolvedValueOnce(DOMINATED as never);
        const live = await getSpecialtyLiveStats('dermatology');
        expect(live.gatePassed).toBe(false);
        expect(live.medianSalary).toBe(0);

        findMany.mockResolvedValueOnce(MIXED as never);
        expect(await getSpecialtyLiveStats('dermatology')).toMatchObject({ gatePassed: true, medianSalary: 120_000, jobCount: 5 });
        const { where } = findMany.mock.calls[1][0] as unknown as { where: { AND: unknown[] } };
        expect(where.AND).toHaveLength(2);
        expect(JSON.stringify(where.AND[1])).toContain('dermatology');
    });

    it('top-paying states and experience bands drop dominated samples', async () => {
        findMany.mockResolvedValueOnce([...MIXED, ...DOMINATED.map((r) => ({ ...r, state: 'Ohio' }))] as never);
        expect((await getSpecialtyTopPayingStates('dermatology')).map((s) => s.state)).toEqual(['Texas']);

        findMany.mockResolvedValueOnce(MIXED as never);
        findMany.mockResolvedValueOnce(DOMINATED as never);
        findMany.mockResolvedValueOnce([] as never);
        expect((await getSpecialtyExperienceBands('dermatology')).map((b) => b.label)).toEqual(['New-grad friendly roles']);
    });
});

describe('page wiring: robots and title come from the shared verdict', () => {
    const page = read('app/salary-guide/specialty/[specialty]/page.tsx');

    it('generateMetadata sets robots from getSalarySpecialtyIndexBasis and titles through the builder', () => {
        expect(page).toContain('getSalarySpecialtyIndexBasis(page.slug)');
        expect(page).toContain('robots: { index: indexBasis !== null, follow: true }');
        expect(page).toContain('buildSpecialtyTitle(page, year, claims)');
        expect(page).not.toContain('Salary Guide ${year}: Pay and Top States');
    });

    it('no page copy says a CRNA or CNM wage is not cited any more', () => {
        expect(page).not.toMatch(/no national \{page\.credential\} wage figure/);
        expect(read('app/salary-guide/specialty/specialty-content.ts')).not.toMatch(/No national \$\{noun\} wage figure/);
    });

    it('the index hub cards cite the CRNA and CNM occupation medians', () => {
        const hub = read('app/salary-guide/specialty/page.tsx');
        expect(hub).toContain('page.occupationWage.formatted');
        expect(hub).not.toContain('Pay from live ${page.credential} postings on the guide');
        expect(hub).not.toContain('moves pay more than almost any other factor');
    });
});
