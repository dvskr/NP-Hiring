/**
 * P2 pSEO-parity package — content-gap synthesis 2026-07-29.
 *
 *   #7  Shortage claims: the only per-city shortage column the repo holds is
 *       the donor board's BEHAVIORAL-HEALTH-discipline HRSA HPSA flag
 *       (`CityData.mentalHealthShortage`). There is no primary-care HPSA
 *       column, so no pSEO surface may present it as an all-NP shortage
 *       figure — every label, meta sentence, FAQ answer and OG param must
 *       name the discipline or withhold the claim.
 *
 *   #8  APRN qualification FAQ: the category×city template asserted
 *       "National board certification (ANCC or AANP)" for all 42 categories.
 *       CRNAs certify through the NBCRNA and CNMs through the AMCB; the
 *       population tracks use PNCB / NCC / AACN. Wrong in the visible answer
 *       AND in its FAQPage schema (one array feeds both — B52).
 *
 *   #15 Maturity parity: formatStatsBadge, the pseoStats staleness guard, and
 *       the Speakable / sources / Place-family schema the city template
 *       carries were missing from the ~663 setting×state pages.
 *
 *   #19 Both pSEO templates emitted BreadcrumbList JSON-LD with no visible,
 *       linked breadcrumb trail.
 *
 *   P3 #13 en-dash salary split: `salaryRange.split('–')` used an EN DASH
 *       while every salaryRange literal is written with an ASCII hyphen, so
 *       the hero fallback rendered a whole range under an "avg salary" label.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    formatStatsBadge,
    getCategoryCredentials,
    ALL_CATEGORY_CONFIGS,
} from '@/lib/pseo/category-city-template';
import { getCategoryFaqs, type CategorySlug } from '@/lib/pseo/category-faq-data';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source with comments stripped. The fixes below are documented by comments
 * that deliberately QUOTE the removed code ("this used to be
 * salaryRange.split('–')"), so "the old code is gone" assertions have to look
 * at code only — otherwise the explanation would fail the test it explains.
 */
const readCode = (rel: string): string =>
    read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

const CITY_TEMPLATE = 'lib/pseo/category-city-template.tsx';
const STATE_TEMPLATE = 'lib/pseo/setting-state-template.tsx';
const CITY_TYPES = 'lib/pseo/city-data/types.ts';

const answersFor = (category: CategorySlug): string =>
    getCategoryFaqs({ category, totalJobs: 7 })
        .map((f) => `${f.question} ${f.answer}`)
        .join('\n');

// ─── #7 — shortage claims name their discipline ─────────────────────────────

describe('P2 #7 — no pSEO surface implies an all-NP shortage figure', () => {
    it('the state stat card no longer ships the unexplained "MH Shortage Areas" label', () => {
        const code = readCode(STATE_TEMPLATE);
        expect(code).not.toContain('MH Shortage Areas');
        expect(code).toContain('Behavioral-Health HPSA');
    });

    it('the city template makes no unqualified "health professional shortage area" claim', () => {
        const code = readCode(CITY_TEMPLATE);
        // The old meta sentence and the old FAQ sentence, both of which read
        // as an all-NP shortage designation.
        expect(code).not.toContain("'Health professional shortage area.'");
        expect(code).not.toContain('is a federally designated Health Professional Shortage Area (HPSA), meaning there is high demand');
        expect(code).not.toContain('>Shortage</div>');
    });

    it('every HPSA claim in the templates is discipline-qualified', () => {
        for (const rel of [CITY_TEMPLATE, STATE_TEMPLATE]) {
            const hpsaLines = readCode(rel)
                .split('\n')
                .filter((line) => /HPSA|Health Professional Shortage/i.test(line))
                // A bare pointer to HRSA's lookup tool asserts nothing about
                // this city, so it needs no discipline qualifier.
                .filter((line) => !line.includes('hpsa.hrsa.gov'));
            expect(hpsaLines.length, `${rel} should still surface the designation`).toBeGreaterThan(0);
            for (const line of hpsaLines) {
                expect(line, `${rel}: HPSA claim must name its discipline → ${line.trim()}`)
                    .toMatch(/behavioral[- ]health/i);
            }
        }
    });

    it('the shortage column documents that it is NOT primary-care data', () => {
        const src = read(CITY_TYPES);
        expect(src).toMatch(/NOT an all-NP or primary-care shortage signal/);
        // Names the concrete data that would be needed to fix it properly.
        expect(src).toContain('primaryCareShortage');
        expect(src).toContain('data.hrsa.gov');
    });

    it('the national shortage stat stays sourced to stats-sources, not this column', () => {
        // lib/stats-sources.ts already re-sourced hrsaShortagePopulation to
        // primary care; the templates must not conflate the two.
        const src = read('lib/stats-sources.ts');
        expect(src).toContain('hrsaShortagePopulation');
        expect(src).toMatch(/primary care/i);
    });
});

// ─── #8 — certification bodies are correct per specialty ────────────────────

