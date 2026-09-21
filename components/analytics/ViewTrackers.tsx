'use client';

import { useEffect } from 'react';
import { trackJobView, trackJobListView, buildJobItem, type JobItem } from '@/lib/analytics';

/**
 * The job fields a GA4 surface on this board can realistically supply.
 *
 * Everything past `id` is optional because a listing query selects fewer
 * columns than a detail query, and the buttons on the detail page receive
 * props rather than the row. Nullable rather than just optional: the Prisma
 * columns are nullable and callers pass them straight through, so forcing
 * every call site to write `?? undefined` would only move the coercion
 * somewhere less visible.
 */
export interface TrackedJob {
  id: string;
  /**
   * Optional, and absent is a real state rather than an oversight. The
   * detail page's Save button is handed a job id and nothing else, so it
   * has no title to report. GA4 joins an item across events on item_id, so
   * the event still lands in the right funnel; omitting item_name reports
   * the label as "(not set)" whereas the empty string this used to send
   * reports a listing whose name genuinely is blank.
   */
  title?: string;
  employer?: string | null;
  jobType?: string | null;
  /**
   * The two-letter code only, deliberately. Job.state holds "California"
   * and Job.stateCode holds "CA" in separate columns, and both land in one
   * item-scoped GA4 dimension (item_category3). buildJobItem accepts either
   * and falls back to the long name, so any surface that reached for `state`
   * because its query happened to select it would file the same job under
   * two dimension values, and GA4 reconciles neither. There is no `state`
   * field here so that a call site has to select the code, and a row with no
   * recorded code omits the dimension rather than substituting a long name.
   */
  stateCode?: string | null;
  sourceProvider?: string | null;
  normalizedMinSalary?: number | null;
}

/**
 * item_list_name for the main /jobs board.
 *
 * One constant so the list impression and the card click send the identical
 * string: GA4 joins select_item back to view_item_list on this value alone,
 * so two spellings would report a click-through rate of zero rather than an
 * error anyone would notice. Named for the surface instead of "All Jobs"
 * because the same route also serves filtered, sorted and paginated views.
 */
export const JOBS_BOARD_LIST_NAME = 'Job Search Results';

/**
 * Build the GA4 item for a job, reporting only what the caller knows.
 *
 * Two fields would otherwise be filled in with something that reads like
 * data in a GA4 report:
 *
 *   item_brand: buildJobItem() substitutes the literal 'Unknown' when no
 *   employer name reaches it. GA4 cannot tell that apart from a company
 *   actually named Unknown, so every brandless listing pools under one fake
 *   advertiser and the item_brand report reads as a finding instead of a
 *   gap.
 *
 *   item_name: typed as a required string, so a caller with no title had to
 *   pass ''. GA4 stores the empty string, and the item report then shows a
 *   blank row beside the same job's real title from view_item.
 *
 * Dropping either key reports "(not set)", which is what we actually know.
 * Retire this wrapper once lib/analytics.ts stops inventing item_brand and
 * types item_name as optional.
 */
export function buildTrackedJobItem(job: TrackedJob): JobItem {
  const employer = job.employer || undefined;
  const title = job.title || undefined;
  const item = buildJobItem({
    id: job.id,
    // Satisfies buildJobItem's required parameter only. The empty string
    // never leaves this function: the key is deleted below in that case.
    title: title ?? '',
    employer,
    jobType: job.jobType ?? undefined,
    // `state` is left unset on purpose: passing it would re-enable
    // buildJobItem's long-name fallback for the code-less rows that every
    // other surface reports as absent. See TrackedJob.stateCode.
    stateCode: job.stateCode ?? undefined,
    sourceProvider: job.sourceProvider ?? undefined,
    normalizedMinSalary: job.normalizedMinSalary ?? undefined,
  });
  // Keyed on what the caller supplied, not on the resulting string: an
  // aggregated listing whose employer really is recorded as "Unknown" keeps
  // its brand, because that is a fact about the row rather than a stand-in.
  if (employer && title) return item;
  const reported: JobItem = { ...item };
  if (!employer) delete reported.item_brand;
  // item_name is required on JobItem, so reporting it as absent needs the
  // widening cast. The alternative is to relax the type in lib/analytics.ts,
  // which this package does not own.
  if (!title) delete (reported as Partial<JobItem>).item_name;
  return reported;
}

/**
 * Fires `view_item` (GA4) when the job detail page mounts.
 * Drop this into any server-rendered job page — it's a zero-UI component.
 */
export function JobViewTracker({ job }: { job: TrackedJob }) {
  useEffect(() => {
    trackJobView(buildTrackedJobItem(job));
  }, [job]);

  return null;
}

/**
 * Fires `view_item_list` (GA4) when a job list page mounts.
 * Pass a slim array of job data — it will track the first 20 items.
 */
export function JobListViewTracker({ jobs, listName }: {
  jobs: TrackedJob[];
  listName: string;
}) {
  useEffect(() => {
    if (jobs.length === 0) return;
    const items: JobItem[] = jobs.map(j => buildTrackedJobItem(j));
    trackJobListView(items, listName);
  }, [jobs, listName]);

  return null;
}

/**
 * Fires `view_item_list` for the main /jobs board.
 *
 * A dedicated component instead of a listName prop passed from the page,
 * because /jobs is a Server Component: a "use client" module's non-component
 * exports reach a Server Component as client references rather than values,
 * so JOBS_BOARD_LIST_NAME must not cross that boundary. Keeping the name on
 * this side leaves it in exactly one place, and the click half of the pair
 * imports the constant directly (client to client).
 */
export function JobsBoardListViewTracker({ jobs }: { jobs: TrackedJob[] }) {
  return <JobListViewTracker jobs={jobs} listName={JOBS_BOARD_LIST_NAME} />;
}

/**
 * Fires a custom `pseo_page_view` event with pSEO dimensions.
 * Drop into any pSEO template to tag views with page_type, category, city, state.
 * This enables GA4 segmentation: "show me only category×city page traffic".
 */
export function PseoPageViewTracker({ pageType, category, city, state, jobCount }: {
  pageType: 'category_city' | 'setting_state' | 'state_hub' | 'metro' | 'enterprise' | 'locations';
  category?: string;
  city?: string;
  state?: string;
  jobCount?: number;
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dataLayer = window.dataLayer || [];
    // Use gtag for GA4 custom event
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'pseo_page_view', {
        pseo_page_type: pageType,
        pseo_category: category || '(all)',
        pseo_city: city || '(none)',
        pseo_state: state || '(none)',
        pseo_job_count: jobCount || 0,
      });
    }
  }, [pageType, category, city, state, jobCount]);

  return null;
}
