/**
 * Pending work 2.21: navigation cards claim no coverage the board cannot
 * guarantee.
 *
 * Twenty-three category landings and the metro guide link /jobs/locations
 * from a card whose sub-label read "Browse every state", "All 50 states" or
 * "50 states". The directory lists the states and cities that hold open
 * roles today (its grid is a groupBy over live listings), so no fixed figure
 * describes it. app/not-found.tsx and the M-08 checks in
 * indexing-site-copy.test.ts hold the same rule for this destination: name
 * it, never size it. Every card now carries one sub-label, in the words of
 * the directory's own title.
 *
 * 2.21 follow-ups: the site-wide footer linked the directory as "Browse All
 * 50 States" on every page, and the old landing generator
 * (scripts/gen-missing-pages.js) still wrote the card as "50 states". The
 * scan now reads every route file under app/jobs, every component, every lib
 * module and the generator, and it reads each link whole: its attributes,
 * its `{}` strings and every value, not only the text it prints. A JSX link
 * is a `<Link>` or an `<a>`, its href in quotes or in braces.
 *
 * The directory's Travel tile was sub-labelled "Locum tenens", a category
 * with a landing of its own that the travel bucket does not count
 * (tests/unit/category-predicate.test.ts). The mid-career landing made the
 * reverse mix-up and sub-labelled its Locum Tenens card "Travel assignments".
 *
 * Text assertions on source, the convention of the copy suites beside this
 * one.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Strip block, line and JSX comments so prose that quotes a removed label
 * does not trip a guard. A `/*` right after a word, a quote, a `*` or a
 * backslash sits in a string or a pattern ("image/*", a glob), not at the
 * start of a comment: read as one, it would erase every line up to the next
 * comment's end, the links on them included.
 */
const code = (src: string) =>
    src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/(?<![\w'"`*\\])\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

/** Every file under `dir` whose name `keep` accepts, repo-relative. */
function files(dir: string, keep: (name: string) => boolean): string[] {
    return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return files(rel, keep);
        return keep(entry.name) ? [rel] : [];
    });
}

/** `text` as a literal piece of a pattern. */
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** `href: '<href>'` in an object literal, in any quotes. */
const literalHref = (href: string): RegExp => new RegExp(`\\bhref:\\s*(['"\`])${escapeRe(href)}\\1`, 'g');

/** A `{ ... }` literal, nested one level at most, that links `href`. */
const linkLiteral = (href: string): RegExp =>
    new RegExp(`\\{(?:[^{}]|\\{[^{}]*\\})*?${literalHref(href).source}(?:[^{}]|\\{[^{}]*\\})*\\}`, 'g');

const DIRECTORY_HREF = '/jobs/locations';
const DIRECTORY_LITERAL = linkLiteral(DIRECTORY_HREF);

/** A JSX href to the directory: in quotes, or in braces in any quotes. */
const JSX_HREF = String.raw`\bhref=(?:["']\/jobs\/locations["']|\{\s*['"\x60]\/jobs\/locations['"\x60]\s*\})`;

/**
 * A JSX link to the directory, a `<Link>` or an `<a>`, through its closing
 * tag. Its opening tag may hold an arrow function (`onMouseEnter={(e) => ...}`).
 */
const DIRECTORY_JSX_LINK = new RegExp(String.raw`<(Link|a)\b(?:=>|[^>])*?${JSX_HREF}(?:=>|[^>])*>[\s\S]*?<\/\1>`, 'g');

/** The same href in each shape on its own, to prove no link went unread. */
const LITERAL_HREF = literalHref(DIRECTORY_HREF);
const JSX_HREF_ANYWHERE = new RegExp(JSX_HREF, 'g');

