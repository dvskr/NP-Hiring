/**
 * P3 donor follow-ups — the four defects P2 found but did not own.
 *
 *  1. lib/state-practice-authority.ts — the `details` prose was donor-niche
 *     verbatim ("PMHNPs in Alaska can practice independently…") and ships on
 *     the Practice Authority card of every /jobs/{setting}/{state} page, in
 *     the body prose AND the FAQPage JSON-LD of the 51 /jobs/state/{state}
 *     hubs, on /resources/fpa-guide and in the licensure checker. The strings
 *     are now derived from brand.niche with the legal substance untouched.
 *
 *  2. lib/pseo/state-narrative.ts + 3. lib/pseo/city-narrative.ts — both
 *     asserted that HPSA-designated areas mean positions "typically qualify
 *     for NHSC Loan Repayment". NHSC LRP is discipline-matched and paid per
 *     NHSC-APPROVED SITE, so no city/metro-level fact establishes that a
 *     posting qualifies; and the shortage input is the donor board's
 *     BEHAVIORAL-HEALTH HPSA column, so the negative branch ("not currently
 *     federally designated…") was the same falsehood inverted. Both sentences
 *     were rewritten, and the designation is now gated to the one category
 *     the discipline describes.
 *
 *  4. components/CategoryFAQAccordion.tsx — the answer <p> now carries
 *     `faq-answer`, the Speakable hook every other FAQ surface uses.
 *
 *  5. components/CategoryHero.tsx — `badgeText` was required, passed by ~30
 *     call sites, and never rendered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// category-city-template.tsx reaches for prisma at module scope; we only want
// its pure gate predicate.
vi.mock('@/lib/prisma', () => ({
    prisma: {
        pseoStats: { findUnique: vi.fn(), findMany: vi.fn() },
        job: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    },
}));

import { brand } from '@/config/brand';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import {
    buildCityFacts,
    buildCityNarrative,
    buildTaxonomyCityNarrative,
    shortageColumnAppliesTo,
} from '@/lib/pseo/city-narrative';
import { buildSettingStateNarrative } from '@/lib/pseo/state-narrative';
import { categoryOwnsShortageData, formatStatsBadge } from '@/lib/pseo/category-city-template';
import { buildLiveRolesBadge } from '@/lib/pseo/listing-narrative';
import { stripUnverifiableFreshness } from '@/components/CategoryHero';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CategoryFAQAccordion from '@/components/CategoryFAQAccordion';
import { getCityBySlug } from '@/lib/pseo/city-data/cities';
import { ALL_CATEGORY_SLUGS, PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';
import { scanNicheCopyDebt } from './brand-leak-scan';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Source with comments stripped — the fixes are documented by comments that
 *  deliberately quote the removed copy, so text assertions must see code only. */
const readCode = (rel: string): string =>
    read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

const AUTHORITY_FILE = 'lib/state-practice-authority.ts';
const CITY_NARRATIVE = 'lib/pseo/city-narrative.ts';
const STATE_NARRATIVE = 'lib/pseo/state-narrative.ts';
const FAQ_ACCORDION = 'components/CategoryFAQAccordion.tsx';
const HERO = 'components/CategoryHero.tsx';

/** A city that carries the donor behavioral-health flag, and one that does not. */
const FLAGGED_CITY = 'houston-tx';
const CLEAR_CITY = 'new-york-ny';
/** A category the behavioral-health designation does NOT describe. */
const OFF_TOPIC_CATEGORY = 'dermatology';

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── 1. practice-authority prose ────────────────────────────────────────────

