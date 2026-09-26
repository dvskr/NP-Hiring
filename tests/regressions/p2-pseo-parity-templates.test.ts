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
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { getPracticeEnvironment } from '@/lib/pseo/practice-environment';
import {
    buildPracticingInStateParagraph,
    buildSettingStateFaqs,
} from '@/lib/pseo/listing-narrative';
import { emptyListingFacts } from '@/lib/pseo/listing-facts';
import { isPseoStatsFresh, PSEO_STATS_MAX_AGE_HOURS } from '@/lib/pseo/render-gate';

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
// Where the thin-content program moved the practice-authority copy (PLAN C.4,
// CS-S6 and CITY-C6): one read model, one set of sentence builders, one card.
const PRACTICE_CARD = 'components/seo/pseo/PracticeCard.tsx';
const PRACTICE_ENV = 'lib/pseo/practice-environment.ts';
const LISTING_NARRATIVE = 'lib/pseo/listing-narrative.ts';

/** Split source on either line ending: the worktree checks out CRLF. */
const LINE_BREAK = /\r?\n/;

const answersFor = (category: CategorySlug): string =>
    getCategoryFaqs({ category, totalJobs: 7 })
        .map((f) => `${f.question} ${f.answer}`)
        .join('\n');

// ─── #7 — shortage claims name their discipline ─────────────────────────────

