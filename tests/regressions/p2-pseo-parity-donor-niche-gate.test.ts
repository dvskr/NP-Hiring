/**
 * P2 pSEO-parity — #7 follow-up: the behavioral-health HPSA claim is
 * CATEGORY-GATED, not merely discipline-LABELLED.
 *
 * The parity pass established that `CityData.mentalHealthShortage` is the
 * donor board's behavioral-health-discipline HRSA HPSA column and that no
 * surface may present it as an all-NP shortage figure. It then acted on that
 * in two ways which are easy to confuse:
 *
 *   1. LABELLING  — name the discipline wherever the designation is stated.
 *   2. GATING     — state the designation only on the page whose specialty it
 *                   actually describes (the behavioral-health category).
 *
 * The OG `shortage` param and the "is this a good place for NP careers" FAQ
 * answer got both. Three surfaces got only the label:
 *
 *   • buildCategoryCityMetadata's meta description  — the SERP snippet
 *   • the city "Community Profile" tile
 *   • the setting×state "State Insights" stat card
 *
 * 2,650 of the 4,135 cities carry the flag, so a labelled-but-ungated surface
 * still publishes a behavioral-health designation on
 * /jobs/dermatology/city/houston-tx and on all 42 categories × ~4.1K cities.
 * Labelling makes the sentence TRUE; gating is what keeps the donor niche off
 * the all-NP URLs the niche-copy ratchets exist to protect. Both are needed.
 *
 * Thin-content program (PLAN.md T0-4, packages W2-STATE and W2-CITYTPL): all
 * three surfaces are now gone, not merely gated. T0-4 retires the donor
 * columns that carry no citable source, and the shortage flag is one of them:
 * lib/pseo/city-data/types.ts records that the column's generator and source
 * dataset are lost, so neither the designation type nor its vintage can be
 * re-verified from this repo. The category x state template stopped reading
 * the flag first; the category x city template followed, dropping the meta
 * sentence, the OG shortage param, the Community Profile tile, the careers
 * FAQ answer and the HRSA line in its sources note.
 *
 * WHAT THIS FILE PINS NOW. The rule it was written for did not change: the
 * donor board's behavioral-health column may never be published as an all-NP
 * shortage figure. Withholding it everywhere satisfies that rule strictly
 * more than gating it did, so every case below pins the REMOVAL, on the same
 * surfaces and by the same means as before. A claim that merely moved would
 * fail these: the behavioural cases drive the real metadata builder and read
 * the string Google would index (description AND OG params, for the flagged
 * and unflagged city on the owning and an unrelated category), and the
 * structural cases assert that the template's one surviving HRSA mention is
 * the bare lookup-tool pointer, which asserts nothing about any city.
 *
 * The two gate predicates are deliberately NOT deleted. They stay exported,
 * pure and unit-tested here so that a future surface backed by a citable
 * HRSA dataset has one gate to reuse instead of re-deriving the slug
 * comparison inline, which is how the three leaks happened the first time.
 * The cases below therefore also pin that nothing calls them today.
 *
 * ONE CASE IS RED ON PURPOSE. The renderers are clean; the PRODUCER is not.
 * scripts/generate-city-snippets.ts still writes the designation and the NHSC
 * eligibility inference into the LLM prompt whose approved output both city
 * surfaces render in preference to the deterministic narrative. That is a
 * source fix this file's owner may not make, so the last case in "the rendered
 * surfaces are gone, not relabelled" fails until the script is corrected. Do
 * not weaken it to go green: it is the only assertion in the repo standing
 * between the retired column and the published page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Own module mock: the shared tests/setup.ts prisma stub has no `pseoStats`
// model, and buildCategoryCityMetadata is entirely pseoStats-driven.
vi.mock('@/lib/prisma', () => ({
    prisma: {
        pseoStats: {
            findUnique: vi.fn(),
            findMany: vi.fn(),
        },
        job: {
            count: vi.fn(),
            aggregate: vi.fn(),
            groupBy: vi.fn(),
            findMany: vi.fn(),
        },
    },
}));

import { prisma } from '@/lib/prisma';
import {
    buildCategoryCityMetadata,
    shortageIsOnTopic,
    categoryOwnsShortageData,
} from '@/lib/pseo/category-city-template';
import { getCityBySlug } from '@/lib/pseo/city-data/cities';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source with comments stripped — the fixes are documented by comments that
 * deliberately quote the removed code, so structural assertions must look at
 * code only.
 */
