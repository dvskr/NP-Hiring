/**
 * Regression guards — content/SEO audit P1 #7 (salary-specialty package):
 * by-specialty salary pages under /salary-guide/specialty/<slug>.
 *
 * What must stay true:
 *   1. Every configured specialty slug is a canonical taxonomy slug —
 *      the route, the /jobs/<slug> cross-link, and the categoryTags
 *      query all key off it.
 *   2. TRUTH RULES: dollar figures derive from STAT_SOURCES (BLS median ×
 *      published premium) or from live DB aggregates — never typed in by
 *      hand, and never from the ingest tuning constants in
 *      config/niche/salary.ts (those are clamps, not wage evidence).
 *      Certification bodies are per-specialty correct (NBCRNA for CRNA,
 *      AMCB for CNM, ANCC-only for the psych specialty, PNCB pediatric,
 *      NCC women's health).
 *   2b. CREDENTIAL TRUTH: nurse anesthetists and nurse midwives are APRNs
 *      but not the niche role, so no surface — heading, prose, metadata,
 *      FAQ or JSON-LD — may render them as `label + brand.niche.short`,
 *      and the all-niche BLS median may not be presented as their pay.
 *   3. NICHE-COPY RATCHET: the new files contain zero reference-niche
 *      literals — the psych entry derives everything from
 *      PSYCH_SPECIALTY_SLUG (taxonomy-registry).
 *   4. The FAQ builder never emits $0 / NaN / undefined, and renders
 *      substantive content even with ZERO live inventory (the pages must
 *      not be soft-404s for empty categories).
 *   5. The hub premium table links into the specialty silo, and the
 *      sitemap advertises the specialty pages from the same config array.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { brand } from '@/config/brand';
import { salaryConfig } from '@/config/niche/salary';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { ALL_CATEGORY_SLUGS, PSYCH_SPECIALTY_SLUG, STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import {
    getSpecialtySalaryPage,
    SALARY_SPECIALTY_PAGES,
    SALARY_SPECIALTY_SLUGS,
} from '@/app/salary-guide/specialty/specialty-config';
import {
    averageOfBounds,
    buildSpecialtyFaqs,
    configRange,
    formatSalary,
    hasReportedRange,
    medianSentence,
    premiumEstimateRange,
    specialtyNoun,
    specialtyNounPlural,
    MIN_LIVE_JOBS,
} from '@/app/salary-guide/specialty/specialty-content';
import { TEMPLATE_REFERENCE_NICHE_TERMS } from './brand-leak-scan';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source with comments stripped. The truth-rule guards below judge CODE:
 * the files are expected to DISCUSS the constants they must never read
 * (that documentation is the point), so prose must not trip the scan.
 */
const codeOnly = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const MEDIAN = Number(STAT_SOURCES.averageSalary.value);

/** Every source file this package owns — scanned by the static guards. */
const PACKAGE_FILES = [
    'app/salary-guide/specialty/specialty-config.ts',
    'app/salary-guide/specialty/specialty-content.ts',
    'app/salary-guide/specialty/page.tsx',
    'app/salary-guide/specialty/[specialty]/page.tsx',
] as const;

