/**
 * P2 #13: metro editorial depth.
 *
 * The metro landing pages are the board's anti-thin-content surface: ten
 * hand-written metros became twenty, and each one has to carry genuinely
 * local, verifiable-or-evergreen substance rather than a find-and-replace of
 * the last one. These tests pin the invariants that make that true:
 *
 *   1. COVERAGE: the twenty target metros exist and are internally consistent
 *      (slugs, state codes, state slugs).
 *   2. TRUTH LINKAGE: practice authority agrees with the board's regulatory
 *      source of truth (lib/state-practice-authority.ts), statute citations
 *      match the session law they name, and NO metro asserts per-state Nurse
 *      Licensure Compact membership at all. These are the places where a
 *      plausible-sounding sentence can quietly become a false YMYL claim.
 *   3. DEPTH + VARIETY: minimum substance per section, and no two metros
 *      sharing byte-identical editorial. A template that repeats is the exact
 *      failure mode this work exists to fix.
 *   4. PAGE WIRING: the template reads its inventory through the shared metro
 *      scope, gates robots on the same function the sitemap uses, publishes
 *      pay only through the gated median, emits exactly one FAQPage node from
 *      one array, serves only local artwork, and publishes no unsourced index
 *      reading or ranking claim. The last one is asserted against the DATA, by
 *      running the page's own publish filter over all twenty records (thin
 *      plan METRO-M1 to M6).
 *   5. M7, THE RECORDS THEMSELVES: the 2026-09-26 sweep rewrote every record
 *      so that no string states an unsourced figure, ranking or regulatory
 *      fact. Its pins guard the specific false facts an earlier, unshipped
 *      rewrite introduced (see the header of lib/metro-data.ts), so none of
 *      them can come back.
 *
 * WHY THE NLC TEST INVERTED
 * This file used to assert that every "X is not a Nurse Licensure Compact
 * state" sentence AGREED WITH LICENSE_GUIDE_NLC_NON_MEMBERS. That made the
 * test an accomplice rather than a guard: the board's own code documents that
 * set as wrong in both directions and forbids deriving per-state membership
 * claims from it (components/tools/MultiStatePlanner.tsx,
 * app/tools/licensure-checker/page.tsx). Agreement with it is not evidence of
 * anything, and it is what let Massachusetts (a party state since
 * 2024-11-20, pending implementation) ship as "not a Nurse Licensure Compact
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
} from '@/lib/metro-data';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const METRO_DATA_SRC = read('lib/metro-data.ts');
const METRO_PAGE_SRC = read('app/jobs/metro/[slug]/page.tsx');
const SITEMAP_SRC = read('app/sitemap.ts');

/**
 * Source with block and line comments removed; mirrors the helper in
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
const SITEMAP_CODE = stripComments(SITEMAP_SRC);

/** Every editorial string on a metro, concatenated, for text-level assertions. */
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

