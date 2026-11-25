/**
 * lib/shortlinks/job-links.ts: the per-job /r/<letter><8 hex> links the admin
 * social kit writes into posts.
 *
 * Pins:
 *  - the parser reads every kit platform letter and nothing else
 *  - the path builder refuses to build a link the route could not resolve
 *  - the lookup starts from employer_jobs and asks for a LIVE job with the
 *    site's own rule (activeIndexableJobWhere)
 *  - a closed post sends old links to /jobs and still counts the click
 *
 * Prisma is the global mock from tests/setup.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { activeIndexableJobWhere } from '@/lib/active-job-filter'
import { jobLinkPath, parseJobLinkCode, resolveJobLink } from '@/lib/shortlinks/job-links'
import { JOB_LINKS_CAMPAIGN, PLATFORM_BY_LETTER } from '@/lib/shortlinks/campaigns'
import { PLATFORM_LETTER } from '@/lib/social-kit/platforms'

const BASE = 'https://board.example'
const JOB_ID = '3f9a20c1-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-25T15:00:00.000Z')

describe('parseJobLinkCode', () => {
  it('reads a platform letter and an 8 hex job prefix', () => {
    expect(parseJobLinkCode('l3f9a20c1')).toEqual({ letter: 'l', platform: 'linkedin', idPrefix: '3f9a20c1' })
    expect(parseJobLinkCode('N3F9A20C1')).toEqual({ letter: 'n', platform: 'forum', idPrefix: '3f9a20c1' })
  })

  it.each(['l3f9a20c', 'l3f9a20c1f', 'z3f9a20c1', 'l3f9g20c1', 'f3', '', '93f9a20c1'])('rejects %j', (code) => {
    expect(parseJobLinkCode(code)).toBeNull()
  })

  it('knows every letter the social kit writes', () => {
    for (const letter of Object.values(PLATFORM_LETTER)) {
      expect(PLATFORM_BY_LETTER[letter], `letter ${letter}`).toBeDefined()
      expect(parseJobLinkCode(`${letter}3f9a20c1`)?.letter).toBe(letter)
    }
  })
})

describe('jobLinkPath', () => {
  it('builds the path the parser reads back', () => {
    const path = jobLinkPath('r', JOB_ID)
    expect(path).toBe('/r/r3f9a20c1')
    expect(parseJobLinkCode(path.slice(3))?.idPrefix).toBe('3f9a20c1')
  })

  it('refuses to build a link the route could not resolve', () => {
    expect(() => jobLinkPath('z', JOB_ID)).toThrow()
    expect(() => jobLinkPath('l', 'not-a-uuid')).toThrow()
  })
})

describe('resolveJobLink', () => {
  const code = parseJobLinkCode('l3f9a20c1')!

  beforeEach(() => {
    vi.mocked(prisma.employerJob.findFirst).mockReset()
    vi.mocked(prisma.job.findFirst).mockReset()
  })

  it('returns null when no employer post has that prefix', async () => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null)
    expect(await resolveJobLink(code, BASE, NOW)).toBeNull()
    expect(prisma.job.findFirst).not.toHaveBeenCalled()
  })

  it('sends a live post to its job page under the kit campaign', async () => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ jobId: JOB_ID } as never)
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ slug: 'family-np-3f9a20c1', employer: 'Example Clinic, LLC' } as never)

    const resolved = await resolveJobLink(code, `${BASE}/`, NOW)
    expect(resolved).toEqual({
      destination: `${BASE}/jobs/family-np-3f9a20c1`,
      destinationPath: '/jobs/family-np-3f9a20c1',
      platform: 'linkedin',
      campaign: JOB_LINKS_CAMPAIGN,
      content: 'example-clinic-llc',
      jobId: parseInt('3f9a20c', 16),
    })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(vi.mocked(prisma.employerJob.findFirst).mock.calls[0][0]?.where).toEqual({ jobId: { startsWith: '3f9a20c1' } })
  })

  it('asks for the job with the live rule the site uses', async () => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ jobId: JOB_ID } as never)
    vi.mocked(prisma.job.findFirst).mockResolvedValue(null)
    await resolveJobLink(code, BASE, NOW)
    expect(vi.mocked(prisma.job.findFirst).mock.calls[0][0]?.where).toEqual({
      AND: [activeIndexableJobWhere(NOW), { id: JOB_ID }],
    })
  })

  it('sends a post that is no longer live to /jobs and still counts the click', async () => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ jobId: JOB_ID } as never)
    vi.mocked(prisma.job.findFirst).mockResolvedValue(null)

    const resolved = await resolveJobLink(code, BASE, NOW)
    expect(resolved).toMatchObject({ destination: `${BASE}/jobs`, content: 'closed', jobId: 0, platform: 'linkedin' })
  })
})