describe('P1 #7 — specialty config integrity', () => {
    it('has a substantive roster and unique slugs', () => {
        expect(SALARY_SPECIALTY_PAGES.length).toBeGreaterThanOrEqual(10);
        expect(new Set(SALARY_SPECIALTY_SLUGS).size).toBe(SALARY_SPECIALTY_SLUGS.length);
    });

    it('every slug is a canonical taxonomy slug (route + /jobs cross-link + tag query)', () => {
        for (const slug of SALARY_SPECIALTY_SLUGS) {
            expect(ALL_CATEGORY_SLUGS, `${slug} missing from taxonomy registry`).toContain(slug);
        }
    });

    it('every entry carries complete, non-empty copy fields', () => {
        for (const page of SALARY_SPECIALTY_PAGES) {
            expect(page.label.length).toBeGreaterThan(2);
            expect(page.role.length).toBeGreaterThan(5);
            expect(page.shortTitle.length).toBeGreaterThan(2);
            expect(page.certification.length).toBeGreaterThan(3);
            expect(page.blurb.length).toBeGreaterThan(40);
            expect(page.settings.length).toBeGreaterThanOrEqual(3);
        }
    });

    it('premium bands are sane and never inverted', () => {
        for (const page of SALARY_SPECIALTY_PAGES) {
            if (!page.premium) continue;
            expect(page.premium.minPct).toBeGreaterThan(0);
            expect(page.premium.maxPct).toBeGreaterThan(page.premium.minPct);
            expect(page.premium.maxPct).toBeLessThanOrEqual(40);
            expect(page.premium.driver.length).toBeGreaterThan(5);
        }
    });

    it('the psych entry derives entirely from the registry constant (no literals)', () => {
        expect(PSYCH_SPECIALTY_SLUG).toBeTruthy();
        const psych = getSpecialtySalaryPage(PSYCH_SPECIALTY_SLUG!);
        expect(psych).toBeDefined();
        // Label title-cases the slug; credential = label initials + niche short.
        expect(psych!.label).toBe('Psychiatric Mental Health');
        expect(psych!.credential).toBe(`PMH${brand.niche.short}`);
        // ANCC is the sole certifying body for this specialty.
        expect(psych!.certification).toBe(`ANCC (PMH${brand.niche.short}-BC)`);
        expect(psych!.premium).toBeDefined();
    });

    it('certification bodies are correct per specialty (truth rule #4)', () => {
        expect(getSpecialtySalaryPage('anesthesia')!.certification).toContain('NBCRNA');
        expect(getSpecialtySalaryPage('midwifery')!.certification).toContain('AMCB');
        expect(getSpecialtySalaryPage('pediatric')!.certification).toContain('PNCB');
        expect(getSpecialtySalaryPage('women-health')!.certification).toContain('NCC');
        expect(getSpecialtySalaryPage('family-practice')!.certification).toMatch(/AANPCB|ANCC/);
        // CRNA / CNM pages must never claim the NP bodies certify them.
        expect(getSpecialtySalaryPage('anesthesia')!.certification).not.toMatch(/AANP\b|ANCC/);
        expect(getSpecialtySalaryPage('midwifery')!.certification).not.toMatch(/AANP\b|ANCC/);
    });

    it('publishes no wage band lifted from the ingest tuning constants', () => {
        // salaryConfig.normalizer.annualMax is the GLOBAL clamp applied to
        // every job at normalization time (config/niche/salary.ts: "maximum
        // reasonable W-2 annual salary"), not a wage observation for any
        // specialty — and its matching floor is $60k, not $200k. Publishing
        // it as "<role> pay spans $200K–$400K" asserted an uncited YMYL
        // salary range as fact. No package file may read that config at all.
        for (const rel of PACKAGE_FILES) {
            const code = codeOnly(read(rel));
            expect(code, `${rel} reads the ingest salary config`).not.toContain('config/niche/salary');
            expect(code, `${rel} references salaryConfig`).not.toMatch(/\bsalaryConfig\b/);
            // …and no six-figure dollar literal is hand-typed either.
            expect(code.match(/\b\d{2,3}[_,]?000\b/g) ?? [], `${rel} hand-types a salary literal`).toHaveLength(0);
        }
        // Every published range traces to a premium band over the cited median.
        for (const page of SALARY_SPECIALTY_PAGES) {
            const r = configRange(page);
            if (!r) continue;
            expect(page.premium, `${page.slug} publishes a range with no premium source`).toBeDefined();
            expect(r).toEqual(premiumEstimateRange(page.premium!));
            expect(r.max).not.toBe(salaryConfig.normalizer.annualMax);
        }
        expect(SALARY_SPECIALTY_PAGES.some((p) => 'wageBand' in p)).toBe(false);
    });
});

