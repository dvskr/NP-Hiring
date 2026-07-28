/**
 * Regression (content audit P0 #3) — the daily index-urls cron built job
 * URLs with `slugify(job.title, job.id)` and never selected the stored
 * `slug` column, while the job page's rel=canonical is
 * `job.slug || slugify(job.title, job.id)` (app/jobs/[slug]/page.tsx).
 * Every job with a stored slug that diverged from its current title —
 * titles edited after ingestion, apostrophes/slashes/parens handled
 * differently at ingestion time — was submitted to the Google Indexing
 * API under a URL whose canonical pointed elsewhere, burning the 200/day
 * quota on non-canonical URLs. Same class of bug as the fixed
 * app/feed.xml/route.ts (see tests/regressions/sitemap-slug-canonical.test.ts).
 *
 * These tests pin the cron to the page's exact canonical expression:
 *  1. static — the route selects `slug` and derives via the SAME imported
 *     slugify with the `job.slug ||` stored-slug precedence;
 *  2. behavioral — the URLs handed to pingAllSearchEnginesBatch equal
 *     `job.slug || slugify(job.title, job.id)` across tricky titles, with
 *     the stored slug winning over the derived one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { slugify } from '@/lib/utils';
import { brand } from '@/config/brand';
import { pingAllSearchEnginesBatch } from '@/lib/search-indexing';

vi.mock('@/lib/auth/verify-cron-or-admin', () => ({
    verifyCronOrAdmin: vi.fn().mockResolvedValue(null), // authorized
}));
vi.mock('@/lib/discord-notifier', () => ({
    sendCronFailureAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/search-indexing', () => ({
    pingAllSearchEnginesBatch: vi.fn().mockResolvedValue({
        google: [],
        bing: [],
        indexNow: [],
    }),
}));

const ROOT = process.cwd();
const CRON_ROUTE = 'app/api/cron/index-urls/route.ts';
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Titles that make a title-derived slug visibly disagree with the page
// canonical: punctuation, truncation, and a stored slug predating an edit.
const TRICKY_JOBS = [
    {
        id: '11111111-1111-1111-1111-111111111111',
        title: "Women's Health Nurse Practitioner",
        slug: null,
    },
    {
        id: '22222222-2222-2222-2222-222222222222',
        title: 'Nurse Practitioner (Outpatient) — Adult/Geriatric',
        slug: null,
    },
    {
        // Stored slug predating a title edit — must win over the derived one.
        id: '44444444-4444-4444-4444-444444444444',
        title: 'Edited Title That No Longer Matches',
        slug: 'original-stored-slug-44444444-4444-4444-4444-444444444444',
    },
];

const canonicalUrlFor = (job: { slug: string | null; title: string; id: string }) =>
    `${brand.baseUrl}/jobs/${job.slug || slugify(job.title, job.id)}`;

const req = () =>
    new Request('https://example.com/api/cron/index-urls', {
        headers: { authorization: 'Bearer test' },
    });

beforeEach(() => vi.clearAllMocks());

describe('P0 #3 static — index-urls derives the page-canonical slug', () => {
    it('imports slugify from @/lib/utils, selects slug, and emits job.slug || slugify(...)', () => {
        const src = read(CRON_ROUTE);
        expect(src).toMatch(/import\s*\{[^}]*\bslugify\b[^}]*\}\s*from\s*'@\/lib\/utils'/);
        expect(src).toMatch(/\bslug:\s*true\b/);
        expect(src).toMatch(/job\.slug\s*\|\|\s*slugify\(job\.title,\s*job\.id\)/);
        // The bare derived-only form must stay dead.
        expect(src).not.toMatch(/const slug = slugify\(/);
    });
});

describe('P0 #3 behavioral — submitted URLs equal the page canonical', () => {
    it('hands pingAllSearchEnginesBatch job.slug || slugify(title, id) URLs', async () => {
        const rows = TRICKY_JOBS.map((j) => ({ ...j }));
        vi.mocked(prisma.job.findMany).mockResolvedValue(rows as never);

        const { GET } = await import('@/app/api/cron/index-urls/route');
        const res = await GET(req() as never);
        expect(res.status).toBe(200);

        // The query must actually fetch the stored slug column, or the
        // `job.slug ||` fallback always fires and nothing changed.
        expect(prisma.job.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ select: expect.objectContaining({ slug: true }) }),
        );

        expect(pingAllSearchEnginesBatch).toHaveBeenCalledTimes(1);
        const submitted = vi.mocked(pingAllSearchEnginesBatch).mock.calls[0][0];
        expect(submitted).toEqual(TRICKY_JOBS.map(canonicalUrlFor));
        // The stored slug must win over any title-derived value.
        expect(submitted).toContain(
            `${brand.baseUrl}/jobs/original-stored-slug-44444444-4444-4444-4444-444444444444`,
        );
    });

    it('still short-circuits cleanly when there are no recent jobs', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);

        const { GET } = await import('@/app/api/cron/index-urls/route');
        const res = await GET(req() as never);

        expect(res.status).toBe(200);
        expect(pingAllSearchEnginesBatch).not.toHaveBeenCalled();
        const body = await res.json();
        expect(body).toMatchObject({ success: true, jobCount: 0 });
    });
});