describe('P3 #1 — practice-authority details are niche-token prose, not donor copy', () => {
    it("the file's only reference-niche term is Minnesota's statutory 'mental health services' clause", () => {
        // Baselined at 54 hits, so the ratchet could never catch this copy.
        // The donor copy is gone. The one remaining hit is the corrected
        // Minnesota entry quoting its statute's "other than primary care or
        // mental health services" setting rule, so it is pinned to that
        // string and no other entry may carry a reference-niche term.
        const debt = scanNicheCopyDebt({ root: ROOT });
        expect(debt[AUTHORITY_FILE] ?? 0).toBe(1);
        const hits = Object.entries(STATE_PRACTICE_AUTHORITY)
            .filter(([, i]) => /pmhnp|psychiatric|mental health/i.test(i.details))
            .map(([n]) => n);
        expect(hits).toEqual(['Minnesota']);
        expect(STATE_PRACTICE_AUTHORITY['Minnesota'].details)
            .toContain('other than primary care or mental health services');
    });

    it('every details string names the profession through the brand token', () => {
        for (const [name, info] of Object.entries(STATE_PRACTICE_AUTHORITY)) {
            expect(info.details, `${name}: details names no profession`)
                .toContain(brand.niche.short);
        }
    });

    it('details prose is built from the token, not hardcoded in source', () => {
        const code = readCode(AUTHORITY_FILE);
        expect(code).toContain("import { brand } from '@/config/brand'");
        expect(code).toContain('brand.niche.short');
        // Every details entry is a template literal referencing a token.
        // Object-literal entries only — the interface's `details: string;`
        // declaration ends in a semicolon, not a comma.
        const details = code.match(/^\s*details: .*,$/gm) ?? [];
        expect(details.length).toBe(51);
        for (const line of details) {
            expect(line, `details line hardcodes its subject → ${line.trim()}`)
                .toMatch(/\$\{NPS?\}/);
        }
    });

    it('the legal substance of each tier survived the rewrite', () => {
        // The profession wording moved, and the 2026-09 regulatory
        // corrections restated several entries in their statutes' own terms
        // (delegated act, practice agreement, exempt from the agreement), so
        // each tier accepts those terms; the tier language must still be
        // there, per tier.
        for (const [name, info] of Object.entries(STATE_PRACTICE_AUTHORITY)) {
            if (info.authority === 'full') {
                expect(info.details, `${name}: full tier lost its independence language`)
                    .toMatch(/independent|full practice|without a collaborative agreement|exempt from those requirements/i);
            }
            if (info.authority === 'reduced') {
                expect(info.details, `${name}: reduced tier lost its collaboration language`)
                    .toMatch(/collaborat/i);
            }
            if (info.authority === 'restricted') {
                expect(info.details, `${name}: restricted tier lost its supervision language`)
                    .toMatch(/supervis|delegated act|practice agreement/i);
            }
        }
    });

    it('still covers 51 jurisdictions with the same tier split', () => {
        const entries = Object.values(STATE_PRACTICE_AUTHORITY);
        expect(entries.length).toBe(51);
        const count = (tier: string) => entries.filter((i) => i.authority === tier).length;
        expect(count('full')).toBe(28);
        expect(count('reduced')).toBe(12);
        expect(count('restricted')).toBe(11);
    });

    // Broadening the subject from the donor board's single psych specialty to
    // nurse practitioners as a whole is only safe where the legal claim is
    // whole-cohort. Florida's is not: the 2020 autonomous-practice law carves
    // out primary care, and this string ships on /jobs/family-practice/florida
    // and /jobs/primary-care/florida — the carve-out's own cohort — plus the
    // /jobs/state/florida body prose and its FAQPage JSON-LD.
    it('Florida does not assert whole-cohort supervision over its primary-care carve-out', () => {
        const florida = STATE_PRACTICE_AUTHORITY['Florida'];
        expect(florida.authority, 'AANP still classifies the state environment restricted').toBe('restricted');
        expect(florida.details).toMatch(/supervis/i);
        // The qualifier, stated in the same terms lib/metro-data.ts uses.
        expect(florida.details).toMatch(/3,000\+? supervised hours/i);
        expect(florida.details).toMatch(/primary[- ]care/i);
        expect(florida.details).toMatch(/family medicine/i);
        expect(florida.details).toMatch(/general pediatrics/i);
        expect(florida.details).toMatch(/general internal medicine/i);
        // And the unqualified absolute the entry used to carry is gone.
        expect(florida.details).not.toMatch(/must work under a supervisory protocol/i);
    });

    // The two datasets describe the same law on the same routes, so pin them
    // to each other rather than to a prose heuristic. (A proximity scan over
    // metro-data was tried and is not usable as a ratchet: it flags California,
    // whose details string already carries its AB 890 qualifier, and Texas,
    // where the only nearby mention of autonomy is metro-data:576 DENYING that
    // Texas has a pathway.)
    it('Florida agrees with lib/metro-data.ts on the carve-out specialties', () => {
        const metro = read('lib/metro-data.ts');
        const details = STATE_PRACTICE_AUTHORITY['Florida'].details;
        for (const specialty of ['family medicine', 'general pediatrics', 'general internal medicine']) {
            expect(metro.toLowerCase(), `metro-data no longer documents ${specialty}`)
                .toContain(specialty);
            expect(details.toLowerCase(), `practice-authority details omits ${specialty}`)
                .toContain(specialty);
        }
        // Both datasets state the same hours threshold.
        expect(metro).toMatch(/3,000\+? supervised (clinical )?hours/i);
        expect(details).toMatch(/3,000\+? supervised hours/i);
    });
});