describe('P2 #13: metro coverage', () => {
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

describe('P2 #13: regulatory truth linkage', () => {
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
        // Membership is not a single bit: a jurisdiction can have enacted the
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
                    `${metro.slug} asserts NLC membership status (${pattern}); state the effect instead`,
                ).toBe(false);
            }
        }
    });

    it('does not derive any claim from LICENSE_GUIDE_NLC_NON_MEMBERS', () => {
        // The dataset the rest of the repo pins shut. Neither the data file,
        // the template, nor this test may read it: an assertion against it
        // only proves the copy and the bad dataset agree with each other.
        const BANNED_SYMBOL = ['LICENSE_GUIDE', 'NLC', 'NON_MEMBERS'].join('_');
        for (const [label, src] of [
            ['lib/metro-data.ts', METRO_DATA_CODE],
            ['app/jobs/metro/[slug]/page.tsx', METRO_PAGE_CODE],
        ] as const) {
            expect(src.includes(BANNED_SYMBOL), label).toBe(false);
        }
        // This test may not read it either: asserting that metro copy agrees
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

    it('never invents a dollar figure: salary numbers come from live aggregation', () => {
        // TRUTH RULE: the only cited salary figures live in lib/stats-sources.ts;
        // everything a reader sees on a metro page is the gated median.
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

describe('P2 #13: editorial depth', () => {
    it.each(METRO_CITIES.map((m) => [m.slug, m] as const))('%s carries enough substance', (_slug, metro) => {
        expect(metro.heroDescription.length).toBeGreaterThan(180);
        expect(metro.licensureNote.length).toBeGreaterThan(150);
        expect(metro.careDemandContext.length).toBeGreaterThan(200);
        // The bento grid renders up to four bullets, and only the ones that
        // clear the page's publish filter, so a record needs at least four to
        // give the filter something to work with.
        expect(metro.whyThisMetro.length).toBeGreaterThanOrEqual(4);
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

    it('opens every licensure note on a sentence the Licensure step can reuse', () => {
        // The "Getting Started" band prints firstSentence(licensureNote) as a
        // standalone sentence; an abbreviation ("St.", "U.S.") would cut it
        // to a fragment. Nashville's opener is 40 characters, the shortest.
        for (const metro of METRO_CITIES) {
            const first = firstSentence(metro.licensureNote);
            expect(first.length, `${metro.slug} first sentence too short to reuse`).toBeGreaterThanOrEqual(30);
        }
    });

    it('only folds SAME-STATE cities into a metro job query', () => {
        // metroScopeWhere ANDs on stateCode; a cross-state suburb can never
        // match, so listing one would be silently dead config.
        const CROSS_STATE = ['Arlington, VA', 'Camden', 'Hoboken', 'Bethesda', 'Rock Hill', 'Hudson'];
        for (const metro of METRO_CITIES) {
            for (const nearby of getNearbyQueryCities(metro)) {
                expect(CROSS_STATE, `${metro.slug} nearbyCities`).not.toContain(nearby);
            }
        }
    });
});

describe('P2 #13: adjacent-city lists', () => {
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
        // The DB match still needs both spellings; employers use both.
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

describe('P2 #13: anti-thin-content, no metro is a copy of another', () => {
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

    it('licensure notes are unique', () => {
        uniqueAcrossMetros('licensureNote', (m) => [m.licensureNote]);
    });

    it('FAQ answers are unique: same-state metros must not share boilerplate', () => {
        // Three Texas metros and three Florida metros share a regulatory
        // regime; that is exactly where copy-paste is tempting.
        uniqueAcrossMetros('faq answer', (m) => m.faqs.map((f) => f.answer));
    });

    it('sub-market notes are unique', () => {
        uniqueAcrossMetros('subMarket note', (m) => m.subMarkets.map((s) => s.note));
    });
});

describe('P2 #13: metro page wiring', () => {
    it('derives metro adjacency from data, not hardcoded city branches', () => {
        expect(METRO_PAGE_SRC).toContain('nearbyCities');
        expect(METRO_PAGE_SRC).not.toContain("city === 'New York'");
        expect(METRO_PAGE_SRC).not.toContain("city === 'Tampa'");
        expect(METRO_PAGE_SRC).not.toContain("city === 'Dallas'");
        expect(METRO_PAGE_SRC).not.toContain("contains: 'Fort Worth'");
    });

    it('emits exactly one FAQPage node (CategoryFAQ owns it) from one array', () => {
        // The page used to render its own FAQPage from metro.faqs AND pass the
        // same array to CategoryFAQ, which renders a second identical node.
        // METRO-M6 appends the employers question to that one array before it
        // reaches CategoryFAQ, so the accordion and the schema cannot drift.
        expect(METRO_PAGE_SRC).not.toContain("'FAQPage'");
        expect(METRO_PAGE_CODE).toContain('customFaqs={faqs}');
        expect(METRO_PAGE_CODE).toMatch(/const faqs = employersFaq \? \[\.\.\.reviewedFaqs, employersFaq\] : reviewedFaqs;/);
        expect(METRO_PAGE_CODE).toContain('buildMetroEmployersFaq({ city: metro.city, employers: facts.topEmployers })');
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
        // Salary copy must degrade to the counted below-gate sentence rather
        // than to an invented $130K-$200K band.
        expect(METRO_PAGE_SRC).not.toMatch(/\$130K/);
    });

    it('reads the display list from its accessor and never builds copy from the query list', () => {
        expect(METRO_PAGE_SRC).toContain('getNearbyDisplayCities(metro)');
        // The query list now lives inside metroScopeWhere (lib/pseo/listing-facts).
        expect(METRO_PAGE_CODE).not.toContain('getNearbyQueryCities');
    });

    it('keeps niche identity on brand tokens', () => {
        expect(METRO_PAGE_SRC).toContain('brand.niche.short');
        expect(METRO_PAGE_SRC).not.toMatch(/pmhnp|psychiatric|mental health/i);
    });

    it('serves no image from the retired remote asset bucket', () => {
        // Ten distinct remote URLs (hero_wc_states, three bento illustrations,
        // six clay icons) were live on this template and every one returned
        // HTTP 400: roughly thirteen broken <Image> elements per page across
        // all 20 metros, the LCP hero included. Same purge the sibling
        // surfaces already took; this template was missed.
        for (const marker of ['storage/v1/object/public', 'supabase.co', 'clay_icon_', 'hero_wc_states', 'bento_state_', 'storageBase']) {
            expect(METRO_PAGE_CODE.includes(marker), `metro template still references "${marker}"`).toBe(false);
        }
        expect(METRO_PAGE_CODE).not.toMatch(/const\s+STORAGE_BASE\s*=/);
        expect(METRO_PAGE_CODE).not.toMatch(/\$\{STORAGE_BASE\}/);
    });

    it('sources every image from public/images and the state diorama set', () => {
        // The bento pictures render through ImmersiveImage (edge-to-edge cells);
        // both element names carry the same local constants.
        const srcs = [...METRO_PAGE_CODE.matchAll(/<(?:Image|ImmersiveImage)\s+src=\{([^}]+)\}/g)].map((m) => m[1].trim());
        expect(srcs.length).toBeGreaterThan(0);
        for (const src of srcs) {
            expect(
                /^(ART_PRACTICE|ART_SALARY|ART_GROWTH)$/.test(src),
                `metro template renders <Image src={${src}}>, not a local asset constant`,
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

describe('P2 #13: thin plan METRO-M1 to M6 (one predicate, gated pay, live facts)', () => {
    it('M3: every metro count reads the shared scope through getListingFacts', () => {
        // The page spells no city predicate of its own; the own-name `contains`
        // and the exact nearby matches live in metroScopeWhere, pinned by
        // tests/unit/listing-facts.test.ts, and app/sitemap.ts reads the same
        // function so page and sitemap can never disagree on inventory.
        expect(METRO_PAGE_SRC).toMatch(/import \{[^}]*\bmetroScopeWhere\b[^}]*\} from '@\/lib\/pseo\/listing-facts'/);
        expect(METRO_PAGE_CODE).toContain("getListingFacts(`metro:${metro.slug}`, metroScopeWhere(metro))");
        expect(METRO_PAGE_CODE).not.toMatch(/city:\s*\{/);
        expect(METRO_PAGE_CODE).not.toContain('groupBy');
        expect(METRO_PAGE_CODE).not.toContain('prisma.job.aggregate');
        expect(SITEMAP_SRC).toMatch(/import \{[^}]*\bmetroScopeWhere\b[^}]*\} from '@\/lib\/pseo\/listing-facts'/);
        expect(SITEMAP_CODE).toContain('metroScopeWhere(metro)');
        expect(SITEMAP_CODE).not.toContain('METRO_ADJACENT_CITIES');
    });

    it('M3: the listing rows use the canonical bucket with the quarantine visible', () => {
        expect(METRO_PAGE_SRC).toContain("import { PUBLISHED_LISTING_WHERE } from '@/lib/pseo/listing-where';");
        expect(METRO_PAGE_CODE).toContain('canonicalBucketWhere({ ...PUBLISHED_LISTING_WHERE, ...metroScopeWhere(metro) }, now)');
        expect(METRO_PAGE_CODE).not.toMatch(/isPublished: true/);
        // Statewide figures use the bucket the state hub and salary guide use.
        expect(METRO_PAGE_CODE).toContain('canonicalBucketWhere({ state: metro.state }, now)');
        expect(METRO_PAGE_CODE).toContain('getGatedLocationSalary({ state: metro.state })');
    });

    it('M1: robots follow shouldIndexMetro over the canonical count, with a self canonical', () => {
        expect(METRO_PAGE_SRC).toMatch(/import \{[^}]*\bshouldIndexMetro\b[^}]*\} from '@\/lib\/pseo\/render-gate'/);
        expect(METRO_PAGE_CODE).toContain('shouldIndexMetro({ activeJobs: facts.total })');
        expect(METRO_PAGE_CODE).toContain('{ index: false, follow: true }');
        expect(METRO_PAGE_CODE).toContain('canonical: `${brand.baseUrl}/jobs/metro/${slug}`');
        expect(SITEMAP_CODE).toContain('shouldIndexMetro({ activeJobs: inventory.activeJobs })');
    });

    it('M1: the zero-job state makes no freshness claim and links the state surfaces', () => {
        expect(METRO_PAGE_CODE).toContain('buildMetroZeroJobsSentence(metro.city)');
        expect(METRO_PAGE_CODE).not.toMatch(/added daily|updated daily|updated today/);
        // The listings caption explains an inventory ("refreshed hourly", or
        // which nearby cities the count folds in), so it renders only when
        // there is one. It used to sit above the empty-state branch and print
        // a freshness claim directly above "No positions at this time".
        expect(METRO_PAGE_CODE).toMatch(/facts\.total >= 1 && \([\s\S]{0,400}refreshed hourly/);
        // The heading omits the count rather than printing "(0)".
        expect(METRO_PAGE_CODE).toMatch(/facts\.total >= 1 \? ` \(\$\{facts\.total\}\)` : ''/);
        // The state hub and salary guide 404 below one canonical job, so
        // every link to them carries the statewide gate.
        expect(METRO_PAGE_CODE).toContain('const stateLinksRender = state.total >= 1;');
        expect(METRO_PAGE_CODE).toMatch(/\/jobs\/state\/\$\{metro\.stateSlug\}[\s\S]{0,120}renders: stateLinksRender/);
        expect(METRO_PAGE_CODE).toMatch(/\/salary-guide\/\$\{metro\.stateSlug\}[\s\S]{0,120}renders: stateLinksRender/);
    });

    it('M2: pay is the gated median through PostedPay, never a posting mean', () => {
        expect(METRO_PAGE_SRC).toMatch(/import \{[\s\S]*?\bPostedPay\b[\s\S]*?\} from '@\/components\/seo\/pseo'/);
        expect(METRO_PAGE_CODE).toMatch(/const payVariant: PostedPayVariant = \{ kind: 'location', scopeName, scopeNoun: 'metro' \};/);
        expect(METRO_PAGE_CODE).toContain('<PostedPay');
        for (const banned of ['_avg', 'avgSalary', 'rawAvgSalary', 'salaryRange', 'MedianFigure', 'salaryGap', 'Average annual salary']) {
            expect(METRO_PAGE_CODE.includes(banned), `page still carries "${banned}"`).toBe(false);
        }
        expect(METRO_PAGE_CODE).not.toMatch(/\baverage\b/i);
        // The hero and the OG card show a figure only when the metro gate passes.
        expect(METRO_PAGE_CODE).toContain("stats.push({ value: formatK(facts.benchmark.median), label: 'median posted pay' });");
        expect(METRO_PAGE_CODE).toMatch(/\.\.\.\(facts\.benchmark !== null && \{ salary: formatK\(facts\.benchmark\.median\) \}\)/);
        // The statewide comparison needs both gates.
        expect(METRO_PAGE_CODE).toContain('if (!metroRow || !state.gatePassed || state.medianK === null) return null;');
    });

    it('M4: the employer card is EmployerRoster at the 2-employer floor', () => {
        expect(METRO_PAGE_SRC).toMatch(/import \{[\s\S]*?\bEmployerRoster\b[\s\S]*?\} from '@\/components\/seo\/pseo'/);
        expect(METRO_PAGE_CODE).toMatch(/const rosterVariant: EmployerRosterVariant = \{ kind: 'city', city: scopeName \};/);
        expect(METRO_PAGE_CODE).toContain('const rosterRenders = employerSentence(rosterVariant, facts) !== null;');
        expect(METRO_PAGE_CODE).toContain('<EmployerRoster variant={rosterVariant} facts={facts}');
        expect(METRO_PAGE_CODE).not.toContain('Top Employers');
    });

    it('M5: the live snapshot is a clay card of floored counts from listing-facts', () => {
        // The dark card became a clayCard (owner decision 2026-09-20); the
        // rows keep their dl and every one comes from a shared builder.
        expect(METRO_PAGE_CODE).not.toContain("background: '#1A2E35'");
        expect(METRO_PAGE_CODE).toContain('Live market snapshot');
        expect(METRO_PAGE_CODE).toContain('buildTerseWorkModeLine(facts.workMode, MIX_MIN_POSTINGS_HUB)');
        expect(METRO_PAGE_CODE).toContain('buildMetroCategoriesSentence(facts.categoryTop)');
        expect(METRO_PAGE_CODE).toContain('buildHubSettingsSentence(facts.settings)');
        expect(METRO_PAGE_CODE).toContain('buildHubRecencySentence(facts.recency)');
        // No share-of-state percentage: every metro sits below the share sample floor.
        expect(METRO_PAGE_CODE).not.toContain('shareOfState');
        expect(METRO_PAGE_CODE).not.toMatch(/\* 100\)/);
    });

    it('reads none of the unsourced record fields or setting lists (T0-4)', () => {
        // lib/metro-data.ts keeps avgCostOfLiving (now empty) and
        // costOfLivingNote (housing guidance only) for importers; the page
        // reads neither, nor the hand-typed topSettings list.
        for (const banned of ['avgCostOfLiving', 'costOfLivingNote', 'costOfLivingSplice', 'topSettings', 'HPSA']) {
            expect(METRO_PAGE_CODE.includes(banned), `page still renders "${banned}"`).toBe(false);
        }
        expect(METRO_PAGE_SRC).not.toMatch(/cost of living/i);
        expect(METRO_PAGE_CODE).not.toContain('Salary Outlook');
        expect(METRO_PAGE_CODE).not.toContain('TrendingUp');
    });

    it('metadata: title and description come from the shared builders, no keywords, no hero fragment', () => {
        expect(METRO_PAGE_CODE).toContain('buildMetroTitle({');
        expect(METRO_PAGE_CODE).toContain('year: new Date().getUTCFullYear()');
        expect(METRO_PAGE_CODE).toMatch(/truncateOnWord\(buildMetroDescription\(\{[\s\S]*?\}\), DESCRIPTION_MAX\)/);
        expect(METRO_PAGE_SRC).toMatch(/import \{[^}]*\btruncateOnWord\b[^}]*\} from '@\/lib\/display-text'/);
        expect(METRO_PAGE_CODE).not.toContain('function truncateOnWord');
        expect(METRO_PAGE_CODE).not.toContain('heroDescription.slice');
        expect(METRO_PAGE_CODE).not.toContain('keywords:');
        expect(METRO_PAGE_CODE).not.toContain('.slice(0, 158)');
    });

    it('hero: the badge and H1 sub-line come from the shared builders, one alert card per page', () => {
        expect(METRO_PAGE_CODE).toContain('buildLiveRolesBadge(facts.total)');
        expect(METRO_PAGE_CODE).toContain('headlineSub={buildMetroHeadlineSub(metro.stateCode)}');
        expect(METRO_PAGE_CODE).not.toContain('Find your fit');
        expect(METRO_PAGE_CODE).not.toMatch(/label: 'positions'/);
        // Exactly one alert card: the sidebar CTA. The bento alert cell is gone.
        expect(METRO_PAGE_CODE.match(/Create Alert/g)?.length).toBe(1);
        expect(METRO_PAGE_CODE).not.toContain('metro-bento-cta');
    });

    it('copy lint: no en or em dash, no spaced hyphen, no console.log, no style jsx, no sticker kit', () => {
        // U+2013 and U+2014, built from char codes so this file carries neither.
        const dashes = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
        expect(METRO_PAGE_SRC).not.toMatch(dashes);
        // A spaced hyphen in a string literal or in JSX text (arithmetic is fine).
        expect(METRO_PAGE_CODE).not.toMatch(/['"`][^'"`\n]* - [^'"`\n]*['"`]/);
        expect(METRO_PAGE_CODE).not.toMatch(/>[^<{\n]* - [^<{\n]*</);
        expect(METRO_PAGE_CODE).not.toContain('console.log');
        expect(METRO_PAGE_SRC).not.toContain('<style jsx');
        expect(METRO_PAGE_SRC).not.toContain('@/components/sticker');
        expect(METRO_PAGE_SRC).not.toContain('stk-');
        // Styles are inline objects plus one static string.
        const styleBlock = METRO_PAGE_SRC.slice(METRO_PAGE_SRC.indexOf('<style>{`'));
        expect(styleBlock).not.toContain('${');
    });
});

/*
 * T0-4 / METRO-M7, pinned against the DATA rather than the page source.
 *
 * The earlier version of this scan asserted only that the page file contained
 * no unsourced phrase, which proved nothing: the page did not spell the claim,
 * it rendered a record field that did. Three channels published the index
 * readings and the ranking claims lib/metro-data.ts admits it cannot source,
 * a hero deck, four bento bullets and twenty FAQ entries.
 *
 * So the filter is read out of the page and run over every record, and the
 * assertion is on what survives. Weaken a pattern in the page and a surviving
 * string carries the claim again, which fails here.
 */
describe('P2 #13: the page publishes no unsourced claim from lib/metro-data.ts', () => {
    /** One claim pattern, read from its declaration in the page. */
    const claimPattern = (name: string): RegExp => {
        const declared = new RegExp(`const ${name} = /(.+)/([a-z]*);`).exec(METRO_PAGE_SRC);
        expect(declared, `${name} is not declared in the metro page`).not.toBeNull();
        return new RegExp(declared![1], declared![2]);
    };

    const CLAIM_PATTERNS = ['CLAIM_QUANTITY', 'CLAIM_EXPENSE', 'CLAIM_PAY', 'CLAIM_RANK'].map(claimPattern);

    const isPublishable = (text: string): boolean => CLAIM_PATTERNS.every((pattern) => !pattern.test(text));
    const publishableProse = (note: string): string =>
        note.split(/(?<=\.)\s+/).filter(isPublishable).join(' ');

    /** Every record string the page renders, after the page's own filter. */
    const publishedProse = (metro: (typeof METRO_CITIES)[number]): string[] => [
        ...metro.whyThisMetro.filter(isPublishable).slice(0, 4),
        publishableProse(metro.careDemandContext),
        publishableProse(metro.licensureNote),
        ...metro.subMarkets.map((sub) => publishableProse(sub.note)).filter((note) => note !== ''),
        ...metro.subMarkets.map((sub) => sub.name),
        ...metro.faqs
            .filter((entry) => isPublishable(entry.question) && isPublishable(entry.answer))
            .flatMap((entry) => [entry.question, entry.answer]),
    ];

    /**
     * What may never reach a reader: an index reading or any percentage, a
     * comparison against a benchmark this board does not publish, a ranking or
     * growth-rate claim, a population magnitude lib/metro-data.ts calls an
     * orientation figure, and pay stated as a mean rather than the gated median.
     */
    const UNSOURCED = /cost of living|living costs|housing costs|national average|fastest[- ]growing|most affordable|\baverage\b|\d\s*%|\b\d[\d.,]*[\s-]*(?:million|billion)\b/i;

    it.each(METRO_CITIES.map((m) => [m.slug, m] as const))('%s publishes no unsourced claim', (slug, metro) => {
        for (const text of publishedProse(metro)) {
            expect(text, `${slug} publishes: ${text}`).not.toMatch(UNSOURCED);
        }
    });

    it('leaves every metro something to publish', () => {
        // The filter may not empty a page: if a record ever loses all of its
        // bullets or all of its care-demand prose, that record needs editing
        // (METRO-M7), not a looser filter.
        for (const metro of METRO_CITIES) {
            expect(metro.whyThisMetro.filter(isPublishable).length, `${metro.slug} bullets`).toBeGreaterThanOrEqual(1);
            expect(publishableProse(metro.careDemandContext), `${metro.slug} care demand`).not.toBe('');
            expect(publishableProse(metro.licensureNote), `${metro.slug} licensure note`).not.toBe('');
            expect(metro.subMarkets.filter((sub) => publishableProse(sub.note) !== '').length, `${metro.slug} sub-markets`).toBeGreaterThanOrEqual(2);
            // At zero reviewed questions CategoryFAQ falls through to the
            // built-in set for the slug, and 'metro' has none, so the band
            // would disappear without anything saying why.
            expect(
                metro.faqs.filter((entry) => isPublishable(entry.question) && isPublishable(entry.answer)).length,
                `${metro.slug} FAQ entries`,
            ).toBeGreaterThanOrEqual(1);
        }
    });

    it('the page renders the filtered copy, never the raw record field', () => {
        // The hero deck is the shared builder over sourced inputs; the bullets,
        // the sub-market notes, the care-demand prose and the FAQ array are all
        // filtered before they reach the markup.
        expect(METRO_PAGE_CODE).toContain('description={heroDeck}');
        expect(METRO_PAGE_CODE).not.toContain('metro.heroDescription');
        expect(METRO_PAGE_CODE).toContain('const metroBullets = metro.whyThisMetro.filter(isPublishable)');
        expect(METRO_PAGE_CODE).toContain('const careDemand = publishableProse(metro.careDemandContext);');
        expect(METRO_PAGE_CODE).toContain('const licensureNote = publishableProse(metro.licensureNote);');
        expect(METRO_PAGE_CODE).toMatch(/const reviewed = metro\.subMarkets\.map\(\(sub\) => \(\{ name: sub\.name, note: publishableProse\(sub\.note\) \}\)\);/);
        expect(METRO_PAGE_CODE).toMatch(/const reviewedFaqs = metro\.faqs\.filter\(\(entry\) => isPublishable\(entry\.question\) && isPublishable\(entry\.answer\)\);/);
        // The bullet tiles and the rail read the filtered lists, not the record.
        expect(METRO_PAGE_CODE).toContain('{metroBullets.map(');
        expect(METRO_PAGE_CODE).toContain('{subMarkets.map(');
        expect(METRO_PAGE_CODE).toContain('{careDemand}');
    });
});

/*
 * METRO-M7: the records themselves.
 *
 * The page filter above is a backstop. The 2026-09-26 sweep made the records
 * clean at the source, and these pins keep them that way. Most of them name a
 * specific false fact that an earlier, never shipped rewrite of this file
 * introduced while removing unsourced claims (the independent audit of that
 * rewrite listed each one), so a future edit cannot quietly restore it.
 */
describe('METRO-M7: the records state only sourced, verified facts', () => {
    type Metro = (typeof METRO_CITIES)[number];
    const everyString = (m: Metro): string[] => [
        m.heroDescription, m.costOfLivingNote, m.licensureNote, m.careDemandContext,
        m.avgCostOfLiving, m.population, ...m.whyThisMetro, ...m.topSettings,
        ...m.subMarkets.flatMap((s) => [s.name, s.note]),
        ...m.faqs.flatMap((f) => [f.question, f.answer]),
    ];
    const sentencesOf = (text: string): string[] => text.split(/(?<=[.?!])\s+(?=[A-Z])/);
    const allSentences = METRO_CITIES.flatMap((m) =>
        everyString(m).flatMap((text) => sentencesOf(text).map((sentence) => [m.slug, sentence] as const)));
    const metro = (slug: string): Metro => {
        const found = getMetroCity(slug);
        expect(found, slug).toBeDefined();
        return found!;
    };
    const subMarket = (slug: string, pattern: RegExp) => {
        const found = metro(slug).subMarkets.find((s) => pattern.test(s.name));
        expect(found, `${slug} has no sub-market matching ${pattern}`).toBeDefined();
        return found!;
    };

    const claimPattern = (name: string): RegExp => {
        const declared = new RegExp(`const ${name} = /(.+)/([a-z]*);`).exec(METRO_PAGE_SRC);
        expect(declared, `${name} is not declared in the metro page`).not.toBeNull();
        return new RegExp(declared![1], declared![2]);
    };

    it('the page filter drops nothing: every rendered record string already passes it', () => {
        const patterns = ['CLAIM_QUANTITY', 'CLAIM_EXPENSE', 'CLAIM_PAY', 'CLAIM_RANK'].map(claimPattern);
        const blocked = (text: string) => patterns.some((pattern) => pattern.test(text));
        for (const m of METRO_CITIES) {
            const rendered = [
                ...m.whyThisMetro, m.careDemandContext, m.licensureNote,
                ...m.subMarkets.map((s) => s.note),
                ...m.faqs.flatMap((f) => [f.question, f.answer]),
            ];
            for (const text of rendered) {
                for (const sentence of text.split(/(?<=\.)\s+/)) {
                    expect(blocked(sentence), `${m.slug}: ${sentence}`).toBe(false);
                }
            }
        }
    });

    it('names the credential through brand tokens', () => {
        expect(METRO_DATA_SRC).toContain("import { brand } from '@/config/brand';");
        expect(METRO_DATA_CODE).toContain('const NP = brand.niche.short;');
        // A bare "NP" or "NPs" typed into prose instead of the token.
        expect(METRO_DATA_CODE).not.toMatch(/(?<![{A-Za-z$])NPs?\b(?! =)/);
    });

    it('every licensure note restates its state\'s verified details', () => {
        // Shares at least one five-word run with the state's details string,
        // so the note is anchored to the verified rule rather than paraphrased
        // from memory.
        const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9,' ]+/g, ' ').replace(/,/g, '').split(/\s+/).filter(Boolean);
        const runs = (text: string) => {
            const w = words(text);
            return new Set(w.slice(0, Math.max(w.length - 4, 0)).map((_, i) => w.slice(i, i + 5).join(' ')));
        };
        for (const m of METRO_CITIES) {
            const detailRuns = runs(STATE_PRACTICE_AUTHORITY[m.state].details);
            const shared = [...runs(m.licensureNote)].filter((run) => detailRuns.has(run));
            expect(shared.length, `${m.slug} licensure note shares no wording with the ${m.state} details`).toBeGreaterThan(0);
        }
    });

    it('Arizona has no transition period, and prescribing waits for the Board', () => {
        // The unshipped rewrite gave Arizona a "transition-to-practice period"
        // in seven places. The verified entry says there is none.
        expect(STATE_PRACTICE_AUTHORITY['Arizona'].details).toMatch(/without physician supervision, a collaborative agreement or a transition period/);
        for (const text of everyString(metro('phoenix-az'))) {
            expect(text).not.toMatch(/transition[- ]to[- ]practice|once the transition|after (?:a|the) transition|transition period is complete/i);
        }
        expect(metro('phoenix-az').licensureNote).toContain('no physician supervision, collaborative agreement, or transition period');
        expect(metro('phoenix-az').licensureNote).toContain('prescribe once the Board grants prescribing and dispensing authority');
    });

    it('Virginia is a patient care team physician, never a supervising physician', () => {
        const virginia = allSentences.filter(([, s]) => /Virginia/.test(s) && /practice agreement/.test(s));
        expect(virginia.length).toBeGreaterThanOrEqual(3);
        for (const [slug, sentence] of virginia) {
            expect(sentence, `${slug}: ${sentence}`).toContain('patient care team physician');
        }
        for (const [slug, sentence] of allSentences) {
            expect(sentence, `${slug}: ${sentence}`).not.toMatch(/Virginia[^.]*supervising physician/);
        }
    });

    it('Delaware grants full practice authority at licensure, with no experience requirement', () => {
        for (const [slug, sentence] of allSentences.filter(([, s]) => /Delaware grants/.test(s))) {
            expect(sentence, `${slug}: ${sentence}`).not.toMatch(/experience requirement|once experience|after (?:a|the) transition/i);
        }
    });

    it('New Jersey is never a plain collaborative agreement requirement, and always carries the 2026 law', () => {
        // Clause level: a Philadelphia sentence names Pennsylvania's
        // collaborative agreement and New Jersey's joint protocols side by side.
        for (const [slug, sentence] of allSentences.filter(([, s]) => /New Jersey/.test(s))) {
            expect(sentence, `${slug}: ${sentence}`).not.toMatch(/New Jersey[^,;]*collaborative (?:agreement|relationship)/);
            if (/joint protocol/.test(sentence)) expect(sentence, `${slug}: ${sentence}`).toMatch(/2026/);
        }
    });

    it('New York practice agreements are made per NP, never a slot inside an existing agreement', () => {
        // NYSED: an NP who needs a written agreement must enter into one with
        // a physician in the NP's specialty, and a physician may hold such
        // agreements with at most four off-premises NPs. There is no existing
        // agreement a newer NP can be placed inside.
        for (const [slug, sentence] of allSentences) {
            expect(sentence, `${slug}: ${sentence}`).not.toMatch(/(?:inside|into|under|within) an existing (?:written )?(?:practice )?agreement|place a newer/i);
        }
        const answer = metro('new-york-ny').faqs.find((f) => /3,600-hour threshold/.test(f.question))?.answer;
        expect(answer).toBeDefined();
        expect(answer).toContain('enter into a written practice agreement with a newer');
    });

    it('Tampa geography: Tampa General on Davis Islands, Moffitt and the Haley VA by USF in north Tampa', () => {
        const davis = subMarket('tampa-fl', /Davis Islands/);
        expect(davis.note).not.toMatch(/Moffitt|Haley|nearby/);
        const usf = subMarket('tampa-fl', /USF/);
        expect(usf.note).toContain('Moffitt');
        expect(usf.note).toContain('Haley');
        expect(usf.note).toContain('north Tampa');
        for (const sub of metro('tampa-fl').subMarkets.filter((s) => /South Tampa/.test(s.name))) {
            expect(sub.note).not.toMatch(/Haley/);
        }
    });

    it('Phoenix geography: the West Valley holds Sun City, so no retirees-versus-families split', () => {
        expect(subMarket('phoenix-az', /West Valley/).note).toContain('Sun City');
        for (const text of everyString(metro('phoenix-az'))) {
            expect(text).not.toMatch(/East Valley retirees|West Valley young families|young families in the West Valley/);
        }
    });

    it('Jacksonville geography: Mayo is in the southeast, and the VA sites are clinics', () => {
        expect(subMarket('jacksonville-fl', /Mayo/).note).toContain('southeast');
        for (const text of everyString(metro('jacksonville-fl'))) {
            expect(text).not.toMatch(/north side|VA medical center/i);
        }
    });

    it('other places the audit found misdescribed stay corrected', () => {
        // Wilson County is east of Nashville, not north.
        expect(subMarket('nashville-tn', /Wilson|eastern/).name).toMatch(/eastern/);
        // Nationwide Children's is just south of downtown Columbus.
        expect(metro('columbus-oh').subMarkets.map((s) => s.name)).not.toContain('Near East Side and Downtown');
        const allText = METRO_CITIES.flatMap(everyString).join('\n');
        for (const stale of [
            'upper Northwest', // the Irving Street complex is east of Rock Creek Park
            'border-adjacent', // the counties around Bexar do not touch the border
            'Joint Base San Antonio installations', // Lackland is on the southwest side
            'The bay separates two hospital networks', // BayCare runs hospitals on both sides
            'most commonly prescribing', // unsourced, and wrong for Ohio
            'Schedule II', // an Illinois consultation rule not in the verified entry
            'national standards of practice', // a different VA initiative from 38 CFR 17.415
            'across the street', // Keck Hospital of USC is about half a mile from LA General
        ]) {
            expect(allText, stale).not.toContain(stale);
        }
    });

    it('every VA full practice authority sentence keeps all three limits of 38 CFR 17.415', () => {
        const vaStrings = METRO_CITIES.flatMap(everyString).filter((t) => /VA grant full practice authority/.test(t));
        expect(vaStrings.length).toBeGreaterThanOrEqual(3);
        for (const text of vaStrings) {
            expect(text, text).toMatch(/\bqualifying\b|meet its requirements/);
            expect(text, text).toMatch(/VA employment/);
            expect(text, text).toContain('Controlled Substances Act');
        }
    });

    it('states no tax rule, coverage rate, or income or insurance claim about an area', () => {
        const banned = /no state income tax|flat (?:state |individual )?income tax|does not tax wage|taxes no wage|levies no|income tax rate|Medicaid expansion|uninsured rate|well-insured|heavily insured|commercially insured|affluent/i;
        for (const [slug, sentence] of allSentences) {
            expect(sentence, `${slug}: ${sentence}`).not.toMatch(banned);
        }
    });
});
