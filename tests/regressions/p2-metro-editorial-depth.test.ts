/**
 * P2 #13 — metro editorial depth.
 *
 * The metro landing pages are the board's anti-thin-content surface: ten
 * hand-written metros became twenty, and each one has to carry genuinely
 * local, verifiable-or-evergreen substance rather than a find-and-replace of
 * the last one. These tests pin the invariants that make that true:
 *
 *   1. COVERAGE — the twenty target metros exist and are internally consistent
 *      (slugs, state codes, state slugs).
 *   2. TRUTH LINKAGE — practice authority agrees with the board's regulatory
 *      source of truth (lib/state-practice-authority.ts), statute citations
 *      match the session law they name, and NO metro asserts per-state Nurse
 *      Licensure Compact membership at all. These are the places where a
 *      plausible-sounding sentence can quietly become a false YMYL claim.
 *   3. DEPTH + VARIETY — minimum substance per section, and no two metros
 *      sharing byte-identical editorial. A template that repeats is the exact
 *      failure mode this work exists to fix.
 *   4. PAGE WIRING — the template derives adjacency from data, emits exactly
 *      one FAQPage node, serves only local artwork, and does not overstate its
 *      own job counts.
 *
 * ── WHY THE NLC TEST INVERTED ─────────────────────────────────────────────
 * This file used to assert that every "X is not a Nurse Licensure Compact
 * state" sentence AGREED WITH LICENSE_GUIDE_NLC_NON_MEMBERS. That made the
 * test an accomplice rather than a guard: the board's own code documents that
 * set as wrong in both directions and forbids deriving per-state membership
 * claims from it (components/tools/MultiStatePlanner.tsx,
 * app/tools/licensure-checker/page.tsx). Agreement with it is not evidence of
 * anything, and it is what let Massachusetts — a party state since
 * 2024-11-20, pending implementation — ship as "not a Nurse Licensure Compact
 * state" on twenty indexed pages. The assertion is now the prohibition the
 * rest of the repo already carries.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    METRO_CITIES,
    METRO_DATA_LAST_REVIEWED,
    getMetroCity,
    getMetrosInState,
    getNearbyQueryCities,
    getNearbyDisplayCities,
    firstSentence,
    spliceSentence,
    costOfLivingSplice,
} from '@/lib/metro-data';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const METRO_DATA_SRC = read('lib/metro-data.ts');
const METRO_PAGE_SRC = read('app/jobs/metro/[slug]/page.tsx');

/**
 * Source with block and line comments removed — mirrors the helper in
 * tests/regressions/p2-tools-calculators-routes.test.ts.
 *
 * The dead-asset and banned-dataset scans below need this: the fix for both
 * defects deliberately NAMES the thing it removed, in a comment, so the next
 * reader knows why the code looks the way it does. A raw substring scan would
 * make those explanations fail the very test they document.
 */
const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const METRO_DATA_CODE = stripComments(METRO_DATA_SRC);
const METRO_PAGE_CODE = stripComments(METRO_PAGE_SRC);

/** Every editorial string on a metro, concatenated — for text-level assertions. */
function allProse(metro: (typeof METRO_CITIES)[number]): string {
    return [
        metro.heroDescription,
        metro.costOfLivingNote,
        metro.licensureNote,
        metro.careDemandContext,
        ...metro.whyThisMetro,
        ...metro.subMarkets.flatMap((s) => [s.name, s.note]),
        ...metro.faqs.flatMap((f) => [f.question, f.answer]),
    ].join(' \n ');
}