describe('P2 #8 — qualification FAQ names the right certifying body', () => {
    it('CRNA certification routes through the NBCRNA, not AANP/ANCC', () => {
        const creds = getCategoryCredentials('anesthesia');
        expect(creds.role).toBe('CRNA');
        expect(creds.certification).toContain('NBCRNA');
        expect(creds.certification).not.toMatch(/AANP|ANCC/);
        expect(creds.degree).toContain('Council on Accreditation');
    });

    it('CNM certification routes through the AMCB, not AANP/ANCC', () => {
        const creds = getCategoryCredentials('midwifery');
        expect(creds.role).toBe('CNM');
        expect(creds.certification).toContain('American Midwifery Certification Board (AMCB)');
        expect(creds.certification).not.toMatch(/AANP|ANCC/);
        expect(creds.degree).toContain('Accreditation Commission for Midwifery Education');
    });

    it('population-track categories use their own boards', () => {
        expect(getCategoryCredentials('pediatric').certification).toContain('Pediatric Nursing Certification Board (PNCB)');
        expect(getCategoryCredentials('neonatal').certification).toContain('National Certification Corporation (NCC)');
        expect(getCategoryCredentials('women-health').certification).toContain('National Certification Corporation (NCC)');
        expect(getCategoryCredentials('clinical-nurse-specialist').certification).toContain('AACN');
        expect(getCategoryCredentials('acute-care').certification).toContain('AACN');
        // AANP administers no acute-care exam.
        expect(getCategoryCredentials('acute-care').certification).not.toContain('AANP');
    });

    it('NP categories keep the AANP/ANCC answer', () => {
        for (const slug of ['remote', 'family-practice', 'primary-care', 'telehealth']) {
            expect(getCategoryCredentials(slug).certification, slug).toContain('AANP or ANCC');
        }
    });

    it('every category resolves to a credential set with a non-empty body', () => {
        for (const slug of Object.keys(ALL_CATEGORY_CONFIGS)) {
            const creds = getCategoryCredentials(slug);
            expect(creds.certification.length, slug).toBeGreaterThan(20);
            expect(creds.role.length, slug).toBeGreaterThan(1);
        }
    });

    it('the template no longer hardcodes one certification body for all categories', () => {
        const src = read(CITY_TEMPLATE);
        expect(src).not.toContain('National board certification (ANCC or AANP)');
        // The FAQ answer is built from the per-category facts.
        expect(src).toMatch(/credentials\.certification/);
    });

    it('category-faq-data carries no cert-body error for the APRN cohort', () => {
        const crna = answersFor('anesthesia');
        expect(crna).toContain('NBCRNA');
        expect(crna).not.toMatch(/\bAANP\b|\bANCC\b/);

        const cnm = answersFor('midwifery');
        expect(cnm).toContain('AMCB');
        expect(cnm).not.toMatch(/\bAANP\b|\bANCC\b/);

        expect(answersFor('pediatric')).toContain('PNCB');
        expect(answersFor('neonatal')).toContain('National Certification Corporation');
        expect(answersFor('women-health')).toContain('National Certification Corporation');
        expect(answersFor('acute-care')).toContain('AACN');
        expect(answersFor('clinical-nurse-specialist')).toContain('AACN');
    });
});

// ─── #8b — practice-authority answer branches on the real union ─────────────

describe('P2 #8b — practice-authority FAQ no longer tells every state it is restricted', () => {
    it('the dead String(authority).includes("Full") test is gone', () => {
        const code = readCode(CITY_TEMPLATE);
        // authority is the lowercase union 'full' | 'reduced' | 'restricted',
        // so these tests were permanently false.
        expect(code).not.toContain("includes('Full')");
        expect(code).not.toContain("includes('Reduced')");
        expect(code).toMatch(/practiceAuthority\.authority === 'full'/);
        expect(code).toMatch(/practiceAuthority\.authority === 'reduced'/);
    });

    it('the raw union member is never rendered as user-facing text', () => {
        const code = readCode(CITY_TEMPLATE);
        expect(code).not.toMatch(/\{practiceAuthority\.authority\}<\/span>/);
        expect(code).toContain('getAuthorityLabel(practiceAuthority.authority)');
    });
});

// ─── #15 — state template reaches city-template maturity ───────────────────

