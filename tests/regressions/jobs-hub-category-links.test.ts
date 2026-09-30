/**
 * M-07 (indexing audit): the /jobs hub's editorial block linked seven category
 * landings from a hard-coded list, so it linked none of the other indexable
 * landings (/jobs/urgent-care had no inbound link in 78 sampled pages) and
 * kept linking a landing that fell under the index gate (noindex) or to 0
 * jobs (404, TECH-06). The links are now built from the landing index
 * verdicts, the rule the primary sitemap submits landings on, and the FAQ
 * answer names only the same categories. The sitewide footer reads the same
 * shared rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('next/cache', () => ({
    unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
vi.mock('@/lib/prisma', () => ({
    prisma: { pseoStats: { findMany: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { CATEGORY_AXES, ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import {
    HUB_AXIS_HEADINGS,
    buildHubCategoryFaqAnswer,
    hubCategoryLabel,
    hubCategoryProse,
    selectHubCategoryGroups,
} from '@/lib/pseo/hub-category-links';
import {
    isLandingVerdictIndexable,
    loadIndexableLandingSlugs,
    readIndexableLandingSlugs,
} from '@/lib/pseo/landing-verdicts';
import { loadFooterIndexableLandings } from '@/lib/pseo/footer-category-loader';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const findMany = vi.mocked(prisma.pseoStats.findMany);

const row = (categorySlug: string, totalJobs: number, distinctEmployers: number, indexable = true) =>
    ({ categorySlug, totalJobs, distinctEmployers, indexable });

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('selectHubCategoryGroups links every indexable landing and no other', () => {
    it('groups by axis in hub order and links only the indexable set', () => {
        const groups = selectHubCategoryGroups(new Set(['urgent-care', 'family-practice', 'midwifery', 'va', 'remote']));
        expect(groups.map((g) => g.axis)).toEqual(['specialty', 'aprn', 'setting', 'employerType']);
        const hrefs = groups.flatMap((g) => g.links.map((l) => l.href));
        expect(hrefs).toEqual(['/jobs/family-practice', '/jobs/midwifery', '/jobs/remote', '/jobs/urgent-care', '/jobs/va']);
        // A landing outside the verdict set is never linked, however prominent.
        expect(hrefs).not.toContain('/jobs/anesthesia');
        expect(hrefs).not.toContain('/jobs/telehealth');
    });

    it('an empty verdict set links nothing', () => {
        expect(selectHubCategoryGroups(new Set())).toEqual([]);
    });

    it('every axis has a heading, and every link lands on a real landing route', () => {
        expect(HUB_AXIS_HEADINGS.map(([axis]) => axis).sort()).toEqual(Object.keys(CATEGORY_AXES).sort());
        const all = selectHubCategoryGroups(new Set(ALL_CATEGORY_SLUGS));
        const slugs = all.flatMap((g) => g.links.map((l) => l.slug));
        expect(slugs.sort()).toEqual([...ALL_CATEGORY_SLUGS].sort());
        for (const slug of slugs) {
            expect(fs.existsSync(path.join(ROOT, 'app', 'jobs', slug, 'page.tsx')), slug).toBe(true);
        }
    });

    it('labels read as professional English (house style: no dashes used as punctuation)', () => {
        expect(hubCategoryLabel('urgent-care')).toBe('Urgent Care');
        expect(hubCategoryLabel('anesthesia')).toBe('Nurse Anesthesia (CRNA)');
        expect(hubCategoryLabel('women-health')).toBe("Women's Health");
        expect(hubCategoryLabel('1099')).toBe('1099 Contractor');
        expect(hubCategoryProse('Nurse Anesthesia (CRNA)')).toBe('nurse anesthesia (CRNA)');
        expect(hubCategoryProse('VA')).toBe('VA');
        for (const slug of ALL_CATEGORY_SLUGS) {
            expect(hubCategoryLabel(slug), slug).not.toMatch(/[–—]| - /);
        }
    });
});

describe('the FAQ answer names only indexable categories', () => {
    it('names the linked categories, axis by axis', () => {
        const groups = selectHubCategoryGroups(new Set(['family-practice', 'acute-care', 'anesthesia', 'remote', 'part-time']));
        const answer = buildHubCategoryFaqAnswer(groups);
        expect(answer).toBe(
            'Categories with their own page of current openings include specialties such as family practice and acute care; '
            + 'APRN roles such as nurse anesthesia (CRNA); work settings such as remote; and job types such as part-time. '
            + 'The filters on this page narrow the board by specialty, work setting, job type and location.',
        );
        expect(answer).not.toContain('midwifery');
        expect(answer).not.toMatch(/[–—]| - /);
    });

    it('with no indexable landing, promises no category page at all', () => {
        const answer = buildHubCategoryFaqAnswer([]);
        expect(answer).toBe('The filters on this page narrow the board by specialty, work setting, job type and location.');
    });
});

describe('the landing verdict rule (shared with app/sitemap.ts and the footer)', () => {
    it('a stored true verdict counts only while its counts clear the listing floor', () => {
        expect(isLandingVerdictIndexable(row('remote', 6, 3))).toBe(true);
        // Written before a floor change: stored true, counts now below it.
        expect(isLandingVerdictIndexable(row('anesthesia', 4, 3))).toBe(false);
        expect(isLandingVerdictIndexable(row('travel', 12, 2))).toBe(false);
        expect(isLandingVerdictIndexable(row('va', 0, 0))).toBe(false);
        expect(isLandingVerdictIndexable(row('pediatric', 9, 4, false))).toBe(false);
    });

    it('reads fresh category-landing rows and keeps the ones that pass', async () => {
        findMany.mockResolvedValue([row('remote', 6, 3), row('anesthesia', 4, 3), row('urgent-care', 11, 5)] as never);
        await expect(readIndexableLandingSlugs()).resolves.toEqual(['remote', 'urgent-care']);
        const args = findMany.mock.calls[0][0] as { where: Record<string, unknown>; select: Record<string, boolean> };
        expect(args.where).toMatchObject({ type: 'category-landing', locationSlug: 'all', indexable: true });
        expect(args.where.updatedAt).toEqual({ gte: expect.any(Date) });
        expect(args.select).toEqual({ categorySlug: true, totalJobs: true, distinctEmployers: true, indexable: true });
    });

    it('an unreadable verdict is null, so the hub links nothing and the footer uses its fallback', async () => {
        findMany.mockRejectedValue(new Error('db blip'));
        await expect(loadIndexableLandingSlugs('jobs-hub')).resolves.toBeNull();
        await expect(loadFooterIndexableLandings()).resolves.toBeNull();
    });

    it('the footer reads the same rule as the hub', async () => {
        findMany.mockResolvedValue([row('remote', 6, 3), row('anesthesia', 4, 3)] as never);
        const footer = await loadFooterIndexableLandings();
        const hub = await loadIndexableLandingSlugs('jobs-hub');
        expect(footer && [...footer]).toEqual(['remote']);
        expect(hub && [...hub]).toEqual(['remote']);
    });

    it('app/sitemap.ts lists landings by the same two checks', () => {
        const sitemap = read('app/sitemap.ts');
        expect(sitemap).toContain('!row.indexable || !shouldIndexCategoryLanding({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })');
    });
});

describe('/jobs renders the gate-driven links', () => {
    const src = read('app/jobs/page.tsx');

    it('builds the groups from the verdicts and feeds the FAQ the same groups', () => {
        expect(src).toContain("selectHubCategoryGroups((await loadIndexableLandingSlugs('jobs-hub')) ?? new Set<string>())");
        expect(src).toContain('buildJobsHubFaqs(total, hubCategoryGroups)');
        expect(src).toContain('answer: buildHubCategoryFaqAnswer(categoryGroups)');
        expect(src).toContain('{hubCategoryGroups.map((group) => (');
    });

    it('carries no hard-coded category landing link', () => {
        for (const slug of ALL_CATEGORY_SLUGS) {
            expect(src, slug).not.toContain(`href="/jobs/${slug}"`);
        }
        expect(src).not.toContain('across every major');
    });
});