describe('P2 #13 — metro coverage', () => {
    const EXPECTED_SLUGS = [
        // Original ten.
        'new-york-ny', 'los-angeles-ca', 'jacksonville-fl', 'columbus-oh', 'tampa-fl',
        'phoenix-az', 'dallas-tx', 'chicago-il', 'seattle-wa', 'atlanta-ga',
        // 2026-07 expansion.
        'houston-tx', 'philadelphia-pa', 'boston-ma', 'denver-co', 'miami-fl',
        'nashville-tn', 'washington-dc', 'charlotte-nc', 'minneapolis-mn', 'san-antonio-tx',
    ];

    it.each(EXPECTED_SLUGS)('covers %s', (slug) => {
        expect(getMetroCity(slug)).toBeDefined();
    });

    it('has no duplicate slugs', () => {
        const slugs = METRO_CITIES.map((m) => m.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('keeps slug and citySlug in sync (state hub + city hub links depend on it)', () => {
        for (const metro of METRO_CITIES) {
            expect(metro.citySlug, metro.slug).toBe(metro.slug);
        }
    });

    it('uses the repo-canonical state code and state slug for every metro', () => {
        for (const metro of METRO_CITIES) {
            expect(STATE_CODES[metro.state], `${metro.slug}: unknown state "${metro.state}"`).toBe(metro.stateCode);
            expect(stateToSlug(metro.state), `${metro.slug} stateSlug`).toBe(metro.stateSlug);
        }
    });

    it('exposes a review date the metro page can render', () => {
        expect(METRO_DATA_LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('getMetrosInState resolves multi-metro states', () => {
        // Texas now carries three guides; the state hub links them all.
        expect(getMetrosInState('Texas').map((m) => m.slug).sort()).toEqual(
            ['dallas-tx', 'houston-tx', 'san-antonio-tx'],
        );
        expect(getMetrosInState('Nowhere')).toEqual([]);
    });
});

describe('P2 #13 — regulatory truth linkage', () => {
    it('practice authority matches lib/state-practice-authority.ts for every metro', () => {
        for (const metro of METRO_CITIES) {
            const authority = STATE_PRACTICE_AUTHORITY[metro.state];
            expect(authority, `${metro.slug}: "${metro.state}" missing from STATE_PRACTICE_AUTHORITY`).toBeDefined();
            expect(
                metro.practiceAuthority.toLowerCase(),
                `${metro.slug}: metro-data says ${metro.practiceAuthority}, state-practice-authority says ${authority.authority}`,
            ).toBe(authority.authority);
        }
    });

    it('Chicago is not carried as a full-practice metro', () => {
        // REGRESSION GUARD. metro-data used to label Illinois "Full", which
        // contradicted lib/state-practice-authority.ts and would have pushed
        // STAT_SOURCES.fullPracticeStates ('27 states + DC') to 28.
        expect(getMetroCity('chicago-il')?.practiceAuthority).toBe('Reduced');
    });

    it('asserts no per-state Nurse Licensure Compact membership anywhere', () => {
        // Membership is not a single bit — a jurisdiction can have enacted the
        // compact and still issue no multistate licenses (Massachusetts:
        // signed 2024-11-20, still implementing). Metro copy therefore states
        // the observable EFFECT, never the membership status. See policy note
        // (7) at the top of lib/metro-data.ts.
        const BANNED = [
            /\bis (?:not )?an? Nurse Licensure Compact\b/i,
            /\bis (?:not )?a (?:member|party) (?:state|jurisdiction) of the (?:Nurse Licensure )?[Cc]ompact\b/i,
            /\b(?:joined|participates in|belongs to) the Nurse Licensure Compact\b/i,
            /\bis (?:not )?a compact (?:state|jurisdiction)\b/i,
        ];
        for (const metro of METRO_CITIES) {
            const prose = allProse(metro);
            for (const pattern of BANNED) {
                expect(
                    pattern.test(prose),
                    `${metro.slug} asserts NLC membership status (${pattern}) — state the effect instead`,
                ).toBe(false);
            }
        }
    });

    it('does not derive any claim from LICENSE_GUIDE_NLC_NON_MEMBERS', () => {
        // The dataset the rest of the repo pins shut. Neither the data file,
        // the template, nor this test may read it — an assertion against it
        // only proves the copy and the bad dataset agree with each other.
        const BANNED_SYMBOL = ['LICENSE_GUIDE', 'NLC', 'NON_MEMBERS'].join('_');
        for (const [label, src] of [
            ['lib/metro-data.ts', METRO_DATA_CODE],
            ['app/jobs/metro/[slug]/page.tsx', METRO_PAGE_CODE],
        ] as const) {
            expect(src.includes(BANNED_SYMBOL), label).toBe(false);
        }
        // This test may not read it either — asserting that metro copy agrees
        // with that set is what let the wrong Massachusetts claim through, so
        // the guard is the missing import, not a substring of its own source.
        const SELF = stripComments(read('tests/regressions/p2-metro-editorial-depth.test.ts'));
        expect(SELF).not.toMatch(/from\s+'@\/lib\/blog-license-guides'/);
        expect(SELF).not.toMatch(new RegExp(`${BANNED_SYMBOL}\\s*[.(\\[]`));
    });

    it('describes the compact by its effect, and keeps the APRN carve-out', () => {
        // The replacement phrasing must still tell a reader the actionable
        // thing, or the fix would have removed information rather than error.
        const withCompactCopy = METRO_CITIES.filter((m) => /Nurse Licensure Compact|multistate/i.test(allProse(m)));
        expect(withCompactCopy.length).toBeGreaterThanOrEqual(6);
        for (const metro of withCompactCopy) {
            expect(
                /does not (?:yet )?issue or recognize multistate nursing licenses|covers RN and LPN licenses only|never covers APRN licenses|never travels on a compact RN license|issued state by state/i.test(allProse(metro)),
                `${metro.slug}: compact copy states neither the effect nor the APRN carve-out`,
            ).toBe(true);
        }
    });

    it('cites the correct Massachusetts session law for full practice authority', () => {
        // VERIFIED 2026-07-29 against malegislature.gov: the NP scope law is
        // Chapter 260 of the Acts of 2020 ("An Act promoting a resilient
        // health care system that puts patients first"). Chapter 227 of the
        // Acts of 2020 is the FY2021 general appropriations act and contains
        // no scope-of-practice language. The wrong number shipped in three
        // rendered places, one of which feeds the FAQPage JSON-LD.
        const boston = getMetroCity('boston-ma');
        expect(boston).toBeDefined();
        const prose = allProse(boston!);
        expect(prose).toContain('Chapter 260 of the Acts of 2020');
        expect(prose).not.toContain('Chapter 227');
        // No metro may cite a Massachusetts act number other than 260.
        expect(METRO_DATA_SRC).not.toMatch(/Chapter (?!260\b)\d+ of the Acts of 2020/);
    });

    it('never invents a dollar figure — salary numbers come from live aggregation', () => {
        // TRUTH RULE: the only cited salary figures live in lib/stats-sources.ts;
        // everything a reader sees on a metro page is DB-aggregated.
        expect(METRO_DATA_SRC).not.toMatch(/\$\s?\d/);
    });

    it('carries no stale year-anchored tax rate', () => {
        // The Atlanta entry used to quote Georgia's 2024 flat rate, which
        // steps down on a legislative schedule.
        expect(METRO_DATA_SRC).not.toMatch(/\d+(\.\d+)?%\s*(as of|in)\s*20\d\d/);
    });

    it('uses none of the template reference-niche terms', () => {
        // Mirrors tests/regressions/niche-copy-debt.test.ts: this file is not in
        // the baseline, so a single hit would arm the ratchet against it.
        expect(METRO_DATA_SRC).not.toMatch(/pmhnp|psychiatric|mental health/i);
    });
});

describe('P2 #13 — editorial depth', () => {
    it.each(METRO_CITIES.map((m) => [m.slug, m] as const))('%s carries enough substance', (_slug, metro) => {
        expect(metro.heroDescription.length).toBeGreaterThan(180);
        expect(metro.costOfLivingNote.length).toBeGreaterThan(180);
        expect(metro.licensureNote.length).toBeGreaterThan(150);
        expect(metro.careDemandContext.length).toBeGreaterThan(200);
        // The bento grid renders whyThisMetro[0..3] unconditionally.
        expect(metro.whyThisMetro.length).toBeGreaterThanOrEqual(4);
        expect(metro.topSettings.length).toBeGreaterThanOrEqual(4);
    });

    it.each(METRO_CITIES.map((m) => [m.slug, m] as const))('%s documents its sub-market structure', (_slug, metro) => {
        expect(metro.subMarkets.length).toBeGreaterThanOrEqual(4);
        const names = metro.subMarkets.map((s) => s.name);
        expect(new Set(names).size, 'duplicate sub-market names').toBe(names.length);
        for (const sub of metro.subMarkets) {
            expect(sub.note.length, `${metro.slug} / ${sub.name}`).toBeGreaterThan(60);
        }
    });

    it.each(METRO_CITIES.map((m) => [m.slug, m] as const))('%s has 4-5 substantive FAQs', (_slug, metro) => {
        expect(metro.faqs.length).toBeGreaterThanOrEqual(4);
        expect(metro.faqs.length).toBeLessThanOrEqual(5);
        for (const faq of metro.faqs) {
            expect(faq.question.endsWith('?'), faq.question).toBe(true);
            expect(faq.answer.length, faq.question).toBeGreaterThan(140);
        }
    });

    it('renders cost of living cleanly in both splice positions', () => {
        // The template reuses the first sentence standalone AND mid-sentence,
        // splitting on the first period — an abbreviation would truncate it.
        for (const metro of METRO_CITIES) {
            const first = firstSentence(metro.costOfLivingNote);
            expect(first.length, `${metro.slug} first sentence too short to splice`).toBeGreaterThan(40);
            expect(metro.avgCostOfLiving, metro.slug).toBe(metro.avgCostOfLiving.trim());
            expect(metro.avgCostOfLiving.endsWith('.'), metro.slug).toBe(false);
        }
    });

    it('only folds SAME-STATE cities into a metro job query', () => {
        // getMetroStats ANDs on stateCode; a cross-state suburb can never
        // match, so listing one would be silently dead config.
        const CROSS_STATE = ['Arlington, VA', 'Camden', 'Hoboken', 'Bethesda', 'Rock Hill', 'Hudson'];
        for (const metro of METRO_CITIES) {
            for (const nearby of getNearbyQueryCities(metro)) {
                expect(CROSS_STATE, `${metro.slug} nearbyCities`).not.toContain(nearby);
            }
        }
    });
});

describe('P2 #13 — cost-of-living splice', () => {
    // The opener is spliced after an em dash in the Cost of Living bento card
    // and again in the Salary Outlook card. It may be lowercased so it reads
    // as one clause — but ONLY when lowercasing is correct English.

    /** Metros whose note opens on a place name. Lowercasing these misspells a city. */
    const PROPER_NOUN_OPENERS: Record<string, string> = {
        'houston-tx': 'Houston is',
        'philadelphia-pa': 'Philadelphia costs',
        'boston-ma': 'Boston is',
        'denver-co': 'Denver costs',
        'miami-fl': 'Miami is',
        'nashville-tn': 'Nashville sits',
        'charlotte-nc': 'Charlotte sits',
        'san-antonio-tx': 'San Antonio is',
    };

    it.each(Object.entries(PROPER_NOUN_OPENERS))(
        '%s keeps its leading proper noun capitalised',
        (slug, opener) => {
            // REGRESSION GUARD. These rendered as "houston is one of the
            // cheapest…" and "san Antonio is the most affordable…" in two
            // visible places each.
            const metro = getMetroCity(slug)!;
            expect(costOfLivingSplice(metro).startsWith(opener), costOfLivingSplice(metro)).toBe(true);
        },
    );

    it('still lowercases a common-noun opener so the clause reads continuously', () => {
        expect(costOfLivingSplice(getMetroCity('chicago-il')!)).toMatch(/^cost of living in Chicago /);
        expect(costOfLivingSplice(getMetroCity('new-york-ny')!)).toMatch(/^living costs in the NYC metro /);
        expect(costOfLivingSplice(getMetroCity('minneapolis-mn')!)).toMatch(/^the Twin Cities /);
        expect(costOfLivingSplice(getMetroCity('washington-dc')!)).toMatch(/^the DMV is /);
    });

    it('never lowercases an unvetted opening word', () => {
        // Independent of the helper's own proper-noun rule: a lowercased
        // opener must be one of a short list of common nouns a human signed
        // off on. A new metro opening "Williamson County sits…" fails here.
        const COMMON_OPENERS = ['cost', 'living', 'the', 'housing'];
        for (const metro of METRO_CITIES) {
            const splice = costOfLivingSplice(metro);
            const source = firstSentence(metro.costOfLivingNote);
            if (splice === source) continue;
            expect(COMMON_OPENERS, `${metro.slug} lowercased "${splice.split(' ')[0]}"`).toContain(
                splice.split(' ')[0],
            );
        }
    });

    it('changes at most the first character, so interior acronyms survive', () => {
        // "Living costs in the NYC metro…" must not become "…nYC…", and the
        // splice must never rewrite the note beyond that one character.
        for (const metro of METRO_CITIES) {
            const splice = costOfLivingSplice(metro);
            const source = firstSentence(metro.costOfLivingNote);
            expect(splice.slice(1), metro.slug).toBe(source.slice(1));
            expect(splice.toLowerCase(), metro.slug).toBe(source.toLowerCase());
        }
    });

    it('leaves an all-caps opening token alone', () => {
        // Guards the branch no metro currently exercises: a note opening on an
        // acronym would otherwise render "dMV housing…".
        expect(spliceSentence('DMV housing costs are the reason', [])).toBe('DMV housing costs are the reason');
        expect(spliceSentence('Cost of living is low', [])).toBe('cost of living is low');
        expect(spliceSentence('Houston is cheap', ['Houston'])).toBe('Houston is cheap');
    });
});

describe('P2 #13 — adjacent-city lists', () => {
    it('names each adjacent city once, under one spelling, in visible copy', () => {
        // REGRESSION GUARD. Minneapolis carried 'Saint Paul' AND 'St. Paul' in
        // the same array, so the job-count caption printed the same city twice
        // and pushed two real suburbs out of the four-city slice.
        const canonical = (name: string) => name.toLowerCase().replace(/^st\.?\s+/, 'saint ');
        for (const metro of METRO_CITIES) {
            const display = getNearbyDisplayCities(metro).map(canonical);
            expect(new Set(display).size, `${metro.slug} display list repeats a city`).toBe(display.length);
        }
    });

    it('keeps alternate spellings out of the display list but in the query', () => {
        const minneapolis = getMetroCity('minneapolis-mn')!;
        expect(getNearbyDisplayCities(minneapolis)).toEqual([
            'Saint Paul', 'Bloomington', 'Edina', 'Minnetonka', 'Maple Grove',
        ]);
        // The DB match still needs both spellings — employers use both.
        expect(getNearbyQueryCities(minneapolis)).toContain('St. Paul');
        expect(getNearbyQueryCities(minneapolis)).toContain('Saint Paul');
    });

    it('every alias names a city that is actually displayed', () => {
        // An alias for a city not in nearbyCities is a silent extra match.
        const canonical = (name: string) => name.toLowerCase().replace(/^st\.?\s+/, 'saint ');
        for (const metro of METRO_CITIES) {
            const display = new Set(getNearbyDisplayCities(metro).map(canonical));
            for (const alias of metro.nearbyCityAliases ?? []) {
                expect(display, `${metro.slug}: alias "${alias}" has no display entry`).toContain(canonical(alias));
            }
        }
    });

    it('the caption slice shows four distinct real cities', () => {
        for (const metro of METRO_CITIES) {
            const shown = getNearbyDisplayCities(metro).slice(0, 4);
            expect(new Set(shown).size, metro.slug).toBe(shown.length);
        }
    });
});

describe('P2 #13 — anti-thin-content: no metro is a copy of another', () => {
    const uniqueAcrossMetros = (label: string, pick: (m: (typeof METRO_CITIES)[number]) => string[]) => {
        const seen = new Map<string, string>();
        for (const metro of METRO_CITIES) {
            for (const value of pick(metro)) {
                const key = value.trim().toLowerCase();
                const previous = seen.get(key);
                expect(previous, `${label} duplicated between ${previous} and ${metro.slug}`).toBeUndefined();
                seen.set(key, metro.slug);
            }
        }
    };

    it('hero descriptions are unique', () => {
        uniqueAcrossMetros('heroDescription', (m) => [m.heroDescription]);
    });

    it('care-demand context is unique', () => {
        uniqueAcrossMetros('careDemandContext', (m) => [m.careDemandContext]);
    });

    it('cost-of-living and licensure notes are unique', () => {
        uniqueAcrossMetros('costOfLivingNote', (m) => [m.costOfLivingNote]);
        uniqueAcrossMetros('licensureNote', (m) => [m.licensureNote]);
    });

    it('FAQ answers are unique — same-state metros must not share boilerplate', () => {
        // Three Texas metros and three Florida metros share a regulatory
        // regime; that is exactly where copy-paste is tempting.
        uniqueAcrossMetros('faq answer', (m) => m.faqs.map((f) => f.answer));
    });

    it('sub-market notes are unique', () => {
        uniqueAcrossMetros('subMarket note', (m) => m.subMarkets.map((s) => s.note));
    });
});

describe('P2 #13 — metro page wiring', () => {
    it('derives metro adjacency from data, not hardcoded city branches', () => {
        expect(METRO_PAGE_SRC).toContain('nearbyCities');
        expect(METRO_PAGE_SRC).not.toContain("city === 'New York'");
        expect(METRO_PAGE_SRC).not.toContain("city === 'Tampa'");
        expect(METRO_PAGE_SRC).not.toContain("city === 'Dallas'");
        expect(METRO_PAGE_SRC).not.toContain("contains: 'Fort Worth'");
    });

    it('emits exactly one FAQPage node (CategoryFAQ owns it)', () => {
        // The page used to render its own FAQPage from metro.faqs AND pass the
        // same array to CategoryFAQ, which renders a second identical node.
        expect(METRO_PAGE_SRC).not.toContain("'FAQPage'");
        expect(METRO_PAGE_SRC).toContain('customFaqs={metro.faqs}');
    });

    it('renders the sub-market rail and the care-demand prose', () => {
        expect(METRO_PAGE_SRC).toContain('metro.subMarkets.map');
        expect(METRO_PAGE_SRC).toContain('metro.careDemandContext');
    });

    it('labels the job count honestly when adjacent cities are folded in', () => {
        // The CTA used to promise "View All {n} Jobs in {city}" while linking
        // to a location filter that excludes the folded-in suburbs.
        expect(METRO_PAGE_SRC).not.toContain('View All {stats.totalJobs} Jobs');
        expect(METRO_PAGE_SRC).toContain('-area positions');
    });

    it('never prints a hardcoded fallback salary range', () => {
        // Salary copy must degrade to "not enough data" rather than to an
        // invented $130K-$200K band.
        expect(METRO_PAGE_SRC).not.toMatch(/\$130K/);
    });

    it('splices sentences through the tested data-layer helper', () => {
        // The splice rule lives in lib/metro-data.ts so it can be asserted
        // against all 20 records (see "cost-of-living splice" above) rather
        // than as an un-exercised private function in a server component.
        expect(METRO_PAGE_SRC).toContain('costOfLivingSplice(metro)');
        expect(METRO_PAGE_SRC).not.toContain('function decapitalize');
        expect(METRO_PAGE_SRC).not.toContain(".split('.')[0].toLowerCase()");
        expect(METRO_DATA_SRC).toContain('export function spliceSentence');
    });

    it('reads the query list and the display list from separate accessors', () => {
        expect(METRO_PAGE_SRC).toContain('getNearbyQueryCities(metro)');
        expect(METRO_PAGE_SRC).toContain('getNearbyDisplayCities(metro)');
        // The visible caption must never be built from the query list.
        expect(METRO_PAGE_SRC).not.toContain('getNearbyQueryCities(metro).slice');
    });

    it('keeps niche identity on brand tokens', () => {
        expect(METRO_PAGE_SRC).toContain('brand.niche.short');
        expect(METRO_PAGE_SRC).not.toMatch(/pmhnp|psychiatric|mental health/i);
    });

    it('serves no image from the retired remote asset bucket', () => {
        // Ten distinct remote URLs (hero_wc_states, three bento illustrations,
        // six clay icons) were live on this template and every one returned
        // HTTP 400 — roughly thirteen broken <Image> elements per page across
        // all 20 metros, the LCP hero included. Same purge the sibling
        // surfaces already took; this template was missed.
        for (const marker of ['storage/v1/object/public', 'supabase.co', 'clay_icon_', 'hero_wc_states', 'bento_state_', 'storageBase']) {
            expect(METRO_PAGE_CODE.includes(marker), `metro template still references "${marker}"`).toBe(false);
        }
        expect(METRO_PAGE_CODE).not.toMatch(/const\s+STORAGE_BASE\s*=/);
        expect(METRO_PAGE_CODE).not.toMatch(/\$\{STORAGE_BASE\}/);
    });

    it('sources every image from public/images and the state diorama set', () => {
        const srcs = [...METRO_PAGE_CODE.matchAll(/<Image\s+src=\{([^}]+)\}/g)].map((m) => m[1].trim());
        expect(srcs.length).toBeGreaterThan(0);
        for (const src of srcs) {
            expect(
                /^(ART_PRACTICE|ART_SALARY|ART_GROWTH)$/.test(src),
                `metro template renders <Image src={${src}}> — not a local asset constant`,
            ).toBe(true);
        }
        // Hero goes through the shared diorama helpers, so a state without
        // artwork degrades to a real local file instead of a blank LCP.
        expect(METRO_PAGE_SRC).toContain('stateDioramaSrc(metro.stateSlug)');
        expect(METRO_PAGE_SRC).toContain('METRO_HERO_FALLBACK');
        for (const constant of ['ART_PRACTICE', 'ART_SALARY', 'ART_GROWTH']) {
            const declared = new RegExp(`const ${constant} = '(/images/[^']+)'`).exec(METRO_PAGE_SRC);
            expect(declared, `${constant} is not declared as a /images/** path`).not.toBeNull();
            expect(
                fs.existsSync(path.join(ROOT, 'public', declared![1])),
                `${constant} points at ${declared![1]}, which does not exist in public/`,
            ).toBe(true);
        }
    });

    it('ships a diorama for every state that carries a metro', () => {
        // The hero falls back rather than breaking, but a missing diorama
        // silently makes twenty distinct metros share one generic image.
        for (const metro of METRO_CITIES) {
            expect(
                fs.existsSync(path.join(ROOT, 'public/images/states', `${metro.stateSlug}.png`)),
                `${metro.slug}: no diorama at public/images/states/${metro.stateSlug}.png`,
            ).toBe(true);
        }
    });

    it('matches adjacent cities exactly so the job count cannot be inflated', () => {
        // `contains` on a short nearby-city token swept in unrelated
        // municipalities — Houston's "Spring" matched Big Spring / Springtown
        // / Spring Branch TX, Philadelphia's "Chester" matched Rochester and
        // Manchester PA — and that count feeds the H1, the <title> and the
        // ItemList numberOfItems.
        expect(METRO_PAGE_CODE).toContain('city: { equals: nearby');
        expect(METRO_PAGE_CODE).not.toContain('city: { contains: nearby');
        // The metro's own name deliberately keeps `contains` (it is what folds
        // Miami Beach into Miami); that is the only permitted substring match.
        expect([...METRO_PAGE_CODE.matchAll(/city:\s*\{\s*contains:\s*(\w+)/g)].map((m) => m[1])).toEqual(['city']);
    });

    it('names any city whose jobs it counts', () => {
        // Under exact matching a nearby entry can only match its own name, so
        // the caption and the count can no longer diverge. Guard the invariant
        // that made that true: no query-only spelling may be a substring-trap
        // for a different real city.
        for (const metro of METRO_CITIES) {
            for (const queried of getNearbyQueryCities(metro)) {
                expect(queried.trim(), `${metro.slug}: empty query city`).not.toBe('');
                expect(
                    queried,
                    `${metro.slug}: query city "${queried}" is the metro's own name`,
                ).not.toBe(metro.city);
            }
        }
    });
});
