/**
 * Backlog 2.1, fix round 1: a sitemap-dated page that follows the launch-promo
 * clock is re-rendered hourly and dated by the switch, and no other page is.
 *
 * WHY: the job description guide was missed twice over. It printed a
 * hard-coded promo label (tests/regressions/promo-copy-static-guard.test.ts
 * now holds every promo statement to a promo branch), and it was fully static
 * and absent from PROMO_SWITCH_PATHS, which only hand-kept lists pinned. A
 * page that decides the phase per render still serves its build-time render
 * until the next deploy when it exports no `revalidate`, and its sitemap
 * lastmod does not move at the switch when PROMO_SWITCH_PATHS leaves it out.
 * A page listed there whose copy does not switch over-claims a change.
 *
 * WHAT IT CHECKS, read from the sources: for every code-authored page the
 * sitemap dates (PAGE_CONTENT_DATES) and every page in PROMO_SWITCH_PATHS,
 *   - the page FOLLOWS THE CLOCK when its code calls config.isPromoActive, or
 *     calls a function imported from a module that reads the clock: one that
 *     calls isPromoActive itself (lib/pricing-copy.ts, a page's copy builder,
 *     lib/compare-data.ts) or calls a function of such a module;
 *   - a page that follows the clock is a server page, exports
 *     `revalidate` of at most an hour and is in PROMO_SWITCH_PATHS;
 *   - a page in PROMO_SWITCH_PATHS follows the clock.
 *
 * LIMITS: it reads calls, not renders. That a page's output really differs
 * across the switch is what the render suites prove (promo-switch-periphery,
 * pricing-pages-phase-switch). A page that only calls a phase-neutral
 * function of a clock module would be flagged here: list it in
 * NOT_PHASE_DEPENDENT with the reason.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PAGE_CONTENT_DATES, PROMO_SWITCH_PATHS } from '@/app/api/sitemaps/lastmod';

const ROOT = process.cwd();
const SCANNED_DIRS = ['app', 'components', 'lib'] as const;
const ONE_HOUR_SECONDS = 3600;

/** route -> why its calls into a clock module do not change what it prints. None today. */
const NOT_PHASE_DEPENDENT: Readonly<Record<string, string>> = {};

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...walk(rel));
        else if (/\.tsx?$/.test(entry.name) && !/\.(?:d|test)\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
}

