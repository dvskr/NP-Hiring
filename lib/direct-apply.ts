/**
 * Where an Apply click leads, and what the call to action says about it.
 * Shared by JobCard, ApplyButton and the job page so the card and the detail
 * page can never disagree.
 *
 * Owner decision (2026-09, indexing audit GFJ-03): an external ATS link is
 * no longer labelled "Direct Apply". The words read like Google's JobPosting
 * `directApply` flag, which means the candidate completes the application on
 * this page without leaving it. That is never true here: an external job
 * continues on the employer's site, and every apply (external or Easy
 * Apply) needs an NP Hiring account first. The labels below say where the
 * application continues instead, and the JobPosting markup does not claim
 * directApply for any job.
 *
 * The URL patterns are intentionally narrow: known major ATS hosts plus the
 * two near-universal employer subdomain patterns (`careers.` and `jobs.`).
 * A link that matches none of them gets a plain "Apply Now" ("Apply" on a
 * card), so the page never names a site it cannot vouch for.
 */

export const ATS_PATTERNS: ReadonlyArray<RegExp> = [
  /\.myworkdayjobs\.com/i,
  /greenhouse\.io/i,
  /lever\.co/i,
  /jobs\.ashbyhq\.com/i,
  /smartrecruiters\.com/i,
  /icims\.com/i,
  /jazz\.co/i,
  /bamboohr\.com/i,
  /usajobs\.gov/i,
  /apply\.workable\.com/i,
  /careers\./i,
  /jobs\./i,
];

/** True when the apply URL points to a recognized ATS or employer career site. */
export function isEmployerSiteUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return ATS_PATTERNS.some((p) => p.test(url));
}

export interface ApplyTarget {
  applyLink: string | null | undefined;
  sourceType: string | null | undefined;
  applyOnPlatform: boolean;
}

/**
 * - 'easy-apply': on-platform Easy Apply (the application is sent from here).
 * - 'employer-site': the application continues on the employer's own site
 *   (an employer post, or a recognized ATS or careers host).
 * - 'external': the application continues on another site we cannot name.
 * - 'none': no apply link at all.
 */
export type ApplyRoute = 'easy-apply' | 'employer-site' | 'external' | 'none';

export function resolveApplyRoute(target: ApplyTarget): ApplyRoute {
  if (target.applyOnPlatform) return 'easy-apply';
  if (!target.applyLink) return 'none';
  if (target.sourceType === 'employer') return 'employer-site';
  return isEmployerSiteUrl(target.applyLink) ? 'employer-site' : 'external';
}

/** The job page's main call to action for each route. */
export const APPLY_CTA_LABELS: Readonly<Record<ApplyRoute, string>> = {
  'easy-apply': 'Easy Apply',
  'employer-site': 'Apply on employer site',
  external: 'Apply Now',
  none: 'Apply link unavailable',
};

/** Label once the candidate has marked the job applied. */
export const APPLY_AGAIN_LABEL = 'Apply Again';

/** The link a signed-in candidate follows to finish an external application. */
export const CONTINUE_TO_EMPLOYER_LABEL = 'Continue to employer application';

/** Full call to action for the job page. */
export function applyCtaLabel(target: ApplyTarget, options: { applied?: boolean } = {}): string {
  const route = resolveApplyRoute(target);
  if (options.applied && route !== 'none') return APPLY_AGAIN_LABEL;
  return APPLY_CTA_LABELS[route];
}

/**
 * The job card's compact button. A card has no room for the full wording,
 * so an external job reads "Apply" and carries the full label as its
 * accessible name (see applyCtaLabel); Easy Apply keeps its own name.
 */
export function cardApplyLabel(target: ApplyTarget): string | null {
  const route = resolveApplyRoute(target);
  if (route === 'none') return null;
  return route === 'easy-apply' ? APPLY_CTA_LABELS['easy-apply'] : 'Apply';
}

/**
 * One line under the "Continue to employer application" link saying where
 * the application goes next. `isMail` is true for a mailto: apply address.
 */
export function continueApplicationNote(route: ApplyRoute, isMail: boolean): string {
  if (isMail) return 'This employer takes applications by email, so the link opens your email app.';
  if (route === 'employer-site') return "Your application continues on the employer's site, in a new tab.";
  return 'Your application continues on the site that listed this job, in a new tab.';
}
