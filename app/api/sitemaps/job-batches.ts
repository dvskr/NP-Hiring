/**
 * The job-detail sitemap's batching, shared by /api/sitemaps/jobs/[batch]
 * (which serves the batches) and /api/sitemaps/index (which lists them and
 * dates each one). One definition, so the index can never list a batch count
 * or a batch lastmod the batch route does not serve.
 *
 * GFJ-04: a published job whose description is a synthesized stub renders
 * `noindex, follow` with no JobPosting (app/jobs/[slug]/page.tsx reads
 * isStubJobDescription), so its URL is left out of the batch too. A sitemap
 * that lists a noindexed page reports as "Submitted URL marked noindex".
 * Batches are still cut from the unfiltered ordered pool (the index counts
 * batches with prisma.job.count over the same where), so a stub only thins
 * its own batch and never moves another job to a different batch.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isStubJobDescription } from '@/app/jobs/[slug]/job-posting-facts';
import { jobContentDate, latestOf } from '@/app/api/sitemaps/lastmod';

/** Jobs per sitemap file: well under Google's 50,000-URL and 50 MB caps. */
export const JOB_BATCH_SIZE = 25000;

/**
 * Descriptions read per query while screening a batch for stubs. The screen
 * reads the description body, so it goes in slices: a full batch never holds
 * every description in memory at once.
 */
export const STUB_SCREEN_CHUNK = 500;

/** Strongest URLs first, so a partly fetched batch still covers the best jobs. */
export const JOB_SITEMAP_ORDER_BY: Prisma.JobOrderByWithRelationInput[] = [
  { qualityScore: 'desc' },
  { createdAt: 'desc' },
];

/** What a job sitemap entry needs: the canonical slug inputs and the content stamps. */
export interface JobSitemapRow {
  id: string;
  title: string;
  slug: string | null;
  contentChangedAt: Date | null;
  createdAt: Date;
}

const JOB_SITEMAP_ROW_SELECT = {
  id: true,
  title: true,
  slug: true,
  contentChangedAt: true,
  createdAt: true,
} as const satisfies Prisma.JobSelect;

/**
 * The ids among `ids` whose stored description is a stub by the job page's
 * own rule (isStubJobDescription: the title and "Employer: / Location:"
 * metadata only, or almost no prose). A row the screen does not return (it
 * left the pool between the two reads) is not called a stub. Allowed to
 * throw.
 */
export async function findStubJobIds(ids: readonly string[]): Promise<Set<string>> {
  const stubs = new Set<string>();
  if (ids.length === 0) return stubs;
  const wanted = new Set(ids);
  for (let start = 0; start < ids.length; start += STUB_SCREEN_CHUNK) {
    const chunk = ids.slice(start, start + STUB_SCREEN_CHUNK);
    const rows = await prisma.job.findMany({
      where: { id: { in: chunk } },
      select: { id: true, title: true, description: true },
    });
    for (const row of Array.isArray(rows) ? rows : []) {
      if (wanted.has(row.id) && isStubJobDescription(row)) stubs.add(row.id);
    }
  }
  return stubs;
}

/**
 * The URLs one job batch lists: the batch's slice of `where` in
 * JOB_SITEMAP_ORDER_BY, minus the stub-description jobs (GFJ-04). The batch
 * route serves these rows and the index dates the batch from them. Allowed
 * to throw.
 */
export async function readJobSitemapBatch(where: Prisma.JobWhereInput, batchIndex: number): Promise<JobSitemapRow[]> {
  const rows: JobSitemapRow[] = await prisma.job.findMany({
    where,
    select: JOB_SITEMAP_ROW_SELECT,
    orderBy: JOB_SITEMAP_ORDER_BY,
    skip: batchIndex * JOB_BATCH_SIZE,
    take: JOB_BATCH_SIZE,
  });
  const list = Array.isArray(rows) ? rows : [];
  const stubs = await findStubJobIds(list.map((row) => row.id));
  return stubs.size > 0 ? list.filter((row) => !stubs.has(row.id)) : list;
}

/**
 * The lastmod of each job batch: the newest content date among the jobs the
 * batch actually lists (readJobSitemapBatch, so a stub it leaves out can
 * never date it). Null for a batch with no dated row. Allowed to throw.
 */
export async function jobBatchContentDates(where: Prisma.JobWhereInput, totalBatches: number): Promise<Array<Date | null>> {
  const dates: Array<Date | null> = [];
  for (let batch = 0; batch < totalBatches; batch++) {
    const rows = await readJobSitemapBatch(where, batch);
    dates.push(rows.reduce<Date | null>((newest, row) => latestOf(newest, jobContentDate(row)), null));
  }
  return dates;
}
