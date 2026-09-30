/**
 * One pagination rule for every pSEO listing (indexing audit TECH-07,
 * TECH-08, TECH-09, TECH-10, M-01, L-06):
 *   - page N >= 2 is its own canonical and answers noindex, follow;
 *   - a page past the last one is a 404;
 *   - a category x city combination with 0 jobs is a 404, never a 308;
 *   - landing CTAs point at the listing's own pages, never a noindexed
 *     filtered /jobs URL;
 *   - listing queries never ship the full description body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        pseoStats: { findUnique: vi.fn(), findMany: vi.fn() },
        job: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
        company: { findMany: vi.fn() },
        $queryRaw: vi.fn(),
    },
}));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import {
    LISTING_PAGE_SIZE,
    isPageOutOfRange,
    listingCanonical,
    listingPagePath,
    listingRobots,
    pageOffset,
    paginationWindow,
    parseListingPage,
    totalPagesFor,
} from '@/lib/pseo/listing-pagination';
import { buildCategoryCityMetadata } from '@/lib/pseo/category-city-template';
import { buildSettingStateMetadata } from '@/lib/pseo/setting-state-template';
import { buildCategoryLandingMetadata } from '@/lib/pseo/category-landing-template';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The control-flow error next/navigation throws, as a string to match on. */
async function rejection(promise: Promise<unknown>): Promise<string> {
    return promise.then(
        () => 'resolved',
        (error: unknown) => {
            const e = error as { digest?: string; message?: string };
            return `${e.digest ?? ''} ${e.message ?? ''}`;
        },
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => { });
    db.job.groupBy.mockResolvedValue([]);
    db.job.findMany.mockResolvedValue([]);
    db.job.aggregate.mockResolvedValue({});
    db.company.findMany.mockResolvedValue([]);
    db.pseoStats.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue([]);
});

describe('pagination helpers', () => {
    it('M-01: a page holds 30 listings (raised from 10)', () => {
        expect(LISTING_PAGE_SIZE).toBe(30);
        expect(pageOffset(1)).toBe(0);
        expect(pageOffset(3)).toBe(60);
    });

    it('parses ?page defensively', () => {
        expect(parseListingPage(undefined)).toBe(1);
        expect(parseListingPage('abc')).toBe(1);
        expect(parseListingPage('-4')).toBe(1);
        expect(parseListingPage('3')).toBe(3);
        expect(parseListingPage(['2', '9'])).toBe(2);
    });

    it('TECH-09: only a page past the last one is out of range', () => {
        expect(totalPagesFor(0)).toBe(1);
        expect(totalPagesFor(61)).toBe(3);
        expect(isPageOutOfRange(1, 0)).toBe(false);
        expect(isPageOutOfRange(3, 61)).toBe(false);
        expect(isPageOutOfRange(4, 61)).toBe(true);
        expect(isPageOutOfRange(999, 638, 50)).toBe(true);
    });

    it('TECH-08: page N is its own canonical and answers noindex, follow', () => {
        expect(listingPagePath('/jobs/remote', 1)).toBe('/jobs/remote');
        expect(listingPagePath('/jobs/remote', 2)).toBe('/jobs/remote?page=2');
        expect(listingCanonical('/jobs/remote', 1)).toBe(`${brand.baseUrl}/jobs/remote`);
        expect(listingCanonical('/jobs/remote', 4)).toBe(`${brand.baseUrl}/jobs/remote?page=4`);
        expect(listingRobots(true, 1)).toEqual({ index: true, follow: true });
        expect(listingRobots(true, 2)).toEqual({ index: false, follow: true });
        expect(listingRobots(false, 1)).toEqual({ index: false, follow: true });
    });

    it('links the first, the last and a window around the current page', () => {
        expect(paginationWindow(1, 1)).toEqual([1]);
        expect(paginationWindow(5, 12)).toEqual([1, 3, 4, 5, 6, 7, 12]);
    });
});

describe('TECH-07: a category x city combination with 0 jobs is a 404, never a 308', () => {
    it('buildCategoryCityMetadata answers not found for a live count of 0', async () => {
        db.pseoStats.findUnique.mockResolvedValue(null);
        db.job.count.mockResolvedValue(0);
        const result = await rejection(buildCategoryCityMetadata('psychiatric-mental-health', 'houston-tx', 1));
        expect(result).toMatch(/404|NOT_FOUND/);
        expect(result).not.toContain('NEXT_REDIRECT');
    });

    it('the template no longer calls permanentRedirect for an empty combination', () => {
        const src = read('lib/pseo/category-city-template.tsx');
        expect(src).not.toMatch(/permanentRedirect\(`\/jobs\/\$\{config\.slug\}`\)/);
    });
});

