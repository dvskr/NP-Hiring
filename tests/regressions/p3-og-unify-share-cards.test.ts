/**
 * P3 #8 — unified OG share cards (+ the P2 #7 shortage-badge follow-up).
 *
 * Two problems these pins lock down:
 *
 *  1. /api/og rendered a donor-era dark-navy card while /api/og/city
 *     rendered the live cream/clay design, so share cards from the same site
 *     looked like two different products. Both generators now compose the
 *     same chrome from app/api/og/og-theme.tsx.
 *
 *  2. The city card's designation badge read a bare "⚕ Shortage Area". The
 *     only data behind the `shortage` param is the caller's
 *     behavioral-health HPSA flag (`mentalHealthShortage`, see
 *     lib/pseo/city-data/types.ts), so the unqualified label asserted a
 *     wider shortage than HRSA designated. It now names the discipline.
 *
 * The load-bearing pin is the CALLER CONTRACT test: roughly 70 pages build
 * /api/og URLs, so the param names those pages actually emit are extracted
 * from source and checked against what the route reads. A redesign that
 * silently drops a param would otherwise ship a card missing information
 * every JD page believes it is sending.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { og, ogClamp, OG_SIZE, OG_CACHE_HEADERS } from '@/app/api/og/og-theme';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const GENERIC_ROUTE = 'app/api/og/route.tsx';
const CITY_ROUTE = 'app/api/og/city/route.tsx';
const THEME = 'app/api/og/og-theme.tsx';
const OG_FILES = [GENERIC_ROUTE, CITY_ROUTE, THEME] as const;

// ─── caller contract ──────────────────────────────────────────────────────

function walk(rel: string, acc: string[] = []): string[] {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return acc;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const next = path.join(rel, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.next') continue;
            walk(next, acc);
        } else if (/\.tsx?$/.test(entry.name)) {
            acc.push(next);
        }
    }
    return acc;
}

/** Every source file that could build an OG URL. */
function callerFiles(): string[] {
    return [...walk('app'), ...walk('lib'), ...walk('components')].filter(
        (f) => !f.startsWith(path.join('app', 'api', 'og')),
    );
}

/**
 * Param names callers emit against a generator path, harvested from source.
 *
 * Two shapes exist in the repo:
 *   - inline single-line query strings (`/api/og?title=…&type=page`), which
 *     is every static and pSEO page; the scan is line-scoped and starts at
 *     the route path so an unrelated URL earlier on the line cannot leak in.
 *   - the incremental builder in app/jobs/[slug]/page.tsx
 *     (`ogImageUrl.searchParams.set('salary', …)`).
 */