describe('P1 #7 — derived ranges trace to the cited BLS median', () => {
    it('premiumEstimateRange = median × band, computed not typed', () => {
        const r = premiumEstimateRange({ minPct: 10, maxPct: 20, driver: 'x' });
        expect(r.min).toBe(Math.round(MEDIAN * 1.1));
        expect(r.max).toBe(Math.round(MEDIAN * 1.2));
    });

    it('configRange: premium math for premium slugs, null for everything else', () => {
        const acute = getSpecialtySalaryPage('acute-care')!;
        expect(configRange(acute)).toEqual(premiumEstimateRange(acute.premium!));

        // No published premium → no invented range (live data or nothing).
        expect(configRange(getSpecialtySalaryPage('family-practice')!)).toBeNull();
        expect(configRange(getSpecialtySalaryPage('midwifery')!)).toBeNull();
        expect(configRange(getSpecialtySalaryPage('anesthesia')!)).toBeNull();
    });

    it('formatSalary matches the salary-guide display shape', () => {
        expect(formatSalary(129210)).toBe('$129K');
        expect(formatSalary(950)).toBe('$950');
    });
});

describe('P1 #7 — live aggregates never publish a halved or $0 figure', () => {
    it('averageOfBounds averages only the bounds Prisma actually returned', () => {
        // Both bounds present → midpoint.
        expect(averageOfBounds(120000, 160000)).toBe(140000);
        // Upper bound null (no posting in the set discloses a max): the
        // figure must be the lower bound, NOT (min + 0) / 2 = half of it.
        expect(averageOfBounds(140000, null)).toBe(140000);
        expect(averageOfBounds(null, 160000)).toBe(160000);
        // Nothing usable → 0 so callers gate the section away.
        expect(averageOfBounds(null, null)).toBe(0);
        expect(averageOfBounds(0, 0)).toBe(0);
    });

    it('hasReportedRange rejects spreads that would render "$X – $0"', () => {
        const base = { avgSalary: 140000, jobCount: 9 };
        expect(hasReportedRange({ ...base, minSalary: 98000, maxSalary: 210000 })).toBe(true);
        expect(hasReportedRange({ ...base, minSalary: 98000, maxSalary: 0 })).toBe(false);
        expect(hasReportedRange({ ...base, minSalary: 0, maxSalary: 0 })).toBe(false);
    });

    it('the FAQ omits the live clause entirely when the average is unusable', () => {
        const fp = getSpecialtySalaryPage('family-practice')!;
        const faqs = buildSpecialtyFaqs(fp, { avgSalary: 0, minSalary: 0, maxSalary: 0, jobCount: 40 }, []);
        expect(faqs[0].a).not.toMatch(/\$0\b/);
        expect(faqs[0].a).not.toContain('active FNP postings');
        // …and drops just the spread when only the upper bound is missing.
        const noMax = buildSpecialtyFaqs(fp, { avgSalary: 140000, minSalary: 98000, maxSalary: 0, jobCount: 9 }, []);
        expect(noMax[0].a).toContain(formatSalary(140000));
        expect(noMax[0].a).not.toContain('range');
        expect(noMax[0].a).not.toMatch(/\$0\b/);
    });

    it('the page routes every aggregate through the helper (no raw (min+max)/2)', () => {
        const src = read('app/salary-guide/specialty/[specialty]/page.tsx');
        expect(src).not.toMatch(/normalizedMaxSalary\s*\|\|\s*0\s*\)?\s*\)\s*\/\s*2/);
        expect(src.match(/averageOfBounds\(/g)?.length).toBe(3); // stats, states, experience
        expect(src).toContain('hasReportedRange(live)');
        expect(src).toContain('live.avgSalary > 0');
    });
});

