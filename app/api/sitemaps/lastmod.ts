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
 *   - a page whose copy switches from the launch promo to the paid ladder
 *     when the promo ends: once that instant has passed, never earlier than
 *     it (PROMO_SWITCH_PATHS below);
 *   - a sitemap index child: the newest lastmod inside that child.
 * A URL whose content date cannot be read carries no lastmod at all, which is
 * honest; a guessed "now" is not.
 *
 * Plain module next to the sitemap routes (not a route file), imported by
 * app/sitemap.ts and the /api/sitemaps routes.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';

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
 * listed here. A comparison page, like the /compare hub, carries the later
 * of COMPARE_REVIEW_DATE (lib/compare-data.ts, the date the claims were
 * checked, which is not bumped for a copy edit that re-checked nothing) and
 * its entry here, when one exists, for a copy or link change since that
 * review. The specialty salary pages carry the later of their own jobs'
 * newest content change and the specialty template's entry here.
 *
 * BUMP A PAGE'S DATE IN THE SAME CHANGE THAT EDITS WHAT IT SAYS: its own
 * copy, or a component or config value it renders (a byline, a hero, a
 * price). A date older than the page's copy under-claims (Google may skip a
 * recrawl); a date moved without a copy change over-claims. Seeded on
 * 2026-09-29 from each page's last commit, and from that day for pages this
 * release rewrote. tests/regressions/sitemap-content-lastmod.test.ts fails
 * when a listed code-authored page has no entry here. The one copy change
 * not recorded here is the launch promo's end, which changes pages on a date
 * fixed in config rather than in a commit: PROMO_SWITCH_PATHS carries it.
 *
 * 2026-10-13: two changes shipped that UTC day and between them changed what
 * every page here says except /terms, /privacy and /sub-processors. The plain
 * copy pass (a74a4d5) reworded UI copy and removed explanatory text site-wide;
 * the SEO, AEO and GEO release retitled the tools, rewrote the job seeker
 * hero and guides, added the full practice quick answer, and moved the growth
 * figure (2025 to 2035), the HRSA floor, the stats review date and the
 * certifying body names. Neither had moved its entries, so that change dated
 * all 33 pages it covered to the day they went live (the /compare entry came
 * later, see its note). The notes on single entries below record what else
 * changed on that page, oldest first.
 */
