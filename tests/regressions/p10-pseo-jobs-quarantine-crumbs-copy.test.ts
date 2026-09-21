/**
 * P10 pseo-jobs regressions (re-verification round 1 survivors):
 *   1. the profession quarantine reaches the state hub, city hub, metro guide,
 *      locations hub, category x city / setting x state templates and the
 *      job detail route (a quarantined row answers 404 on its UUID URL)
 *   2. every CategoryHero caller renders the breadcrumb trail its
 *      BreadcrumbList JSON-LD declares, as links
 *   3. state hub count copy agrees in number ("1 job", not "1 jobs")
 *   4. the branded 404 page carries its own title
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';
import {
    withListingQuarantine,
    publishedListingWhere,
    PUBLISHED_LISTING_WHERE,
} from '@/lib/pseo/listing-where';
import { crumbsFromSchema, normalizeCrumbs } from '@/components/CategoryHero';
import { metadata as notFoundMetadata } from '@/app/not-found';

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
        'app/jobs/state/[state]/page.tsx',
        'app/jobs/city/[slug]/page.tsx',
        'app/jobs/metro/[slug]/page.tsx',
        'app/jobs/locations/page.tsx',
    ]) {
        it(`${rel} carries no bare isPublished predicate`, () => {
            const src = read(rel);
            expect(src).toContain("import { PUBLISHED_LISTING_WHERE } from '@/lib/pseo/listing-where';");
            expect(src).not.toMatch(/isPublished: true/);
            expect(src).toMatch(/\.\.\.PUBLISHED_LISTING_WHERE/);
        });
    }

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
        expect(src).toContain("`${c.name} (${c.count} ${pluralize(c.count, 'job')})`");
        expect(src).not.toContain('(${c.count} jobs)');
        expect(src).toContain("badgeText={`${stats.totalJobs} live ${pluralize(stats.totalJobs, 'role')} · updated today`}");
        expect(src).toContain("label: pluralize(stats.totalJobs, 'position')");
        expect(src).toContain("label: pluralize(stats.uniqueEmployerCount, 'employer')");
        expect(src).toContain("There ${isAre(stats.totalJobs)} currently");
        expect(src).not.toMatch(/label: '(positions|employers)'/);
        expect(src).not.toMatch(/\{stats\.totalJobs\} active positions/);
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