describe('P1 #7 — FAQ builder (feeds visible accordion AND FAQPage schema)', () => {
    const live = { avgSalary: 141000, minSalary: 98000, maxSalary: 210000, jobCount: 17 };
    const topStates = [
        { state: 'California', stateCode: 'CA', slug: 'california', avgSalary: 165000, jobCount: 6 },
        { state: 'Washington', stateCode: 'WA', slug: 'washington', avgSalary: 158000, jobCount: 4 },
        { state: 'New Jersey', stateCode: 'NJ', slug: 'new-jersey', avgSalary: 151000, jobCount: 3 },
    ];

    it('renders substantive FAQs even with ZERO live inventory (no soft-404 shell)', () => {
        for (const page of SALARY_SPECIALTY_PAGES) {
            const faqs = buildSpecialtyFaqs(page, null, []);
            expect(faqs.length, page.slug).toBeGreaterThanOrEqual(3);
            const joined = faqs.map((f) => `${f.q} ${f.a}`).join(' ');
            expect(joined).not.toMatch(/\$0\b|NaN|undefined/);
            // The headline answer always cites the BLS median.
            expect(faqs[0].a).toContain(STAT_SOURCES.averageSalary.formatted);
            // The certification answer names the config's certifying body text.
            expect(joined).toContain(page.certification);
        }
    });

    it('includes live board figures only when the aggregate clears the floor', () => {
        const fp = getSpecialtySalaryPage('family-practice')!;
        const withLive = buildSpecialtyFaqs(fp, live, []);
        expect(withLive[0].a).toContain(formatSalary(live.avgSalary));
        expect(withLive[0].a).toContain(String(live.jobCount));

        const belowFloor = buildSpecialtyFaqs(fp, { ...live, jobCount: MIN_LIVE_JOBS - 1 }, []);
        expect(belowFloor[0].a).not.toContain(formatSalary(live.avgSalary));
    });

    it('adds a top-paying-states FAQ only with >= 3 qualifying states', () => {
        const fp = getSpecialtySalaryPage('family-practice')!;
        const withStates = buildSpecialtyFaqs(fp, null, topStates);
        const statesFaq = withStates.find((f) => f.q.includes('states pay'));
        expect(statesFaq).toBeDefined();
        expect(statesFaq!.a).toContain('California');
        expect(statesFaq!.a).toContain(formatSalary(topStates[0].avgSalary));

        const withoutStates = buildSpecialtyFaqs(fp, null, topStates.slice(0, 2));
        expect(withoutStates.find((f) => f.q.includes('states pay'))).toBeUndefined();
    });

    it('questions take the right indefinite article (they ship into FAQPage schema)', () => {
        expect(buildSpecialtyFaqs(getSpecialtySalaryPage('acute-care')!, null, [])[0].q)
            .toContain('does an Acute Care');
        expect(buildSpecialtyFaqs(getSpecialtySalaryPage('family-practice')!, null, [])[0].q)
            .toContain('does a Family Practice');
        for (const page of SALARY_SPECIALTY_PAGES) {
            for (const faq of buildSpecialtyFaqs(page, live, topStates)) {
                expect(faq.q, `${page.slug}: ${faq.q}`).not.toMatch(/\ba [AEIOU]/);
            }
        }
    });

    it('cites the FPA stat from lib/stats-sources.ts in the negotiation FAQ', () => {
        const faqs = buildSpecialtyFaqs(getSpecialtySalaryPage('family-practice')!, null, []);
        const negotiation = faqs[faqs.length - 1];
        expect(negotiation.a).toContain(STAT_SOURCES.fullPracticeStates.formatted);
    });
});

