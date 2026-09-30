/**
 * Indexing audit, site-copy package: M-08 (the "#1 job board" claim), L-03
 * (homepage title and H1), H-04 (homepage links spent on noindex search URLs),
 * L-02 / CS-10 / CQ-16 (doubled brand suffix in titles, and the H1 and
 * employer-name defects), L-05 (links that redirect or hit robots-disallowed
 * paths) and M-07 (sitemap pages with no crawlable inbound link from an
 * indexable page).
 *
 * Some blocks pin files other packages own; their handoffs landed in the
 * wave 2 handoff package, and the pins keep the defects from returning.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        pseoStats: { findMany: vi.fn() },
        company: { findMany: vi.fn(), findUnique: vi.fn() },
        job: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
        siteStat: { findFirst: vi.fn() },
    },
}));

vi.mock('@/lib/site-stats', () => ({
    getSiteStats: vi.fn().mockResolvedValue({ totalJobs: 638, totalCompanies: 131 }),
    getSiteStatsOrNull: vi.fn().mockResolvedValue({ totalJobs: 638, totalCompanies: 131 }),
}));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import {
    BOARD_DESCRIPTION,
    EMAIL_DEFAULT_PREHEADER,
    OG_HOMEPAGE_HEADLINE,
    OG_HOMEPAGE_STATS,
} from '@/config/niche/copy';
import { US_STATE_ONLY_CODES } from '@/lib/states-covered';
import { getIndexableLandingSlugs } from '@/lib/homepage-links';
import { buildEmployerChips } from '@/components/EmployerTrustSection';
import { mergeStateCounts } from '@/components/TopStatesSection';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

type Mock = ReturnType<typeof vi.fn>;
const m = (fn: unknown) => fn as Mock;

/** Page and client modules pull in large dependency trees on first import. */
const COLD_IMPORT_TIMEOUT_MS = 120_000;

/** Strip block, line and JSX comments so prose that quotes a removed claim does not trip a guard. */
const code = (src: string) =>
    src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

/** House style for visible copy: no em dash, en dash or spaced hyphen. */
const DASHES = /[—–]| - /;

/* ── M-08: no first-place ranking claim anywhere ───────────────────────── */

function walk(dir: string, exts: string[]): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...walk(rel, exts));
        } else if (exts.some((ext) => entry.name.endsWith(ext))) {
            out.push(rel.split(path.sep).join('/'));
        }
    }
    return out;
}

/**
 * A claim that this board ranks first. Sourced statements about another
 * company keep their own citation and are not matched (lib/compare-data.ts
 * quotes Indeed's "#1 job site" with its Comscore source).
 */
const RANKING_CLAIM = /\bthe #1\b|#1 (?:[\w$.{}'-]+ ){0,3}(?:job board|board for)|#1 \$\{brand|number[ -]one (?:[\w$.{}-]+ ){0,3}job board/i;

