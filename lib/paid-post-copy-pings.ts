import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * The new job URLs worth announcing to search engines, for the end of an
 * ingest run (lib/ingestion-service.ts).
 *
 * A listing that copies a role its employer is paying to feature
 * (lib/paid-post-twins.ts) is hidden and its URL redirects to the paid post.
 * Pinging one spends a slot of the Indexing API's daily quota on a URL that
 * redirects, and can seed a duplicate Google Jobs entry, so every URL whose
 * job is already marked is dropped.
 *
 * It filters on the marks already set and does not run the twin sync. The
 * sync reads every live paid post, every employer post and every listing of
 * those employers, too much to repeat at the end of each of the day's ingest
 * runs; the hourly refresh-site-stats cron and the verify route run it. A
 * copy this run inserted is therefore marked by the next hourly sync, and
 * its URL can be announced once before it starts redirecting.
 *
 * Fail-soft: when the marks cannot be read, every URL is pinged.
 */
export async function withoutPaidPostCopies(urls: string[]): Promise<string[]> {
  if (urls.length === 0) return urls;
  try {
    // Each URL ends in the job's stored slug (newJobUrls in ingestFromSource),
    // and slug is unique, so one query maps every URL back to its job.
    const slugOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);
    const marked = await prisma.job.findMany({
      where: { slug: { in: urls.map(slugOf) }, shadowedByJobId: { not: null } },
      select: { slug: true },
    });
    if (marked.length === 0) return urls;
    const markedSlugs = new Set(marked.map((job) => job.slug));
    const kept = urls.filter((url) => !markedSlugs.has(slugOf(url)));
    logger.info('[Indexing] Skipping new URLs that copy a live paid post', { skipped: urls.length - kept.length });
    return kept;
  } catch (filterError) {
    logger.error('[Indexing] Could not check new URLs for paid-post copies; pinging all of them', filterError, {
      urls: urls.length,
    });
    return urls;
  }
}
