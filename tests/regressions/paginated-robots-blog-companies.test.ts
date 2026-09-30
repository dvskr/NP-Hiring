/**
 * TECH-08 and M-01 (indexing audit): a paginated view is its own canonical and
 * answers `noindex, follow` in its meta robots, the same verdict the middleware
 * sends as X-Robots-Tag for any ?page >= 2. Before this, /blog?page=2 said
 * meta 'index, follow' with a canonical to /blog while the header said
 * 'noindex, follow', and /companies?page=2 said nothing in its meta robots.
 *
 * Drives the real generateMetadata of both pages with their data reads mocked.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        company: { count: vi.fn(async () => 600) },
    },
}));
vi.mock('@/lib/site-stats', () => ({
    getSiteStats: vi.fn(async () => ({ totalCompanies: 600 })),
}));
vi.mock('@/lib/blog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/blog')>();
    return {
        ...actual,
        getAllPublishedSlugs: vi.fn(async () => [{ slug: 'np-salary-guide' }, { slug: 'np-1099-vs-w2' }]),
        getPublishedPosts: vi.fn(async () => []),
        getPostCount: vi.fn(async () => 0),
    };
});

import { brand } from '@/config/brand';
import { generateMetadata as blogMetadata } from '@/app/blog/page';
import { generateMetadata as companiesMetadata } from '@/app/companies/page';

const params = (page?: string) => ({ searchParams: Promise.resolve(page === undefined ? {} : { page }) });

describe('/blog pagination metadata', () => {
    it('page 1 is indexable with the bare canonical', async () => {
        const meta = await blogMetadata(params());
        expect(meta.alternates?.canonical).toBe(`${brand.baseUrl}/blog`);
        expect(meta.robots).toEqual({ index: true, follow: true });
    });

    it('page 2 is its own canonical and answers noindex, follow', async () => {
        const meta = await blogMetadata(params('2'));
        expect(meta.alternates?.canonical).toBe(`${brand.baseUrl}/blog?page=2`);
        expect(meta.robots).toEqual({ index: false, follow: true });
    });

    it('an unparsable page reads as page 1', async () => {
        const meta = await blogMetadata(params('abc'));
        expect(meta.alternates?.canonical).toBe(`${brand.baseUrl}/blog`);
        expect(meta.robots).toEqual({ index: true, follow: true });
    });
});

describe('/companies pagination metadata', () => {
    it('page 1 keeps the bare canonical and sets no robots override', async () => {
        const meta = await companiesMetadata(params());
        expect(meta.alternates?.canonical).toBe(`${brand.baseUrl}/companies`);
        expect(meta.robots).toBeUndefined();
    });

    it('page 2 is its own canonical and answers noindex, follow', async () => {
        const meta = await companiesMetadata(params('2'));
        expect(meta.alternates?.canonical).toBe(`${brand.baseUrl}/companies?page=2`);
        expect(meta.robots).toEqual({ index: false, follow: true });
    });
});