describe('M-08: the unsubstantiated "#1 job board" claim is gone', () => {
    const files = ['app', 'components', 'lib', 'config', 'content'].flatMap((dir) =>
        walk(dir, ['.ts', '.tsx', '.mdx']),
    );

    it('scans a plausible surface area', () => {
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain('app/layout.tsx');
        expect(files).toContain('config/niche/copy.ts');
        expect(files).toContain('components/Footer.tsx');
    });

    it('no production file makes a first-place ranking claim', () => {
        // No exemptions: every file that carried the claim, the site-wide
        // footer included, is fixed in this package.
        const offenders = files.filter((rel) => RANKING_CLAIM.test(code(read(rel))));
        expect(offenders).toEqual([]);
    });

    it('the detector sees the footer claim it replaced (guards the guard)', () => {
        expect(RANKING_CLAIM.test('The #1 specialized job board for {brand.niche.descriptor}s.')).toBe(true);
        expect(RANKING_CLAIM.test("the world's #1 job site (Comscore Total Visits, March 2026)")).toBe(false);
    });

    it('the footer on every page carries a short factual tagline instead', () => {
        const footer = code(read('components/Footer.tsx'));
        const tagline = footer.match(/<p className="footer-tagline"[^>]*>\s*([^<]+?)\s*<\/p>/)?.[1];
        expect(tagline).toBe('Jobs for {brand.niche.descriptor}s, updated daily.');
        expect(tagline).not.toMatch(/#1|number one|leading|largest|best|specialized job board/i);
        expect(tagline).not.toMatch(DASHES);
    });

    it('the factual board description replaces it, and says nothing it cannot back', () => {
        for (const text of [BOARD_DESCRIPTION, EMAIL_DEFAULT_PREHEADER, OG_HOMEPAGE_HEADLINE]) {
            expect(text).not.toMatch(/#1|number one|leading|largest|best|thousands|all 50 states/i);
            expect(text).not.toMatch(DASHES);
        }
        expect(BOARD_DESCRIPTION).toMatch(/career sites/);
        expect(BOARD_DESCRIPTION).toMatch(/updated daily/);
    });

    it('the site-wide Organization JSON-LD and default og:description carry it', () => {
        const layout = read('app/layout.tsx');
        expect(layout).toContain("import { BOARD_DESCRIPTION } from '@/config/niche/copy'");
        expect(layout).toContain('"description": BOARD_DESCRIPTION');
        expect(layout).toContain('description: BOARD_DESCRIPTION');
        expect(code(layout)).not.toMatch(/thousands of|across (?:all )?50 states/i);
    });

    it('/about metadata makes neither the ranking nor the 50-state claim', async () => {
        const { metadata } = await import('@/app/about/page');
        const text = JSON.stringify([metadata.title, metadata.description, metadata.openGraph]);
        expect(text).not.toMatch(/#1|number one|all 50 states/i);
        expect(String(metadata.description)).toContain(BOARD_DESCRIPTION);
        // The layout template appends the brand; the page title must not.
        expect(String(metadata.title)).not.toContain(`| ${brand.name}`);
    }, COLD_IMPORT_TIMEOUT_MS);
});

/* ── M-08: state coverage is measured, never a hardcoded 50 ─────────────── */

/** A literal 50 within one line of "States Covered", in either order. */
const HARDCODED_STATE_COVERAGE = /\b50\b[^\n]{0,120}States Covered|States Covered[^\n]{0,120}\b50\b/i;

describe('M-08: no hardcoded "50 States Covered"', () => {
    it.each([
        'config/niche/copy.ts',
        'app/about/AboutClient.tsx',
        'app/about/page.tsx',
        'app/for-programs/page.tsx',
        'app/api/og/route.tsx',
    ])('%s pairs no literal 50 with "States Covered"', (rel) => {
        expect(code(read(rel))).not.toMatch(HARDCODED_STATE_COVERAGE);
    });

    it('no production file claims job coverage "across all 50 states"', () => {
        // State regulation, salary benchmarks and the 50 state pages are real
        // and keep their wording; inventory coverage is not, and is measured.
        const COVERAGE_CLAIM = /(?:jobs|positions|listings|openings|roles|feeds)\b[^.\n`'"]{0,80}across (?:all )?50 states/i;
        // The last pending file (config/niche/stats.ts, the logged-in
        // dashboard "Job Market Pulse" card) dropped the claim with its
        // handoff, so every production file is scanned.
        const offenders = ['app', 'components', 'lib', 'config']
            .flatMap((dir) => walk(dir, ['.ts', '.tsx']))
            .filter((rel) => COVERAGE_CLAIM.test(code(read(rel))));
        expect(offenders).toEqual([]);
    });

    it('the dashboard market pulse card makes no coverage claim', async () => {
        const { DASHBOARD_MARKET_PULSE } = await import('@/config/niche/stats');
        const sentence = `${DASHBOARD_MARKET_PULSE.lead}${DASHBOARD_MARKET_PULSE.metric}${DASHBOARD_MARKET_PULSE.tail}`;
        expect(sentence).toBe('New NP roles are added daily from employer ATS feeds.');
        expect(sentence).not.toMatch(/50 states|nationwide|every state/i);
    });

    it('the default share card stats make no coverage claim', () => {
        expect(OG_HOMEPAGE_STATS).toEqual([
            { number: 'Free', label: 'For Job Seekers' },
            { number: '8', label: 'ATS Sources' },
            { number: 'Daily', label: 'Job Updates' },
        ]);
        for (const stat of OG_HOMEPAGE_STATS) {
            expect(`${stat.number} ${stat.label}`).not.toMatch(/states?|coverage|nationwide|#1|largest|best/i);
        }
    });

    it('"8 ATS Sources" matches the sources the ingest crons schedule', async () => {
        const { CRON_ENTRIES } = await import('@/config/cron-schedule');
        const scheduled = new Set(
            CRON_ENTRIES.filter((entry) => entry.path.startsWith('/api/cron/ingest?'))
                .map((entry) => new URL(entry.path, brand.baseUrl).searchParams.get('source')),
        );
        const stat = OG_HOMEPAGE_STATS.find((entry) => entry.label === 'ATS Sources');
        expect(stat?.number).toBe(String(scheduled.size));
    }, COLD_IMPORT_TIMEOUT_MS);

    it('/about and /for-programs read the same measured figure', () => {
        for (const rel of ['app/about/page.tsx', 'app/for-programs/page.tsx']) {
            expect(read(rel)).toContain("import { getStatesCovered } from '@/lib/states-covered'");
        }
    });

    it('/about hands the measured count to the client', async () => {
        m(prisma.job.groupBy).mockResolvedValue(US_STATE_ONLY_CODES.slice(0, 44).map((stateCode) => ({ stateCode })));
        m(prisma.job.count).mockResolvedValue(0);
        const [{ default: AboutPage }, { default: AboutClient }] = await Promise.all([
            import('@/app/about/page'),
            import('@/app/about/AboutClient'),
        ]);
        const tree = (await AboutPage()) as ReactElement<{ children: ReactNode }>;
        const children = ([] as ReactNode[]).concat(tree.props.children);
        const client = children.find(
            (child): child is ReactElement<{ statesCovered: number | null }> =>
                isValidElement(child) && child.type === AboutClient,
        );
        expect(client?.props.statesCovered).toBe(44);
    }, COLD_IMPORT_TIMEOUT_MS);
});

describe('M-08: the /about stats tile renders only a measured count', () => {
    type AboutClientModule = typeof import('@/app/about/AboutClient');
    let AboutClient: AboutClientModule['default'];

    beforeAll(async () => {
        ({ default: AboutClient } = await import('@/app/about/AboutClient'));
    }, COLD_IMPORT_TIMEOUT_MS);

    const render = (statesCovered?: number | null) =>
        renderToStaticMarkup(createElement(AboutClient, { totalJobs: 638, totalEmployers: 131, statesCovered }));

    it('shows the measured count in a three-tile row', () => {
        const html = render(44);
        expect(html).toMatch(/<div class="num">44<\/div><div class="lab">States Covered<\/div>/);
        expect(html).toContain('grid-template-columns:repeat(3, 1fr)');
        expect(html).not.toMatch(HARDCODED_STATE_COVERAGE);
    });

    it.each([null, 0, undefined])('omits the tile when the count is %s, and closes the row up', (count) => {
        const html = render(count);
        expect(html).not.toContain('States Covered');
        expect(html).toContain('grid-template-columns:repeat(2, 1fr)');
        // The two measured tiles still render.
        expect(html).toMatch(/<div class="num">638<\/div><div class="lab">Active Jobs<\/div>/);
        expect(html).toMatch(/<div class="num">131<\/div><div class="lab">Employers<\/div>/);
    });
});

/* ── L-03: homepage title and H1 ───────────────────────────────────────── */

describe('L-03: the homepage names the brand and the topic', () => {
    beforeEach(() => {
        m(prisma.pseoStats.findMany).mockResolvedValue([]);
    });

    it('the <title> leads with the brand, set absolute so no template doubles it', async () => {
        const { generateMetadata } = await import('@/app/page');
        const metadata = await generateMetadata();
        expect(metadata.title).toEqual({
            absolute: `${brand.name}: 638 ${brand.niche.long} Jobs, Updated Daily`,
        });
        const absolute = (metadata.title as { absolute: string }).absolute;
        expect(absolute.length).toBeLessThanOrEqual(60);
        expect(absolute).not.toMatch(DASHES);
        const alt = JSON.stringify(metadata.openGraph);
        expect(alt).not.toMatch(/50 states/);
    }, COLD_IMPORT_TIMEOUT_MS);

    it('the H1 is a descriptive phrase and the stamped line is decorative', () => {
        const hero = read('components/HomepageHero.tsx');
        expect(hero).toContain('const HERO_HEADING = `${brand.niche.descriptor.charAt(0).toUpperCase()}${brand.niche.descriptor.slice(1)} jobs`');
        expect(hero).toMatch(/<m\.h1 variants=\{fadeUp\} className="ns-h1">\s*\{HERO_HEADING\}\s*<\/m\.h1>/);
        // Exactly one H1 in the hero.
        expect(hero.match(/<m\.h1\b/g)?.length).toBe(1);
        // The cycling role stamp now sits in an aria-hidden paragraph.
        expect(hero).toMatch(/<m\.p\s+variants=\{fadeUp\}\s+aria-hidden="true"/);
    });

    it('a plain sentence says what the site lists and where it comes from', () => {
        const hero = code(read('components/HomepageHero.tsx'));
        const intro = hero.slice(hero.indexOf('className="ns-intro"'));
        expect(intro).toContain("career sites and direct employer posts, updated daily");
        expect(intro).toContain('Free for job seekers.');
        expect(intro.slice(0, 400)).not.toMatch(DASHES);
    });
});

/* ── Homepage copy matches the pages it links ──────────────────────────── */

describe('the homepage describes /resources/fpa-guide as the concept guide it now is', () => {
    /** Wording that promises a state list, which /scope-of-practice owns. */
    const STATE_LIST_PROMISE = /per-state|state[ -]by[ -]state|your state['’]s entry|all 50 states|\b50 states\b/i;

    /** Every source line that links the FPA guide, so a promise cannot sit beside the href. */
    const fpaLines = (rel: string, window: number) => {
        const lines = read(rel).split(/\r?\n/);
        return lines.flatMap((line, i) =>
            line.includes("href: '/resources/fpa-guide'") ? [lines.slice(i, i + window).join('\n')] : [],
        );
    };

    it('the free tools band blurb explains the concept and promises no state list', () => {
        const [card] = fpaLines('app/page.tsx', 3);
        expect(card).toContain("blurb: 'What full practice authority means, and how it shapes practice and pay.'");
        expect(card).not.toMatch(STATE_LIST_PROMISE);
        expect(card).not.toMatch(DASHES);
    });

    it('the reading tape fallback card is titled for the concept', () => {
        const cards = fpaLines('components/HomepageBlogSection.tsx', 1);
        expect(cards).toHaveLength(1);
        expect(cards[0]).toContain("title: 'What Full Practice Authority means'");
        expect(cards[0]).not.toMatch(STATE_LIST_PROMISE);
        expect(cards[0]).not.toMatch(DASHES);
    });
});

/* ── H-04: homepage links land on indexable pages ──────────────────────── */

type HeroModule = typeof import('@/components/HomepageHero');

describe('H-04: hero quick filters and stickers', () => {
    let hero: HeroModule;

    beforeAll(async () => {
        hero = await import('@/components/HomepageHero');
    }, COLD_IMPORT_TIMEOUT_MS);

    it('quick filters link their landing pages, never a noindex /jobs?q= search', () => {
        const src = read('components/HomepageHero.tsx');
        for (const slug of ['remote', 'telehealth', 'full-time', 'part-time', 'new-grad']) {
            expect(src).toContain(`href: '/jobs/${slug}'`);
        }
        expect(src).not.toContain('/jobs?q=${encodeURIComponent(filter.query)}');
        expect(src).not.toContain("query: 'New Grad Friendly'");
    });

    it('with no indexable landing, only the salary guide sticker renders', () => {
        const stickers = hero.selectHeroStickers([]);
        expect(stickers.map((s) => s.href)).toEqual(['/salary-guide']);
    });

    it('renders only indexable landings, in priority order, and keeps the salary guide slot', () => {
        const stickers = hero.selectHeroStickers([
            'family-practice',
            'pediatric',
            'psychiatric-mental-health',
            'urgent-care',
            'per-diem',
            'acute-care',
            'travel',
            'women-health',
            'primary-care',
            'emergency',
        ]);
        const hrefs = stickers.map((s) => s.href);
        expect(hrefs).toHaveLength(10);
        expect(hrefs[5]).toBe('/salary-guide');
        // The two landings that were live "noindex" with 0 jobs are skipped,
        // and the next candidate fills the slot.
        expect(hrefs).not.toContain('/jobs/private-practice');
        expect(hrefs).not.toContain('/jobs/adult-gerontology');
        expect(hrefs).toContain('/jobs/urgent-care');
        expect(hrefs).toContain('/jobs/primary-care');
        // Nine category slots: the tenth indexable candidate waits its turn.
        expect(hrefs).not.toContain('/jobs/emergency');
    });

    it('a sticker keeps its slot styling whatever category lands in it', () => {
        const [first] = hero.selectHeroStickers(['pediatric']);
        expect(first.href).toBe('/jobs/pediatric');
        expect(first.pos).toEqual({ top: '12%', left: '4%' });
    });

    it('never links a quick-filter landing from a sticker (no duplicate links)', () => {
        const stickers = hero.selectHeroStickers(['remote', 'telehealth', 'full-time', 'part-time', 'new-grad']);
        expect(stickers.map((s) => s.href)).toEqual(['/salary-guide']);
    });
});

describe('H-04: the homepage reads the landing index verdicts the cron stores', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns the fresh, indexable category-landing rows', async () => {
        m(prisma.pseoStats.findMany).mockResolvedValue([{ categorySlug: 'pediatric' }, { categorySlug: 'travel' }]);
        await expect(getIndexableLandingSlugs()).resolves.toEqual(['pediatric', 'travel']);
        const args = m(prisma.pseoStats.findMany).mock.calls[0][0];
        expect(args.where).toMatchObject({ type: 'category-landing', locationSlug: 'all', indexable: true });
        expect(args.where.updatedAt.gte).toBeInstanceOf(Date);
    });

    it('fails closed: a read error links no gated landing instead of failing the render', async () => {
        m(prisma.pseoStats.findMany).mockRejectedValue(new Error('db down'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(getIndexableLandingSlugs()).resolves.toEqual([]);
        } finally {
            spy.mockRestore();
        }
    });

    it('app/page.tsx passes the verdicts to the hero', () => {
        const page = read('app/page.tsx');
        expect(page).toContain('const indexableLandingSlugs = await getIndexableLandingSlugs();');
        expect(page).toContain('<HomepageHero indexableLandingSlugs={indexableLandingSlugs} />');
    });
});

describe('H-04 / L-03: employer chips link indexable company profiles with honest counts', () => {
    const companies = [
        { id: 'ls', name: 'LifeStance Health', normalizedName: 'life-stance' },
        { id: 'om', name: 'One Medical', normalizedName: 'one' },
        { id: 'sm', name: 'Small Clinic', normalizedName: 'small clinic' },
        { id: 'mc1', name: 'MultiCare Health', normalizedName: 'multi-care' },
        { id: 'mc2', name: 'Multicare Health', normalizedName: 'multicare' },
        { id: 'long', name: 'A'.repeat(41), normalizedName: 'long' },
    ];

    it('links /companies/{display-name slug} at the profile index gate, else a search', () => {
        const chips = buildEmployerChips(
            [
                { companyId: 'ls', activeJobs: 105 },
                { companyId: 'om', activeJobs: 62 },
                { companyId: 'sm', activeJobs: 2 },
            ],
            companies,
        );
        expect(chips).toEqual([
            { name: 'LifeStance Health', count: 105, href: '/companies/lifestance-health' },
            { name: 'One Medical', count: 62, href: '/companies/one-medical' },
            { name: 'Small Clinic', count: 2, href: '/jobs?q=Small%20Clinic' },
        ]);
    });

    it('collapses two spellings that share one profile URL, and skips over-long names', () => {
        const chips = buildEmployerChips(
            [
                { companyId: 'mc1', activeJobs: 9 },
                { companyId: 'mc2', activeJobs: 6 },
                { companyId: 'long', activeJobs: 30 },
                { companyId: 'missing', activeJobs: 30 },
            ],
            companies,
        );
        expect(chips).toEqual([{ name: 'MultiCare Health', count: 9, href: '/companies/multicare-health' }]);
    });

    it('honours the strip size', () => {
        const chips = buildEmployerChips(
            [
                { companyId: 'ls', activeJobs: 105 },
                { companyId: 'om', activeJobs: 62 },
            ],
            companies,
            1,
        );
        expect(chips).toHaveLength(1);
    });

    it('counts with the canonical predicate, grouped by Company row', () => {
        const src = read('components/EmployerTrustSection.tsx');
        expect(src).toContain("by: ['companyId']");
        expect(src).toContain('canonicalBucketWhere({ companyId: { not: null } }, now)');
        expect(src).not.toContain('where: { isPublished: true }');
    });

    it('the strip links each chip where the builder says, and hides the marquee echo', () => {
        const strip = read('components/ClayDoughStrip.tsx');
        expect(strip).toContain('href={emp.href}');
        expect(strip).not.toContain('href={`/jobs?q=${encodeURIComponent(emp.name)}`}');
        expect(strip).toContain('aria-hidden={i >= unique.length ? true : undefined}');
        expect(strip).toContain('tabIndex={i >= unique.length ? -1 : undefined}');
    });
});

describe('H-04: state tiles link canonical state pages with canonical counts', () => {
    it('merges a name and its code, drops non-US values, and uses the served slug', () => {
        const states = mergeStateCounts([
            { state: 'California', jobs: 40 },
            { state: 'CA', jobs: 5 },
            { state: 'New York', jobs: 30 },
            { state: 'Iraq', jobs: 4 },
            { state: 'Remote', jobs: 9 },
            { state: null, jobs: 3 },
        ]);
        expect(states).toEqual([
            { name: 'California', count: 45, slug: 'california' },
            { name: 'New York', count: 30, slug: 'new-york' },
        ]);
    });

    it('queries the canonical predicate, not bare isPublished', () => {
        const src = read('components/TopStatesSection.tsx');
        expect(src).toContain('canonicalBucketWhere({ state: { not: null } })');
        expect(src).not.toContain('isPublished: true');
    });
});

/* ── L-05 / M-07: internal links ───────────────────────────────────────── */

describe('L-05: city links resolve metro twins before linking', () => {
    /**
     * Each builds a /jobs/city/{slug} href for any city that resolves, and
     * cityLinkResolves() says yes to the 20 curated metros, whose city form
     * only 308s to /jobs/metro/{slug} (/blog/np-license-texas linked
     * /jobs/city/dallas-tx; /jobs/locations linked /jobs/city/chicago-il).
     * A handoff to each owner routes them through localJobsPath; these pins
     * fail until it lands.
     */
    it.each([
        'app/jobs/locations/page.tsx',
        'app/jobs/city/[slug]/page.tsx',
        'app/salary-guide/[state]/page.tsx',
        'components/blog/LicenseGuideMarketSnapshot.tsx',
        'components/JobLocationContext.tsx',
        'components/tools/city-picker-data.ts',
        'lib/pseo/category-city-template.tsx',
    ])('%s links cities through localJobsPath', (rel) => {
        const src = code(read(rel));
        expect(src).toContain("from '@/lib/city-link-path'");
        expect(src).toMatch(/localJobsPath\(/);
    });

    it('localJobsPath sends a metro to its guide and any other city to its page', async () => {
        const { localJobsPath } = await import('@/lib/city-link-path');
        expect(localJobsPath('dallas-tx')).toBe('/jobs/metro/dallas-tx');
        expect(localJobsPath('tulsa-ok')).toBe('/jobs/city/tulsa-ok');
    });
});

describe('CQ-16: copy defects in shared templates', () => {
    it('the category landing H1 is a noun phrase, not "... NP Jobs find your next role."', () => {
        const template = code(read('lib/pseo/category-landing-template.tsx'));
        expect(template).not.toContain('find your next role');
        expect(template).toContain('headlineSub="in the United States."');
    });

    it('the job card never cuts an employer to "University of"', () => {
        const card = code(read('components/JobCard.tsx'));
        expect(card).toContain("import { shortEmployerLabel } from '@/lib/employer-display';");
        expect(card).toContain('{shortEmployerLabel(displayEmployer)}');
        expect(card).not.toContain(".slice(0, 2).join(' ')");
    });
});

describe('L-05 / M-07: homepage and FAQ links', () => {
    it('the join CTA links /signup directly (not /register, which only 308s there)', () => {
        const src = read('components/FeaturedJobs.tsx');
        expect(src).toContain('<Link href="/signup" className="fjs-join">');
        expect(src).not.toContain('href="/register"');
    });

    it('/for-job-seekers is linked from the homepage and the FAQ', () => {
        expect(read('components/FeaturedJobs.tsx')).toContain('<Link href="/for-job-seekers" className="fjs-more">');
        expect(read('app/faq/page.tsx')).toContain("{ href: '/for-job-seekers', label:");
    });

    it('the CEU guide is linked from the FAQ through its own slug constant', () => {
        const faq = read('app/faq/page.tsx');
        expect(faq).toContain("import { CEU_GUIDE_SLUG, CEU_GUIDE_TITLE } from '@/lib/blog-ceu-guide'");
        expect(faq).toContain('{ href: `/blog/${CEU_GUIDE_SLUG}`, label: CEU_GUIDE_TITLE }');
    });
});

/* ── L-02 / CS-10 / CQ-16: one brand suffix per title ──────────────────── */

describe('L-02 / CS-10: no page re-appends the brand the layout template adds', () => {
    const STATIC_PAGES = [
        '@/app/for-programs/page',
        '@/app/for-employers/resources/page',
        '@/app/for-employers/resources/how-to-hire/page',
        '@/app/for-employers/resources/job-description-guide/page',
        '@/app/for-employers/resources/job-description-templates/page',
    ] as const;

    it.each(STATIC_PAGES)('%s title carries no brand suffix', async (specifier) => {
        const { metadata } = await import(/* @vite-ignore */ specifier);
        const title = String(metadata.title);
        expect(title).not.toContain(brand.name);
        expect(title).not.toMatch(DASHES);
    }, COLD_IMPORT_TIMEOUT_MS);

    it('every job description template title renders the brand once', async () => {
        const { generateMetadata, generateStaticParams } = await import(
            '@/app/for-employers/resources/job-description-templates/[id]/page'
        );
        const params = generateStaticParams();
        expect(params.length).toBeGreaterThan(0);
        for (const { id } of params) {
            const metadata = await generateMetadata({ params: Promise.resolve({ id }) });
            expect(String(metadata.title)).not.toContain(brand.name);
        }
    }, COLD_IMPORT_TIMEOUT_MS);

    it('the job description guide says "an NP", not "a NP"', async () => {
        const { metadata } = await import('@/app/for-employers/resources/job-description-guide/page');
        expect(String(metadata.title)).not.toMatch(/\ba NP\b/);
        expect(String(metadata.title)).toMatch(/^Writing an? /);
    }, COLD_IMPORT_TIMEOUT_MS);
});

/**
 * The `{ ... }` object literal that opens at `start`, by brace depth. Template
 * placeholders are balanced, so counting braces is enough for metadata.
 */
function objectLiteralAt(src: string, start: number): string | null {
    let depth = 0;
    for (let i = start; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    return null;
}

/** Drop each `key: { ... }` sub-object, so only top-level properties remain. */
function withoutSubObjects(literal: string, keys: readonly string[]): string {
    let out = literal;
    for (const key of keys) {
        const at = out.search(new RegExp(`\\b${key}:\\s*\\{`));
        if (at < 0) continue;
        const open = out.indexOf('{', at);
        const sub = objectLiteralAt(out, open);
        if (sub) out = out.slice(0, at) + out.slice(open + sub.length);
    }
    return out;
}

/**
 * The top-level `title` of a file's static `metadata` export, when it is a
 * template literal ending in the brand suffix. openGraph and twitter titles
 * are not templated, so they may carry the brand.
 */
function doubledBrandTitle(src: string): string | null {
    const at = src.search(/export const metadata\b[^=]*=\s*\{/);
    if (at < 0) return null;
    const literal = objectLiteralAt(src, src.indexOf('{', at));
    if (!literal) return null;
    const topLevel = withoutSubObjects(literal, ['openGraph', 'twitter', 'robots', 'alternates']);
    return topLevel.match(/\btitle:\s*`[^`]*\| \$\{brand\.name\}`/)?.[0] ?? null;
}

describe('L-02 / CS-10: no layout or page anywhere re-appends the templated brand', () => {
    /**
     * Pages outside this package that rendered "| NP Hiring | NP Hiring" (the
     * first two verified live, both indexable). Each has a handoff filed to
     * its owner; these pins fail until it lands, because the doubled title
     * ships until then.
     */
    const HANDOFF_FILES = [
        'app/data-request/layout.tsx',
        'app/do-not-sell/layout.tsx',
        'app/forgot-password/layout.tsx',
        'app/reset-password/layout.tsx',
        'app/unsubscribe/layout.tsx',
        'app/unauthorized/page.tsx',
        'app/onboarding/professional/page.tsx',
        'app/employer/login/page.tsx',
        'app/employer/signup/page.tsx',
        'app/employer/analytics/page.tsx',
    ] as const;

    it('the templates these titles rely on still append the brand', () => {
        expect(read('app/layout.tsx')).toContain('template: `%s | ${brand.name}`');
        expect(read('app/employer/layout.tsx')).toContain('template: `%s | ${brand.name}`');
    });

    it('the detector sees a doubled title and ignores share-card titles', () => {
        expect(doubledBrandTitle("export const metadata = {\n  title: `Unsubscribe | ${brand.name}`,\n};")).not.toBeNull();
        expect(
            doubledBrandTitle(
                "export const metadata: Metadata = {\n  title: `Companies`,\n  openGraph: { title: `Companies | ${brand.name}` },\n};",
            ),
        ).toBeNull();
        expect(doubledBrandTitle("export const metadata = {\n  title: { absolute: `${brand.name}: Jobs` },\n};")).toBeNull();
    });

    it.each(HANDOFF_FILES)('%s leaves the brand to the template', (rel) => {
        expect(doubledBrandTitle(code(read(rel)))).toBeNull();
    });

    it('no other page or layout under app/ re-appends it', () => {
        const pending = new Set<string>(HANDOFF_FILES);
        const offenders = walk('app', ['page.tsx', 'layout.tsx'])
            .filter((rel) => !pending.has(rel) && rel !== 'app/layout.tsx')
            .filter((rel) => doubledBrandTitle(code(read(rel))) !== null);
        expect(offenders).toEqual([]);
    });
});
