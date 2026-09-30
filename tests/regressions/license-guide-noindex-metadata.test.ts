/**
 * Audit CQ-03 / FB-2, at runtime: app/blog/[slug]/page.tsx generateMetadata
 * renders "noindex, follow" for a license guide whose state is not
 * indexable, keeps its self canonical, turns indexable the moment the
 * state's facts are verified, and never touches an authored post's robots.
 *
 * The data layer is mocked: the post comes from the code generators (the
 * same objects lib/blog.ts serves when no DB row exists), listing and salary
 * reads return their empty shapes, and the facts table is a mutable stand-in
 * for lib/license-guide-facts.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LicenseGuideStateFacts } from '@/lib/license-guide-facts';

const facts = vi.hoisted(() => ({ table: {} as Record<string, LicenseGuideStateFacts> }));

vi.mock('@/lib/license-guide-facts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/license-guide-facts')>();
    return { ...actual, LICENSE_GUIDE_FACTS: facts.table };
});

vi.mock('@/lib/blog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/blog')>();
    return {
        ...actual,
        // Loaded lazily so the generators resolve after every mock is in place.
        getPostBySlug: vi.fn(async (slug: string) => {
            const license = slug.match(/^np-license-(.+)$/);
            if (license) return (await import('@/lib/blog-license-guides')).getLicenseGuidePost(license[1]);
            return (await import('@/lib/blog-mdx-posts')).getMdxPost(slug);
        }),
        getRelatedPosts: vi.fn(async () => []),
        getAllPublishedSlugs: vi.fn(async () => []),
    };
});

// The nearby-guide links read the published slug list; no guide is linked here.
vi.mock('@/lib/pseo/practice-environment', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/pseo/practice-environment')>();
    return { ...actual, isLicenseGuideLive: vi.fn(async () => false) };
});

vi.mock('@/lib/pseo/listing-facts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/pseo/listing-facts')>();
    return { ...actual, getListingFacts: vi.fn(async () => actual.emptyListingFacts()) };
});

vi.mock('@/lib/salary-analytics', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/salary-analytics')>();
    return { ...actual, getGatedLocationSalary: vi.fn(async () => actual.summarizeGatedSalary([])) };
});

const { generateMetadata } = await import('@/app/blog/[slug]/page');

const meta = (slug: string) => generateMetadata({ params: Promise.resolve({ slug }) });

const checked = (value: string) => ({
    value,
    sourceUrl: 'https://example.org/board/aprn',
    sourceName: 'Example Board of Nursing',
    checkedOn: '2026-10-02',
});

describe('license guide robots (generateMetadata)', () => {
    beforeEach(() => {
        for (const key of Object.keys(facts.table)) delete facts.table[key];
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('renders noindex, follow while the state has no verified facts, with a self canonical', async () => {
        for (const slug of ['np-license-texas', 'np-license-wyoming', 'np-license-district-of-columbia']) {
            const m = await meta(slug);
            expect(m.robots, slug).toEqual({ index: false, follow: true });
            expect(m.alternates?.canonical, slug).toBe(`https://nphiring.com/blog/${slug}`);
        }
    });

    it('turns indexable the moment the state is verified with its three required facts', async () => {
        facts.table.TX = {
            stateCode: 'TX',
            initialFee: checked('$150 for the initial APRN application'),
            renewalCycle: checked('Every two years'),
            ceRequirement: checked('20 contact hours each renewal period'),
            processingTime: null,
            applicationRoute: null,
            verified: true,
        };
        expect((await meta('np-license-texas')).robots).toBeUndefined();
        // Other states stay noindex.
        expect((await meta('np-license-wyoming')).robots).toEqual({ index: false, follow: true });
    });

    it('stays noindex for a complete but unverified entry', async () => {
        facts.table.TX = {
            stateCode: 'TX',
            initialFee: checked('$150'),
            renewalCycle: checked('Every two years'),
            ceRequirement: checked('20 contact hours'),
            processingTime: null,
            applicationRoute: null,
            verified: false,
        };
        expect((await meta('np-license-texas')).robots).toEqual({ index: false, follow: true });
    });

    it('never sets robots on an authored post', async () => {
        for (const slug of ['np-salary-guide', 'np-1099-vs-w2']) {
            const m = await meta(slug);
            expect(m.robots, slug).toBeUndefined();
            expect(m.alternates?.canonical, slug).toBe(`https://nphiring.com/blog/${slug}`);
        }
    });
});