const readCode = (rel: string): string =>
    read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

const CITY_TEMPLATE = 'lib/pseo/category-city-template.tsx';

/** A city that carries the donor flag, and one that does not. */
const SHORTAGE_CITY = 'houston-tx';
const CLEAR_CITY = 'new-york-ny';

/** A category the designation does NOT describe. */
const OFF_TOPIC_CATEGORY = 'dermatology';

const HPSA_SENTENCE = 'Federally designated behavioral-health HPSA.';

/** Split source on either line ending: the worktree checks out CRLF. */
const LINE_BREAK = /\r?\n/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/** Fresh + positive, so getCityStats returns on the cached-row fast path. */
const freshRow = () => ({
    totalJobs: 31,
    rawAvgSalary: 129,
    colAdjustedSalary: 133,
    updatedAt: new Date(),
});

beforeEach(() => {
    vi.clearAllMocks();
    db.pseoStats.findUnique.mockResolvedValue(freshRow());
    vi.spyOn(console, 'error').mockImplementation(() => { });
});

// ─── the data that makes this matter ────────────────────────────────────────

describe('the donor shortage column is on the majority of cities', () => {
    it('a labelled-but-ungated surface would reach most of the corpus', () => {
        const flagged = CITIES.filter((c) => c.mentalHealthShortage).length;
        // Not a golden number — the point is that this is not a rare edge
        // case, so "it is labelled correctly" is not an adequate defence.
        expect(flagged).toBeGreaterThan(CITIES.length / 2);
        expect(getCityBySlug(SHORTAGE_CITY)!.mentalHealthShortage).toBe(true);
        expect(getCityBySlug(CLEAR_CITY)!.mentalHealthShortage).toBe(false);
    });

    it('the behavioral-health category slug resolves from the registry', () => {
        expect(PSYCH_SPECIALTY_SLUG).toBeDefined();
        expect(OFF_TOPIC_CATEGORY).not.toBe(PSYCH_SPECIALTY_SLUG);
    });
});

// ─── the gate predicate ─────────────────────────────────────────────────────

describe('the two gate predicates', () => {
    const OTHER_CATEGORIES = [OFF_TOPIC_CATEGORY, 'cardiology', 'aesthetics', 'remote', 'family-practice'];

    it('shortageIsOnTopic is true only for a flagged city on the behavioral-health category', () => {
        expect(shortageIsOnTopic(getCityBySlug(SHORTAGE_CITY)!, PSYCH_SPECIALTY_SLUG!)).toBe(true);
    });

    it('shortageIsOnTopic is false for a flagged city on any other category', () => {
        const city = getCityBySlug(SHORTAGE_CITY)!;
        for (const slug of OTHER_CATEGORIES) {
            expect(shortageIsOnTopic(city, slug), slug).toBe(false);
        }
    });

    it('shortageIsOnTopic is false for an unflagged city even on the behavioral-health category', () => {
        expect(shortageIsOnTopic(getCityBySlug(CLEAR_CITY)!, PSYCH_SPECIALTY_SLUG!)).toBe(false);
    });

    it('categoryOwnsShortageData is category-only, so both polarities stay available on topic', () => {
        // The Community Profile tile and the state stat card report "Not
        // designated" / a low count, which is a real NHSC-eligibility signal
        // for a behavioral-health seeker. Gating THOSE on the flag would
        // delete on-topic information, so they gate on the category alone.
        expect(categoryOwnsShortageData(PSYCH_SPECIALTY_SLUG!)).toBe(true);
        for (const slug of OTHER_CATEGORIES) {
            expect(categoryOwnsShortageData(slug), slug).toBe(false);
        }
    });

    it('the affirmative predicate is strictly narrower than the category predicate', () => {
        for (const city of [getCityBySlug(SHORTAGE_CITY)!, getCityBySlug(CLEAR_CITY)!]) {
            for (const slug of [PSYCH_SPECIALTY_SLUG!, ...OTHER_CATEGORIES]) {
                if (shortageIsOnTopic(city, slug)) {
                    expect(categoryOwnsShortageData(slug), slug).toBe(true);
                }
            }
        }
    });
});

