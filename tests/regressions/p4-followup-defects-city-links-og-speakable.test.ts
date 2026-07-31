/**
 * P4 — the five cross-ownership follow-ups P2/P3 identified but could not reach.
 *
 *   (a) THE REAL DEFECT. app/jobs/state/[state]/page.tsx renders a "Top Cities"
 *       grid from a groupBy that takes the top 8 cities by volume with NO floor,
 *       and links each one at /jobs/city/<slug>. That route notFound()s below its
 *       MIN_JOBS render gate, so every city in the grid carrying 1–2 postings was
 *       a guaranteed 404. This is a DIFFERENT failure from the P3 round-trip
 *       guard already applied there: cityLinkResolves asks "can the route rebuild
 *       this NAME from the slug", not "does the route have the stock to render".
 *       A city can pass the first and still 404 on the second.
 *
 *   (b) app/jobs/city/[slug] and app/jobs/metro/[slug] pointed their OG cards at
 *       the general-purpose /api/og `type=page` mode (title + prose subtitle)
 *       while /api/og/city — same chrome since P3 #8 — renders jobs-count and
 *       salary fact tiles. Routed to the dedicated generator, passing ONLY the
 *       params that route reads, and deliberately passing neither `category`
 *       (these are all-specialty hubs) nor `shortage` (behavioral-health-only
 *       designation; P3 kept that gate narrow on purpose).
 *
 *   (c) Speakable parity: P3 added `className="faq-answer"` to
 *       components/CategoryFAQAccordion, the class every other FAQ surface
 *       declares, so lib/pseo/setting-state-template.tsx could widen its
 *       SpeakableSpecification.cssSelector to include '.faq-answer'.
 *
 *       CORRECTED: the class existing is necessary but not sufficient.
 *       CATEGORY_FAQS is a Partial<Record<CategorySlug, …>> and
 *       'psychiatric-mental-health' has no entry, so getCategoryFaqs() returns
 *       [], <CategoryFAQ> returns null before rendering any <p>, and the
 *       accordion — class and all — is absent. Widening the array
 *       unconditionally therefore claimed a selector matching no markup on the
 *       51 psych×state URLs, the site's flagship niche: precisely the false
 *       claim the P2 tripwire was written to prevent. The selector is now
 *       gated on the same getCategoryFaqs() call the renderer makes (27 of 28
 *       state-eligible categories declare it; the 28th does not).
 *
 *       The category×city template was reported as carrying the identical
 *       divergence. It does NOT — it never touches CATEGORY_FAQS; it builds a
 *       fixed five-element `categoryCityFaqs` literal that every category
 *       renders. Its unconditional selector is correct, and is pinned below.
 *
 *   (d) middleware.ts documented its two pSEO allowlists with stale directory
 *       counts on a load-bearing 410 gate.
 *
 *   (e) The three repaired city slugs are still keyed on their OLD values in
 *       PseoStats.locationSlug, CitySnippet.citySlug and
 *       CategoryCitySnippet.citySlug. scripts/repair-city-slug-diacritics-db.ts
 *       renames them; these pins hold the rename table honest against the
 *       dataset and the 301 map WITHOUT importing the script (its module body
 *       constructs a Prisma client on purpose — see its env-selection header).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getCityBySlug } from '@/lib/pseo/city-data/cities';
import { MIN_CITY_JOBS_FOR_LINK } from '@/app/jobs/locations/[state]/directory';
import { MIN_JOBS_FOR_CATEGORY_CITY } from '@/lib/pseo/render-gate';
import {
    ALL_CATEGORY_SLUGS,
    STATE_ELIGIBLE_CATEGORY_SLUGS,
} from '@/lib/pseo/taxonomy-registry';
import { getCategoryFaqs, type CategorySlug } from '@/lib/pseo/category-faq-data';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source with comments stripped. Several pins below assert that a shape is
 * ABSENT, and the comments that document those shapes quote them verbatim —
 * without this the documentation would fail the test it documents.
 *
 * LINE comments are stripped FIRST, on purpose. app/jobs/city/[slug]/page.tsx
 * carries a line comment reading "the redirect from /jobs/city/* to
 * /jobs/metro/* lives in …": stripping block comments first treats that `/*` as
 * a block opener and swallows the next 9KB of real code, silently voiding every
 * assertion that follows.
 */
const readCode = (rel: string): string =>
    read(rel)
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

