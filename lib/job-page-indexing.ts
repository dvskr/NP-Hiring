/**
 * lib/job-page-indexing.ts: the one search engine ping for a job page an
 * employer just posted, activated or renewed (indexing audit, JOB-PAGE
 * handoff 10).
 *
 * pingAllSearchEngines sends Google URL_UPDATED in the 'new-content' lane,
 * and lib/search-indexing.ts checks only that the URL is a job page. Google's
 * Indexing API takes only pages that carry JobPosting, and a job page emits
 * none when isJobPostingEligible says no (no US place and no verified remote
 * declaration, or a stub description). Such a job still goes to Bing and
 * IndexNow, which index any page; only the Google leg waits until the page
 * carries a JobPosting. The index-urls cron reads the same rule
 * (app/api/cron/index-urls/window.ts), so the two paths agree.
 *
 * The rule is imported from app/jobs/[slug]/job-posting-facts.ts, never from
 * components/JobStructuredData.tsx, which only the job page may import
 * (tests/regressions/indexing-safety.test.ts).
 */
import { isJobPostingEligible, type JobPostingFactsInput } from '@/app/jobs/[slug]/job-posting-facts';
import { logger } from '@/lib/logger';
import { pingAllSearchEngines, pingBing, pingIndexNow } from '@/lib/search-indexing';

type IndexResults = Awaited<ReturnType<typeof pingAllSearchEngines>>;

/**
 * The Job columns isJobPostingEligible reads. A caller that loads the row
 * with a narrower select adds these, so the check sees the stored values.
 */
export const JOB_POSTING_ELIGIBILITY_SELECT = {
  title: true,
  employer: true,
  description: true,
  location: true,
  mode: true,
  isRemote: true,
  isHybrid: true,
  city: true,
  state: true,
  stateCode: true,
  country: true,
} as const;

/**
 * Ping every engine for an eligible job page; Bing and IndexNow only for a
 * job whose page emits no JobPosting. Never throws synchronously: callers
 * fire and forget with a .catch.
 */
export async function pingSearchEnginesForJobPage(url: string, job: JobPostingFactsInput): Promise<IndexResults> {
  if (isJobPostingEligible(job)) return pingAllSearchEngines(url);
  logger.info('[Indexing] Google skipped: the job page emits no JobPosting', { url });
  const settled = await Promise.allSettled([pingBing(url), pingIndexNow(url)]);
  return settled.flatMap((result) => {
    if (result.status !== 'fulfilled') return [];
    return Array.isArray(result.value) ? result.value : [result.value];
  });
}