// ─── surface 1: the SERP snippet (behavioural) ──────────────────────────────

describe('meta description: the donor claim ships on no category at all', () => {
    it('omits the HPSA sentence on a flagged city under an unrelated specialty', async () => {
        const meta = await buildCategoryCityMetadata(OFF_TOPIC_CATEGORY, SHORTAGE_CITY, 1);

        expect(meta.description).toBeDefined();
        expect(meta.description).not.toContain(HPSA_SENTENCE);
        expect(meta.description).not.toMatch(/HPSA|shortage/i);
        // Still a real description: withholding the claim does not blank the
        // snippet, it just leaves the live inventory facts.
        expect(meta.description).toContain('Houston, TX');
        expect(meta.description).toMatch(/^\d+ active .+ listings? in Houston, TX/);
        // T0-4 retires cost of living with the shortage column: the donor's
        // costOfLivingIndex has no source file either, so the snippet that
        // used to end "COL index: 96." now ends with facts the page can cite.
        expect(meta.description).not.toMatch(/COL index|cost of living/i);
    });

    it('withholds it on the behavioral-health category too, flagged or not', async () => {
        // This case used to assert the OPPOSITE: the designation was allowed
        // on the one category whose discipline it describes. T0-4 pulled the
        // column outright because its provenance cannot be re-established, so
        // the on-topic surface is the one that changed and it is pinned here.
        for (const citySlug of [SHORTAGE_CITY, CLEAR_CITY]) {
            const meta = await buildCategoryCityMetadata(PSYCH_SPECIALTY_SLUG!, citySlug, 1);
            expect(meta.description, citySlug).toBeDefined();
            expect(meta.description, citySlug).not.toContain(HPSA_SENTENCE);
            expect(meta.description, citySlug).not.toMatch(/HPSA|shortage/i);
            // And the snippet is still built, so this is a withheld claim and
            // not a builder that failed and returned nothing.
            expect(meta.description!.length, citySlug).toBeGreaterThan(40);
        }
    });

    it('leaves no dangling separator when the claim is withheld', async () => {
        const meta = await buildCategoryCityMetadata(OFF_TOPIC_CATEGORY, SHORTAGE_CITY, 1);
        expect(meta.description).toBe(meta.description!.trim());
        expect(meta.description).not.toMatch(/\s{2,}/);
    });

    it('no category sets the OG shortage param any more', async () => {
        // The param was the second half of the same gate: /api/og/city renders
        // a "Behavioral-Health HPSA" badge for shortage=true, and a share card
        // is as public a claim as the SERP snippet. With the description gone,
        // a caller still passing the param would republish the claim as an
        // image, which no text assertion would catch.
        for (const categoryKey of [OFF_TOPIC_CATEGORY, PSYCH_SPECIALTY_SLUG!]) {
            for (const citySlug of [SHORTAGE_CITY, CLEAR_CITY]) {
                const meta = await buildCategoryCityMetadata(categoryKey, citySlug, 1);
                const ogUrl = String(
                    (meta.openGraph?.images as { url: string }[] | undefined)?.[0]?.url ?? '',
                );
                const label = `${categoryKey}/${citySlug}`;
                // The card is still generated, so this is a dropped param and
                // not a dropped image.
                expect(ogUrl, label).toContain('/api/og/city?');
                expect(ogUrl, label).not.toMatch(/shortage/i);
            }
        }
    });
});

// ─── surfaces 2 and 3: the rendered tiles (structural) ──────────────────────