const STATE_HUB = 'app/jobs/state/[state]/page.tsx';
const CITY_PAGE = 'app/jobs/city/[slug]/page.tsx';
const METRO_PAGE = 'app/jobs/metro/[slug]/page.tsx';
const OG_CITY_ROUTE = 'app/api/og/city/route.tsx';
const STATE_TEMPLATE = 'lib/pseo/setting-state-template.tsx';
const FAQ_ACCORDION = 'components/CategoryFAQAccordion.tsx';
const MIDDLEWARE = 'middleware.ts';
const DB_REPAIR_SCRIPT = 'scripts/repair-city-slug-diacritics-db.ts';

// ─── (a) the state hub links no city the city route will 404 ────────────────

describe('P4 (a) — Top Cities links carry the inventory gate, not just the name gate', () => {
    const code = () => readCode(STATE_HUB);

    it('imports the shared threshold instead of re-typing the number', () => {
        expect(code()).toMatch(
            /import\s*\{[^}]*\bMIN_CITY_JOBS_FOR_LINK\b[^}]*\}\s*from\s*'@\/app\/jobs\/locations\/\[state\]\/directory'/,
        );
    });

    it('gates the linkable flag on the job count AND the slug round-trip', () => {
        const src = code();
        // The count gate — expressed through the constant, never a literal.
        expect(src).toMatch(/_count\.city\s*>=\s*MIN_CITY_JOBS_FOR_LINK/);
        // The P3 round-trip guard is still there; this is an AND, not a swap.
        expect(src).toMatch(/cityLinkResolves\(name,\s*stateCode\)/);
        expect(src).toMatch(
            /const\s+linkable\s*=[\s\S]{0,200}?MIN_CITY_JOBS_FOR_LINK[\s\S]{0,200}?&&[\s\S]{0,200}?cityLinkResolves/,
        );
    });

    it('never compares the city count against a bare number', () => {
        // A literal here is how the two gates drift apart again.
        expect(code()).not.toMatch(/_count\.city\s*>=?\s*\d/);
    });

    it('the shared threshold still equals every other pSEO city gate', () => {
        // Belt and braces with tests/regressions/p2-mesh-directories-state-cities:
        // that suite pins the city route's own MIN_JOBS literal to this constant,
        // which is what makes "link gate == render gate" true by construction.
        expect(MIN_CITY_JOBS_FOR_LINK).toBe(MIN_JOBS_FOR_CATEGORY_CITY);
        const cityGate = readCode(CITY_PAGE).match(/const\s+MIN_JOBS\s*=\s*(\d+)/);
        expect(cityGate, 'city route MIN_JOBS gate not found — it moved').toBeTruthy();
        expect(Number(cityGate![1])).toBe(MIN_CITY_JOBS_FOR_LINK);
    });

    it('only the gated list reaches the rendered grid', () => {
        const src = code();
        // linkableCities is the filtered list; the raw citiesWithJobs list must
        // not be what the <Link> maps over.
        expect(src).toMatch(/const\s+linkableCities\s*=\s*citiesWithJobs\.filter/);
        expect(src).toMatch(/linkableCities\.map\(\(c\)\s*=>/);
        expect(src).not.toMatch(/citiesWithJobs\.map\([^)]*\)\s*=>\s*\(?\s*<Link/);
    });

    it('the rejected cities are still NAMED — the fix drops links, not facts', () => {
        const src = code();
        // The narrative and the "which cities" FAQ read the ungated list on
        // purpose: withholding a dead link must never rewrite a true claim.
        expect(src).toMatch(/topCityNames:\s*citiesWithJobs\.slice/);
        expect(src).toMatch(/citiesWithJobs\.length > 0/);
    });
});

// ─── (b) both place pages use the dedicated city OG generator ───────────────

