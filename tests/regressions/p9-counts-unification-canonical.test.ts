/**
 * P9 — count unification (live review 2026-08-17, item #4).
 *
 * The review caught five coexisting "active job" predicates putting four
 * different totals in front of readers at once (/jobs 876, /press 988,
 * /about 1,079+, homepage 1,000+, /for-programs a fifth), a private
 * inflated new-grad heuristic (~50 vs the filter page's honest 3), three
 * competing employer definitions (107 vs 109), a "Verified Employers" label
 * with no verification filter behind it, and a literal "0+ NPs in Network"
 * rendered from a zero-filled query failure.
 *
 * The fix: lib/canonical-counts.ts is the single countable-inventory
 * predicate (activeIndexableJobWhere + GLOBAL_EXCLUSIONS — exactly what
 * /jobs browses), every count-rendering surface consumes it (directly or
 * via the SiteStat snapshot), buckets compose through canonicalBucketWhere
 * so the expiry OR can never be clobbered, and sub-floor / failed counts
 * are OMITTED, never padded or zero-filled.
 *
 * These tests pin (a) the canonical builder's composition-safety contract
 * and (b) — grep-based, so a new bespoke count fails CI — that each surface
 * still derives its numbers from the canonical module.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import {
    canonicalActiveJobWhere,
    canonicalEmployerWhere,
    canonicalBucketWhere,
    COUNT_DISPLAY_FLOOR,
    SUBSCRIBER_DISPLAY_FLOOR,
} from '@/lib/canonical-counts';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ─── (a) canonical predicate contract ─────────────────────────────────── */

describe('canonicalActiveJobWhere — composition safety', () => {
    const now = new Date('2026-08-20T00:00:00Z');
    const where = canonicalActiveJobWhere(now);

    it('has NO top-level OR — the expiry gate lives inside AND', () => {
        // The /about OR-clobber bug: spreading a base where and adding a
        // sibling OR silently REPLACED activeIndexableJobWhere's expiry OR.
        // The canonical builder nests it so that failure mode cannot recur.
        expect(where).not.toHaveProperty('OR');
        const and = where.AND as Prisma.JobWhereInput[];
        expect(Array.isArray(and)).toBe(true);
        const expiry = and.find((clause) => Array.isArray(clause.OR));
        expect(expiry?.OR).toEqual(activeIndexableJobWhere(now).OR);
    });

    it('carries every non-OR gate of activeIndexableJobWhere unchanged', () => {
        const base: Partial<Prisma.JobWhereInput> = { ...activeIndexableJobWhere(now) };
        delete base.OR;
        for (const [key, value] of Object.entries(base)) {
            expect(where).toHaveProperty(key);
            expect(where[key as keyof Prisma.JobWhereInput]).toEqual(value);
        }
    });

    it('excludes every GLOBAL_EXCLUSIONS clause (the /jobs browse veto set)', () => {
        const and = where.AND as Prisma.JobWhereInput[];
        const nots = and.filter((clause) => clause.NOT !== undefined).map((clause) => clause.NOT);
        expect(nots).toEqual(GLOBAL_EXCLUSIONS);
        // expiry OR + one NOT per exclusion, nothing else smuggled in
        expect(and).toHaveLength(GLOBAL_EXCLUSIONS.length + 1);
    });

    it('canonicalBucketWhere composes a bucket carrying its own OR without losing the expiry gate', () => {
        const bucket: Prisma.JobWhereInput = { OR: [{ isRemote: true }, { title: { contains: 'telehealth' } }] };
        const composed = canonicalBucketWhere(bucket, now);
        expect(composed.AND).toEqual([canonicalActiveJobWhere(now), bucket]);
        // Both ORs survive: the canonical side keeps expiry inside its AND,
        // the bucket keeps its own OR untouched.
        const [canonical, composedBucket] = composed.AND as Prisma.JobWhereInput[];
        expect((canonical.AND as Prisma.JobWhereInput[]).some((clause) => Array.isArray(clause.OR))).toBe(true);
        expect(composedBucket.OR).toEqual(bucket.OR);
    });

    it('canonicalEmployerWhere is exactly "has ≥1 canonical active job"', () => {
        expect(canonicalEmployerWhere(now)).toEqual({ jobs: { some: canonicalActiveJobWhere(now) } });
    });

    it('display floors are sane and ordered', () => {
        expect(COUNT_DISPLAY_FLOOR).toBeGreaterThanOrEqual(1);
        expect(SUBSCRIBER_DISPLAY_FLOOR).toBeGreaterThanOrEqual(COUNT_DISPLAY_FLOOR);
    });
});

/* ─── (b) every count surface consumes the canonical module ────────────── */