describe('P2 #15 — setting-state template has parity with the city template', () => {
    const src = () => read(STATE_TEMPLATE);

    it('the hero badge derives freshness from statsAsOf', () => {
        expect(src()).toMatch(/badgeText=\{formatStatsBadge\(/);
        expect(src()).not.toMatch(/badgeText=\{`\$\{stats\.totalJobs\} live roles/);
    });

    it('formatStatsBadge is shared, not copied', () => {
        // Matched as a BINDING in the city-template import, not as an exact
        // line: the same import also carries the P2 #7 gate predicate, and
        // pinning the literal line makes every future shared helper look like
        // a regression.
        expect(src()).toMatch(
            /import \{[^}]*\bformatStatsBadge\b[^}]*\} from '\.\/category-city-template'/,
        );
        // Exactly one implementation across the two templates.
        const impls = [read(CITY_TEMPLATE), src()]
            .join('\n')
            .match(/function formatStatsBadge\(/g) ?? [];
        expect(impls).toHaveLength(1);
    });

    it('cached pseoStats rows are staleness-gated before use', () => {
        expect(src()).toContain('PSEO_STALENESS_MS');
        expect(src()).toMatch(/updatedAt\.getTime\(\) <= PSEO_STALENESS_MS/);
        expect(src()).toContain('statsAsOf');
    });

    it('emits Speakable + geography schema with selectors that exist', () => {
        expect(src()).toContain('SpeakableSpecification');
        expect(src()).toContain("'@type': 'State'");
        expect(src()).toContain('id="answer-summary"');
        // Only declared selectors that are actually rendered on this page.
        const speakable = src().match(/cssSelector: \[([^\]]*)\]/);
        expect(speakable).not.toBeNull();
        expect(speakable![1]).toContain('#answer-summary');
        expect(speakable![1]).not.toContain('.faq-answer');
    });

    it('carries a sources line for the stats it renders', () => {
        expect(src()).toMatch(/Sources: \{STAT_SOURCES\.fullPracticeStates\.source\}/);
    });

    it('JSON-LD built from aggregator-sourced strings is escaped (B29)', () => {
        for (const rel of [CITY_TEMPLATE, STATE_TEMPLATE]) {
            const code = read(rel);
            const itemList = code.slice(code.indexOf("'@type': 'ItemList'"));
            expect(itemList.slice(0, 900), rel).toContain("replace(/</g, '\\\\u003c')");
        }
    });

    it('formatStatsBadge only claims "updated today" when the data is from today', () => {
        expect(formatStatsBadge(5, new Date())).toBe('5 live roles · updated today');
        expect(formatStatsBadge(5, null)).toBe('5 live roles · updated today');

        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const stale = formatStatsBadge(5, tenDaysAgo);
        expect(stale).toContain('5 live roles · updated ');
        expect(stale).not.toContain('updated today');
    });
});

// ─── #19 — visible breadcrumbs, single schema graph ────────────────────────

describe('P2 #19 — pSEO templates render visible, linked breadcrumbs', () => {
    it.each([CITY_TEMPLATE, STATE_TEMPLATE])('%s renders <Breadcrumbs> from one items array', (rel) => {
        const src = read(rel);
        expect(src).toContain("import Breadcrumbs from '@/components/Breadcrumbs'");
        expect(src).toContain('<Breadcrumbs items={breadcrumbItems} />');
        expect(src).toMatch(/const breadcrumbItems = \[/);
    });

    it.each([CITY_TEMPLATE, STATE_TEMPLATE])('%s emits exactly one BreadcrumbList graph', (rel) => {
        const src = read(rel);
        // Breadcrumbs already emits BreadcrumbList JSON-LD; rendering
        // BreadcrumbSchema as well would duplicate it.
        expect(src).not.toMatch(/<BreadcrumbSchema/);
        expect(src).not.toMatch(/^import BreadcrumbSchema/m);
        // And the hero's unlinked span trail is suppressed so the page has a
        // single Breadcrumb landmark.
        expect(src).toContain('breadcrumbs={[]}');
    });

    it('the Breadcrumbs component still derives its schema from the visible items', () => {
        const src = read('components/Breadcrumbs.tsx');
        expect(src).toContain("'@type': 'BreadcrumbList'");
        expect(src).toMatch(/items\.map\(\(item, index\)/);
        expect(src).toContain('aria-label="Breadcrumb"');
        // B29 escaping on the schema payload.
        expect(src).toContain("replace(/</g, '\\\\u003c')");
    });
});

// ─── P3 #13 — en-dash salary split ─────────────────────────────────────────

describe('P3 #13 — hero salary stat no longer depends on an en-dash split', () => {
    it('neither template splits salaryRange', () => {
        for (const rel of [CITY_TEMPLATE, STATE_TEMPLATE]) {
            expect(readCode(rel), rel).not.toMatch(/salaryRange\.split\(/);
        }
    });

    it('the fallback renders the whole band under a band label', () => {
        for (const rel of [CITY_TEMPLATE, STATE_TEMPLATE]) {
            expect(readCode(rel), rel).toMatch(/\{ value: config\.salaryRange, label: 'typical range' \}/);
        }
    });

    it('every salaryRange literal is a parseable ASCII-hyphen band', () => {
        for (const config of Object.values(ALL_CATEGORY_CONFIGS)) {
            expect(config.salaryRange, config.slug).not.toContain('–');
            expect(config.salaryRange, config.slug).not.toContain('—');
            expect(config.salaryRange, config.slug).toMatch(/^\$[\d.]+K?-\$?[\d.]+K?\+?(\/hr)?$/);
        }
    });
});