describe('P4 (b) — city and metro OG cards route to /api/og/city', () => {
    /** Params /api/og/city actually reads, parsed from the route itself. */
    const routeParams = (): Set<string> => {
        const matches = read(OG_CITY_ROUTE).matchAll(/searchParams\.get\('([^']+)'\)/g);
        return new Set([...matches].map((m) => m[1]));
    };

    /** The object literal passed to `new URLSearchParams({ … })` on a page. */
    const ogParamBlock = (rel: string): string => {
        const src = readCode(rel);
        const start = src.indexOf('new URLSearchParams({');
        expect(start, `${rel} builds no URLSearchParams for its OG card`).toBeGreaterThan(-1);
        const end = src.indexOf('});', start);
        return src.slice(start, end);
    };

    const passedKeys = (rel: string): string[] =>
        [...ogParamBlock(rel).matchAll(/(?:^|[{\s])([a-zA-Z]\w*):/gm)].map((m) => m[1]);

    it('the generator still reads the params these pages depend on', () => {
        const params = routeParams();
        for (const key of ['city', 'jobs', 'salary', 'category', 'shortage']) {
            expect(params.has(key), `/api/og/city no longer reads "${key}"`).toBe(true);
        }
    });

    for (const rel of [CITY_PAGE, METRO_PAGE]) {
        it(`${rel} points og:image at /api/og/city, not the generic generator`, () => {
            const src = readCode(rel);
            expect(src).toContain('/api/og/city?');
            expect(src, 'still on the generic title+subtitle card').not.toContain('/api/og?type=page');
        });

        it(`${rel} passes only params /api/og/city reads`, () => {
            const params = routeParams();
            const keys = passedKeys(rel);
            expect(keys.length).toBeGreaterThan(0);
            for (const key of keys) {
                expect(params.has(key), `${rel} passes "${key}", which /api/og/city ignores`).toBe(true);
            }
        });

        it(`${rel} passes city and jobs`, () => {
            const keys = passedKeys(rel);
            expect(keys).toContain('city');
            expect(keys).toContain('jobs');
        });

        it(`${rel} never passes shortage — that badge is behavioral-health only`, () => {
            // P3 deliberately did NOT widen the gate. These hubs carry no
            // category, so the designation can never be on topic here.
            expect(ogParamBlock(rel)).not.toContain('shortage');
        });

        it(`${rel} never passes category — an all-specialty hub has none`, () => {
            expect(ogParamBlock(rel)).not.toContain('category');
        });

        it(`${rel} omits the salary tile rather than inventing a band`, () => {
            // The salary key is conditional on live disclosed pay, never a
            // hardcoded fallback figure.
            expect(ogParamBlock(rel)).toMatch(/\.\.\.\([\s\S]*?&&\s*\{\s*salary:/);
        });

        it(`${rel} feeds og and twitter from ONE built URL`, () => {
            const src = readCode(rel);
            const built = src.match(/const\s+ogImageUrl\s*=\s*`\/api\/og\/city\?/);
            expect(built, `${rel} should build the card URL once`).toBeTruthy();
            // Two independent template literals are how the two cards drift.
            expect((src.match(/`\/api\/og\/city\?/g) ?? []).length).toBe(1);
        });
    }
});

// ─── (c) Speakable parity on the setting×state template ─────────────────────

describe('P4 (c) — setting×state Speakable declares the FAQ answers', () => {
    it('the accordion still renders the class the selector points at', () => {
        const src = read(FAQ_ACCORDION);
        expect(src).toContain('className="faq-answer"');
        expect(src).toMatch(/<p className="faq-answer"[\s\S]{0,200}\{faq\.answer\}/);
    });

    it('declares #answer-summary unconditionally and .faq-answer only when gated', () => {
        const selector = readCode(STATE_TEMPLATE).match(/cssSelector: ([\s\S]{0,240}?),\r?\n/);
        expect(selector).not.toBeNull();
        // #answer-summary renders on every state page, so it is never gated.
        expect(selector![1]).toContain('#answer-summary');
        // .faq-answer may only appear on the TRUE side of a conditional.
        expect(selector![1]).toMatch(/\?[\s\S]*'\.faq-answer'/);
        const [, ifTrue = '', ifFalse = ''] = selector![1].split(/\?|:/);
        expect(ifTrue).toContain('.faq-answer');
        expect(ifFalse).not.toContain('.faq-answer');
        expect(ifFalse).toContain('#answer-summary');
    });

    it('the gate is the same getCategoryFaqs call the renderer makes', () => {
        // A gate computed from different inputs than <CategoryFAQ> receives
        // could disagree with it, which is the whole failure mode. Pin that
        // both read config.faqCategory + stats.totalJobs and nothing else.
        const code = readCode(STATE_TEMPLATE);
        const gate = code.match(/getCategoryFaqs\(\{([\s\S]{0,200}?)\}\)\.length > 0/);
        expect(gate).not.toBeNull();
        expect(gate![1]).toContain('config.faqCategory');
        expect(gate![1]).toContain('stats.totalJobs');
        expect(gate![1]).not.toContain('avgSalary');
        expect(gate![1]).not.toContain('customFaqs');

        const render = code.match(/<CategoryFAQ([\s\S]{0,200}?)\/>/);
        expect(render).not.toBeNull();
        expect(render![1]).toContain('config.faqCategory');
        expect(render![1]).toContain('stats.totalJobs');
        expect(render![1]).not.toContain('avgSalary');
        expect(render![1]).not.toContain('customFaqs');
    });

    it('#answer-summary is rendered and .faq-answer reaches the page via CategoryFAQ', () => {
        const template = read(STATE_TEMPLATE);
        expect(template).toContain('id="answer-summary"');
        expect(template).toContain("from './category-faq-data'");
        expect(read('components/CategoryFAQ.tsx')).toContain('CategoryFAQAccordion');
    });

    it('CategoryFAQ renders NOTHING for an unmapped key — the reason the gate exists', () => {
        // This is the mechanism the unconditional selector overlooked: the
        // class on the <p> is irrelevant when the component short-circuits
        // before rendering any <p> at all.
        expect(read('components/CategoryFAQ.tsx')).toMatch(
            /faqs\.length === 0\)\s*return null/,
        );
    });

    it('every state-eligible category either renders FAQ answers or is caught by the gate', () => {
        // Behavioural, not a hardcoded slug list: computed from the same
        // SETTING_CONFIGS → getCategoryFaqs path the template runs, so adding
        // (or dropping) FAQ copy moves these numbers on its own.
        const rendersFaqs = (slug: string): boolean => {
            const config = SETTING_CONFIGS[slug];
            if (!config) return false;
            return (
                getCategoryFaqs({
                    category: config.faqCategory as CategorySlug,
                    totalJobs: 10,
                }).length > 0
            );
        };
        const unmapped = STATE_ELIGIBLE_CATEGORY_SLUGS.filter((s) => !rendersFaqs(s));

        // While ANY state-eligible category is unmapped, an unconditional
        // '.faq-answer' would be a false Speakable claim on 51 URLs per slug.
        // 'psychiatric-mental-health' is the current one — the site's flagship
        // niche — but the pin deliberately does not name it.
        expect(unmapped.length).toBeGreaterThan(0);
        expect(unmapped.length).toBeLessThan(STATE_ELIGIBLE_CATEGORY_SLUGS.length);
        for (const slug of unmapped) {
            expect(SETTING_CONFIGS[slug], `${slug} must still have a state config`).toBeDefined();
        }
    });

    it('the category×city template is NOT affected — its FAQ array is unconditional', () => {
        // Reported as carrying "the identical divergence". It does not:
        // category-city-template.tsx does not use CategoryFAQ/CATEGORY_FAQS at
        // all. It builds `categoryCityFaqs` as a literal array of five
        // {q,a} objects that every category gets, each rendered through a <p
        // className="faq-answer">. So '.faq-answer' always matches there and
        // its unconditional selector is correct. Pinned so that stops being
        // true loudly if the array ever becomes conditional.
        const city = read('lib/pseo/category-city-template.tsx');
        // It *mentions* getCategoryFaqs / CategoryFAQ in notes about unmapped
        // keys, but never imports or calls either — assert on the import and
        // the element, which comments cannot forge.
        expect(city).not.toMatch(/import\s+CategoryFAQ\b/);
        expect(city).not.toMatch(/import\s*\{[^}]*getCategoryFaqs/);
        expect(city).not.toContain('<CategoryFAQ');
        expect(readCode('lib/pseo/category-city-template.tsx')).not.toMatch(/getCategoryFaqs\(/);
        const arr = city.match(/const categoryCityFaqs = \[([\s\S]*?)\n {2}\];/);
        expect(arr).not.toBeNull();
        const body = arr![1];
        // No spread and no element-level conditional => length is fixed.
        expect(body).not.toMatch(/\n {4}\.\.\./);
        expect(body.match(/\n {4}\{/g) ?? []).toHaveLength(5);
        expect(city).toMatch(/categoryCityFaqs\.map\(\(faq, i\) =>/);
        expect(city).toContain('<p className="faq-answer"');
    });
});

// ─── (d) the middleware allowlist comment tells the truth ───────────────────

describe('P4 (d) — middleware documents the real allowlist sizes', () => {
    const countRouteDirs = (child: string): number =>
        fs
            .readdirSync(path.join(ROOT, 'app/jobs'), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .filter((entry) => fs.existsSync(path.join(ROOT, 'app/jobs', entry.name, child)))
            .filter((entry) => ALL_CATEGORY_SLUGS.includes(entry.name)).length;

    it('the registry agrees with the physical route folders', () => {
        // Namespace segments (jobs/state, jobs/locations) also own a [state]
        // folder, so the category filter above is what makes these comparable.
        expect(countRouteDirs('city')).toBe(ALL_CATEGORY_SLUGS.length);
        expect(countRouteDirs('[state]')).toBe(STATE_ELIGIBLE_CATEGORY_SLUGS.length);
    });

    it('the comment counts match the sets they describe', () => {
        const src = read(MIDDLEWARE);
        const stateLine = src.match(/state-eligible:.*?\((\d+) dirs\)/);
        const cityLine = src.match(/city-eligible:.*?\((\d+) dirs\)/);
        expect(stateLine, 'state-eligible comment line not found').toBeTruthy();
        expect(cityLine, 'city-eligible comment line not found').toBeTruthy();
        expect(Number(stateLine![1])).toBe(STATE_ELIGIBLE_CATEGORY_SLUGS.length);
        expect(Number(cityLine![1])).toBe(ALL_CATEGORY_SLUGS.length);
    });

    it('the stale figures are gone', () => {
        const src = read(MIDDLEWARE);
        expect(src).not.toMatch(/state-eligible:.*?\(13 dirs\)/);
        expect(src).not.toMatch(/city-eligible:.*?\(28 dirs\)/);
    });
});

// ─── (e) the DB rename table is honest ──────────────────────────────────────

describe('P4 (e) — the city-slug DB rename script', () => {
    /**
     * Pairs are read out of the script's source rather than imported: the module
     * body selects an env and constructs a Prisma client at import time (the
     * repo's convention for db: scripts), which a unit test must not trigger.
     */
    const renames = (): { from: string; to: string }[] =>
        [...read(DB_REPAIR_SCRIPT).matchAll(/from: '([a-z0-9-]+)', to: '([a-z0-9-]+)'/g)]
            .map((m) => ({ from: m[1], to: m[2] }));

    it('renames exactly the three diacritic-garbled slugs', () => {
        expect(renames()).toHaveLength(3);
    });

    it('every target slug is a live city and every source slug is retired', () => {
        for (const { from, to } of renames()) {
            expect(getCityBySlug(to), `${to} is not in the dataset`).toBeTruthy();
            expect(getCityBySlug(from), `${from} is still a live dataset slug`).toBeFalsy();
        }
    });

    it('every rename has the matching 301 already shipped in next.config.ts', () => {
        // The URL half was done in P3; renaming DB rows without it would strand
        // the indexed forms.
        const config = read('next.config.ts');
        for (const { from, to } of renames()) {
            expect(config).toContain(`/jobs/:category/city/${from}`);
            expect(config).toContain(`/jobs/:category/city/${to}`);
        }
    });

    it('covers all three columns the P3 dataset repair left behind', () => {
        const src = read(DB_REPAIR_SCRIPT);
        expect(src).toContain('prisma.pseoStats');
        expect(src).toContain('prisma.citySnippet');
        expect(src).toContain('prisma.categoryCitySnippet');
        expect(src).toContain('locationSlug');
        expect(src).toContain('citySlug');
    });

    it('is dry-run by default and offers --check', () => {
        const src = read(DB_REPAIR_SCRIPT);
        expect(src).toContain("process.argv.includes('--apply')");
        expect(src).toContain("process.argv.includes('--check')");
        // Writes are reachable only behind --apply.
        expect(src).toMatch(/if \(!APPLY\)[\s\S]{0,240}?return;/);
        expect(src).toMatch(/if \(CHECK_ONLY\)[\s\S]{0,300}?return;/);
    });

    it('targets a database explicitly, like the other db: scripts', () => {
        const src = read(DB_REPAIR_SCRIPT);
        expect(src).toContain("startsWith('--env=')");
        expect(src).toContain('PROD_DATABASE_URL');
    });

    it('validates the rename table against the dataset before querying', () => {
        expect(read(DB_REPAIR_SCRIPT)).toContain('assertRenamesMatchDataset()');
    });

    it('never deletes a row', () => {
        const src = readCode(DB_REPAIR_SCRIPT);
        expect(src).not.toMatch(/\.delete\(|\.deleteMany\(/);
    });
});
