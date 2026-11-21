/**
 * A page's ISR window is the SHORTEST cache window anywhere in its tree: the
 * page's `revalidate`, every layout's, and every `unstable_cache` (or fetch)
 * revalidate a render reads. The sitewide footer renders on every page
 * through the root layout, and its category read was cached for an hour, so
 * when job pages moved to a day (171bef4) they still re-rendered hourly:
 * production kept serving STALE job pages and the database pool kept timing
 * out under crawler load (2026-11-17). These guards keep everything the job
 * page renders at least as long-lived as the job page itself.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FOOTER_VERDICT_CACHE_SECONDS } from '@/lib/pseo/footer-category-loader';
import { FOOTER_LANDING_VERDICT_CACHE_SECONDS } from '@/lib/pseo/landing-verdicts';
import { JOB_PAGE_PLACE_CACHE_SECONDS } from '@/app/jobs/[slug]/place-cache';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function jobPageWindow(): number {
    const match = read('app/jobs/[slug]/page.tsx').match(/^export const revalidate = (\d+);/m);
    expect(match, 'app/jobs/[slug]/page.tsx exports a numeric revalidate').not.toBeNull();
    return Number(match![1]);
}

describe('the job page keeps its whole ISR window', () => {
    it('the footer (rendered on every page) caches its read at least as long as the job page', () => {
        expect(FOOTER_VERDICT_CACHE_SECONDS).toBe(FOOTER_LANDING_VERDICT_CACHE_SECONDS);
        expect(FOOTER_VERDICT_CACHE_SECONDS).toBeGreaterThanOrEqual(jobPageWindow());
    });

    it('the footer reads through the daily cache, not the hourly one', () => {
        expect(read('components/SiteFooter.tsx')).toContain('loadFooterIndexableLandings()');
        const loader = read('lib/pseo/footer-category-loader.ts');
        expect(loader).toContain("loadIndexableLandingSlugsDaily('footer')");
        expect(loader).not.toMatch(/loadIndexableLandingSlugs\(/);
        const verdicts = read('lib/pseo/landing-verdicts.ts');
        expect(verdicts).toMatch(/\['indexable-landing-slugs-daily'\],\s*\{\s*revalidate: FOOTER_LANDING_VERDICT_CACHE_SECONDS,/);
    });

    it('no layout above the job page sets a shorter window', () => {
        const window = jobPageWindow();
        for (const layout of ['app/layout.tsx', 'app/jobs/layout.tsx', 'app/jobs/[slug]/layout.tsx']) {
            if (!fs.existsSync(path.join(ROOT, layout))) continue;
            const match = read(layout).match(/^export const revalidate = (\d+);/m);
            if (match) expect(Number(match[1]), layout).toBeGreaterThanOrEqual(window);
        }
    });

    it('the place-scoped figures (salary median, city count, crumb verdicts) cache at least as long as the job page', () => {
        expect(JOB_PAGE_PLACE_CACHE_SECONDS).toBeGreaterThanOrEqual(jobPageWindow());
        const place = read('app/jobs/[slug]/place-cache.ts');
        expect(place.match(/revalidate: JOB_PAGE_PLACE_CACHE_SECONDS,/g) ?? []).toHaveLength(2);
        expect(place).not.toMatch(/revalidate: \d/);
        const crumbs = read('app/jobs/[slug]/job-breadcrumbs.ts');
        expect(crumbs.match(/revalidate: JOB_PAGE_PLACE_CACHE_SECONDS,/g) ?? []).toHaveLength(2);
        expect(crumbs).not.toMatch(/revalidate: \d/);
    });

    it('the job page counts views from the browser, never during its cached render', () => {
        const page = read('app/jobs/[slug]/page.tsx');
        expect(page).not.toMatch(/viewCount|jobViewEvent/);
        expect(read('components/analytics/ViewTrackers.tsx')).toContain('/track-view`');
        expect(fs.existsSync(path.join(ROOT, 'app/api/jobs/[id]/track-view/route.ts'))).toBe(true);
    });
});