// ─── 2/3. the shortage + NHSC sentences ─────────────────────────────────────

describe('P3 #2/#3 — the shortage gate is shared with the city template', () => {
    it('shortageColumnAppliesTo agrees with categoryOwnsShortageData everywhere', () => {
        for (const slug of ALL_CATEGORY_SLUGS) {
            expect(shortageColumnAppliesTo(slug), slug)
                .toBe(categoryOwnsShortageData(slug));
        }
    });

    it('an absent or unknown category never owns the column', () => {
        expect(shortageColumnAppliesTo(undefined)).toBe(false);
        expect(shortageColumnAppliesTo('__no_such_category__')).toBe(false);
    });

    it('the behavioral-health slug is the one that does own it', () => {
        expect(PSYCH_SPECIALTY_SLUG).toBeDefined();
        expect(shortageColumnAppliesTo(PSYCH_SPECIALTY_SLUG!)).toBe(true);
        expect(OFF_TOPIC_CATEGORY).not.toBe(PSYCH_SPECIALTY_SLUG);
    });
});

describe('P3 #3 — city narrative makes no false designation claim in either polarity', () => {
    const flagged = () => buildCityFacts(getCityBySlug(FLAGGED_CITY)!);
    const clear = () => buildCityFacts(getCityBySlug(CLEAR_CITY)!);

    it('the fixtures still have the polarities this suite depends on', () => {
        expect(flagged().shortage).toBe(true);
        expect(clear().shortage).toBe(false);
    });

    it('the all-specialty city hub states no shortage or NHSC claim at all', () => {
        // /jobs/city/{slug} passes no category, so the behavioral-health
        // column is off topic by definition.
        for (const facts of [flagged(), clear()]) {
            const text = buildCityNarrative(facts, 12);
            expect(text).not.toMatch(/HPSA|Health Professional Shortage|NHSC|shortage area/i);
        }
    });

    it('an off-topic category never publishes the designation, flagged or not', () => {
        for (const facts of [flagged(), clear()]) {
            const text = buildTaxonomyCityNarrative(facts, OFF_TOPIC_CATEGORY, 12);
            expect(text).not.toMatch(/HPSA|Health Professional Shortage|NHSC|shortage area/i);
        }
    });

    it('neither branch asserts the city is NOT a designated shortage area', () => {
        // The old negative branch generalised a behavioral-health-only column
        // to every HRSA discipline.
        for (const facts of [flagged(), clear()]) {
            for (const slug of [OFF_TOPIC_CATEGORY, PSYCH_SPECIALTY_SLUG!]) {
                const text = buildTaxonomyCityNarrative(facts, slug, 12);
                expect(text).not.toMatch(/not currently a federally designated/i);
                expect(text).not.toMatch(/is not currently/i);
            }
        }
    });

    it('on topic and flagged, no designation claim is published at all', () => {
        // Thin plan T0-4 (2026-09): the shortage column has no citable source,
        // so the narrative no longer names a designation in either polarity.
        const text = buildTaxonomyCityNarrative(flagged(), PSYCH_SPECIALTY_SLUG!, 12);
        expect(text).not.toMatch(/HPSA|Health Professional Shortage|NHSC|shortage area/i);
        expect(text).not.toMatch(/typically (eligible|qualify) for NHSC/i);
    });

    it('on topic but unflagged, no designation claim is made either way', () => {
        const text = buildTaxonomyCityNarrative(clear(), PSYCH_SPECIALTY_SLUG!, 12);
        expect(text).not.toMatch(/Health Professional Shortage Area \(HPSA\)/);
        expect(text).not.toMatch(/NHSC-approved/);
    });
});