/** Every quoted value in a literal that is copy rather than a path. */
const copyOf = (literal: string): string[] =>
    [...literal.matchAll(/(['"`])((?:(?!\1).)*)\1/g)].map((match) => match[2]).filter((text) => !text.startsWith('/'));

/** A literal's sub-label, when it is a string. */
const subOf = (literal: string): string | undefined => /\bsub:\s*(['"`])((?:(?!\1).)*)\1/.exec(literal)?.[2];

/** A link as the suite reads it: its whole source, not only the text it prints. */
interface LinkSource {
    source: string;
}

/** Each object literal in `src` that links the directory. */
const literalLinks = (src: string): LinkSource[] => [...src.matchAll(DIRECTORY_LITERAL)].map(([source]) => ({ source }));

/** Each JSX link to the directory in `src`. */
const jsxLinks = (src: string): LinkSource[] => [...src.matchAll(DIRECTORY_JSX_LINK)].map(([source]) => ({ source }));

/** A count of states, in figures or in words: "50", "50+", "fifty", "fifty-one". */
const STATE_COUNT = String.raw`(?:\d+\+?|fifty(?:[\s-]one)?)`;

/** States or jurisdictions, US or U.S. ones included. */
const STATES = String.raw`(?:U\.?S\.?\s+)?(?:states?|jurisdictions?)\b`;

/**
 * Wording that sizes the directory: every state, all states, or a count of
 * them. A destination name ("All locations") is not a size.
 */
const COVERAGE_CLAIM = new RegExp(
    String.raw`\b(?:every|all|each)\s+(?:${STATE_COUNT}\s+)?${STATES}|\b${STATE_COUNT}[\s-]*${STATES}|\bnationwide\b`,
    'i',
);

/** A link's source with its quoted paths blanked: an href or an image path is not copy. */
const unpathed = (source: string): string => source.replace(/(['"`])\/(?:(?!\1).)*\1/g, "''");

/** The coverage claim anywhere in a link's source but its paths, or null. */
const claimIn = (link: LinkSource): string | null => COVERAGE_CLAIM.exec(unpathed(link.source))?.[0] ?? null;

const DIRECTORY = 'app/jobs/locations/page.tsx';
const FOOTER = 'components/Footer.tsx';
const GENERATOR = 'scripts/gen-missing-pages.js';

/** The one sub-label for a card that links the directory. */
const LOCATIONS_SUB = 'States and cities';

/** The footer's link to the directory, in the same words. */
const FOOTER_LABEL = 'Browse States and Cities';

/** Every route file under app/jobs. */
const PAGES = files('app/jobs', (name) => name === 'page.tsx');

/**
 * Everything else that links the directory: every component (the site-wide
 * footer and header, the shared category sections), every lib module (where
 * a shared landing template would carry the card) and the landing
 * generator, whose card template a regenerated page would ship.
 */
const SHARED = [
    ...files('components', (name) => /\.tsx?$/.test(name)),
    ...files('lib', (name) => /\.tsx?$/.test(name)),
    GENERATOR,
];

const toSource = (file: string) => ({ file, src: code(read(file)) });
const PAGE_SOURCES = PAGES.map(toSource);
const SOURCES = [...PAGE_SOURCES, ...SHARED.map(toSource)];

const count = (pattern: RegExp): number => SOURCES.reduce((total, { src }) => total + (src.match(pattern)?.length ?? 0), 0);

/** Every card, tile, crumb and footer link that links the directory from an object literal. */
const LITERALS = SOURCES.flatMap(({ file, src }) =>
    literalLinks(src).map((link) => ({ file, ...link, copy: copyOf(link.source), sub: subOf(link.source) })),
);
const CARDS = LITERALS.filter((link) => link.sub !== undefined);

/** Every JSX link to the directory. */
const JSX_LINKS = SOURCES.flatMap(({ file, src }) => jsxLinks(src).map((link) => ({ file, ...link })));

/** A literal by the copy a reader sees. */
const report = (link: { file: string; copy: string[] }) => `${link.file}: ${link.copy.join(' / ')}`;

/** A link that sizes the directory, by the claim it makes. */
const claimReport = (link: { file: string } & LinkSource) => `${link.file}: ${claimIn(link)}`;

describe('2.21: links to /jobs/locations claim no coverage', () => {
    it('reads every link to the directory: route files under app/jobs, every component, every lib module and the generator', () => {
        expect(PAGES.length).toBeGreaterThan(100);
        expect(SHARED).toContain(FOOTER);
        expect(LITERALS, 'a literal that links the directory went unread: widen DIRECTORY_LITERAL').toHaveLength(count(LITERAL_HREF));
        expect(JSX_LINKS, 'a JSX link to the directory went unread: widen DIRECTORY_JSX_LINK').toHaveLength(count(JSX_HREF_ANYWHERE));
        expect(
            LITERALS.filter((link) => /\bsub:/.test(link.source)),
            'a card sub-label is not a string literal, so neither the pin nor the detector reads it',
        ).toHaveLength(CARDS.length);

        // The landings and the metro guide, whose card has its own shape.
        const carriers = [...new Set(CARDS.map((card) => card.file))];
        expect(carriers.length).toBeGreaterThanOrEqual(20);
        expect(carriers).toContain('app/jobs/metro/[slug]/page.tsx');
        expect(carriers).toContain(GENERATOR);
    });

    describe('the detector (guards the guard)', () => {
        it.each(['Browse every state', 'All 50 states', '50 states', 'Browse All 50 States'])('sees the replaced label "%s"', (label) => {
            expect(COVERAGE_CLAIM.test(label)).toBe(true);
        });

        it.each([
            'All 50 U.S. states',
            'all 50 US states',
            'Every U.S. state',
            '50+ states',
            'fifty states',
            'Fifty-one jurisdictions',
            '51 jurisdictions',
            '50-state coverage',
            'Nationwide',
        ])('sees the spelling "%s"', (spelling) => {
            expect(COVERAGE_CLAIM.test(spelling)).toBe(true);
        });

        // The card and footer labels, and the names the live links print.
        it.each([
            LOCATIONS_SUB,
            FOOTER_LABEL,
            'Posted pay by state',
            'State by state',
            'All Locations',
            'Browse all locations',
            'Browse by location',
            'Jobs by Location',
        ])('passes the destination name "%s"', (name) => {
            expect(COVERAGE_CLAIM.test(name)).toBe(false);
        });
    });

    describe('the reader takes each link whole (guards the guard)', () => {
        it.each([
            ['the text it prints', '<Link href="/jobs/locations" style={tile}><MapPin size={18} /><div>All 50 states</div></Link>'],
            ['a string in braces', `<Link href="/jobs/locations">{'All 50 states'}</Link>`],
            ['an attribute', '<Link href="/jobs/locations" aria-label="Browse all 50 states">Locations</Link>'],
            ['a link whose href is in braces', `<Link href={'/jobs/locations'} title="Every state">Locations</Link>`],
            ['a plain anchor', '<a href="/jobs/locations">Nationwide</a>'],
            ['a link whose tag holds an arrow function', '<Link onMouseEnter={(e) => hover(e)} href="/jobs/locations">All 50 states</Link>'],
        ])('finds the claim in %s', (_shape, jsx) => {
            const links = jsxLinks(jsx);
            expect(links.map((link) => link.source)).toEqual([jsx]);
            expect(claimIn(links[0])).not.toBeNull();
        });

        it('finds the claim in copy a literal holds outside a quoted value', () => {
            const literal = `{ href: '/jobs/locations', label: <>All 50 states</> }`;
            const links = literalLinks(literal);
            expect(links.map((link) => link.source)).toEqual([literal]);
            expect(claimIn(links[0])).toBe('All 50 states');
        });

        it('reads no claim into a path', () => {
            const literal = `{ href: '/jobs/locations', label: 'By Location', sub: '${LOCATIONS_SUB}', icon: '/images/nav/50-states.webp' }`;
            expect(literalLinks(literal).map(claimIn)).toEqual([null]);
        });

        it('reads the link after a "/*" that sits in a string', () => {
            const src = [
                '<input type="file" accept="image/*" />',
                "const LINK = { label: 'All 50 states', href: '/jobs/locations' };",
                '/** A later doc comment. */',
            ].join('\n');
            expect(literalLinks(code(src)).map(claimIn)).toEqual(['All 50 states']);
        });

        it('counts a sub-label behind an identifier as unread, since it is no string to pin or read', () => {
            const hidden = `{ href: '/jobs/locations', label: 'By Location', sub: LOCATIONS }`;
            expect(subOf(hidden)).toBeUndefined();
            expect(/\bsub:/.test(hidden)).toBe(true);
        });
    });

    it('no card, tile, crumb or footer link sizes the directory', () => {
        expect(LITERALS.filter((link) => claimIn(link) !== null).map(claimReport)).toEqual([]);
    });

    it('no JSX link sizes it either', () => {
        expect(JSX_LINKS.filter((link) => claimIn(link) !== null).map(claimReport)).toEqual([]);
    });

    it('every card carries the one sub-label, the generator template included', () => {
        expect([...new Set(CARDS.map((card) => card.sub))]).toEqual([LOCATIONS_SUB]);
    });

    it('the sub-label is how the directory titles itself', () => {
        expect(code(read(DIRECTORY)).toLowerCase()).toContain(`jobs by location | ${LOCATIONS_SUB.toLowerCase()}`);
    });

    it('the site-wide footer names the directory the same way', () => {
        const footer = LITERALS.filter((link) => link.file === FOOTER);
        expect(footer.map(report)).toEqual([`${FOOTER}: ${FOOTER_LABEL}`]);
        expect(FOOTER_LABEL.toLowerCase()).toBe(`browse ${LOCATIONS_SUB.toLowerCase()}`);
    });
});

describe('2.21: the directory travel tile describes the travel page', () => {
    const TRAVEL_SUB = 'Short-term assignments';
    const tiles = code(read(DIRECTORY)).match(/\{[^{}]*\bhref:\s*'\/jobs\/travel'[^{}]*\}/g) ?? [];

    it('is sub-labelled in the words of the travel page', () => {
        expect(tiles).toHaveLength(1);
        expect(tiles[0]).toContain("label: 'Travel'");
        expect(subOf(tiles[0] ?? '')).toBe(TRAVEL_SUB);
        expect(code(read('app/jobs/travel/page.tsx'))).toContain(TRAVEL_SUB);
    });

    it('does not name locum tenens, which has a landing of its own', () => {
        expect(fs.existsSync(path.join(ROOT, 'app/jobs/locum-tenens/page.tsx'))).toBe(true);
        expect(tiles.join('\n')).not.toMatch(/locum/i);
    });
});

/**
 * Travel and locum tenens each have a landing of their own, and neither
 * bucket counts the other's roles (tests/unit/category-predicate.test.ts).
 * A card under app/jobs that links one never describes itself with the
 * other's name, anywhere in its source but its paths.
 */
describe('2.21: a travel or locum tenens card names its own category', () => {
    const SIBLINGS = [
        { href: '/jobs/travel', other: /locum/i },
        { href: '/jobs/locum-tenens', other: /travel/i },
    ];

    it.each(SIBLINGS)('no card that links $href names the other', ({ href, other }) => {
        const cards = PAGE_SOURCES.flatMap(({ file, src }) =>
            [...src.matchAll(linkLiteral(href))].map(([source]) => ({ file, source })),
        );
        const hrefs = PAGE_SOURCES.reduce((total, { src }) => total + (src.match(literalHref(href))?.length ?? 0), 0);
        expect(cards, `a literal that links ${href} went unread`).toHaveLength(hrefs);
        expect(cards.length).toBeGreaterThanOrEqual(4);
        expect(cards.filter((card) => other.test(unpathed(card.source))).map((card) => `${card.file}: ${card.source}`)).toEqual([]);
    });
});