describe('count surfaces derive from the canonical module (grep pins)', () => {
    // Every user-facing count surface named in review item #4. A NEW count
    // surface must join this list and import one of the two canonical entry
    // points rather than hand-rolling its own predicate.
    const COUNT_SURFACES = [
        'app/page.tsx',
        'app/about/page.tsx',
        'app/press/page.tsx',
        'app/for-programs/page.tsx',
        'app/companies/page.tsx',
    ] as const;

    it.each(COUNT_SURFACES)('%s imports canonical-counts and/or site-stats', (rel) => {
        const src = read(rel);
        const canonical = /from\s+'@\/lib\/canonical-counts'/.test(src);
        const snapshot = /from\s+'@\/lib\/site-stats'/.test(src);
        expect(canonical || snapshot, `${rel} must consume the canonical count module`).toBe(true);
    });

    it.each(COUNT_SURFACES)('%s runs no bare-isPublished job count', (rel) => {
        // The five-predicate drift started as innocent-looking
        // `count({ where: { isPublished: true } })` calls.
        expect(read(rel)).not.toMatch(/count\(\s*\{\s*where:\s*\{\s*isPublished:\s*true\s*[,}]/);
    });

    it('lib/site-stats.ts computes from the canonical predicates, not distinct employer strings', () => {
        const src = read('lib/site-stats.ts');
        expect(src).toMatch(/from\s+'@\/lib\/canonical-counts'/);
        expect(src).toContain('canonicalActiveJobWhere');
        expect(src).toContain('canonicalEmployerWhere');
        expect(src).not.toContain("distinct: ['employer']");
    });
});

describe('/about — canonical totals, filter-page-parity buckets (item #4a/#4b/#4c)', () => {
    const page = read('app/about/page.tsx');
    const client = read('app/about/AboutClient.tsx');

    it('headline totals come from getSiteStats, not private aggregates', () => {
        expect(page).toMatch(/import\s*\{[^}]*\bgetSiteStats\b[^}]*\}\s*from\s*'@\/lib\/site-stats'/);
        expect(page).not.toContain("distinct: ['companyId']");
    });

    it('the OR-clobber pattern is gone — no spread-plus-sibling-OR base where', () => {
        expect(page).not.toContain('...baseWhere');
        // Buckets compose through the clobber-proof helper instead.
        expect(page).toContain('canonicalBucketWhere(');
    });

    it('new-grad renders the SAME clause the /jobs/new-grad filter uses — the inflated description heuristic stays dead', () => {
        expect(page).toContain('newGradWhereClause()');
        expect(page).not.toMatch(/contains:\s*'new graduate'/);
    });

    it('inpatient/outpatient buckets reuse the registry clauses their filter pages count with', () => {
        expect(page).toContain("buildCategoryWhereClause('inpatient', { isRemote: { not: true } })");
        expect(page).toContain("buildCategoryWhereClause('outpatient')");
        // parity anchor: the filter page uses the identical clause.
        expect(read('app/jobs/inpatient/page.tsx')).toContain(
            "buildCategoryWhereClause('inpatient', { isRemote: { not: true } })",
        );
    });

    it('sub-floor buckets are floor-gated, and the client never fabricates proportional fallbacks', () => {
        expect(page).toContain('COUNT_DISPLAY_FLOOR');
        // The old fallback invented 5%/20%/35%/18% splits of totalJobs.
        expect(client).not.toMatch(/totalJobs\s*\*\s*0\./);
        // null → the count line is omitted, label kept.
        expect(client).toContain('counts.newGrad !== null');
    });

    it('the employer stat is labeled plainly — no unverified "Verified" claim', () => {
        expect(client).not.toContain('Verified Employers');
        expect(client).toMatch(/<div className="lab">Employers<\/div>/);
    });

    it('metadata no longer claims "thousands of companies"', () => {
        expect(page.toLowerCase()).not.toContain('thousands of companies');
        expect(page.toLowerCase()).not.toContain('thousands of jobs');
    });
});

describe('/press — canonical predicate, ONE employer definition (item #4a/#4c)', () => {
    const page = read('app/press/page.tsx');

    it('counts with the canonical predicates', () => {
        expect(page).toContain('canonicalActiveJobWhere()');
        expect(page).toContain('canonicalEmployerWhere()');
    });

    it('no longer counts employers as distinct job.employer strings', () => {
        expect(page).not.toMatch(/by:\s*\['employer'\]/);
    });
});

describe('/for-programs — omit, never zero-fill or pad (item #4d)', () => {
    const page = read('app/for-programs/page.tsx');

    it('stats come from the canonical snapshot with a null (omit) failure path', () => {
        expect(page).toMatch(/import\s*\{[^}]*\bgetSiteStatsOrNull\b[^}]*\}\s*from\s*'@\/lib\/site-stats'/);
        expect(page).toContain('canonicalActiveJobWhere()');
        // The old catch returned zero-filled stats that rendered "0+".
        expect(page).not.toMatch(/totalJobs:\s*0\s*,\s*statesCovered:\s*0\s*,\s*subscribers:\s*0/);
        expect(page).toMatch(/return null/);
    });

    it('the subscriber pill is floor-gated and nothing renders a "+" suffix', () => {
        expect(page).toContain('SUBSCRIBER_DISPLAY_FLOOR');
        expect(page).not.toMatch(/suffix:\s*'\+'/);
        expect(page).not.toContain('{s.suffix}');
    });

    it('the pill band is conditional — no stat pills, no band', () => {
        expect(page).toMatch(/statPills\.length > 0 &&/);
    });
});

describe('/companies — directory and snapshot share the ONE employer definition (item #4c)', () => {
    const page = read('app/companies/page.tsx');

    it('directory count and listing both use the canonical employer/job predicates', () => {
        expect(page).toContain('canonicalEmployerWhere()');
        expect(page).toContain('canonicalActiveJobWhere(now)');
        expect(page).not.toContain('activeIndexableJobWhere(');
    });
});
