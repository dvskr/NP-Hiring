import type { ShortlinkCampaign } from './types'

/**
 * Platform letter → utm_source-style name.
 *
 * Adding a platform here is a one-line change; the resolver reads from
 * this map at runtime so no other file needs to know about it.
 */
export const PLATFORM_BY_LETTER: Readonly<Record<string, string>> = Object.freeze({
  f: 'facebook',
  i: 'instagram',
  l: 'linkedin',
  x: 'x',
  r: 'reddit',
  t: 'threads',
  p: 'program-director',
  // Forums and communities where the board's audience talks shop. Used by
  // the admin social kit's per-job links; the click's referer says which.
  n: 'forum',
})

/**
 * Per-job links the admin social kit (/admin/social-kit) writes into posts:
 * `/r/<platform letter><first 8 hex digits of the job id>`, e.g. /r/l3f9a20c1
 * (lib/shortlinks/job-links.ts).
 *
 * Unlike the catalog campaigns below, nothing about these is frozen in
 * code. The route looks the job up when the link is clicked, so a new paid
 * post gets working links the moment it goes live, and a post that has
 * closed sends old links to /jobs instead of a dead page.
 */
export const JOB_LINKS_CAMPAIGN = 'organic-paid-jobs'

export const KNOWN_PLATFORM_LETTERS: ReadonlySet<string> = new Set(
  Object.keys(PLATFORM_BY_LETTER),
)

/**
 * This board's catalog campaign: the codes a post can carry without a job
 * behind them, /r/<letter>0 (browse every job) and /r/p<n> (the program
 * director landing). Its job list is empty because this board has shipped
 * no numbered job codes; a post about one job uses the social kit's per-job
 * link (JOB_LINKS_CAMPAIGN) instead.
 *
 * To ship numbered codes, list them here with this board's own job slugs.
 * A code with no entry (/r/f1, /r/i7) redirects to /jobs like any unknown
 * code, so removing an entry never strands a reader, but it does break the
 * link in a post that already went out.
 */
export const BOARD_CAMPAIGN: ShortlinkCampaign = Object.freeze({
  campaign: 'board-links',
  jobs: Object.freeze([] as const),
}) as ShortlinkCampaign

/**
 * Pointer to the campaign the route handler currently serves. To roll a
 * new campaign, add a new constant above and swap this export: the route
 * handler reads through it.
 */
export const ACTIVE_CAMPAIGN: ShortlinkCampaign = BOARD_CAMPAIGN