describe('P2 #7 — no pSEO surface implies an all-NP shortage figure', () => {
    it('the state stat card ships no shortage designation at all', () => {
        const code = readCode(STATE_TEMPLATE);
        // The label was fixed twice: first from an unexplained "MH Shortage
        // Areas" count to a discipline-qualified "Behavioral-Health HPSA"
        // card, and now away altogether. PLAN C.1 T0-4 retires the donor
        // column because no source file survives for it, so the card, the
        // count it summed, and the HRSA credit in the sources note all go
        // together. Withholding the claim satisfies #7 strictly more than
        // qualifying it did, so the pin is the absence.
        expect(code).not.toContain('MH Shortage Areas');
        expect(code).not.toContain('Behavioral-Health HPSA');
        expect(code).not.toMatch(/HPSA|Health Professional Shortage/i);
        // And the template reads the donor column nowhere, so there is no
        // value left to relabel.
        expect(code).not.toMatch(/mentalHealthShortage/);
    });

    it('the city template makes no unqualified "health professional shortage area" claim', () => {
        const code = readCode(CITY_TEMPLATE);
        // The old meta sentence and the old FAQ sentence, both of which read
        // as an all-NP shortage designation.
        expect(code).not.toContain("'Health professional shortage area.'");
        expect(code).not.toContain('is a federally designated Health Professional Shortage Area (HPSA), meaning there is high demand');
        expect(code).not.toContain('>Shortage</div>');
    });

    it('neither template states an HPSA designation for a reader to mis-scope', () => {
        for (const rel of [CITY_TEMPLATE, STATE_TEMPLATE]) {
            const hpsaLines = readCode(rel)
                .split(LINE_BREAK)
                .filter((line) => /HPSA|Health Professional Shortage/i.test(line))
                // A bare pointer to HRSA's lookup tool asserts nothing about
                // this city, so it needed no discipline qualifier then and
                // survives the removal for the same reason.
                .filter((line) => !line.includes('hpsa.hrsa.gov'));
            // Was: at least one line, each naming its discipline. T0-4
            // withdrew the claim rather than qualifying it, which is the
            // stronger form of the same rule, so the pin is the empty list.
            expect(hpsaLines, `${rel} must state no designation`).toEqual([]);
        }
        // The pointer exemption is not a hole. Exactly one line uses it, it is
        // the NHSC tip, and it names no city and no designation, so a claim
        // cannot ride along on the URL that excuses the line.
        const pointers = readCode(CITY_TEMPLATE)
            .split(LINE_BREAK)
            .map((line) => line.trim())
            .filter((line) => line.includes('hpsa.hrsa.gov'));
        expect(pointers).toEqual([
            "'Check NHSC loan repayment eligibility for your site (hpsa.hrsa.gov)',",
        ]);
        expect(readCode(STATE_TEMPLATE)).not.toContain('hpsa.hrsa.gov');
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
    // Two defects, one cause: `String(authority).includes('Full')` tested the
    // lowercase union 'full' | 'reduced' | 'restricted' against a Title Case
    // literal, so it was permanently false and every state inherited the
    // restricted sentence; a second surface rendered the raw union member as
    // the chip text ("reduced").
    //
    // PLAN C.4 (CS-S6, CITY-C6) moved both surfaces out of the city template:
    // the sentences are built in lib/pseo/listing-narrative.ts from the
    // lib/pseo/practice-environment.ts read model, and the card is the shared
    // components/seo/pseo/PracticeCard.tsx. The invariant did not move with
    // them, so these cases follow it to its new home, and assert it on the
    // output rather than on a source literal: a behavioural pin cannot be
    // satisfied by a branch that is present but never taken, which is exactly
    // how the original bug survived review.
    const envFor = (stateName: string) => {
        const env = getPracticeEnvironment(stateName);
        expect(env, stateName).not.toBeNull();
        return env!;
    };

    it('each AANP tier gets its own sentence, so no state inherits another tier', () => {
        const tiers = [
            ['full', 'Arizona', 'AANP classifies Arizona as a full practice state.'],
            ['reduced', 'New Jersey', 'AANP classifies New Jersey as a reduced practice state.'],
            ['restricted', 'Texas', 'AANP classifies Texas as a restricted practice state.'],
        ] as const;
        const paragraphs = tiers.map(([tier, stateName, label]) => {
            const env = envFor(stateName);
            expect(env.authority, stateName).toBe(tier);
            const paragraph = buildPracticingInStateParagraph(env);
            expect(paragraph, stateName).toContain(label);
            return paragraph;
        });
        // Three tiers, three distinct paragraphs. The defect's signature was
        // all three collapsing onto the restricted branch.
        expect(new Set(paragraphs).size).toBe(3);
        // Keyed on the restricted tier name and on the rule the old
        // getAuthorityLabel('restricted') text carried: Arizona's details
        // legitimately say "without physician supervision".
        expect(paragraphs[0]).not.toMatch(/Restricted Practice|Physician Supervision Required/i);
        expect(paragraphs[1]).not.toMatch(/Restricted Practice/i);
    });

    it('the dead Title Case membership tests are gone from every surface that took them', () => {
        for (const rel of [CITY_TEMPLATE, STATE_TEMPLATE, PRACTICE_CARD, PRACTICE_ENV, LISTING_NARRATIVE]) {
            const code = readCode(rel);
            expect(code, rel).not.toContain("includes('Full')");
            expect(code, rel).not.toContain("includes('Reduced')");
            expect(code, rel).not.toContain('includes("Full")');
        }
    });

    it('the raw union member is never rendered as user-facing text', () => {
        // The tier reaches the DOM only through a mapped label. It survives as
        // a lookup KEY (PracticeCard indexes its chip fill by it), which
        // publishes nothing, so the pin is on interpolation into JSX.
        for (const rel of [CITY_TEMPLATE, STATE_TEMPLATE, PRACTICE_CARD]) {
            expect(readCode(rel), rel).not.toMatch(/\{[A-Za-z][\w.!]*\.authority\}/);
        }
        expect(readCode(PRACTICE_CARD)).toContain('chip={env.authorityLabel}');
        for (const stateName of ['Arizona', 'New Jersey', 'Texas']) {
            const env = envFor(stateName);
            const labels = {
                authorityLabel: env.authorityLabel,
                authorityDescription: env.authorityDescription,
                authorityShort: env.authorityShort,
            };
            for (const [field, text] of Object.entries(labels)) {
                expect(text, `${stateName}.${field}`).not.toBe(env.authority);
                expect(text.length, `${stateName}.${field}`).toBeGreaterThan(env.authority.length);
            }
        }
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
        // The local PSEO_STALENESS_MS constant and its inline comparison are
        // gone. PLAN C.2 routes every index decision through the one pure
        // module, lib/pseo/render-gate.ts, so a sitemap URL can never be one
        // the page renders noindex; the freshness window is part of that
        // decision, so it is now one exported constant that nobody re-declares.
        expect(src()).toMatch(/from '\.\/render-gate'/);
        expect(src()).toMatch(/isPseoStatsFresh\(stored\.updatedAt, now\)/);
        expect(src()).toContain('pseoStatsFreshnessThreshold()');
        expect(src()).toContain('statsAsOf');
        expect(src()).not.toContain('PSEO_STALENESS_MS');
        // The gate still bites, which the old source grep never checked: a row
        // inside the window is usable, one outside it is not.
        const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000);
        expect(isPseoStatsFresh(hoursAgo(1))).toBe(true);
        expect(isPseoStatsFresh(hoursAgo(PSEO_STATS_MAX_AGE_HOURS + 1))).toBe(false);
    });

    it('emits Speakable + geography schema with selectors that exist', () => {
        expect(src()).toContain('SpeakableSpecification');
        expect(src()).toContain("'@type': 'State'");
        expect(src()).toContain('id="answer-summary"');
        // Only declared selectors that are actually rendered on this page.
        // #answer-summary is unconditional, so it is declared unconditionally.
        const speakable = src().match(/cssSelector: ([\s\S]{0,240}?),\r?\n/);
        expect(speakable).not.toBeNull();
        expect(speakable![1]).toContain('#answer-summary');

        // P4: '.faq-answer' was BANNED here through P2 because this page's FAQ
        // (components/CategoryFAQ → CategoryFAQAccordion) rendered its answer
        // <p> without the class, so declaring the selector would have pointed
        // Speakable at nothing. P3 added `className="faq-answer"` to that <p>
        // (pinned by tests/regressions/p3-donor-followups-narrative-truth.test.ts).
        //
        // The class existing is NECESSARY BUT NOT SUFFICIENT, and a first pass
        // at this inversion missed that: <CategoryFAQ> returns null outright
        // when getCategoryFaqs() is empty, so on a faqCategory with no
        // CATEGORY_FAQS entry the accordion — and every .faq-answer in it —
        // is absent no matter what class the <p> would have carried. Declaring
        // the selector unconditionally therefore re-created the exact false
        // claim this test exists to forbid. The rule was never "never declare
        // .faq-answer"; it is "never declare a selector this page does not
        // render", and that is what is pinned here.
        expect(read('components/CategoryFAQAccordion.tsx')).toContain('className="faq-answer"');
        // The .faq-answer branch must be GATED, not unconditional...
        expect(speakable![1]).toMatch(/\?[\s\S]*'\.faq-answer'/);
        // ...on the same array the renderer hands to the band. The gate used
        // to be a second getCategoryFaqs() call, which could drift from the
        // one the renderer made; CS-S9 feeds the band from a single array
        // (buildSettingStateFaqs), so the selector and the render now read one
        // variable and cannot disagree. That is the invariant, tightened.
        expect(src()).toMatch(/const rendersFaqAnswers = stateFaqs\.length > 0/);
        expect(src()).toMatch(/cssSelector: rendersFaqAnswers/);
        expect(src()).toMatch(/\{rendersFaqAnswers && \(/);
        expect(src()).toMatch(/customFaqs=\{stateFaqs\}/);
    });

    it('the Speakable FAQ gate is load-bearing: the band can still come out empty', () => {
        // If this ever becomes impossible the gate is dead weight and can be
        // dropped, but while the builder can return nothing, an unconditional
        // '.faq-answer' selector is a false claim on 51 URLs per affected
        // category.
        //
        // The gate's INPUT changed with CS-S9: it used to be the category-
        // generic CATEGORY_FAQS list, so the old proof counted state-eligible
        // slugs with no entry in it. The template no longer reads that list at
        // all, which would have left this case passing while testing nothing,
        // so it now drives the builder the template actually calls. Every one
        // of its four questions is conditional on data the scope may not have.
        const barren = buildSettingStateFaqs({
            label: 'Inpatient',
            stateName: 'Texas',
            slug: 'inpatient',
            facts: emptyListingFacts(new Date('2026-09-16T12:00:00Z')),
            physicianAnswer: null,
            nlcAnswer: null,
        });
        expect(barren).toEqual([]);
        // Every state-eligible slug must at least HAVE a config: the template
        // notFound()s otherwise, which would 404 all 51 of its state pages.
        for (const slug of STATE_ELIGIBLE_CATEGORY_SLUGS) {
            expect(SETTING_CONFIGS[slug], slug).toBeDefined();
        }
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
    // The band this defect split on is retired outright (thin plan T0-3):
    // CategoryConfig carries no salaryRange field, neither template reads one,
    // and every pay figure comes from the gated helpers in
    // lib/salary-analytics.ts with its BLS cite. The successor rule lives in
    // tests/regressions/pseo-no-static-salary.test.ts, which also forbids new
    // hand-typed literals; these cases pin the removal itself.
    it('neither template reads a salaryRange band', () => {
        for (const rel of [CITY_TEMPLATE, STATE_TEMPLATE]) {
            expect(readCode(rel), rel).not.toMatch(/salaryRange/);
        }
    });

    it('no category config carries a band field', () => {
        for (const config of Object.values(ALL_CATEGORY_CONFIGS)) {
            expect(config, config.slug).not.toHaveProperty('salaryRange');
        }
    });
});