describe('the rendered surfaces are gone, not relabelled', () => {
    it('the Community Profile tile no longer states the designation', () => {
        const code = readCode(CITY_TEMPLATE);
        // Was: `categoryOwnsShortage && ( … Behavioral-Health HPSA … )`, a tile
        // printing "Designated" / "Not designated" under a discipline label.
        expect(code).not.toMatch(/Behavioral-Health HPSA/);
        expect(code).not.toMatch(/categoryOwnsShortage\b/);
        expect(code).not.toMatch(/'Designated' : 'Not designated'/);
    });

    it('the careers FAQ answer no longer states the designation', () => {
        const code = readCode(CITY_TEMPLATE);
        // The FAQ answer also fed the FAQPage schema, so this one string was
        // published twice per URL. Both copies go with the branch.
        expect(code).not.toContain('carries a federal HRSA behavioral-health');
        expect(code).not.toMatch(/shortageMatchesCategory/);
    });

    it('the sources note no longer credits HRSA for data the page stopped printing', () => {
        const code = readCode(CITY_TEMPLATE);
        expect(code).not.toMatch(/HRSA behavioral-health HPSA designations/);
    });

    it('the one surviving HRSA mention is a bare pointer to the lookup tool', () => {
        // Not a blanket ban: a link to HRSA's own site-eligibility lookup
        // asserts nothing about this city, which is exactly the distinction
        // this file exists to hold. Pinned as a whole line so a claim cannot
        // be smuggled in alongside the URL that would otherwise excuse it.
        const hpsaLines = readCode(CITY_TEMPLATE)
            .split(LINE_BREAK)
            .map((l) => l.trim())
            .filter((l) => /HPSA|Health Professional Shortage/i.test(l));
        expect(hpsaLines).toEqual([
            "'Check NHSC loan repayment eligibility for your site (hpsa.hrsa.gov)',",
        ]);
    });

    it('the meta description is built by the shared, claim-free narrative helper', () => {
        // The inline `description: \`Find … COL index: …\`` template literal that
        // carried the gated sentence is gone; the snippet now comes from
        // lib/pseo/listing-narrative.ts, which composes live inventory facts
        // only. Pinning the delegation stops the literal growing back here.
        const code = readCode(CITY_TEMPLATE);
        expect(code).not.toMatch(/description: `Find/);
        expect(code).toContain('buildCategoryCityDescription({');
        expect(readCode('lib/pseo/listing-narrative.ts')).not.toMatch(/HPSA|shortage/i);
    });

    it('the raw flag is read only by the predicate that owns it', () => {
        // Every other reader is gone: the two demand scorers that consumed it
        // as an internal input, and the tile that read it for its value. One
        // read is left, and it is the predicate's own return.
        const code = readCode(CITY_TEMPLATE);
        const rawReads = code
            .split(LINE_BREAK)
            .map((l) => l.trim())
            .filter((l) => l.includes('.mentalHealthShortage'));
        expect(rawReads).toEqual([
            'return city.mentalHealthShortage && categoryOwnsShortageData(categorySlug);',
        ]);
    });

    it('the predicates survive with no caller, which is what keeps them honest', () => {
        // They are kept on purpose (see this file's header): a later surface
        // built on a citable HRSA dataset reuses the gate instead of inlining
        // the slug comparison. Until then every occurrence in the template is
        // a declaration, so a new caller is a deliberate, visible change here.
        const code = readCode(CITY_TEMPLATE);
        expect(code.match(/shortageIsOnTopic\(/g) ?? []).toHaveLength(1);
        expect(code).toMatch(/export function shortageIsOnTopic\(city: CityData/);
        // categoryOwnsShortageData: its declaration plus the one call inside
        // shortageIsOnTopic, and nothing else.
        expect(code.match(/categoryOwnsShortageData\(/g) ?? []).toHaveLength(2);
        expect(code).toMatch(/export function categoryOwnsShortageData\(categorySlug: string/);
    });

    // RED ON PURPOSE. Every case above reads a RENDERER, and the renderers are
    // clean. They are not the only way the claim reaches a page. Both city
    // surfaces prefer an APPROVED DB snippet over the deterministic narrative
    // (getCityNarrative in app/jobs/city/[slug]/page.tsx, and the
    // dbCatCityOverride branch in this template), and those rows are written by
    // scripts/generate-city-snippets.ts, which no package in this pass touched:
    // "git diff --stat be5a2f2 -- scripts/generate-city-snippets.ts" is empty.
    // Its prompt still states the donor designation as fact, in buildCityPrompt
    // and again in buildTaxonomyPrompt (which runs for EVERY taxonomy slug, not
    // only the one category the discipline describes), and still instructs the
    // model to draw the NHSC eligibility inference that P3 #2 and #3 removed
    // from the narratives. So the retired claim can still reach the HTML
    // through a surface none of the assertions above look at.
    //
    // PLAN C.1 T0-4 retires the column itself, not merely its renderers, so the
    // removal has to reach the producer or it is only skin deep. Fixing the
    // script is a source edit this group is forbidden to make, so this case
    // stays red and the finding goes to the orchestrator.
    //
    // WHOEVER APPLIES THAT FIX MUST APPLY IT AS ONE CHANGE. An older ratchet,
    // tests/regressions/p1-snippet-generator-prompt-niche.test.ts, asserts the
    // OPPOSITE of this case: its 'base city prompt is clean and uses the
    // niche-neutral shortage phrasing' expects buildCityPrompt to CONTAIN
    // 'Health Professional Shortage Area', because when it was written the
    // only defect in view was the donor niche leaking into the wording, not
    // the designation itself. T0-4 supersedes that: the designation is now
    // retired outright, so the same case has to become a not.toMatch on the
    // same string, keeping its countNicheTerms, title and no-'undefined' pins
    // so the P1 #10 niche-neutrality intent survives. Deleting the prompt
    // lines without that rewrite trades this red for that one and reads like
    // a mistake, which is how a removal gets reverted.
    it('the snippet generator no longer feeds the donor claim into the prompt', () => {
        const generator = readCode('scripts/generate-city-snippets.ts')
            .split(LINE_BREAK)
            .map((l) => l.trim());
        // Every family T0-4 retires, in ONE assertion, so a single run hands
        // the orchestrator the complete edit list instead of one family per
        // re-run. Line level, so the message names the surviving producer
        // rather than printing the whole script.
        //
        //  - the designation sentence itself, in buildCityPrompt and again in
        //    buildTaxonomyPrompt;
        //  - the CityFactBlock field and the mapping that carries
        //    CityData.mentalHealthShortage into it, so the value cannot
        //    survive under a new label once the sentences go;
        //  - the instruction telling the model to draw the NHSC eligibility
        //    inference that P3 #2 and #3 removed from the deterministic
        //    narratives, which would otherwise still invite the claim with
        //    the fact lines already deleted;
        //  - costOfLivingIndex and medianIncome, retired by the same T0-4
        //    item for the same reason (no source file survives for either)
        //    and already pinned absent from the SERP snippet above.
        const RETIRED_IN_PROMPTS =
            /HPSA|Health Professional Shortage|shortageArea|shortage status|NHSC|Cost of living index|Median household income/i;
        expect(generator.filter((line) => RETIRED_IN_PROMPTS.test(line))).toEqual([]);
    });
});

// ─── the invariant, restated where the data lives ───────────────────────────

describe('city-data/types.ts documents gating, not just labelling', () => {
    it('tells renderers the claim is category-gated', () => {
        const src = read('lib/pseo/city-data/types.ts');
        expect(src).toMatch(/NOT an all-NP or primary-care shortage signal/);
        // The rule the three leaks violated: labelling alone is insufficient.
        expect(src).toMatch(/GATE IT/);
        expect(src).toMatch(/Labelling alone is NOT sufficient/i);
        expect(src).toContain('shortageIsOnTopic');
        expect(src).toContain('categoryOwnsShortageData');
    });
});