describe('P1 #7 — credential truth: CRNAs and CNMs are never rendered as the niche role', () => {
    /** APRN roles that are NOT the board's niche role. */
    const NON_NICHE_SLUGS = ['anesthesia', 'midwifery'] as const;
    const live = { avgSalary: 141000, minSalary: 98000, maxSalary: 210000, jobCount: 17 };
    const topStates = [
        { state: 'California', stateCode: 'CA', slug: 'california', avgSalary: 165000, jobCount: 6 },
        { state: 'Washington', stateCode: 'WA', slug: 'washington', avgSalary: 158000, jobCount: 4 },
        { state: 'New Jersey', stateCode: 'NJ', slug: 'new-jersey', avgSalary: 151000, jobCount: 3 },
    ];

    it('the config flags them non-niche and forces them to carry a credential', () => {
        for (const slug of NON_NICHE_SLUGS) {
            const page = getSpecialtySalaryPage(slug)!;
            expect(page.isNicheRole, slug).toBe(false);
            expect(page.credential, slug).toBeTruthy();
        }
        // …and every other entry is a genuine niche specialty.
        for (const page of SALARY_SPECIALTY_PAGES) {
            if ((NON_NICHE_SLUGS as readonly string[]).includes(page.slug)) continue;
            expect(page.isNicheRole, page.slug).toBe(true);
        }
    });

    it('group nouns use the credential for non-niche roles, the label otherwise', () => {
        expect(specialtyNoun(getSpecialtySalaryPage('anesthesia')!)).toBe('CRNA');
        expect(specialtyNounPlural(getSpecialtySalaryPage('anesthesia')!)).toBe('CRNAs');
        expect(specialtyNoun(getSpecialtySalaryPage('midwifery')!)).toBe('CNM');
        expect(specialtyNounPlural(getSpecialtySalaryPage('midwifery')!)).toBe('CNMs');
        expect(specialtyNounPlural(getSpecialtySalaryPage('family-practice')!))
            .toBe(`Family Practice ${brand.niche.short}s`);
        expect(specialtyNounPlural(getSpecialtySalaryPage('hospitalist')!))
            .toBe(`Hospitalist ${brand.niche.short}s`);
    });

    it('no FAQ — and so no FAQPage entry — calls them by the niche noun', () => {
        for (const slug of NON_NICHE_SLUGS) {
            const page = getSpecialtySalaryPage(slug)!;
            for (const args of [[null, []], [live, topStates]] as const) {
                const joined = buildSpecialtyFaqs(page, args[0], args[1])
                    .map((f) => `${f.q} ${f.a}`)
                    .join(' ');
                // "Nurse Anesthetist NPs" / "Nurse Midwife NPs" — the defect.
                expect(joined, slug).not.toContain(`${page.label} ${brand.niche.short}`);
                // …and no "CRNA NP" variant either.
                expect(joined, slug).not.toMatch(
                    new RegExp(`\\b${page.credential} ${brand.niche.short}s?\\b`),
                );
            }
        }
    });

    it('the cited median is disclosed as an excluding benchmark on non-niche pages', () => {
        for (const slug of NON_NICHE_SLUGS) {
            const page = getSpecialtySalaryPage(slug)!;
            const sentence = medianSentence(page);
            expect(sentence).toContain(STAT_SOURCES.averageSalary.formatted);
            expect(sentence, slug).toMatch(/does not include them/);
            // The headline pay FAQ leads with that disclosure and, with no
            // live inventory, quotes no other dollar figure at all.
            const faq = buildSpecialtyFaqs(page, null, [])[0];
            expect(faq.a.startsWith(sentence), slug).toBe(true);
            expect(faq.a.match(/\$[\d,]+K?/g)).toEqual([STAT_SOURCES.averageSalary.formatted]);
        }
        // On a niche page the median is the page's own cohort figure.
        const fp = getSpecialtySalaryPage('family-practice')!;
        expect(medianSentence(fp)).not.toMatch(/does not include/);
        expect(medianSentence(fp)).toContain(`all ${brand.niche.short}s`);
    });

    it('the templates render group nouns through the helpers, never label + niche token', () => {
        // specialtyNoun() is the ONE sanctioned place that may compose
        // `label + niche token`, because it only does so for niche roles.
        const HELPER_MODULE = 'app/salary-guide/specialty/specialty-content.ts';
        for (const rel of PACKAGE_FILES) {
            const src = read(rel);
            expect(src, `${rel} composes label + niche token in JSX`).not.toMatch(
                /\{page\.label\}\s*\{brand\.niche\.short\}/,
            );
            const composed = src.match(/\$\{page\.label\}\s+\$\{(?:brand\.niche\.short|short)\}/g) ?? [];
            expect(composed.length, `${rel} composes label + niche token`).toBe(
                rel === HELPER_MODULE ? 1 : 0,
            );
        }
        const detail = read('app/salary-guide/specialty/[specialty]/page.tsx');
        // Top-states heading, certification heading and CTA all go through them.
        expect(detail).toContain('Top-Paying States for {nounPlural}');
        expect(detail).toContain('Certification & Where {nounPlural} Work');
        expect(detail).toContain('Find {specialtyNoun(page)} Jobs');
        // The hero and the Article description share one median sentence.
        expect(detail).toContain('medianSentenceParts(page)');
        expect(detail).toContain('medianSentence(page)');
    });
});

