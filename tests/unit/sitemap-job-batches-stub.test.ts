/**
 * GFJ-04 (indexing audit): a published job whose stored description is a
 * synthesized stub (the title plus "Employer: / Location:" metadata, as the
 * three Televero BambooHR rows were) renders `noindex, follow` with no
 * JobPosting. The job sitemap used to list it anyway, which Search Console
 * reports as "Submitted URL marked noindex". The batch now leaves such rows
 * out by the page's own rule (isStubJobDescription), and the index dates a
 * batch only from the rows it lists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/prisma', () => ({
    prisma: { job: { findMany: vi.fn(), count: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { isStubJobDescription } from '@/app/jobs/[slug]/job-posting-facts';
import {
    JOB_BATCH_SIZE,
    STUB_SCREEN_CHUNK,
    findStubJobIds,
    jobBatchContentDates,
    readJobSitemapBatch,
} from '@/app/api/sitemaps/job-batches';
import { GET as jobsSitemapGET } from '@/app/api/sitemaps/jobs/[batch]/route';

const BASE = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;
const findMany = vi.mocked(prisma.job.findMany);
const count = vi.mocked(prisma.job.count);

const FULL = 'Provide primary care to adult and pediatric patients in a busy outpatient clinic, '
    + 'including assessment, diagnosis, treatment planning and patient education, with a supportive team '
    + 'of physicians, nurses and medical assistants. Collaborate on care plans and document every visit.';
const STUB_TITLE = 'Psychiatric Nurse Practitioner, Remote TX Part Time';
const STUB = `${STUB_TITLE}\nEmployer: Televero Health\nDepartment: Clinical\nEmployment: Part-Time\nLocation: United States`;

const OLD = new Date('2026-09-01T00:00:00.000Z');
const NEW = new Date('2026-09-27T00:00:00.000Z');

interface FakeJob {
    id: string;
    title: string;
    slug: string;
    description: string;
    contentChangedAt: Date | null;
    createdAt: Date;
}

const REAL: FakeJob = { id: 'a1', title: 'Family Nurse Practitioner', slug: 'family-np-a1', description: FULL, contentChangedAt: OLD, createdAt: OLD };
// The stub is the newest row, so it would date the batch if it were counted.
const STUBBED: FakeJob = { id: 'b2', title: STUB_TITLE, slug: 'televero-b2', description: STUB, contentChangedAt: NEW, createdAt: NEW };

/** A Prisma double over `jobs`: the batch read or the description screen, by the select. */
function serve(jobs: readonly FakeJob[]): void {
    findMany.mockImplementation((async (args: { select?: Record<string, boolean>; where?: { id?: { in?: string[] } } }) => {
        if (args.select?.description) {
            const wanted = new Set(args.where?.id?.in ?? []);
            return jobs.filter((j) => wanted.has(j.id)).map((j) => ({ id: j.id, title: j.title, description: j.description }));
        }
        // The batch read never selects the description.
        return jobs.map((j) => ({ id: j.id, title: j.title, slug: j.slug, contentChangedAt: j.contentChangedAt, createdAt: j.createdAt }));
    }) as never);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('the stub rule is the job page rule', () => {
    it('reads the Televero metadata-only description as a stub, and a real posting as not', () => {
        expect(isStubJobDescription({ title: STUB_TITLE, description: STUB })).toBe(true);
        expect(isStubJobDescription({ title: REAL.title, description: FULL })).toBe(false);
    });

    it('the job page robots and the batch both call isStubJobDescription', () => {
        const read = (rel: string) => {
            const file = path.join(process.cwd(), rel);
            return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        };
        // The page's robots live in page.tsx or its metadata helper.
        const jobPage = read('app/jobs/[slug]/page.tsx') + read('app/jobs/[slug]/job-page-meta.ts');
        expect(jobPage).toMatch(/isStubJobDescription\(job\)[^\n]*index: false, follow: true/);
        expect(read('app/api/sitemaps/job-batches.ts')).toContain('isStubJobDescription(row)');
    });
});

describe('findStubJobIds', () => {
    it('flags only the stub rows, reading descriptions for the requested ids alone', async () => {
        serve([REAL, STUBBED]);
        const stubs = await findStubJobIds([REAL.id, STUBBED.id]);
        expect([...stubs]).toEqual([STUBBED.id]);
        const args = findMany.mock.calls[0][0] as { where: unknown; select: unknown };
        expect(args.where).toEqual({ id: { in: [REAL.id, STUBBED.id] } });
        expect(args.select).toEqual({ id: true, title: true, description: true });
    });

    it('reads nothing for an empty batch', async () => {
        await expect(findStubJobIds([])).resolves.toEqual(new Set());
        expect(findMany).not.toHaveBeenCalled();
    });

    it('screens a large batch in slices, never every description at once', async () => {
        const jobs = Array.from({ length: STUB_SCREEN_CHUNK * 2 + 1 }, (_, i): FakeJob => ({ ...REAL, id: `r${i}` }));
        serve(jobs);
        await findStubJobIds(jobs.map((j) => j.id));
        expect(findMany).toHaveBeenCalledTimes(3);
        for (const call of findMany.mock.calls) {
            expect(((call[0] as { where: { id: { in: string[] } } }).where.id.in).length).toBeLessThanOrEqual(STUB_SCREEN_CHUNK);
        }
    });
});

describe('readJobSitemapBatch and the batch dates', () => {
    it('lists every job but the stub, cut from the unfiltered pool so no job changes batch', async () => {
        serve([REAL, STUBBED]);
        const rows = await readJobSitemapBatch({ isPublished: true }, 2);
        expect(rows.map((r) => r.id)).toEqual([REAL.id]);
        const batchArgs = findMany.mock.calls[0][0] as { skip: number; take: number; select: Record<string, boolean>; where: unknown };
        expect(batchArgs.skip).toBe(2 * JOB_BATCH_SIZE);
        expect(batchArgs.take).toBe(JOB_BATCH_SIZE);
        expect(batchArgs.where).toEqual({ isPublished: true });
        // The batch read itself never ships description bodies.
        expect(batchArgs.select).not.toHaveProperty('description');
    });

    it('a stub never dates its batch', async () => {
        serve([REAL, STUBBED]);
        await expect(jobBatchContentDates({ isPublished: true }, 1)).resolves.toEqual([OLD]);
    });

    it('a batch of stubs only has no date', async () => {
        serve([STUBBED]);
        await expect(jobBatchContentDates({ isPublished: true }, 1)).resolves.toEqual([null]);
    });
});

describe('/api/sitemaps/jobs/[batch] (GFJ-04)', () => {
    it('submits the real job and leaves the stub out', async () => {
        count.mockResolvedValue(2 as never);
        serve([REAL, STUBBED]);
        const response = await jobsSitemapGET(new Request('http://localhost/api/sitemaps/jobs/0'), {
            params: Promise.resolve({ batch: '0' }),
        });
        const xml = await response.text();
        expect(xml).toContain(`<loc>${BASE}/jobs/${REAL.slug}</loc>`);
        expect(xml).not.toContain(STUBBED.slug);
        expect(xml).not.toContain(NEW.toISOString());
    });

    it('a failed screen fails the batch rather than listing an unscreened stub', async () => {
        count.mockResolvedValue(2 as never);
        findMany.mockImplementation((async (args: { select?: Record<string, boolean> }) => {
            if (args.select?.description) throw new Error('db blip');
            return [REAL, STUBBED];
        }) as never);
        await expect(jobsSitemapGET(new Request('http://localhost/api/sitemaps/jobs/0'), {
            params: Promise.resolve({ batch: '0' }),
        })).rejects.toThrow('db blip');
    });
});