describe('P3 #2 — state narrative makes no false designation claim in either polarity', () => {
    const args = (shortageCityCount: number) =>
        ['Texas', 'TX', 103, shortageCityCount, 25] as const;

    it('an off-topic setting never publishes the designation, whatever the count', () => {
        for (const count of [0, 3]) {
            const text = buildSettingStateNarrative(OFF_TOPIC_CATEGORY, ...args(count));
            expect(text).not.toMatch(/HPSA|Health Professional Shortage|NHSC|shortage area/i);
        }
    });

    it('a zero count no longer flips to the opposite falsehood', () => {
        for (const slug of [OFF_TOPIC_CATEGORY, PSYCH_SPECIALTY_SLUG!]) {
            const text = buildSettingStateNarrative(slug, ...args(0));
            expect(text).not.toMatch(/are not currently federally designated/i);
            expect(text).not.toMatch(/not currently federally designated/i);
        }
    });

    it('on topic with a positive count, no designation claim is published at all', () => {
        // Thin plan T0-4 (2026-09): the count column has no citable source.
        const text = buildSettingStateNarrative(PSYCH_SPECIALTY_SLUG!, ...args(3));
        expect(text).not.toMatch(/HPSA|Health Professional Shortage|NHSC|shortage area/i);
        expect(text).not.toMatch(/typically qualify for NHSC/i);
    });

    it('the live-demand sentence stays on every page and agrees on plurality', () => {
        expect(buildSettingStateNarrative('remote', 'Texas', 'TX', 103, 0, 1))
            .toContain('The 1 active posting reflects');
        expect(buildSettingStateNarrative('remote', 'Texas', 'TX', 103, 0, 25))
            .toContain('The 25 active postings reflect');
    });
});

describe('P3 #2/#3 — NHSC copy explains mechanics and quotes no award', () => {
    for (const rel of [CITY_NARRATIVE, STATE_NARRATIVE]) {
        it(`${rel} quotes no NHSC dollar figure`, () => {
            const code = readCode(rel);
            // Same rule the blog/pillar suites enforce: name the program, link
            // or defer to HRSA, never state an award amount.
            expect(code, `${rel}: quotes an NHSC award amount`)
                .not.toMatch(/(NHSC|National Health Service Corps)[^.]{0,160}\$\s?\d/);
            expect(code, `${rel}: quotes an NHSC award amount`)
                .not.toMatch(/\$\s?\d[^.]{0,160}(NHSC|National Health Service Corps)/);
        });

        it(`${rel} makes no shortage/HPSA designation claim`, () => {
            // Thin plan T0-4 (2026-09): the designation columns have no citable
            // source, so the narratives stopped surfacing them altogether.
            const lines = readCode(rel)
                .split('\n')
                .filter((l) => /HPSA|Health Professional Shortage|shortage-area/i.test(l));
            expect(lines, `${rel} still surfaces a designation`).toEqual([]);
        });

        it(`${rel} never promises blanket NHSC eligibility`, () => {
            const code = readCode(rel);
            expect(code).not.toMatch(/typically (qualify|eligible) for NHSC/i);
            expect(code).not.toMatch(/(broadly|most positions) qualify for NHSC/i);
            expect(code).not.toMatch(/alongside NHSC eligibility/i);
        });
    }

    it('the discipline gate has one definition and the state narrative does not copy it', () => {
        expect(readCode(CITY_NARRATIVE)).toContain('export function shortageColumnAppliesTo');
        // No second copy of the predicate body (the state narrative no longer
        // needs it at all since the designation sentence was removed).
        expect(
            (readCode(STATE_NARRATIVE).match(/function shortageColumnAppliesTo/g) ?? []).length,
        ).toBe(0);
    });
});