/** Source without comments: a clock read named in a comment is not a read. */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = SCANNED_DIRS.flatMap(walk);
const FILE_SET = new Set(FILES);
const CODE = new Map(FILES.map((file) => [file, stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'))]));

const readsClockDirectly = (code: string): boolean => /\bisPromoActive\(/.test(code);

interface ImportedBinding {
    /** The name the importing file calls it by. */
    local: string;
    /** The specifier it is imported from, as written. */
    from: string;
}

/** The value bindings a source imports: default, named (with aliases) and namespace. Type-only imports are skipped. */
function importedBindings(code: string): ImportedBinding[] {
    const bindings: ImportedBinding[] = [];
    for (const match of code.matchAll(/\bimport\s+(type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
        if (match[1]) continue;
        const [, , clause, from] = match;
        const named = clause.match(/\{([\s\S]*)\}/)?.[1] ?? '';
        for (const item of named.split(',').map((part) => part.trim()).filter(Boolean)) {
            if (item.startsWith('type ')) continue;
            bindings.push({ local: item.split(/\s+as\s+/).pop() as string, from });
        }
        const outside = clause.replace(/\{[\s\S]*\}/, '');
        const namespace = outside.match(/\*\s+as\s+([\w$]+)/)?.[1];
        if (namespace) bindings.push({ local: `${namespace}.`, from });
        const fallback = outside.replace(/\*\s+as\s+[\w$]+/, '').match(/[\w$]+/)?.[0];
        if (fallback) bindings.push({ local: fallback, from });
    }
    return bindings;
}

/** The scanned file an import specifier names, or null for a package or an unscanned path. */
function resolveImport(from: string, importer: string): string | null {
    let base: string;
    if (from.startsWith('@/')) base = from.slice(2);
    else if (from.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), from));
    else return null;
    return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base].find((candidate) => FILE_SET.has(candidate)) ?? null;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `code` calls the binding: `name(`, or `ns.anything(` for a namespace
 * import. A member of something else (`other.name(`) is not a call of it; a
 * spread (`...name(`) is.
 */
function calls(code: string, binding: ImportedBinding): boolean {
    const callee = binding.local.endsWith('.') ? `${escapeRegExp(binding.local)}[\\w$]+` : escapeRegExp(binding.local);
    return new RegExp(`(?:^|[^.\\w$]|\\.{3})${callee}\\(`).test(code);
}

/** The scanned modules `code` (in `file`) calls an imported function of. */
function calledModules(code: string, file: string): string[] {
    return importedBindings(code)
        .filter((binding) => calls(code, binding))
        .map((binding) => resolveImport(binding.from, file))
        .filter((resolved): resolved is string => resolved !== null);
}

/** Modules that read the promo clock: they call isPromoActive, or call a function of a module that does. */
const DIRECT_CLOCK_MODULES = new Set(FILES.filter((file) => readsClockDirectly(CODE.get(file) as string)));
const CLOCK_MODULES = new Set([
    ...DIRECT_CLOCK_MODULES,
    ...FILES.filter((file) => calledModules(CODE.get(file) as string, file).some((called) => DIRECT_CLOCK_MODULES.has(called))),
]);

/** The clock modules `code` (in `file`) calls into; `self` when it calls isPromoActive itself. Empty: it does not follow the clock. */
function clockReads(code: string, file: string): string[] {
    const viaModules = calledModules(code, file).filter((called) => CLOCK_MODULES.has(called));
    return [...new Set([...(readsClockDirectly(code) ? ['self'] : []), ...viaModules])];
}

const pageFile = (route: string): string => `app${route}/page.tsx`;

const isClientComponent = (code: string): boolean => /^\s*['"]use client['"]/.test(code);

/** The `revalidate` a route file exports, in seconds; null when it exports none. */
function revalidateSeconds(code: string): number | null {
    const match = code.match(/^export const revalidate = (\d+);/m);
    return match ? Number(match[1]) : null;
}

/** What is wrong with `route`, given its page source and the set of pages the switch dates. */
function violations(route: string, code: string, switchPaths: ReadonlySet<string>): string[] {
    const file = pageFile(route);
    const reads = route in NOT_PHASE_DEPENDENT ? [] : clockReads(code, file);
    const found: string[] = [];
    if (reads.length > 0) {
        const how = `follows the promo clock (${reads.join(', ')})`;
        if (isClientComponent(code)) found.push(`${route} ${how} but is a client page: the server must decide the phase`);
        const seconds = revalidateSeconds(code);
        if (seconds === null || seconds > ONE_HOUR_SECONDS) {
            found.push(`${route} ${how} but does not re-render hourly (export const revalidate = 3600): it would keep the promo until the next deploy`);
        }
        if (!switchPaths.has(route)) {
            found.push(`${route} ${how} but is not in PROMO_SWITCH_PATHS: its sitemap lastmod would not move at the switch`);
        }
    } else if (switchPaths.has(route)) {
        found.push(`${route} is in PROMO_SWITCH_PATHS but its page reads no promo clock: its lastmod would move with no copy change`);
    }
    return found;
}

const JD_GUIDE_ROUTE = '/for-employers/resources/job-description-guide';

describe('2.1: the clock finder', () => {
    it('reads default, named, aliased and namespace imports, and skips type-only ones', () => {
        const code = [
            "import 'server-only';",
            "import type { Metadata } from 'next';",
            "import Link from 'next/link';",
            "import Page, { build as buildCopy, type Copy, other } from './copy';",
            "import * as pricing from '@/lib/pricing-copy';",
        ].join('\n');
        expect(importedBindings(code)).toEqual([
            { local: 'Link', from: 'next/link' },
            { local: 'buildCopy', from: './copy' },
            { local: 'other', from: './copy' },
            { local: 'Page', from: './copy' },
            { local: 'pricing.', from: '@/lib/pricing-copy' },
        ]);
    });

    it('tells a call from a mention and from a member of something else', () => {
        const binding = { local: 'postJobCta', from: './post-job-cta' };
        expect(calls('const cta = postJobCta(new Date());', binding)).toBe(true);
        expect(calls('postJobCta(now)', binding)).toBe(true);
        // /faq spreads its builder's entries into the list it renders.
        expect(calls('const faqs = [...postJobCta(new Date()), ...rest];', binding)).toBe(true);
        expect(calls('const builder = postJobCta;', binding)).toBe(false);
        expect(calls('other.postJobCta(now); other?.postJobCta(now)', binding)).toBe(false);
        expect(calls('myPostJobCta(now); xpostJobCta(now)', binding)).toBe(false);
        expect(calls('pricing.ladderLine(now)', { local: 'pricing.', from: '@/lib/pricing-copy' })).toBe(true);
        expect(calls('const lines = pricing;', { local: 'pricing.', from: '@/lib/pricing-copy' })).toBe(false);
    });

    it('knows the modules that read the clock, and that a comment is not a read', () => {
        for (const clockModule of [
            'lib/pricing-copy.ts',
            'lib/compare-data.ts',
            'app/for-employers/resources/post-job-cta.ts',
            'components/tools/cost-per-hire-model.ts',
            'app/pricing/pricing-page-copy.ts',
            'app/for-employers/for-employers-copy.ts',
            'app/faq/faq-employer-copy.ts',
        ]) {
            expect(CLOCK_MODULES.has(clockModule), clockModule).toBe(true);
        }
        // lib/config.ts DEFINES the clock; a page that reads a price from it does not follow it.
        expect(CLOCK_MODULES.has('lib/config.ts')).toBe(false);
        expect(readsClockDirectly(stripComments('// config.isPromoActive(now) decides it\nconst a = 1;'))).toBe(false);
        expect(readsClockDirectly(stripComments('/* isPromoActive( */ const promoActive = config.isPromoActive(new Date());'))).toBe(true);
    });
});

describe('2.1: every sitemap-dated page that follows the promo clock re-renders hourly and is dated by the switch', () => {
    const routes = [...new Set([...Object.keys(PAGE_CONTENT_DATES), ...PROMO_SWITCH_PATHS])].sort();

    it('covers the dated pages, and each has a page file', () => {
        expect(routes.length).toBeGreaterThan(30);
        expect(routes).toContain(JD_GUIDE_ROUTE);
        expect(routes.filter((route) => !CODE.has(pageFile(route))), 'routes with no app/<route>/page.tsx').toEqual([]);
    });

    it('no page follows the clock without re-rendering hourly and a place in PROMO_SWITCH_PATHS, and none is listed without following it', () => {
        const found = routes.flatMap((route) => violations(route, CODE.get(pageFile(route)) as string, PROMO_SWITCH_PATHS));
        expect(found, found.join('\n')).toEqual([]);
    });

    it('the pages that follow the clock are exactly PROMO_SWITCH_PATHS', () => {
        const following = routes.filter((route) => clockReads(CODE.get(pageFile(route)) as string, pageFile(route)).length > 0);
        expect(following).toEqual([...PROMO_SWITCH_PATHS].sort());
        // A page that prints no promo copy does not follow it.
        for (const route of ['/about', '/terms', '/resources', '/tools/licensure-checker']) {
            expect(clockReads(CODE.get(pageFile(route)) as string, pageFile(route)), route).toEqual([]);
        }
    });

    it('every exemption is still needed', () => {
        for (const route of Object.keys(NOT_PHASE_DEPENDENT)) {
            expect(clockReads(CODE.get(pageFile(route)) as string, pageFile(route)).length, `${route} no longer calls a clock module: drop it from NOT_PHASE_DEPENDENT`).toBeGreaterThan(0);
        }
    });
});

describe('2.1: the guard fails on the two ways the job description guide was missed', () => {
    const guide = CODE.get(pageFile(JD_GUIDE_ROUTE)) as string;

    it('the guide follows the clock through the resources CTA builder, and is clean as it stands', () => {
        expect(clockReads(guide, pageFile(JD_GUIDE_ROUTE))).toEqual(['app/for-employers/resources/post-job-cta.ts']);
        expect(violations(JD_GUIDE_ROUTE, guide, PROMO_SWITCH_PATHS)).toEqual([]);
    });

    it('a guide that is static again is reported', () => {
        const staticAgain = guide.replace(/^export const revalidate = \d+;$/m, '');
        expect(staticAgain).not.toBe(guide);
        expect(violations(JD_GUIDE_ROUTE, staticAgain, PROMO_SWITCH_PATHS)).toEqual([
            expect.stringContaining('does not re-render hourly'),
        ]);
        // A daily re-render is not enough either.
        const daily = guide.replace(/^export const revalidate = \d+;$/m, 'export const revalidate = 86400;');
        expect(violations(JD_GUIDE_ROUTE, daily, PROMO_SWITCH_PATHS)).toEqual([expect.stringContaining('does not re-render hourly')]);
    });

    it('a guide left out of PROMO_SWITCH_PATHS is reported', () => {
        const without = new Set([...PROMO_SWITCH_PATHS].filter((route) => route !== JD_GUIDE_ROUTE));
        expect(violations(JD_GUIDE_ROUTE, guide, without)).toEqual([expect.stringContaining('is not in PROMO_SWITCH_PATHS')]);
    });

    it('a page listed in PROMO_SWITCH_PATHS that reads no clock is reported', () => {
        const about = CODE.get(pageFile('/about')) as string;
        expect(violations('/about', about, new Set([...PROMO_SWITCH_PATHS, '/about']))).toEqual([
            expect.stringContaining('reads no promo clock'),
        ]);
    });
});