export const PAGE_CONTENT_DATES: Readonly<Record<string, string>> = {
  '/for-employers': '2026-10-13',
  // 2026-10-20 (security and register batch): the comparison table is rebuilt
  // from audited cells (lib/seeker-comparison.ts, register D25), its
  // surrounding cards say only what the board does, and the "how it works"
  // steps (components/FeaturedJobs.tsx) lose the AI and no recruiter claims.
  '/for-job-seekers': '2026-10-20',
  '/about': '2026-10-13',
  '/editorial-policy': '2026-10-13',
  '/faq': '2026-10-13',
  '/contact': '2026-10-13',
  '/terms': '2026-09-27',
  '/privacy': '2026-09-15',
  '/pricing': '2026-10-13',
  // 2026-10-04 (backlog 2.2): the program guide card now resolves through
  // lib/blog.ts, which serves the guide from code, so the card renders; it
  // read the empty blog_posts table and never rendered before.
  // 2026-10-13 (SEO, AEO and GEO release): the card prints the guide's new
  // title (content/blog/how-to-evaluate-np-programs.mdx).
  '/for-programs': '2026-10-13',
  '/security': '2026-10-13',
  '/sub-processors': '2026-09-12',
  '/accessibility': '2026-10-13',
  '/press': '2026-10-13',
  // 2026-10-04 (backlog 2.2): the article count, the article grid, the
  // "Before you apply" band and the state guide grid now list the posts
  // lib/blog.ts serves from code; they read the empty blog_posts table and
  // rendered nothing before.
  // 2026-10-13 (SEO, AEO and GEO release): ten new posts move the article
  // count and the article grid, the "Before you apply" cards carry the two
  // guides' new titles and descriptions, and three tool cards carry their
  // new titles (app/tools/tools-registry.ts).
  '/resources': '2026-10-13',
  '/resources/fpa-guide': '2026-10-13',
  // 2026-10-23 (register 2.25): the private practice jobs card follows that
  // landing's job count, and the landing had none at ship.
  '/resources/private-practice-guide': '2026-10-23',
  '/resources/1099-vs-w2': '2026-10-13',
  '/scope-of-practice': '2026-10-13',
  '/tools': '2026-10-13',
  '/tools/1099-vs-w2-calculator': '2026-10-13',
  // 2026-09-29: a curated metro's jobs link now opens its metro guide (L-05).
  // 2026-10-13 (SEO, AEO and GEO release): the H1 names the tool.
  '/tools/cost-of-living-comparison': '2026-10-13',
  '/tools/licensure-checker': '2026-10-13',
  '/tools/salary-benchmark': '2026-10-13',
  // 2026-10-23 (register 2.25): the last breadcrumb names the tool as its title does.
  '/tools/specialty-finder': '2026-10-23',
  '/tools/private-practice-revenue-calculator': '2026-10-23',
  '/tools/cost-per-hire-calculator': '2026-10-23',
  '/for-employers/resources': '2026-10-13',
  // 2026-10-20 (register 2.23): the credential checklist and the first FAQ
  // answer name the certifying body AANPCB.
  '/for-employers/resources/how-to-hire': '2026-10-20',
  '/for-employers/resources/job-description-guide': '2026-10-13',
  '/for-employers/resources/job-description-templates': '2026-10-13',
  // Every template page renders from one template file and lib/jd-templates.ts.
  // 2026-10-20 (register 2.23): each template's credentials line names the
  // certifying body AANPCB.
  '/for-employers/resources/job-description-templates/[id]': '2026-10-20',
  // 2026-10-13 (plain copy pass): a new title, no hero line or closing
  // line, and rewritten method bullets (app/compare/page.tsx). The entry
  // came later (backlog 2.22): until then the review alone dated the hub.
  // COMPARE_REVIEW_DATE stays: nobody re-checked the claims.
  '/compare': '2026-10-13',
  // CQ-13: the licensure row and advantage now link the scope of practice
  // explorer (lib/compare-data.ts). COMPARE_REVIEW_DATE stays: nobody
  // re-checked the claims.
  // 2026-10-13: the salary row and the salary card print the stats review
  // date (STATS_LAST_REVIEWED, lib/stats-sources.ts), which the SEO, AEO and
  // GEO release moved, and the plain copy pass trimmed the shared template
  // (app/compare/comparison-shared.tsx). COMPARE_REVIEW_DATE still stays.
  '/compare/np-hiring-vs-indeed': '2026-10-13',
  // 2026-10-04 (backlog 2.1): the "comparing published prices" line dates
  // only the AANP price to the review (it read "both public, as of" the
  // review, five weeks before our promo and ladder went public), and the
  // salary guide line reads "an NP". No claim was re-checked.
  // 2026-10-13: the salary row prints the moved stats review date and the
  // shared template was trimmed, as on the Indeed page above.
  '/compare/np-hiring-vs-aanp-jobcenter': '2026-10-13',
  // 2026-10-04 (backlog 2.1): "hiring an NP" (it read "a NP"). CQ-13 had
  // relinked its licensure row on 2026-09-29, like the Indeed page's.
  // 2026-10-13: the salary row prints the moved stats review date and the
  // shared template was trimmed, as on the Indeed page above.
  '/compare/np-hiring-vs-enp-network': '2026-10-13',
  // Every specialty salary page renders from one template: the specialty
  // config and content were rewritten on 2026-09-29 (specialty-config.ts,
  // specialty-content.ts), and the plain copy pass removed the related
  // guides lede on 2026-10-13.
  '/salary-guide/specialty/[specialty]': '2026-10-13',
};