// ─── 4. Speakable hook on the shared FAQ accordion ──────────────────────────

describe('P3 #4 — CategoryFAQAccordion answers carry the Speakable class', () => {
    it('the answer element is marked faq-answer', () => {
        const src = read(FAQ_ACCORDION);
        expect(src).toContain('className="faq-answer"');
        // On the answer <p>, not somewhere decorative.
        expect(src).toMatch(/<p className="faq-answer"[\s\S]{0,200}\{faq\.answer\}/);
    });

    // W1B-SHARED: the accordion is a server component over native <details>,
    // so the class is pinned on the rendered HTML as well as the source:
    // every answer is in the server output, no client JS, first item open.
    it('renders native details with every answer under faq-answer in server HTML', () => {
        const faqs = [
            { question: 'First question?', answer: 'First answer in the HTML.' },
            { question: 'Second question?', answer: 'Second answer, also in the HTML.' },
        ];
        const html = renderToStaticMarkup(React.createElement(CategoryFAQAccordion, { faqs }));
        expect(html.match(/<details /g)).toHaveLength(2);
        expect(html.match(/<summary /g)).toHaveLength(2);
        // Only the first item starts open.
        expect(html.match(/<details [^>]*\bopen\b[^>]*>/g)).toHaveLength(1);
        expect(html).toContain('<p class="faq-answer">First answer in the HTML.</p>');
        expect(html).toContain('<p class="faq-answer">Second answer, also in the HTML.</p>');
        expect(html).not.toContain('<button');
        expect(read(FAQ_ACCORDION)).not.toContain("'use client'");
        expect(renderToStaticMarkup(React.createElement(CategoryFAQAccordion, { faqs: [] }))).toBe('');
    });

    it('the class matches the selector the other FAQ surfaces already declare', () => {
        // Same literal the salary-guide and category×city templates list in
        // SpeakableSpecification.cssSelector, so the setting-state template can
        // now widen its own array to include it.
        for (const rel of [
            'app/salary-guide/[state]/page.tsx',
            'lib/pseo/category-city-template.tsx',
        ]) {
            expect(read(rel)).toContain("'.faq-answer'");
        }
    });
});

// ─── 5. CategoryHero renders what it is handed ──────────────────────────────

