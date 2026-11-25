import { prisma } from '@/lib/prisma'
import { activeIndexableJobWhere } from '@/lib/active-job-filter'
import { JOB_LINKS_CAMPAIGN, PLATFORM_BY_LETTER } from './campaigns'
import type { ShortlinkResolution } from './types'

/**
 * Per-job short links for employer posts, as written by the admin social kit
 * (/admin/social-kit).
 *
 * Code shape: one platform letter, then the first 8 hex digits of the job's
 * id (`l3f9a20c1` is a LinkedIn click on job 3f9a20c1-...). Eight hex digits
 * give about 4.3 billion values against a few dozen employer posts, so two
 * posts sharing a prefix is not a practical concern; the lookup still orders
 * by id so that, if it ever happened, a code would resolve the same way on
 * every click.
 *
 * The lookup starts from employer_jobs, a small table, rather than
 * prefix-scanning every job. Only employer posts get these links, and it
 * keeps the codes from becoming a way to walk the aggregated inventory.
 */

export const JOB_LINK_ID_CHARS = 8

const JOB_CODE_PATTERN = /^([a-z])([0-9a-f]{8})$/
const JOB_ID_PREFIX_PATTERN = /^[0-9a-f]{8}/
const CONTENT_LABEL_MAX = 60

export interface JobLinkCode {
  readonly letter: string
  readonly platform: string
  readonly idPrefix: string
}

/** Parse `<letter><8 hex>`. Null for any other shape or an unknown letter. */
export function parseJobLinkCode(rawCode: string): JobLinkCode | null {
  if (typeof rawCode !== 'string') return null
  const match = rawCode.toLowerCase().match(JOB_CODE_PATTERN)
  if (!match) return null
  const [, letter, idPrefix] = match
  const platform = PLATFORM_BY_LETTER[letter]
  if (!platform) return null
  return Object.freeze({ letter, platform, idPrefix })
}

/**
 * The `/r/...` path for one platform's link to one job. Throws on an unknown
 * platform letter or an id that does not start with 8 hex digits, because a
 * link the route cannot resolve must never reach a published post.
 */
export function jobLinkPath(letter: string, jobId: string): string {
  if (!PLATFORM_BY_LETTER[letter]) {
    throw new Error(`Unknown short link platform letter: ${letter}`)
  }
  const idPrefix = jobId.toLowerCase().match(JOB_ID_PREFIX_PATTERN)?.[0]
  if (!idPrefix) {
    throw new Error(`Job id has no 8 hex digit prefix: ${jobId}`)
  }
  return `/r/${letter}${idPrefix}`
}

/** Lowercase kebab label for the click row's `content` column. */
function contentLabel(employer: string): string {
  const label = employer
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CONTENT_LABEL_MAX)
    .replace(/-+$/, '')
  return label || 'employer-job'
}

/**
 * Resolve a parsed job code against the database.
 *
 * - No employer post with that id prefix: null, so the route treats it like
 *   any unknown code (untracked redirect to /jobs).
 * - The post exists but is not live (expired, paused, unpaid, held): /jobs,
 *   logged with content `closed` and job id 0, the browse-all convention, so
 *   clicks on old posts still count.
 * - Live: the job page. "Live" is activeIndexableJobWhere
 *   (lib/active-job-filter.ts), the site's rule for a posting that is up.
 *   jobId holds the first 7 hex digits as an integer, a stable per-job
 *   number that fits the Int column.
 */
export async function resolveJobLink(
  code: JobLinkCode,
  baseUrl: string,
  now: Date = new Date(),
): Promise<ShortlinkResolution | null> {
  const owner = await prisma.employerJob.findFirst({
    where: { jobId: { startsWith: code.idPrefix } },
    orderBy: { jobId: 'asc' },
    select: { jobId: true },
  })
  if (!owner) return null

  const job = await prisma.job.findFirst({
    where: { AND: [activeIndexableJobWhere(now), { id: owner.jobId }] },
    select: { slug: true, employer: true },
  })

  const base = baseUrl.replace(/\/$/, '')
  if (!job?.slug) {
    return Object.freeze({
      destination: `${base}/jobs`,
      destinationPath: '/jobs',
      platform: code.platform,
      campaign: JOB_LINKS_CAMPAIGN,
      content: 'closed',
      jobId: 0,
    })
  }

  const path = `/jobs/${job.slug}`
  return Object.freeze({
    destination: `${base}${path}`,
    destinationPath: path,
    platform: code.platform,
    campaign: JOB_LINKS_CAMPAIGN,
    content: contentLabel(job.employer),
    jobId: parseInt(code.idPrefix.slice(0, 7), 16),
  })
}