/**
 * Code-authored pages whose rendered copy switches from the launch promo to
 * the paid ladder at config.promoEndsAt (backlog 2.1). Each states the promo
 * while it runs and the ladder as the current price afterwards, deciding the
 * phase per render and re-rendering at least hourly, so the switch needs no
 * deploy and no edit to PAGE_CONTENT_DATES. Their copy did change at that
 * instant, though, so once it has passed their lastmod is never earlier
 * (pageContentDate); before it nothing here changes. Add a page in the same
 * change that makes its copy follow the promo clock, and only then: listing
 * one whose copy does not switch over-claims a change. Every comparison page
 * is here because each states our price in its capability table; their hub
 * prints no price and is not.
 * tests/regressions/promo-clock-pages-rerender.test.ts holds the set to the
 * sources in both directions: a dated page whose code reads the promo clock
 * has to be here (and re-render hourly), and a page here has to read it. The
 * hub is that suite's one exemption: it builds the comparison profiles to
 * list them and prints only fields that are the same in both phases.
 */
export const PROMO_SWITCH_PATHS: ReadonlySet<string> = new Set([
  '/pricing',
  '/for-employers',
  '/faq',
  '/for-employers/resources',
  '/for-employers/resources/how-to-hire',
  // States no price: only its post-a-job button switches ("Post a Job: Free"
  // to "Post a Job"), the same kind of change as the homepage's employer band.
  '/for-employers/resources/job-description-guide',
  '/for-employers/resources/job-description-templates',
  '/for-employers/resources/job-description-templates/[id]',
  '/tools/salary-benchmark',
  '/tools/cost-per-hire-calculator',
  '/compare/np-hiring-vs-indeed',
  '/compare/np-hiring-vs-aanp-jobcenter',
  '/compare/np-hiring-vs-enp-network',
]);

/**
 * The instant the launch promo ended, once `now` has reached it; null while
 * it runs. Every page in PROMO_SWITCH_PATHS changed its copy then, and so did
 * the homepage's employer band (see withPromoSwitch).
 */
export function promoSwitchDate(now: Date = new Date()): Date | null {
  return config.isPromoActive(now) ? null : new Date(config.promoEndsAt);
}

/**
 * The content date of a page that lists jobs AND renders copy that switches
 * when the promo ends (the homepage, through components/EmployerHowItWorks):
 * its jobs' newest content date, raised to the switch once that has passed.
 * A date that could not be read stays unread, because the switch is only a
 * lower bound on it, not the page's content date.
 */
export function withPromoSwitch(date: Date | null | undefined, now: Date = new Date()): Date | undefined {
  if (!isValidDate(date)) return undefined;
  return latestOf(date, promoSwitchDate(now)) ?? undefined;
}

/**
 * The content date of a code-authored page: its copy date (see
 * PAGE_CONTENT_DATES), raised to the promo switch for a page in
 * PROMO_SWITCH_PATHS once `now` has passed it. Undefined when neither
 * applies: the sitemap then emits no lastmod for the page rather than a
 * guessed one. A switch page without a copy date (a comparison page still
 * dated by its review; none is today) is dated by the switch alone once it
 * has happened, which is exact: nothing else on it changed since.
 */
export function pageContentDate(path: string, now: Date = new Date()): Date | undefined {
  const day = PAGE_CONTENT_DATES[path];
  const copyDate = day ? new Date(`${day}T00:00:00.000Z`) : undefined;
  const switchDate = PROMO_SWITCH_PATHS.has(path) ? promoSwitchDate(now) : null;
  return latestOf(copyDate, switchDate) ?? undefined;
}

/** The newest content date among the code-authored pages at `now`, for a sitemap index child. */
export function newestPageContentDate(now: Date = new Date()): Date | null {
  const paths = new Set([...Object.keys(PAGE_CONTENT_DATES), ...PROMO_SWITCH_PATHS]);
  return latestOf(...[...paths].map((path) => pageContentDate(path, now)));
}

/** A sitemap XML <lastmod> value (W3C datetime), or '' when there is no date. */
export function lastmodTag(date: Date | null | undefined, indent = '    '): string {
  return isValidDate(date) ? `\n${indent}<lastmod>${date.toISOString()}</lastmod>` : '';
}
