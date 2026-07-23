/**
 * Regression (F6, audit high) — the job-detail sitemap batches and feed.xml
 * built URLs with local, divergent slug helpers (`title.toLowerCase()
 * .replace(/[^a-z0-9]+/g,'-')`) and never selected the stored `slug` column,
 * while the job page's rel=canonical is `job.slug || slugify(job.title,
 * job.id)` (lib/utils slugify: different punctuation stripping, dash
 * collapsing, and word-boundary truncation). Every title with an apostrophe,
 * slash, or parenthesis — or over the truncation length — was submitted to
 * Google under a URL whose canonical pointed elsewhere ("Duplicate, Google
 * chose different canonical than user" at scale).
 *
 * These tests pin both surfaces to the page's exact canonical expression:
 *  1. static — all three modules derive slugs via the SAME imported slugify
 *     and no local slug helper survives;
 *  2. behavioral — the emitted sitemap/feed URLs equal
 *     `job.slug || slugify(job.title, job.id)` across tricky titles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { slugify } from '@/lib/utils';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SITEMAP_ROUTE = 'app/api/sitemaps/jobs/[batch]/route.ts';
const FEED_ROUTE = 'app/feed.xml/route.ts';
const JOB_PAGE = 'app/jobs/[slug]/page.tsx';

// Titles that made every divergent slug helper visibly disagree with
// lib/utils slugify: apostrophes, slashes, parens/em-dash, and truncation.
const TRICKY_JOBS = [
    {
        id: '11111111-1111-1111-1111-111111111111',
        title: "Women's Health PMHNP",
        slug: null,
    },
    {
        id: '22222222-2222-2222-2222-222222222222',
        title: 'PMHNP (Outpatient) — Adult/Geriatric',
        slug: null,
    },
    {
        id: '33333333-3333-3333-3333-333333333333',
        title: 'Psychiatric Mental Health Nurse Practitioner — Full-Time Telehealth Position With Comprehensive Benefits Package',
        slug: null,
    },
    {
        // Stored slug predating a title edit — must win over the derived one.
        id: '44444444-4444-4444-4444-444444444444',
        title: 'Edited Title That No Longer Matches',
        slug: 'original-stored-slug-44444444-4444-4444-4444-444444444444',
    },
];

const canonicalSlugFor = (job: { slug: string | null; title: string; id: string }) =>
    job.slug || slugify(job.title, job.id);

const extractJobSlugs = (xml: string, tagPattern: RegExp): string[] => {
    const slugs: string[] = [];
    for (const match of xml.matchAll(tagPattern)) {
        const url = match[1];
        const idx = url.indexOf('/jobs/');
        expect(idx).toBeGreaterThan(-1);
        slugs.push(url.slice(idx + '/jobs/'.length));
    }
    return slugs;
};

beforeEach(() => vi.clearAllMocks());

describe('F6 static — one slugify to rule all job URLs', () => {
    it('sitemap batch route imports slugify from @/lib/utils and emits job.slug || slugify(...)', () => {
        const src = read(SITEMAP_ROUTE);
        expect(src).toMatch(/import\s*\{[^}]*\bslugify\b[^}]*\}\s*from\s*'@\/lib\/utils'/);
        expect(src).toMatch(/\.slug\s*\|\|\s*slugify\(/);
        // The divergent local helper and its regex must stay dead.
        expect(src).not.toContain('function jobSlug');
        expect(src).not.toContain('[^a-z0-9]+');
        // The batch query must actually fetch the stored slug column.
        expect(src).toMatch(/select:\s*\{[^}]*\bslug:\s*true\b/);
    });

    it('feed.xml imports slugify from @/lib/utils, selects slug, and emits job.slug || slugify(...)', () => {
        const src = read(FEED_ROUTE);
        expect(src).toMatch(/import\s*\{[^}]*\bslugify\b[^}]*\}\s*from\s*'@\/lib\/utils'/);
        expect(src).toMatch(/\.slug\s*\|\|\s*slugify\(/);
        expect(src).not.toContain('[^a-z0-9]+');
        expect(src).toMatch(/\bslug:\s*true\b/);
    });

    it('job page canonical still derives from the same imported slugify', () => {
        const src = read(JOB_PAGE);
        expect(src).toMatch(/import\s*\{[^}]*\bslugify\b[^}]*\}\s*from\s*'@\/lib\/utils'/);
        expect(src).toMatch(/job\.slug\s*\|\|\s*slugify\(job\.title,\s*job\.id\)/);
    });
});

describe('F6 behavioral — sitemap batch URLs equal the page canonical', () => {
    it('emits job.slug || slugify(title, id) for tricky titles and stored slugs', async () => {
        const rows = TRICKY_JOBS.map(j => ({ ...j, updatedAt: new Date('2026-07-01T00:00:00Z') }));
        vi.mocked(prisma.job.count).mockResolvedValue(rows.length as never);
        vi.mocked(prisma.job.findMany).mockResolvedValue(rows as never);

        const { GET } = await import('@/app/api/sitemaps/jobs/[batch]/route');
        const res = await GET(
            new Request('https://example.com/api/sitemaps/jobs/0'),
            { params: Promise.resolve({ batch: '0' }) },
        );
        expect(res.status).toBe(200);

        const xml = await res.text();
        const emitted = extractJobSlugs(xml, /<loc>([^<]+)<\/loc>/g);
        expect(emitted).toEqual(TRICKY_JOBS.map(canonicalSlugFor));
        // The stored slug must win over any title-derived value.
        expect(emitted).toContain('original-stored-slug-44444444-4444-4444-4444-444444444444');
        // The query must select the slug column or the fallback always fires.
        expect(prisma.job.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ select: expect.objectContaining({ slug: true }) }),
        );
    });
});

describe('F6 behavioral — feed.xml URLs equal the page canonical', () => {
    it('emits job.slug || slugify(title, id) for tricky titles and stored slugs', async () => {
        const rows = TRICKY_JOBS.map(j => ({
            ...j,
            employer: 'Test Clinic',
            location: 'Austin, TX',
            city: 'Austin',
            state: 'TX',
            description: 'desc',
            descriptionSummary: 'summary',
            normalizedMinSalary: null,
            normalizedMaxSalary: null,
            createdAt: new Date('2026-07-01T00:00:00Z'),
            isRemote: false,
        }));
        vi.mocked(prisma.job.findMany).mockResolvedValue(rows as never);

        const { GET } = await import('@/app/feed.xml/route');
        const res = await GET();
        expect(res.status).toBe(200);

        const xml = await res.text();
        const emitted = extractJobSlugs(xml, /<link>([^<]+\/jobs\/[^<]+)<\/link>/g);
        expect(emitted).toEqual(TRICKY_JOBS.map(canonicalSlugFor));
        expect(emitted).toContain('original-stored-slug-44444444-4444-4444-4444-444444444444');
        expect(prisma.job.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ select: expect.objectContaining({ slug: true }) }),
        );
    });
});
