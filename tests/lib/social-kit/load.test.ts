/**
 * lib/social-kit/load.ts: what the social kit page reads.
 *
 * Pins:
 *  - the kit offers live jobs only (activeIndexableJobWhere) and paid ones
 *    only: Stripe posts and pack posts, never promo, free, pending,
 *    refunded, disputed or expired rows
 *  - a job without a slug (no page to link to) never reaches the kit
 *  - the posting tracker and the click counts fail soft: logged, and
 *    reported as unavailable, so the posts still load
 *  - click counts are human clicks on the kit's own campaign
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  job: { findMany: vi.fn() },
  socialPostLog: { findMany: vi.fn() },
  shortLinkClick: { groupBy: vi.fn() },
}))
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logger', () => ({ logger }))

import { activeIndexableJobWhere } from '@/lib/active-job-filter'
import { JOB_LINKS_CAMPAIGN } from '@/lib/shortlinks/campaigns'
import {
  loadSocialKitClicks,
  loadSocialKitJobs,
  loadSocialPostLogs,
  SOCIAL_KIT_PAYMENT_STATUSES,
  socialKitJobWhere,
} from '@/lib/social-kit/load'

const JOB = '3f9a20c1-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-25T15:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('which jobs the kit offers', () => {
  it('counts Stripe posts and pack posts as paid, and nothing else', () => {
    expect([...SOCIAL_KIT_PAYMENT_STATUSES].sort()).toEqual(['pack', 'paid'])
    for (const status of ['promo', 'free', 'pending', 'refunded', 'disputed', 'expired', 'plan']) {
      expect(SOCIAL_KIT_PAYMENT_STATUSES).not.toContain(status)
    }
  })

  it('asks for live jobs with the site rule and a paid employer post', () => {
    expect(socialKitJobWhere(NOW)).toEqual({
      AND: [
        activeIndexableJobWhere(NOW),
        { employerJobs: { is: { paymentStatus: { in: ['paid', 'pack'] } } } },
      ],
    })
  })

  it('reads newest first and drops a job with no page to link to', async () => {
    db.job.findMany.mockResolvedValue([
      { id: 'a', slug: 'np-a', title: 'A', employerJobs: { companyWebsite: 'https://a.test' } },
      { id: 'b', slug: null, title: 'B', employerJobs: { companyWebsite: null } },
    ])
    const jobs = await loadSocialKitJobs(NOW)
    expect(jobs.map((job) => job.id)).toEqual(['a'])
    expect(jobs[0]).toMatchObject({ companyWebsite: 'https://a.test' })
    expect(jobs[0]).not.toHaveProperty('employerJobs')
    const args = db.job.findMany.mock.calls[0][0]
    expect(args.orderBy).toEqual({ createdAt: 'desc' })
    expect(args.where).toEqual(socialKitJobWhere(NOW))
  })
})

describe('loadSocialPostLogs', () => {
  it('reads nothing when there are no jobs', async () => {
    expect(await loadSocialPostLogs([])).toEqual({ logs: [], available: true })
    expect(db.socialPostLog.findMany).not.toHaveBeenCalled()
  })

  it('returns the history and drops rows with a platform the kit does not know', async () => {
    db.socialPostLog.findMany.mockResolvedValue([
      { id: 'a1', jobId: JOB, platform: 'reddit', venue: 'r/nursepractitioner', postUrl: null, postedAt: new Date('2026-11-23T15:00:00.000Z') },
      { id: 'a2', jobId: JOB, platform: 'myspace', venue: null, postUrl: null, postedAt: new Date('2026-11-22T15:00:00.000Z') },
    ])
    expect(await loadSocialPostLogs([JOB])).toEqual({
      logs: [{ id: 'a1', jobId: JOB, platform: 'reddit', venue: 'r/nursepractitioner', postUrl: null, postedAt: '2026-11-23T15:00:00.000Z' }],
      available: true,
    })
  })

  it('reports the tracker unavailable instead of failing the page, and logs why', async () => {
    const failure = new Error('relation "social_post_logs" does not exist')
    db.socialPostLog.findMany.mockRejectedValue(failure)
    expect(await loadSocialPostLogs([JOB])).toEqual({ logs: [], available: false })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('posting tracker'), failure, expect.anything())
  })
})

describe('loadSocialKitClicks', () => {
  it('counts human clicks on the kit campaign, per code', async () => {
    db.shortLinkClick.groupBy.mockResolvedValue([
      { code: 'l3f9a20c1', _count: { _all: 4 } },
      { code: 'r3f9a20c1', _count: { _all: 1 } },
    ])
    expect(await loadSocialKitClicks()).toEqual({ counts: { l3f9a20c1: 4, r3f9a20c1: 1 }, available: true })
    expect(db.shortLinkClick.groupBy.mock.calls[0][0].where).toEqual({ campaign: JOB_LINKS_CAMPAIGN, isBot: false })
  })

  it('reports the counts unavailable instead of failing the page, and logs why', async () => {
    const failure = new Error('timeout')
    db.shortLinkClick.groupBy.mockRejectedValue(failure)
    expect(await loadSocialKitClicks()).toEqual({ counts: {}, available: false })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('click counts'), failure)
  })
})
