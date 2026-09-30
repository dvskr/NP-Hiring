/**
 * Sitemap lastmod from content, never from bookkeeping (indexing audit CS-02,
 * TECH-04, GFJ-10).
 *
 * Job.updatedAt moves on every write: view counts, link and presence checks,
 * freshness scoring and the ingest renewal. PseoStats.updatedAt moves on every
 * aggregate-pseo run. Used as lastmod, both told search engines that almost
 * every URL changed that day, and Google uses a lastmod only when it is
 * "consistently and verifiably accurate". Every sitemap therefore dates a URL
 * from its content:
 *   - a job page: when its published content last changed
 *     (Job.contentChangedAt, written only on create and on a change to a
 *     rendered field; createdAt for a row the column has not reached);
 *   - a listing page (home, /jobs, state hubs, metros, cities, directories,
 *     companies, category landings, setting x state, category x city): the
 *     newest such date among the jobs it lists;
 *   - a salary specialty page: the newest such date among its own
 *     specialty's jobs, or its template's copy date when that is later;
 *   - a code-authored page: the date its copy last changed
 *     (PAGE_CONTENT_DATES below);
 *   - a sitemap index child: the newest lastmod inside that child.
 * A URL whose content date cannot be read carries no lastmod at all, which is
 * honest; a guessed "now" is not.
 *
 * Plain module next to the sitemap routes (not a route file), imported by
 * app/sitemap.ts and the /api/sitemaps routes.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** The two Job columns a content date reads, for a `select` or an aggregate `_max`. */
export const JOB_CONTENT_DATE_FIELDS = { contentChangedAt: true, createdAt: true } as const;

/** A job row's content stamps (or an aggregate's `_max` of them). */
export interface JobContentStamps {
  contentChangedAt?: Date | null;
  createdAt?: Date | null;
}

const isValidDate = (value: unknown): value is Date => value instanceof Date && !Number.isNaN(value.getTime());

/** The latest of the given dates, skipping missing and invalid ones; null when none is usable. */
export function latestOf(...dates: ReadonlyArray<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (isValidDate(date) && (latest === null || date.getTime() > latest.getTime())) latest = date;
  }
  return latest;
}

/**
 * When a job's published content last changed: contentChangedAt, or createdAt
 * for a row the column has not reached. The later of the two, so a row whose
 * stamps disagree can never date its content before it existed.
 */
export function jobContentDate(stamps: JobContentStamps | null | undefined): Date | null {
  return latestOf(stamps?.contentChangedAt, stamps?.createdAt);
}

/**
 * The newest content date among the jobs `where` selects, from one aggregate.
 * Null when no job matches or the read returns nothing usable. Allowed to
 * throw: callers decide whether a failure omits a lastmod or a section.
 */
export async function latestJobContentDate(where: Prisma.JobWhereInput): Promise<Date | null> {
  const aggregate = await prisma.job.aggregate({ where, _max: JOB_CONTENT_DATE_FIELDS });
  return jobContentDate(aggregate?._max);
}

/**
 * When each code-authored page's copy last changed (a UTC calendar day), for
 * its sitemap lastmod. Pages whose main content is a live job list, or live
 * figures computed from one, are dated from the jobs instead and are not
 * listed here. A comparison page carries the later of COMPARE_REVIEW_DATE
 * (lib/compare-data.ts, the date its claims were checked, which is not
 * bumped for a copy edit that re-checked nothing) and its entry here, when
 * one exists, for a copy or link change since that review. The specialty
 * salary pages carry the later of their own jobs' newest content change and
 * the specialty template's entry here.
 *
 * BUMP A PAGE'S DATE IN THE SAME CHANGE THAT EDITS WHAT IT SAYS: its own
 * copy, or a component or config value it renders (a byline, a hero, a
 * price). A date older than the page's copy under-claims (Google may skip a
 * recrawl); a date moved without a copy change over-claims. Seeded on
 * 2026-09-29 from each page's last commit, and from that day for pages this
 * release rewrote. tests/regressions/sitemap-content-lastmod.test.ts fails
 * when a listed code-authored page has no entry here.
 */
export const PAGE_CONTENT_DATES: Readonly<Record<string, string>> = {
  '/for-employers': '2026-09-27',
  '/for-job-seekers': '2026-09-29',
  '/about': '2026-09-29',
  '/editorial-policy': '2026-09-26',
  '/faq': '2026-09-29',
  '/contact': '2026-09-21',
  '/terms': '2026-09-27',
  '/privacy': '2026-09-15',
  '/pricing': '2026-09-27',
  '/for-programs': '2026-09-29',
  '/security': '2026-09-12',
  '/sub-processors': '2026-09-12',
  '/accessibility': '2026-09-15',
  '/press': '2026-09-29',
  '/resources': '2026-09-29',
  '/resources/fpa-guide': '2026-09-29',
  '/resources/private-practice-guide': '2026-09-29',
  '/resources/1099-vs-w2': '2026-09-29',
  '/scope-of-practice': '2026-09-29',
  '/tools': '2026-09-12',
  '/tools/1099-vs-w2-calculator': '2026-09-15',
  // 2026-09-29: a curated metro's jobs link now opens its metro guide (L-05).
  '/tools/cost-of-living-comparison': '2026-09-29',
  '/tools/licensure-checker': '2026-09-29',
  '/tools/salary-benchmark': '2026-09-21',
  '/tools/specialty-finder': '2026-09-15',
  '/tools/private-practice-revenue-calculator': '2026-09-29',
  '/tools/cost-per-hire-calculator': '2026-09-27',
  '/for-employers/resources': '2026-09-29',
  '/for-employers/resources/how-to-hire': '2026-09-29',
  '/for-employers/resources/job-description-guide': '2026-09-29',
  '/for-employers/resources/job-description-templates': '2026-09-29',
  // Every template page renders from one template file and lib/jd-templates.ts.
  '/for-employers/resources/job-description-templates/[id]': '2026-09-29',
  // CQ-13: the licensure row and advantage now link the scope of practice
  // explorer (lib/compare-data.ts). COMPARE_REVIEW_DATE stays: nobody
  // re-checked the claims.
  '/compare/np-hiring-vs-indeed': '2026-09-29',
  '/compare/np-hiring-vs-enp-network': '2026-09-29',
  // Every specialty salary page renders from one template: the specialty
  // config and content were rewritten in this release (specialty-config.ts,
  // specialty-content.ts).
  '/salary-guide/specialty/[specialty]': '2026-09-29',
};

/**
 * The copy date of a code-authored page (see PAGE_CONTENT_DATES), or
 * undefined when the page has no entry: the sitemap then emits no lastmod
 * for it rather than a guessed one.
 */
export function pageContentDate(path: string): Date | undefined {
  const day = PAGE_CONTENT_DATES[path];
  if (!day) return undefined;
  const date = new Date(`${day}T00:00:00.000Z`);
  return isValidDate(date) ? date : undefined;
}

/** The newest copy date among the code-authored pages, for a sitemap index child. */
export function newestPageContentDate(): Date | null {
  return latestOf(...Object.keys(PAGE_CONTENT_DATES).map(pageContentDate));
}

/** A sitemap XML <lastmod> value (W3C datetime), or '' when there is no date. */
export function lastmodTag(date: Date | null | undefined, indent = '    '): string {
  return isValidDate(date) ? `\n${indent}<lastmod>${date.toISOString()}</lastmod>` : '';
}
