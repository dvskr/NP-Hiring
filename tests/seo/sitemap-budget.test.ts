/**
 * P4.1: sitemap budget guard tests.
 *
 * Prevents the next b2187d7-style detonation. Asserts:
 *  - The primary sitemap stays within Google's 50k cap (with 5k headroom)
 *  - Each section's URL count is within an expected range
 *  - All static-pattern URLs in the sitemap conform to canonical shape
 *  - The robots.txt declares the one sitemap entry point (the index) and
 *    leaves the noindexed account pages crawlable (TECH-05)
 *
 * Mocked Prisma — runs against in-memory fixtures, no DB required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// This file executes the REAL production sitemap over a 2000-city fixture,
// importing the full sitemap module graph (tools/compare/reports registries,
// the metro dataset, and the state-directory slug machinery). That run sat
// just under vitest's 5s default; the P7-D4 correctness pass (per-city slug
// canonicalization + metro-twin dedup + round-trip veto) pushed it over.
// The cost is per-invocation module + fixture work, not a hang — prod
// generates the sitemap once per revalidate, where ~hundreds of ms for
// no-404/no-redirect submissions is the right trade.
vi.setConfig({ testTimeout: 30_000 });
// The sitemap lists blog slugs; keep the test off the network.
vi.mock('@/lib/blog', () => ({ getAllPublishedSlugs: vi.fn().mockResolvedValue([]) }));
import { prisma } from '@/lib/prisma';
import sitemapHandler from '@/app/sitemap';
import robotsHandler from '@/app/robots';
import { brand } from '@/config/brand';

// Canonical host comes from the board's brand config — hardcoding the donor
// domain here broke every fork (NP Hiring fork, 2026-07-02).
const BASE_URL = brand.baseUrl.replace(/\/$/, '');
const BASE_URL_RE = new RegExp(`^${BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\/|$)`);

// Build a synthetic catalog that's representative of production scale.
function jobsFixture(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        id: `job-${i.toString().padStart(6, '0')}-${'a'.repeat(36)}`,
        title: `PMHNP Position ${i}`,
        updatedAt: new Date('2026-05-04'),
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('P4.1: sitemap budget guard', () => {
    it('stays within Google 50k cap and emits all expected sections', async () => {
        // Realistic-but-modest fixtures.
        vi.mocked(prisma.job.findFirst).mockResolvedValue({
            updatedAt: new Date('2026-05-04T12:00:00Z'),
        } as never);

        // ~5k active jobs (close to current production)
        vi.mocked(prisma.job.findMany).mockResolvedValue(jobsFixture(5000) as never);

        // ~80 cities with ≥3 jobs (close to current)
        vi.mocked(prisma.job.groupBy).mockResolvedValue(
            Array.from({ length: 80 }, (_, i) => ({
                city: `City${i}`,
                state: i % 2 === 0 ? 'California' : 'Texas',
                _count: { city: 5 + (i % 30) },
            })) as never
        );

        // ~30 companies with ≥8 jobs
        vi.mocked(prisma.company.findMany).mockResolvedValue(
            Array.from({ length: 30 }, (_, i) => ({
                id: `c${i}`,
                name: `Company ${i}`,
                normalizedName: `company-${i}`,
                _count: { jobs: 10 + i },
            })) as never
        );

        // Blog: empty fixture for this test (covered separately).
        // Note: getAllPublishedSlugs is called inside sitemap.ts; if it
        // can't reach Supabase from the test env, the try/catch falls
        // through harmlessly. We assert the sitemap shape regardless.

        const sitemap = await sitemapHandler();

        // Section presence sanity checks
        const baseUrl = BASE_URL;
        const urls = sitemap.map((s) => s.url);
        expect(urls).toContain(baseUrl);
        expect(urls).toContain(`${baseUrl}/jobs`);
        expect(urls).toContain(`${baseUrl}/blog`);
        // /post-job is noindex and out of the sitemap (thin plan O1).
        expect(urls).not.toContain(`${baseUrl}/post-job`);

        // Total count should be substantial but well under cap. (The floor was
        // 100 while every salary specialty page was listed unconditionally;
        // FB-2 lists only the ones whose page indexes, and this fixture gives
        // the specialty verdicts no postings, so only the cited-median pages
        // remain.)
        expect(sitemap.length).toBeGreaterThan(80);
        expect(sitemap.length).toBeLessThan(45_000);

        // Every URL must be HTTPS + canonical-shaped (no query strings).
        // Homepage may render as bare host without trailing slash; everything
        // else must be under /...
        for (const entry of sitemap) {
            expect(entry.url).toMatch(BASE_URL_RE);
            expect(entry.url).not.toContain('?');
            expect(entry.url).not.toContain('#');
        }
    });

    it('hard-fails when active job count is 0 (DB-degraded protection)', async () => {
        vi.mocked(prisma.job.findFirst).mockResolvedValue({
            updatedAt: new Date('2026-05-04'),
        } as never);
        vi.mocked(prisma.job.findMany).mockResolvedValue([] as never); // 0 jobs
        vi.mocked(prisma.job.groupBy).mockResolvedValue([] as never);
        vi.mocked(prisma.company.findMany).mockResolvedValue([] as never);

        // The inner throw triggers the outer try/catch which returns the
        // static-only sitemap. So we expect a non-empty static list, not
        // an empty array — that's the safe degradation.
        const sitemap = await sitemapHandler();
        // Static fallback always has core pages
        expect(sitemap.length).toBeGreaterThan(50);
        expect(sitemap.length).toBeLessThan(200);
        const urls = sitemap.map((s) => s.url);
        // Homepage (bare host) — accept either "https://...com" or with trailing slash.
        expect(urls.some((u) => u === BASE_URL || u === `${BASE_URL}/`)).toBe(true);
    });

    it('robots.txt names one sitemap entry point: the index (FB-4, CS-08, TECH-11)', () => {
        const robots = robotsHandler();

        // The index lists /sitemap.xml and every batch, so it is the only
        // Sitemap line: no duplicate /sitemap.xml, no retired image sitemap,
        // no empty video sitemap (Search Console counts every listed one as
        // submitted).
        const sitemaps = ([] as string[]).concat(robots.sitemap ?? []);
        expect(sitemaps).toEqual([`${process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl}/api/sitemaps/index`]);

        // Catch-all rule must exist
        const catchAll = robots.rules instanceof Array
            ? robots.rules.find((r) => r.userAgent === '*')
            : robots.rules.userAgent === '*' ? robots.rules : null;
        expect(catchAll).toBeDefined();
        expect(catchAll?.disallow).toBeDefined();
    });

    it('TECH-05: search and AI crawlers may fetch the account pages, so they can read the noindex', () => {
        // Each of these answers noindex (metadata robots plus the middleware
        // X-Robots-Tag), and /saved and /messages are linked from every page.
        // A robots.txt block hides that noindex, which is how these URLs
        // reached "Indexed, though blocked by robots.txt". The dated re-block
        // (AUTH_REBLOCK_DATE) is gone for good.
        const ACCOUNT_PAGES = ['/signup', '/login', '/messages', '/saved', '/job-alerts/manage', '/employer/login'];
        const robots = robotsHandler();
        const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
        const asArray = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
        for (const agent of ['*', 'GPTBot', 'AhrefsBot', 'ClaudeBot']) {
            const rule = rules.find((r) => asArray(r.userAgent).includes(agent));
            expect(rule, `no rule block for ${agent}`).toBeDefined();
            const disallow = asArray(rule!.disallow);
            for (const page of ACCOUNT_PAGES) {
                expect(disallow.some((prefix) => page.startsWith(prefix)), `${agent} is blocked from ${page}`).toBe(false);
            }
        }
        // Social preview bots ignore X-Robots-Tag and would render a login
        // shell, so they still skip all six.
        const social = rules.find((r) => asArray(r.userAgent).includes('Twitterbot'));
        for (const page of ACCOUNT_PAGES) expect(asArray(social!.disallow)).toContain(page);
        expect(fs.readFileSync(path.join(process.cwd(), 'app', 'robots.ts'), 'utf8')).not.toMatch(/AUTH_REBLOCK_DATE\s*=|POST_DEADLINE_AUTH_REBLOCK\s*=/);
    });

    it('the account pages really do answer noindex, so unblocking them is safe', () => {
        // Metadata robots on each page or layout…
        for (const rel of [
            'app/signup/page.tsx',
            'app/login/page.tsx',
            'app/messages/layout.tsx',
            'app/saved/layout.tsx',
            'app/job-alerts/manage/layout.tsx',
            'app/employer/layout.tsx',
        ]) {
            expect(fs.readFileSync(path.join(process.cwd(), ...rel.split('/')), 'utf8'), rel).toMatch(/robots:\s*\{\s*index:\s*false/);
        }
        // …and the middleware header for every one of them.
        const middleware = fs.readFileSync(path.join(process.cwd(), 'middleware.ts'), 'utf8');
        for (const page of ['/login', '/signup', '/saved', '/messages', '/job-alerts/manage']) {
            expect(middleware).toContain(`'${page}'`);
        }
        expect(middleware).toContain("hasNoindexPrefix('/employer')");
    });

    it('robots.txt still blocks token-bearing and admin surfaces', () => {
        const robots = robotsHandler();
        const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
        const catchAll = rules.find((r) => r.userAgent === '*');
        const disallow = (catchAll!.disallow ?? []) as string[];

        // Critical safety: never let Google index admin / dashboard / token URLs.
        //
        // Path-prefix convention in app/robots.ts FULL_DISALLOW: surfaces with
        // a real bare-URL page (e.g. /admin renders a page, /dashboard renders
        // a page) are listed WITHOUT a trailing slash so the prefix matches
        // both the bare URL and child paths. Surfaces that exist only as
        // token-bearing children (e.g. /jobs/edit/<token>, no bare page) keep
        // the trailing slash. Assertions below mirror that intent — do not
        // re-add trailing slashes without first removing the bare pages.
        expect(disallow).toContain('/admin');
        expect(disallow).toContain('/dashboard');
        expect(disallow).toContain('/auth');
        expect(disallow).toContain('/jobs/edit/');
        expect(disallow).toContain('/post-job/checkout');
        expect(disallow).toContain('/post-job/preview');
        expect(disallow).toContain('/forgot-password');
        expect(disallow).toContain('/reset-password');
    });
});
