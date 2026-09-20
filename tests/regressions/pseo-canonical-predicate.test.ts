/**
 * One inventory predicate for every pSEO gate (PLAN C.2, W1-SITEMAP).
 *
 * The numbers that flow into lib/pseo/render-gate.ts must all be taken with
 * the canonical countable-inventory predicate in lib/canonical-counts.ts:
 * the cron that stores PseoStats, the primary sitemap, and the data layer
 * (lib/pseo/listing-facts.ts) that feeds the page robots. The cities batch
 * route counts nothing itself: it only reads rows the cron wrote, so it
 * inherits the predicate and must never open a Job query of its own.
 *
 * render-gate.ts is deliberately dependency-free (pure functions over plain
 * numbers, testable without Prisma), so it cannot carry a second predicate;
 * its purity is pinned here instead of an import.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CRON = 'app/api/cron/aggregate-pseo/route.ts';
const SITEMAP = 'app/sitemap.ts';
const CITIES_ROUTE = 'app/api/sitemaps/cities/[batch]/route.ts';
const RENDER_GATE = 'lib/pseo/render-gate.ts';
const LISTING_FACTS = 'lib/pseo/listing-facts.ts';

const CANONICAL_IMPORT = /import \{[^}]*\bcanonical(?:Bucket|ActiveJob)Where\b[^}]*\} from '@\/lib\/canonical-counts'/;

describe('the count producers import the canonical predicate', () => {
    it.each([CRON, SITEMAP, LISTING_FACTS])('%s imports from lib/canonical-counts', (rel) => {
        expect(read(rel)).toMatch(CANONICAL_IMPORT);
    });

    it('the cron takes every Job query through canonicalBucketWhere and nothing else', () => {
        const code = stripComments(read(CRON));
        const jobQueries = code.match(/prisma\.job\.(?:findMany|count|groupBy|aggregate)\(/g) ?? [];
        expect(jobQueries.length).toBeGreaterThanOrEqual(3);
        // `where:` values inside query calls; a parameter's type annotation
        // (`where: Record<...>`, `where: Prisma.JobWhereInput`) is not a query.
        const wheres = code.match(/\bwhere: (?!Record<|Prisma\.)[^\n]+/g) ?? [];
        const jobWheres = wheres.filter((w) => !w.includes('WHERE p.'));
        expect(jobWheres.length).toBeGreaterThanOrEqual(3);
        for (const where of jobWheres) {
            expect(where, where).toContain('canonicalBucketWhere(');
        }
        expect(code).not.toContain('activeIndexableJobWhere');
        expect(code).not.toContain('PUBLISHED_LISTING_WHERE');
        expect(code).not.toMatch(/where:\s*\{\s*isPublished/);
    });

    it('the sitemap counts every pSEO section with canonicalBucketWhere', () => {
        const code = stripComments(read(SITEMAP));
        // State hubs, salary states, metros, directories, city pages and the
        // city employer groupBy: six canonical scopes, plus the hub row fetch.
        expect(code.match(/canonicalBucketWhere\(/g)?.length).toBeGreaterThanOrEqual(6);
        expect(code).not.toContain('PUBLISHED_LISTING_WHERE');
        // The OR-clobber shape lib/canonical-counts.ts exists to prevent.
        expect(code).not.toMatch(/\.\.\.ACTIVE_JOB_WHERE,\s*OR:/);
        expect(code).not.toMatch(/\.\.\.activeIndexableJobWhere\([^)]*\),\s*OR:/);
    });

    it('the cities batch route opens no Job query: it reads only what the cron stored', () => {
        const code = stripComments(read(CITIES_ROUTE));
        expect(code).not.toMatch(/prisma\.job\./);
        expect(code).toContain('FROM "PseoStats"');
        expect(code).not.toContain('activeIndexableJobWhere');
    });
});

describe('lib/pseo/render-gate.ts stays a pure module', () => {
    const src = read(RENDER_GATE);

    it('imports nothing and touches no client, so it cannot carry a second predicate', () => {
        expect(src).not.toMatch(/^\s*import\s/m);
        expect(src).not.toMatch(/\bprisma\b/);
        expect(src).not.toMatch(/\brequire\(/);
    });

    it('every gate takes plain numbers or facts and returns a boolean', () => {
        const signatures = src.match(/export function shouldIndex\w+\([^)]*\): boolean/g) ?? [];
        expect(signatures.length).toBeGreaterThanOrEqual(8);
        for (const signature of signatures) {
            expect(signature).not.toMatch(/Prisma|Job\b/);
        }
    });
});

describe('the freshness window has one owner', () => {
    it('only render-gate.ts defines PSEO_STATS_MAX_AGE_HOURS; the sitemap routes import it', () => {
        expect(read(RENDER_GATE)).toContain('export const PSEO_STATS_MAX_AGE_HOURS = 36');
        for (const rel of [CRON, SITEMAP, CITIES_ROUTE]) {
            const code = stripComments(read(rel));
            expect(code, rel).not.toMatch(/PSEO_STALENESS_HOURS\s*=|PSEO_STATS_MAX_AGE_HOURS\s*=/);
        }
        expect(read(CITIES_ROUTE)).toContain('pseoStatsFreshnessThreshold');
        expect(read(SITEMAP)).toContain('pseoStatsFreshnessThreshold');
    });
});