describe('TECH-08: the templates emit a self canonical on page N', () => {
    it('setting x state: page 2 is its own canonical, noindex, follow; a page past the end is a 404', async () => {
        db.pseoStats.findUnique.mockResolvedValue(null);
        db.job.count.mockResolvedValue(45);
        const meta = await buildSettingStateMetadata('inpatient', 'texas', 2);
        expect(meta.alternates?.canonical).toBe(`${brand.baseUrl}/jobs/inpatient/texas?page=2`);
        expect(meta.robots).toEqual({ index: false, follow: true });

        const past = await rejection(buildSettingStateMetadata('inpatient', 'texas', 3));
        expect(past).toMatch(/404|NOT_FOUND/);
    });

    it('category landing: page 2 is its own canonical, noindex, follow; a page past the end is a 404', async () => {
        db.job.count.mockResolvedValue(45);
        const meta = await buildCategoryLandingMetadata('family-practice', { page: '2' });
        expect(meta.alternates?.canonical).toBe(`${brand.baseUrl}/jobs/family-practice?page=2`);
        expect(meta.robots).toEqual({ index: false, follow: true });

        const past = await rejection(buildCategoryLandingMetadata('family-practice', { page: '3' }));
        expect(past).toMatch(/404|NOT_FOUND/);
    });

    it('category x city: page 2 is its own canonical, noindex, follow', async () => {
        db.pseoStats.findUnique.mockResolvedValue({ totalJobs: 45, updatedAt: new Date() });
        db.job.count.mockResolvedValue(45);
        const meta = await buildCategoryCityMetadata('psychiatric-mental-health', 'houston-tx', 2);
        expect(meta.alternates?.canonical).toBe(`${brand.baseUrl}/jobs/psychiatric-mental-health/city/houston-tx?page=2`);
        expect(meta.robots).toEqual({ index: false, follow: true });
    });

    it('the state hub reads the shared canonical rule and never canonicals page N to page 1', () => {
        const src = read('app/jobs/state/[state]/page.tsx');
        expect(src).toContain('listingCanonical(`/jobs/state/${stateSlug}`, page)');
        // The range gate runs before the listing query (an out-of-range page never reaches Prisma).
        expect(src).toContain('isPageOutOfRange(page, (await hubData).facts.total, PAGE_SIZE)');
        expect(src).not.toMatch(/Canonical always points to page 1/);
    });
});

const BESPOKE_LANDINGS = [
    '1099', 'community-health', 'contract', 'correctional', 'entry-level', 'full-time', 'geriatric', 'hospital',
    'inpatient', 'lgbtq', 'locum-tenens', 'mid-career', 'new-grad', 'outpatient', 'part-time', 'per-diem',
    'private-practice', 'remote', 'senior', 'telehealth', 'travel', 'va', 'veterans',
];

describe('the 23 bespoke landings and the shared template', () => {
    it.each(BESPOKE_LANDINGS)('/jobs/%s: self canonical per page, 404 past the end, own pages, no description', (slug) => {
        const src = read(`app/jobs/${slug}/page.tsx`);
        expect(src).toContain(`canonical: listingCanonical('/jobs/${slug}', page)`);
        expect(src).toContain('isPageOutOfRange(page, facts.total');
        expect(src).toContain('<ListingPagination');
        expect(src).toContain(`listingPagePath('/jobs/${slug}', page + 1)`);
        expect(src).toContain('ctaHref="#listings"');
        expect(src).toContain('omit: JOB_LISTING_OMIT');
        expect(src).toContain('const limit = LISTING_PAGE_SIZE;');
        // TECH-10: no CTA spends the landing's strongest link on a noindexed filtered view.
        expect(src).not.toMatch(/href="\/jobs\?(category|workMode)=/);
        expect(src).not.toMatch(/ctaHref="\/jobs\?/);
    });

    it('the shared landing template follows the same rule', () => {
        const src = read('lib/pseo/category-landing-template.tsx');
        expect(src).toContain('listingCanonical(`/jobs/${slug}`, page)');
        expect(src).toContain('<ListingPagination');
        expect(src).toContain('omit: JOB_LISTING_OMIT');
        expect(src).toContain('ctaHref="#listings"');
        expect(src).not.toContain('/jobs?category=');
    });

    it('TECH-10: the metro and city pages list their inventory on the page, not behind /jobs?location', () => {
        for (const rel of ['app/jobs/metro/[slug]/page.tsx', 'app/jobs/city/[slug]/page.tsx']) {
            expect(read(rel), rel).not.toContain('/jobs?location=');
        }
        expect(read('app/jobs/metro/[slug]/page.tsx')).toContain('omit: JOB_LISTING_OMIT');
    });
});

describe('/jobs (TECH-09, L-06)', () => {
    const src = read('app/jobs/page.tsx');

    it('answers 404 past the last page, in the metadata and the page', () => {
        expect(src).toContain('function isBoardPageOutOfRange(page: number, total: number)');
        expect(src.match(/isBoardPageOutOfRange\((pageNum|page), (totalJobs|total)\)\) notFound\(\);/g)).toHaveLength(2);
    });

    it('never selects the full description for the client list, and cuts the summary', () => {
        const select = src.slice(src.indexOf('select: {'), src.indexOf('employerJobs: { select'));
        expect(select).not.toMatch(/\bdescription: true/);
        expect(src).toContain('descriptionSummary: cardSummary(j.descriptionSummary)');
    });

    it('asks for the median, never the average (house style)', () => {
        expect(src).not.toMatch(/What is the average/);
    });
});