describe('P3 #5 — CategoryHero renders every prop it accepts', () => {
    const src = () => read(HERO);
    /** JSX + styles only — after the destructuring block. */
    const body = () => src().slice(src().indexOf('}: CategoryHeroProps) {'));

    it('badgeText reaches the DOM instead of being silently dropped', () => {
        expect(body()).toContain('stripUnverifiableFreshness(badgeText');
        expect(body()).toContain('{badge}');
        expect(body()).toContain('cath5-badge');
    });

    // Rendering badgeText made ~30 previously-dead strings visible, most of
    // them hardcoding "· updated today" on a revalidate=3600 ISR route with
    // no generateStaticParams, so the served HTML can be days old while
    // asserting it was updated today.
    //
    // PLAN C.1 T0-4 has since retired that literal at the call sites the
    // thin-content waves rewrote: the city hero reports the stats row's own
    // date through formatStatsBadge(), and the metro hero and
    // category-landing-template use buildLiveRolesBadge(), a bare count that
    // makes no freshness claim at all.
    //
    // That is a dent, not a clearance. The waves rewrote only the call sites
    // they owned; the majority of the app/jobs category hubs still hardcode
    // "· updated today" and are out of this program's scope, so the component
    // is still what has to defuse the claim. Both halves are pinned below: a
    // sample of the call sites that still need defusing, and the removals, so
    // a later edit cannot quietly put the claim back into a rewritten one.
    describe('the badge never publishes a freshness claim the HTML cannot support', () => {
        it('drops relative freshness and keeps the count', () => {
            expect(stripUnverifiableFreshness('412 live roles · updated today'))
                .toBe('412 live roles');
            expect(stripUnverifiableFreshness('412 live roles · updated daily'))
                .toBe('412 live roles');
            expect(stripUnverifiableFreshness('412 live roles · updated 4 min ago'))
                .toBe('412 live roles');
            expect(stripUnverifiableFreshness('412 live roles · updated just now'))
                .toBe('412 live roles');
        });

        it('keeps a date-anchored claim, which stays true however long it is cached', () => {
            // The form formatStatsBadge() emits for a stats row it did not
            // recompute today.
            expect(stripUnverifiableFreshness('412 live roles · updated Jul 12'))
                .toBe('412 live roles · updated Jul 12');
            expect(stripUnverifiableFreshness('412 live roles · updated Jul 12, 2026'))
                .toBe('412 live roles · updated Jul 12, 2026');
        });

        it('passes through badges that make no freshness claim', () => {
            expect(stripUnverifiableFreshness('Nationwide')).toBe('Nationwide');
            expect(stripUnverifiableFreshness('Job Alerts')).toBe('Job Alerts');
            expect(stripUnverifiableFreshness('')).toBe('');
        });

        it('strips the live formatStatsBadge output for a same-day row', () => {
            expect(formatStatsBadge(412, new Date())).toContain('updated today');
            expect(stripUnverifiableFreshness(formatStatsBadge(412, new Date())))
                .toBe('412 live roles');
        });

        it('the actual hardcoded call-site strings all lose the claim', () => {
            // Still hardcoded upstream (foreign files); the component is what
            // has to be safe. P10 pseo-jobs #4: the state hub pluralizes the
            // noun ("1 live role"); the freshness suffix is unchanged.
            const callSites = [
                'app/jobs/state/[state]/page.tsx',
                'app/jobs/remote/page.tsx',
                'app/jobs/locum-tenens/page.tsx',
            ];
            for (const rel of callSites) {
                expect(read(rel), rel).toMatch(/live (?:roles|\$\{pluralize\([^)]*'role'\)\}) · updated today/);
            }
            // A sample, not a census: many more app/jobs hubs still emit the
            // same literal. The list must stay non-empty for as long as ANY
            // caller hardcodes the claim, because the day it empties,
            // stripUnverifiableFreshness has no remaining input and the
            // defusing can be reconsidered. Until then the stripper is
            // load-bearing on every hub that still ships the literal.
            expect(callSites.length).toBeGreaterThan(0);
            expect(stripUnverifiableFreshness('1 live role · updated today')).toBe('1 live role');
            expect(stripUnverifiableFreshness('1247 live roles · updated today'))
                .not.toMatch(/updated/i);
        });

        // PLAN C.1 T0-4 retires the hand-typed freshness literal wherever a
        // thin-content wave rewrote the caller. These pin the REMOVAL itself,
        // so the claim cannot come back through the same three files, and they
        // check the replacement really is claim-free rather than a rename.
        it('the rewritten call sites derive the badge instead of asserting it', () => {
            expect(read('app/jobs/city/[slug]/page.tsx'))
                .toContain('badgeText={formatStatsBadge(facts.total, facts.computedAt)}');
            expect(read('app/jobs/metro/[slug]/page.tsx'))
                .toContain('buildLiveRolesBadge(facts.total)');
            expect(read('lib/pseo/category-landing-template.tsx'))
                .toContain('buildLiveRolesBadge(facts.total)');
            for (const rel of [
                'app/jobs/city/[slug]/page.tsx',
                'app/jobs/metro/[slug]/page.tsx',
                'lib/pseo/category-landing-template.tsx',
            ]) {
                expect(read(rel), rel).not.toMatch(/updated (?:today|daily)/);
            }
            // buildLiveRolesBadge publishes a count and nothing else, so there
            // is no freshness claim left for the hero to strip. Asserted on the
            // builder, not on the literal, because a count-only badge is the
            // property that makes the removal safe.
            expect(buildLiveRolesBadge(412)).toBe('412 live roles');
            expect(buildLiveRolesBadge(1)).toBe('1 live role');
            expect(buildLiveRolesBadge(412)).not.toMatch(/updated/i);
            expect(stripUnverifiableFreshness(buildLiveRolesBadge(412))).toBe('412 live roles');
            // formatStatsBadge stays date-derived: it says "updated today" only
            // for a row recomputed today and prints the real date otherwise.
            expect(formatStatsBadge(412, new Date('2026-07-12T00:00:00Z')))
                .toBe('412 live roles · updated Jul 12');
        });
    });

    it('the live-indicator dot is gated on the badge claiming live inventory', () => {
        // /jobs/locations passes "Nationwide" and /job-alerts passes "Job
        // Alerts": neither states any live inventory, so neither should get a
        // pulsing live dot.
        expect(body()).toMatch(/claimsLiveInventory\(badge\) && <span className="cath5-dot"/);
        for (const [rel, literal] of [
            ['app/jobs/locations/page.tsx', 'Nationwide'],
            ['app/job-alerts/page.tsx', 'Job Alerts'],
        ] as const) {
            expect(read(rel), rel).toContain(`badgeText="${literal}"`);
            expect(/\blive\b/i.test(literal), literal).toBe(false);
        }
    });

    it('the newly-rendered dot pulse honors prefers-reduced-motion', () => {
        // app/globals.css's reduce block is a class allowlist, not a universal
        // selector, so it cannot reach this component-scoped class.
        expect(read('app/globals.css')).not.toContain('.cath5-dot');
        expect(src()).toMatch(
            /@media \(prefers-reduced-motion: reduce\) \{\s*\.cath5-dot \{[^}]*animation: none/,
        );
        // Any other indefinite animation added to this component needs the
        // same gate.
        const infinite = src().match(/animation:[^;]*infinite[^;]*;/g) ?? [];
        expect(infinite.length).toBe(1);
    });

    it('no prop is declared, destructured, and then discarded', () => {
        const iface = src().slice(
            src().indexOf('interface CategoryHeroProps'),
            src().indexOf('}: CategoryHeroProps) {'),
        );
        const propNames = Array.from(
            new Set((iface.match(/^\s{2}(\w+)\??:/gm) ?? []).map((m) => m.trim().replace(/\??:$/, ''))),
        );
        expect(propNames.length).toBeGreaterThan(10);
        const unused = propNames.filter((p) => !body().includes(p));
        expect(unused, `props destructured but never rendered: ${unused.join(', ')}`).toEqual([]);
    });

    it('the pill custom properties it references are actually defined', () => {
        // --pill-bg / --pill-border were referenced by .cath5-badge and defined
        // nowhere, so the declarations were invalid at computed-value time.
        for (const token of ['--pill-bg', '--pill-border']) {
            expect(src()).toContain(`${token}:`);
        }
    });

    it('the breadcrumb separator hangs off the list item, not the only-child span', () => {
        expect(src()).toContain('.cath5-crumbs li:not(:last-child)::after');
        expect(src()).not.toContain('.cath5-crumbs span:not(:last-child)::after');
    });

    it('row 1 degrades when a slot is absent', () => {
        // pSEO templates pass breadcrumbs={[]} and no indexLabel; a fixed
        // 3-column grid shifted the remaining slots into the wrong columns.
        expect(src()).not.toMatch(/\.cath5-row1 \{[^}]*grid-template-columns/);
        expect(src()).toMatch(/\.cath5-row1 \{[^}]*display: flex/);
    });
});
