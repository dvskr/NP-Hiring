import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { activeIndexableJobWhere } from '@/lib/active-job-filter'
import { JOB_LINKS_CAMPAIGN } from '@/lib/shortlinks/campaigns'
import { isSocialPlatform, type PostLogEntry } from './tracker'
import type { SocialKitJob } from './types'

/**
 * EmployerJob.paymentStatus values the kit treats as paid: a post bought
 * through Stripe Checkout ('paid', which a renewal also writes) and a post
 * published from a bought 5-post pack credit ('pack').
 *
 * Left out on purpose: 'promo' (free during the launch promo; a promo post
 * enters the kit once a renewal is paid for, which writes 'paid'), the
 * legacy free and plan statuses, 'pending' and 'expired' checkouts (never
 * paid), and 'refunded' and 'disputed' rows, whose money is gone or in
 * question. To promote promo posts too, add 'promo' here.
 */
export const SOCIAL_KIT_PAYMENT_STATUSES: readonly string[] = Object.freeze(['paid', 'pack'])

/**
 * The query behind the kit: live (activeIndexableJobWhere, the site's rule
 * for a posting that is up, so the kit never offers a post for a job whose
 * page is gone) and paid (SOCIAL_KIT_PAYMENT_STATUSES).
 */
export function socialKitJobWhere(now: Date): Prisma.JobWhereInput {
  return {
    AND: [
      activeIndexableJobWhere(now),
      { employerJobs: { is: { paymentStatus: { in: [...SOCIAL_KIT_PAYMENT_STATUSES] } } } },
    ],
  }
}

const SOCIAL_KIT_JOB_SELECT = {
  id: true,
  slug: true,
  title: true,
  employer: true,
  location: true,
  city: true,
  state: true,
  stateCode: true,
  country: true,
  isRemote: true,
  isHybrid: true,
  mode: true,
  jobType: true,
  salaryPeriod: true,
  minSalary: true,
  maxSalary: true,
  salaryIsEstimated: true,
  salaryConfidence: true,
  experienceLabel: true,
  minYearsExperience: true,
  maxYearsExperience: true,
  newGradFriendly: true,
  setting: true,
  population: true,
  benefits: true,
  description: true,
  createdAt: true,
  expiresAt: true,
  employerJobs: { select: { companyWebsite: true } },
} satisfies Prisma.JobSelect

/** Every live paid employer post, newest first. */
export async function loadSocialKitJobs(now: Date = new Date()): Promise<SocialKitJob[]> {
  const rows = await prisma.job.findMany({
    where: socialKitJobWhere(now),
    orderBy: { createdAt: 'desc' },
    select: SOCIAL_KIT_JOB_SELECT,
  })

  return rows
    .filter((row): row is typeof row & { slug: string } => !!row.slug)
    .map(({ employerJobs, ...job }) => ({ ...job, companyWebsite: employerJobs?.companyWebsite ?? null }))
}

/** Upper bound on tracker rows read per page load; years of daily posting. */
const MAX_POST_LOGS = 5000

export interface PostLogLoad {
  readonly logs: PostLogEntry[]
  /** False when the tracker could not be read, e.g. a database without its table yet. */
  readonly available: boolean
}

/**
 * The posting history for these jobs, newest first. A failure here must not
 * take the posts down with it, so it is logged and reported as unavailable,
 * and the page says the tracker could not be loaded.
 */
export async function loadSocialPostLogs(jobIds: readonly string[]): Promise<PostLogLoad> {
  if (!jobIds.length) return { logs: [], available: true }
  try {
    const rows = await prisma.socialPostLog.findMany({
      where: { jobId: { in: [...jobIds] } },
      orderBy: { postedAt: 'desc' },
      take: MAX_POST_LOGS,
    })
    const logs = rows.flatMap((row): PostLogEntry[] =>
      isSocialPlatform(row.platform)
        ? [{ id: row.id, jobId: row.jobId, platform: row.platform, venue: row.venue, postUrl: row.postUrl, postedAt: row.postedAt.toISOString() }]
        : [],
    )
    return { logs, available: true }
  } catch (error) {
    logger.error('[social-kit] could not read the posting tracker', error, { jobs: jobIds.length })
    return { logs: [], available: false }
  }
}

export interface ClickLoad {
  /** Human clicks per /r/ code. */
  readonly counts: Readonly<Record<string, number>>
  /** False when the counts could not be read; the page says so. */
  readonly available: boolean
}

/**
 * Human clicks per short link code for the kit's campaign, so each post can
 * show how it has done. Bots and link-preview fetches are excluded (they are
 * recorded with isBot true, lib/shortlinks/bots.ts). A failed read is logged
 * and reported as unavailable, so the posts still load.
 */
export async function loadSocialKitClicks(): Promise<ClickLoad> {
  try {
    const rows = await prisma.shortLinkClick.groupBy({
      by: ['code'],
      where: { campaign: JOB_LINKS_CAMPAIGN, isBot: false },
      _count: { _all: true },
    })
    return { counts: Object.fromEntries(rows.map((row) => [row.code, row._count._all])), available: true }
  } catch (error) {
    logger.error('[social-kit] could not read the click counts', error)
    return { counts: {}, available: false }
  }
}