describe('P1 #7 — niche-copy ratchet: new files carry zero reference-niche literals', () => {
    it.each(PACKAGE_FILES)('%s has no reference-niche terms', (rel) => {
        const src = read(rel);
        for (const re of TEMPLATE_REFERENCE_NICHE_TERMS) {
            const matches = src.match(re) ?? [];
            expect(matches, `${rel} contains ${re}: ${matches.join(', ')}`).toHaveLength(0);
        }
    });
});

describe('P1 #7 — wiring: hub links, sitemap entries, page plumbing', () => {
    it('the hub premium table links into the specialty silo from the shared config', () => {
        const src = read('app/salary-guide/page.tsx');
        expect(src).toContain("from '@/app/salary-guide/specialty/specialty-config'");
        expect(src).toContain('/salary-guide/specialty/');
        // The psych row's slug comes from the registry constant, not a literal.
        expect(src).toContain('slug: PSYCH_SPECIALTY_SLUG');
        // …and the index hub itself is reachable from the national guide.
        expect(src).toContain('href="/salary-guide/specialty"');
    });

    it('the sitemap advertises the specialty pages from the same config array', () => {
        const src = read('app/sitemap.ts');
        expect(src).toContain("from '@/app/salary-guide/specialty/specialty-config'");
        expect(src).toContain('SALARY_SPECIALTY_SLUGS.map');
        expect(src).toContain('/salary-guide/specialty');
        // Included in both the healthy and the degraded-mode (catch) sitemap.
        expect(src.match(/\.\.\.salarySpecialtyPages,/g)?.length).toBe(2);
    });

    it('the specialty page escapes JSON-LD and sets a canonical', () => {
        const src = read('app/salary-guide/specialty/[specialty]/page.tsx');
        expect(src).toContain('\\\\u003c'); // repo JSON-LD escape pattern
        expect(src).toContain('alternates: { canonical: url }');
        expect(src).toContain('/api/og?title='); // OG via the board's own edge route
        expect(src).toContain('generateStaticParams');
        // Live sections must gate on the floors — never render $0 shells.
        expect(src).toContain('MIN_LIVE_JOBS');
        expect(src).toContain('MIN_STATE_JOBS');
        // No fabricated freshness (B54): Article schema must not stamp dates.
        expect(src).not.toContain('dateModified');
        expect(src).not.toContain('datePublished');
    });

    it('state-eligible specialties can deep-link /jobs/<cat>/<state>', () => {
        // The page links category-state spokes only for registry-eligible slugs;
        // sanity-check the two axes agree for at least the core specialties.
        for (const slug of ['family-practice', 'acute-care', 'anesthesia', 'midwifery']) {
            expect(SALARY_SPECIALTY_SLUGS).toContain(slug);
            expect(STATE_ELIGIBLE_CATEGORY_SLUGS).toContain(slug);
        }
    });
});