function paramsEmittedBy(routePath: string): Set<string> {
    const found = new Set<string>();
    // `/api/og?` must not also match `/api/og/city?` (and vice versa).
    const marker = `${routePath}?`;

    for (const file of callerFiles()) {
        const src = read(file);
        if (!src.includes(routePath)) continue;

        for (const line of src.split('\n')) {
            const at = line.indexOf(marker);
            if (at === -1) continue;
            for (const param of line.slice(at).matchAll(/[?&]([a-zA-Z][a-zA-Z0-9]*)=/g)) {
                found.add(param[1]);
            }
        }

        if (src.includes(`new URL('${routePath}'`)) {
            for (const setter of src.matchAll(/ogImageUrl\.searchParams\.set\('([a-zA-Z0-9]+)'/g)) {
                found.add(setter[1]);
            }
        }
    }
    return found;
}

/** Param names a generator route actually reads. */
function paramsReadBy(routeRel: string): Set<string> {
    const src = read(routeRel);
    const found = new Set<string>();
    for (const match of src.matchAll(/searchParams\.get\('([a-zA-Z0-9]+)'\)/g)) {
        found.add(match[1]);
    }
    return found;
}

describe('P3 #8 — the /api/og query-param contract survived the redesign', () => {
    it('reads every param the ~70 calling pages emit', () => {
        const emitted = [...paramsEmittedBy('/api/og')].sort();
        const read_ = paramsReadBy(GENERIC_ROUTE);
        // Sanity: the harvest actually found the callers.
        expect(emitted.length, 'no /api/og callers harvested — the scan broke').toBeGreaterThan(5);
        const dropped = emitted.filter((p) => !read_.has(p));
        expect(
            dropped,
            `/api/og no longer reads params its callers still send: ${dropped.join(', ')}`,
        ).toEqual([]);
    });

    it('still reads the full documented param set, including the optional ones', () => {
        const read_ = paramsReadBy(GENERIC_ROUTE);
        for (const param of [
            'title',
            'type',
            'subtitle',
            'company',
            'salary',
            'location',
            'jobType',
            'isNew',
            'experience',
        ]) {
            expect(read_.has(param), `/api/og stopped reading ?${param}`).toBe(true);
        }
    });

    it('keeps the three render modes keyed off title/type exactly as before', () => {
        const src = read(GENERIC_ROUTE);
        // A param-less request must still render a branded card, not an empty
        // page card: homepage mode is the default when no title is supplied.
        expect(src).toContain("const isHomepage = !title && type !== 'page'");
        expect(src).toContain("const isPageType = type === 'page'");
        expect(src).toContain('OG_HOMEPAGE_HEADLINE');
        expect(src).toContain('OG_HOMEPAGE_SUBHEADLINE');
        expect(src).toContain('OG_HOMEPAGE_STATS');
    });

    it('keeps the placeholder-suppression rules (no invented salary or location)', () => {
        const src = read(GENERIC_ROUTE);
        expect(src).toContain("'Competitive Pay'");
        expect(src).toContain("'Hidden'");
        expect(src).toContain("'Remote / On-site'");
    });

    it('never states an employer or schedule the caller did not supply', () => {
        // The bigger card gives the employer its own berry headline line and
        // the schedule its own tile, so printing the `brand.name` /
        // 'Full-time' fallbacks there would read as a stated fact about a real
        // employer rather than as filler. Both slots are gated on the param
        // actually being present.
        const src = read(GENERIC_ROUTE);
        expect(src).toContain("const hasCompany = Boolean(searchParams.get('company'))");
        expect(src).toContain("const hasJobType = Boolean(searchParams.get('jobType'))");
        expect(src).toContain('{hasCompany ? (');
        expect(src).toContain('{hasJobType ? (');
    });

    it('the city card never doubles the credential ("NP NP Jobs")', () => {
        const src = read(CITY_ROUTE);
        expect(src).toContain('const showCategory =');
        expect(src).toContain('displayCategory.toLowerCase() !== brand.niche.short.toLowerCase()');
    });

    it('/api/og/city reads every param the city template emits', () => {
        const emitted = [...paramsEmittedBy('/api/og/city')];
        const read_ = paramsReadBy(CITY_ROUTE);
        for (const param of ['category', 'city', 'jobs', 'salary', 'shortage']) {
            expect(read_.has(param), `/api/og/city stopped reading ?${param}`).toBe(true);
        }
        const dropped = emitted.filter((p) => !read_.has(p));
        expect(dropped, `/api/og/city ignores emitted params: ${dropped.join(', ')}`).toEqual([]);
    });
});

// ─── one design system ────────────────────────────────────────────────────

describe('P3 #8 — both generators render the same design language', () => {
    it('both routes compose their chrome from the shared theme', () => {
        for (const rel of [GENERIC_ROUTE, CITY_ROUTE]) {
            const src = read(rel);
            expect(src, `${rel} does not import the shared OG theme`).toMatch(
                /from '\.{1,2}\/(og\/)?og-theme'/,
            );
            expect(src, `${rel} stopped using the shared surface`).toContain('<OgSurface>');
            expect(src, `${rel} stopped using the shared footer`).toContain('<OgFooter>');
        }
    });

    it('no donor-era dark-navy palette survives in any OG source', () => {
        // The old /api/og card: navy ground, slate dividers, slate body text.
        const donorHexes = ['#0A1120', '#020617', '#1e293b', '#0f172a', '#94a3b8', '#64748b', '#C2410C'];
        for (const rel of OG_FILES) {
            const src = read(rel);
            for (const hex of donorHexes) {
                expect(
                    src.toLowerCase().includes(hex.toLowerCase()),
                    `${rel} still carries donor-era hex ${hex}`,
                ).toBe(false);
            }
            expect(src, `${rel} still sets a dark backgroundColor`).not.toContain(
                "backgroundColor: '#0A1120'",
            );
        }
    });

    it('the shared palette traces to the live stylesheet, not to invention', () => {
        const css = read('app/globals.css');
        expect(css).toContain(`--color-primary: ${og.berry}`);
        expect(css).toContain(`--color-primary-dark: ${og.berryDeep}`);
        expect(css).toContain(`--color-primary-400: ${og.berryLight}`);
    });

    it('size and cache policy are shared, so the two cards cannot drift apart', () => {
        expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
        expect(OG_CACHE_HEADERS['Cache-Control']).toContain('s-maxage=2592000');
        for (const rel of [GENERIC_ROUTE, CITY_ROUTE]) {
            const src = read(rel);
            expect(src, `${rel} lost the shared size constant`).toContain('...OG_SIZE');
            expect(src, `${rel} lost the shared cache headers`).toContain('...OG_CACHE_HEADERS');
            expect(src, `${rel} re-declares cache policy inline`).not.toContain('s-maxage=');
        }
    });
});

// ─── edge + satori constraints ────────────────────────────────────────────

describe('P3 #8 — edge-runtime and satori constraints hold', () => {
    it('both generators stay on the edge runtime', () => {
        for (const rel of [GENERIC_ROUTE, CITY_ROUTE]) {
            expect(read(rel), `${rel} left the edge runtime`).toContain(
                "export const runtime = 'edge'",
            );
        }
    });

    it('no node-only imports leaked into any OG source', () => {
        for (const rel of OG_FILES) {
            const src = read(rel);
            expect(src, `${rel} imports a node builtin`).not.toMatch(
                /from '(node:[a-z/]+|fs|path|os|crypto|buffer)'/,
            );
        }
    });

    it('no font is fetched — both cards render on the built-in sans stack', () => {
        for (const rel of [GENERIC_ROUTE, CITY_ROUTE]) {
            const src = read(rel);
            // The only network call either route makes is the fixed-origin logo.
            const fetches = src.match(/fetch\(/g) ?? [];
            expect(fetches.length, `${rel} makes an unexpected fetch`).toBe(1);
            expect(src).toContain('fetch(`${brand.baseUrl}/logo.png`)');
        }
        expect(read(THEME), 'og-theme must stay render-only (no network)').not.toContain('fetch(');
    });

    it('no JSX fragment reaches satori (it has no Fragment branch)', () => {
        for (const rel of OG_FILES) {
            expect(read(rel), `${rel} uses a JSX fragment`).not.toMatch(/<>|<\/>/);
        }
    });

    it('the shared theme uses stroke icons, never emoji (satori ships no emoji font)', () => {
        for (const rel of OG_FILES) {
            const src = read(rel);
            // Dingbats / misc-symbols (U+2600–U+27BF, which is where ⚕ lives)
            // and the pictographic planes would all render as tofu.
            expect(src, `${rel} contains an emoji glyph`).not.toMatch(
                /[☀-➿\u{1F000}-\u{1FAFF}]/u,
            );
        }
    });
});

// ─── P2 #7 follow-up: the shortage badge names its discipline ─────────────

describe('P2 #7 follow-up — the city card labels the shortage designation', () => {
    const src = read(CITY_ROUTE);

    it('the badge names the discipline HRSA actually designated', () => {
        expect(src).toContain('Behavioral-Health HPSA');
    });

    it('the unqualified all-specialty claim is gone', () => {
        expect(src).not.toContain('Shortage Area');
        expect(src).not.toContain('⚕');
    });

    it('the badge still renders only when the caller sets ?shortage=true', () => {
        expect(src).toContain("searchParams.get('shortage') === 'true'");
        expect(src).toContain('{shortage ? (');
    });

    it('the caller gate that keeps the label on-topic is still the single predicate', () => {
        // The route cannot know the discipline from the param, so the label is
        // only true while the caller keeps gating on shortageIsOnTopic().
        const template = read('lib/pseo/category-city-template.tsx');
        expect(template).toContain('shortageIsOnTopic(city, config.slug)');
        expect(template).toContain("...(shortageMatchesCategory && { shortage: 'true' })");
    });
});

// ─── brand tokens ─────────────────────────────────────────────────────────

describe('P3 #8 — niche identity comes from config, not from the card', () => {
    it('the city headline derives its credential from brand.niche', () => {
        const src = read(CITY_ROUTE);
        expect(src).toContain('brand.niche.short');
        expect(src, 'city card still hardcodes the donor credential').not.toContain('PMHNP');
    });

    it('the generic card keeps deriving the brandmark and default employer from config', () => {
        const src = read(GENERIC_ROUTE);
        expect(src).toContain("searchParams.get('company') || brand.name");
        expect(src).toContain('alt={brand.name}');
        expect(src).not.toContain('PMHNP');
    });
});

// ─── shared helpers ───────────────────────────────────────────────────────

describe('ogClamp — query-supplied text can never overflow the card', () => {
    it('returns short values untouched', () => {
        expect(ogClamp('Family Nurse Practitioner', 40)).toBe('Family Nurse Practitioner');
    });

    it('trims surrounding whitespace', () => {
        expect(ogClamp('  Remote  ', 40)).toBe('Remote');
    });

    it('caps over-long values with a single ellipsis and never exceeds the max', () => {
        const clamped = ogClamp('x'.repeat(200), 20);
        expect(clamped.length).toBe(20);
        expect(clamped.endsWith('…')).toBe(true);
    });

    it('is safe at tiny maxima (no empty or negative slice)', () => {
        expect(ogClamp('abcdef', 1).length).toBeGreaterThan(0);
    });
});
