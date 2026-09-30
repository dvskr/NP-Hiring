/**
 * EDGE-CRONS handoff 20: the dead-link gate reaches every listing.
 *
 * A job at DEAD_LINK_MISS_THRESHOLD consecutive source misses answers 410 on
 * its own URL (middleware) and its page reads closed. Only the sitemap and
 * canonical-count predicates (activeIndexableJobWhere, canonicalBucketWhere)
 * dropped it, so /jobs search, every PUBLISHED_LISTING_WHERE user, semantic
 * search and the edge city gate still listed a link that answers 410. The
 * gate now lives in a leaf module (lib/dead-link-threshold.ts) that each of
 * them reads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { DEAD_LINK_MISS_THRESHOLD as LEAF_THRESHOLD, LIVE_LINK_REST_FILTER, liveLinkWhere } from '@/lib/dead-link-threshold';
import { DEAD_LINK_MISS_THRESHOLD, activeIndexableJobWhere } from '@/lib/active-job-filter';
import { buildCategoryWhereClause, buildWhereClause } from '@/lib/filters';
import { PUBLISHED_LISTING_WHERE, publishedListingWhere, withListingQuarantine } from '@/lib/pseo/listing-where';
import { cityGateLookup } from '@/lib/pseo/listing-gates-edge';
import { DEFAULT_FILTERS } from '@/types/filters';

const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const LIVE = { healthConsecutiveMissing: { lt: DEAD_LINK_MISS_THRESHOLD } };
const andOf = (where: { AND?: unknown }): unknown[] => (Array.isArray(where.AND) ? where.AND : [where.AND]);

describe('one threshold, one clause', () => {
    it('active-job-filter re-exports the leaf threshold, and the sitemap predicate reads it', () => {
        expect(DEAD_LINK_MISS_THRESHOLD).toBe(LEAF_THRESHOLD);
        expect(DEAD_LINK_MISS_THRESHOLD).toBe(5);
        expect(activeIndexableJobWhere().healthConsecutiveMissing).toEqual({ lt: DEAD_LINK_MISS_THRESHOLD });
    });

    it('liveLinkWhere returns a fresh clause on every call', () => {
        const a = liveLinkWhere();
        const b = liveLinkWhere();
        expect(a).toEqual(LIVE);
        expect(a).not.toBe(b);
    });

    it('the leaf imports nothing at runtime, so the edge gates and lib/filters can read it without a cycle', () => {
        const src = read('lib/dead-link-threshold.ts');
        const imports = src.match(/^import .*$/gm) ?? [];
        expect(imports).toEqual(["import type { Prisma } from '@prisma/client';"]);
    });
});

describe('every listing predicate carries the gate', () => {
    it('withListingQuarantine, publishedListingWhere and PUBLISHED_LISTING_WHERE', () => {
        expect(andOf(withListingQuarantine({ isPublished: true }))).toContainEqual(LIVE);
        expect(andOf(publishedListingWhere({ isRemote: true }))).toContainEqual(LIVE);
        expect(PUBLISHED_LISTING_WHERE.AND).toContainEqual(LIVE);
    });

    it('/jobs search (buildWhereClause), with and without filters', () => {
        expect(andOf(buildWhereClause(DEFAULT_FILTERS))).toContainEqual(LIVE);
        expect(andOf(buildWhereClause({ ...DEFAULT_FILTERS, search: 'remote nurse practitioner', jobType: ['Full-Time'] }))).toContainEqual(LIVE);
    });

    it('the legacy category builder (buildCategoryWhereClause)', () => {
        expect(andOf(buildCategoryWhereClause('telehealth'))).toContainEqual(LIVE);
        expect(andOf(buildCategoryWhereClause('not-a-registered-slug', { isRemote: true }))).toContainEqual(LIVE);
    });

    it('both semantic search queries: the keyword leg and the hydrate choke point', () => {
        const src = read('app/api/jobs/search/semantic/route.ts');
        expect(src).toContain("import { liveLinkWhere } from '@/lib/dead-link-threshold';");
        const gated = src.match(/AND: \[\.\.\.GLOBAL_EXCLUSIONS\.map\(\(exclusion\) => \(\{ NOT: exclusion \}\)\), liveLinkWhere\(\)\]/g) ?? [];
        expect(gated).toHaveLength(2);
    });
});

describe('the edge city gate reads the rows the page counts', () => {
    const isMetro = (): boolean => false;

    it('filters dead links in the REST lookup for a hub slug and an ambiguous slug', () => {
        expect(LIVE_LINK_REST_FILTER).toBe(`health_consecutive_missing=lt.${DEAD_LINK_MISS_THRESHOLD}`);
        expect(cityGateLookup('austin-tx', isMetro)?.query).toContain(`&${LIVE_LINK_REST_FILTER}&`);
        expect(cityGateLookup('notacity-zz', isMetro)?.query).toContain(`&${LIVE_LINK_REST_FILTER}&`);
    });
});
