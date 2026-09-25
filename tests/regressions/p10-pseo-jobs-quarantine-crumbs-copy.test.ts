/**
 * P10 pseo-jobs regressions (re-verification round 1 survivors):
 *   1. the profession quarantine reaches the state hub, city hub, metro guide,
 *      locations hub, category x city / setting x state templates and the
 *      job detail route (a quarantined row answers 404 on its UUID URL)
 *   2. every CategoryHero caller renders the breadcrumb trail its
 *      BreadcrumbList JSON-LD declares, as links
 *   3. state hub count copy agrees in number ("1 job", not "1 jobs")
 *   4. the branded 404 page carries its own title
 *   5. the locations index never counts the District of Columbia as a state
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';
import {
    withListingQuarantine,
    publishedListingWhere,
    PUBLISHED_LISTING_WHERE,
} from '@/lib/pseo/listing-where';
import { canonicalActiveJobWhere, canonicalBucketWhere } from '@/lib/canonical-counts';
import { STATE_CODES } from '@/lib/pseo/setting-state-config';
import CategoryHero, { crumbsFromSchema, normalizeCrumbs } from '@/components/CategoryHero';
import { metadata as notFoundMetadata } from '@/app/not-found';
import LocationsPage from '@/app/jobs/locations/page';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NOT_CLAUSES = GLOBAL_EXCLUSIONS.map((exclusion) => ({ NOT: exclusion }));

describe('1. profession quarantine on pSEO listing predicates', () => {
    it('appends every GLOBAL_EXCLUSIONS veto under AND and keeps the caller OR', () => {
        const where = withListingQuarantine({
            isPublished: true,
            OR: [{ state: 'Texas' }, { stateCode: 'TX' }],
        });
        expect(where.isPublished).toBe(true);
        expect(where.OR).toEqual([{ state: 'Texas' }, { stateCode: 'TX' }]);
        expect(where.AND).toEqual(NOT_CLAUSES);
        expect(where.AND.length).toBeGreaterThan(0);
    });

    it('keeps an existing AND (array or single clause) ahead of the vetoes', () => {
        const fromArray = withListingQuarantine({ AND: [{ city: 'Austin' }] });
        expect(fromArray.AND).toEqual([{ city: 'Austin' }, ...NOT_CLAUSES]);
        const fromObject = withListingQuarantine({ AND: { city: 'Austin' } });
        expect(fromObject.AND).toEqual([{ city: 'Austin' }, ...NOT_CLAUSES]);
    });

    it('does not mutate the input predicate', () => {
        const input = { isPublished: true, AND: [{ city: 'Austin' }] };
        withListingQuarantine(input);
        expect(input.AND).toEqual([{ city: 'Austin' }]);
    });

    it('the spreadable base survives a spread beside scalar and OR keys', () => {
        const where = { ...PUBLISHED_LISTING_WHERE, city: { not: null }, OR: [{ state: 'Texas' }] };
        expect(where.isPublished).toBe(true);
        expect(where.AND).toEqual(NOT_CLAUSES);
        expect(publishedListingWhere({ isRemote: true })).toEqual({ isPublished: true, isRemote: true, AND: NOT_CLAUSES });
    });

    it('the profession-class veto is one of the appended clauses', () => {
        const serialized = JSON.stringify(PUBLISHED_LISTING_WHERE.AND);
        expect(serialized).toContain('professionClass');
        expect(serialized).toContain('other_clinical');
        expect(serialized).toContain('Podiatrist');
    });

    for (const rel of [
        'app/jobs/city/[slug]/page.tsx',
        'app/jobs/metro/[slug]/page.tsx',
    ]) {
        it(`${rel} carries no bare isPublished predicate`, () => {
            const src = read(rel);
            expect(src).toContain("import { PUBLISHED_LISTING_WHERE } from '@/lib/pseo/listing-where';");
            expect(src).not.toMatch(/isPublished: true/);
            expect(src).toMatch(/\.\.\.PUBLISHED_LISTING_WHERE/);
        });
    }

    /*
     * WHY THIS PIN CHANGED (indexing-policy follow-up, 2026-09): the
     * locations index counted its state tiles, remote banner and hero total
     * on the published-only spread base, which carries the quarantine but
     * not the expiry or dead-link gates, while the state hubs and
     * /jobs/remote those tiles link to count with canonicalBucketWhere. A
     * tile could promise more jobs than its destination listed. The property
     * this case exists for, that no listing count skips the profession
     * quarantine, still holds: canonicalBucketWhere carries every
     * GLOBAL_EXCLUSIONS veto (pinned behaviourally below) plus the two gates
     * the old base lacked. Every query is checked, not just the first, so a
     * count added later with a bare where clause fails here.
     */
    it('app/jobs/locations/page.tsx routes every Job query through canonicalBucketWhere', () => {
        const rel = 'app/jobs/locations/page.tsx';
        const src = read(rel);
        expect(src).not.toMatch(/isPublished: true/);
        expect(src).not.toMatch(/PUBLISHED_LISTING_WHERE/);
        expect(src).toContain("import { canonicalBucketWhere } from '@/lib/canonical-counts';");
        const queries = src.match(/prisma\.job\.\w+\(\{[\s\S]{0,240}?where: [^\n]*/g) ?? [];
        // State tiles, remote banner, top cities, hero total, directory rows.
        expect(queries.length, `${rel} lost a Job query, so the loader moved`).toBeGreaterThanOrEqual(5);
        for (const query of queries) expect(query, query).toContain('canonicalBucketWhere(');
    });

    /*
     * WHY THIS PIN CHANGED (PLAN T0-1, thin-content state hub rewrite):
     * app/jobs/state/[state]/page.tsx no longer hand-builds a listing
     * predicate at all, so it cannot spread PUBLISHED_LISTING_WHERE. Every
     * Job query it makes now composes canonicalBucketWhere(), which is
     * activeIndexableJobWhere() AND GLOBAL_EXCLUSIONS. That is a strict
     * superset of PUBLISHED_LISTING_WHERE: the same quarantine vetoes plus
     * the expiry and repeated-dead-link gates. The property this case exists
     * for therefore still holds, by a different mechanism, so the pin follows
     * the property rather than the literal. The removal of the old shape is
     * pinned too, so a half-migrated file fails loudly instead of quietly
     * carrying two predicates.
     */
    it('app/jobs/state/[state]/page.tsx routes every Job query through canonicalBucketWhere', () => {
        const rel = 'app/jobs/state/[state]/page.tsx';
        const src = read(rel);
        expect(src).not.toMatch(/isPublished: true/);
        expect(src).not.toMatch(/PUBLISHED_LISTING_WHERE/);
        expect(src).toContain("import { canonicalBucketWhere } from '@/lib/canonical-counts';");
        // EVERY call site, not just the first: a second query added later with
        // a bare where clause is exactly how a quarantined Podiatrist row
        // reached /jobs/state/texas the first time.
        const queries = src.match(/prisma\.job\.\w+\(\{[\s\S]{0,240}?where: [^\n]*/g) ?? [];
        expect(queries.length, `${rel} makes no prisma.job query, so the loader moved`).toBeGreaterThan(0);
        for (const query of queries) expect(query, query).toContain('canonicalBucketWhere(');
        // The hub's aggregates come from the shared facts loader, which
        // composes the same predicate, so they carry the quarantine as well.
        expect(src).toContain("import { getListingFacts");
        expect(read('lib/pseo/listing-facts.ts')).toContain("import { canonicalBucketWhere");
    });

    it('canonicalBucketWhere carries the same profession vetoes as PUBLISHED_LISTING_WHERE', () => {
        // The mechanism behind the pin above: swapping the builder must never
        // be a way to drop the quarantine. Every veto the spreadable base
        // appends has to survive in the canonical predicate and in a bucketed
        // composition of it, which is the shape the hub actually queries with.
        const canonical = JSON.stringify(canonicalActiveJobWhere());
        for (const clause of NOT_CLAUSES) expect(canonical).toContain(JSON.stringify(clause));
        const bucketed = JSON.stringify(canonicalBucketWhere({ state: 'Texas' }));
        for (const clause of NOT_CLAUSES) expect(bucketed).toContain(JSON.stringify(clause));
        expect(bucketed).toContain('professionClass');
        expect(bucketed).toContain('other_clinical');
        expect(bucketed).toContain('Podiatrist');
    });

    it('the job detail route gates its live render on the quarantine and 404s a rejected row', () => {
        const src = read('app/jobs/[slug]/page.tsx');
        expect(src).toMatch(/prisma\.job\.findFirst\(\{\s*where: \{ id, \.\.\.PUBLISHED_LISTING_WHERE \}/);
        expect(src).toContain("if (!jobWithRelation) return { status: 'quarantined' };");
        expect(src).toMatch(/if \(result\.status === 'quarantined'\) \{\s*notFound\(\);/);
        expect(src).toMatch(/if \(result\.status === 'gone' \|\| result\.status === 'quarantined'\) \{\s*return \{\s*title: 'Page Not Found'/);
        // Related-job and internal-link buckets never surface a quarantined row either.
        expect(src).not.toMatch(/isPublished: true \}/);
        expect(src.match(/\{ id: \{ not: currentJobId \}, \.\.\.PUBLISHED_LISTING_WHERE \}/g)?.length).toBe(2);
    });

    it('the category x city and setting x state templates wrap every buildWhere call', () => {
        for (const rel of ['lib/pseo/category-city-template.tsx', 'lib/pseo/setting-state-template.tsx']) {
            const src = read(rel);
            const calls = src.match(/const where = [^\n]*buildWhere\([^\n]*/g) ?? [];
            expect(calls.length, rel).toBe(2);
            for (const call of calls) expect(call, rel).toContain('withListingQuarantine(');
        }
    });

    it('setting-state-config stays free of the Prisma-bound filters import (middleware imports it)', () => {
        const src = read('lib/pseo/setting-state-config.ts');
        expect(src).not.toContain('listing-where');
        expect(src).not.toContain("from '@/lib/filters'");
    });
});

describe('2. hero breadcrumbs mirror the BreadcrumbList schema', () => {
    it('maps schema items to linked crumbs with the current page unlinked', () => {
        const items = [
            { name: 'Home', url: 'https://example.com' },
            { name: 'Jobs', url: 'https://example.com/jobs' },
            { name: 'Texas', url: 'https://example.com/jobs/state/texas' },
        ];
        const crumbs = crumbsFromSchema(items);
        expect(crumbs).toEqual([
            { label: 'Home', href: 'https://example.com' },
            { label: 'Jobs', href: 'https://example.com/jobs' },
            { label: 'Texas', href: 'https://example.com/jobs/state/texas' },
        ]);
        expect(normalizeCrumbs(crumbs, 'https://example.com')).toEqual([
            { label: 'Home', href: '/' },
            { label: 'Jobs', href: '/jobs' },
            { label: 'Texas', href: null },
        ]);
    });

    it('no app/jobs page passes a label-only string trail to CategoryHero', () => {
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
                const rel = `${dir}/${entry.name}`;
                if (entry.isDirectory()) walk(rel);
                else if (rel.endsWith('.tsx') && /breadcrumbs=\{\['/.test(read(rel))) offenders.push(rel);
            }
        };
        walk('app/jobs');
        expect(offenders).toEqual([]);
    });

    for (const rel of [
        'app/jobs/remote/page.tsx',
        'app/jobs/state/[state]/page.tsx',
        'app/jobs/metro/[slug]/page.tsx',
        'app/jobs/city/[slug]/page.tsx',
        'app/jobs/new-grad/page.tsx',
    ]) {
        it(`${rel} builds its hero trail with crumbsFromSchema`, () => {
            const src = read(rel);
            expect(src).toContain("import CategoryHero, { crumbsFromSchema } from '@/components/CategoryHero';");
            expect(src).toMatch(/breadcrumbs=\{crumbsFromSchema\(/);
            expect(src).toMatch(/<BreadcrumbSchema items=\{/);
        });
    }
});

describe('3. state hub count copy agrees in number', () => {
    const src = read('app/jobs/state/[state]/page.tsx');

    it('FAQ city counts, hero badge and stats are pluralized', () => {
        // WHY THIS PIN CHANGED (PLAN C.4, HUB-S10): the page-local FAQ array
        // and the page-local "There is/are currently" sentence were replaced
        // by buildHubFaqs and buildPlainStateNarrative. Both builders do their
        // own count-noun agreement through isAre / formatCount and are pinned
        // entry by entry in tests/unit/listing-narrative.test.ts, so the
        // plural guarantee survived the move and only its address changed.
        // Pin the call sites, and keep every in-page pin that still applies.
        expect(src).toContain('...buildHubFaqs({');
        expect(src).toContain('buildPlainStateNarrative({');
        expect(src).not.toContain('(${c.count} jobs)');
        expect(src).toContain("badgeText={`${stats.totalJobs} live ${pluralize(stats.totalJobs, 'role')} · updated today`}");
        expect(src).toContain("label: pluralize(stats.totalJobs, 'position')");
        expect(src).toContain("label: pluralize(stats.uniqueEmployerCount, 'employer')");
        expect(src).not.toMatch(/label: '(positions|employers)'/);
        expect(src).not.toMatch(/\{stats\.totalJobs\} active positions/);
        // The defect itself, pinned independently of where the copy now lives:
        // a live count interpolated straight in front of a hard-coded plural
        // noun is what "1 jobs" was, and the hub must never print one again.
        expect(src).not.toMatch(/\$\{[\w.()]*(?:count|Count|total|Total)[\w.()]*\}\s+(?:jobs|roles|positions|employers|cities)\b/);
    });

    it('metro and city hubs no longer hard-code plural nouns after a live count', () => {
        const metro = read('app/jobs/metro/[slug]/page.tsx');
        expect(metro).not.toContain('live roles ·');
        expect(metro).not.toMatch(/label: 'positions'/);
        const city = read('app/jobs/city/[slug]/page.tsx');
        expect(city).not.toContain('{city.count} jobs</span>');
    });
});

describe('4. branded 404 title', () => {
    it('exports a not-found title and noindex robots', () => {
        expect(notFoundMetadata.title).toBe('Page Not Found');
        expect(notFoundMetadata.robots).toEqual({ index: false, follow: true });
        expect(String(notFoundMetadata.title)).toMatch(/not found/i);
        expect(String(notFoundMetadata.description)).not.toMatch(/[–—]/);
    });
});

/*
 * The locations index builds its grid from STATE_CODES, the 50 states and
 * the District of Columbia. With DC in the grid, stats.states.length counts
 * a jurisdiction that is not a state: printed under "US state" or "States
 * Hiring" it would read "51 US states" once every jurisdiction is hiring,
 * and an ItemList sliced to 50 would then disagree with its own
 * numberOfItems. The site's convention is "50 states and DC" or "51
 * jurisdictions". Pinned on what the page emits: the loader runs against
 * the Prisma mock and the returned element tree is read without rendering.
 */
describe('5. the locations index labels the District of Columbia truthfully', () => {
    const DC = 'District of Columbia';
    const ALL = Object.keys(STATE_CODES);
    const STATES_ONLY = ALL.filter((name) => name !== DC);

    type GroupByArgs = { by: readonly string[] };
    interface ListItem { position: number; name: string; url: string }
    interface CollectionSchema {
        '@type': string;
        description: string;
        mainEntity: { numberOfItems: number; itemListElement: ListItem[] };
    }
    interface HeroStat { value: string; label: string }

    /** Every element in the tree that `match` accepts, children first to last. */
    function collect(node: unknown, match: (el: React.ReactElement) => boolean, out: React.ReactElement[] = []): React.ReactElement[] {
        if (Array.isArray(node)) {
            for (const child of node) collect(child, match, out);
            return out;
        }
        if (!React.isValidElement(node)) return out;
        if (match(node)) out.push(node);
        collect((node.props as { children?: unknown }).children, match, out);
        return out;
    }

    /** Runs the page with `hiring` carrying 2 canonical jobs each and no city rows. */
    async function renderIndex(hiring: readonly string[]): Promise<{ schema: CollectionSchema; stats: HeroStat[] }> {
        vi.mocked(prisma.job.count).mockResolvedValue(40 as never);
        vi.mocked(prisma.job.groupBy).mockImplementation((async (args: GroupByArgs) =>
            [...args.by].join(',') === 'state,stateCode'
                ? hiring.map((name) => ({ state: name, stateCode: STATE_CODES[name], _count: { _all: 2 } }))
                : []) as never);
        const tree = await LocationsPage();
        const schemas = collect(tree, (el) => el.type === 'script' && (el.props as { type?: string }).type === 'application/ld+json')
            .map((el) => JSON.parse((el.props as { dangerouslySetInnerHTML: { __html: string } }).dangerouslySetInnerHTML.__html) as CollectionSchema)
            .filter((schema) => schema['@type'] === 'CollectionPage');
        const heroes = collect(tree, (el) => el.type === CategoryHero);
        expect(schemas).toHaveLength(1);
        expect(heroes).toHaveLength(1);
        return { schema: schemas[0], stats: (heroes[0].props as { stats: HeroStat[] }).stats };
    }

    function expectListMatchesCount(schema: CollectionSchema, expected: number): void {
        const { numberOfItems, itemListElement } = schema.mainEntity;
        expect(numberOfItems).toBe(expected);
        expect(itemListElement).toHaveLength(numberOfItems);
        expect(itemListElement.map((item) => item.position)).toEqual(itemListElement.map((_, idx) => idx + 1));
    }

    it('STATE_CODES is the 50 states plus DC, spelled as the page spells it', () => {
        expect(ALL).toHaveLength(51);
        expect(STATES_ONLY).toHaveLength(50);
        expect(STATE_CODES[DC]).toBe('DC');
    });

    it('with every jurisdiction hiring: 50 US states and the District of Columbia, never 51 states', async () => {
        const { schema, stats } = await renderIndex(ALL);
        expect(schema.description).toContain('across 50 US states and the District of Columbia.');
        expect(JSON.stringify(schema)).not.toMatch(/\b51\s+(?:US\s+)?states?\b/i);
        expect(stats).toContainEqual({ value: '50', label: 'States Hiring' });
        expect(stats.map((s) => s.value)).not.toContain('51');
        // Every tile the grid links is listed, DC included, and the count agrees.
        expectListMatchesCount(schema, 51);
        expect(schema.mainEntity.itemListElement.map((item) => item.url)).toContain(`${brand.baseUrl}/jobs/state/district-of-columbia`);
    });

    it('with states only: counts the states and says nothing about DC', async () => {
        const { schema, stats } = await renderIndex(['Texas', 'Ohio', 'Utah']);
        expect(schema.description).toContain('across 3 US states.');
        expect(schema.description).not.toContain(DC);
        expect(stats).toContainEqual({ value: '3', label: 'States Hiring' });
        expectListMatchesCount(schema, 3);
    });

    it('with DC alone: names the District and prints no state figure at all', async () => {
        const { schema, stats } = await renderIndex([DC]);
        expect(schema.description).toContain('across the District of Columbia.');
        expect(schema.description).not.toMatch(/\bstates?\b/i);
        expect(stats.map((s) => s.label)).not.toContain('States Hiring');
        expectListMatchesCount(schema, 1);
    });
});
