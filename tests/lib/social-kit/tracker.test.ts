import { describe, it, expect } from 'vitest'
import {
  groupPostLogs,
  isRecent,
  isSocialPlatform,
  NEW_POST_LOG,
  postedAgoLabel,
  SOCIAL_PLATFORMS,
  trackerKey,
  type PostLogEntry,
} from '@/lib/social-kit/tracker'
import { PLATFORM_LABEL, PLATFORM_LETTER, VENUE_HINT } from '@/lib/social-kit/platforms'

const JOB = '3f9a20c1-0000-4000-8000-000000000001'

function log(overrides: Partial<PostLogEntry>): PostLogEntry {
  return { id: 'log1', jobId: JOB, platform: 'linkedin', venue: null, postUrl: null, postedAt: '2026-10-20T15:00:00.000Z', ...overrides }
}

describe('NEW_POST_LOG', () => {
  it('turns blank optional fields into null and trims the rest', () => {
    expect(NEW_POST_LOG.parse({ jobId: JOB, platform: 'reddit', venue: '  r/nursepractitioner ', postUrl: '' })).toEqual({
      jobId: JOB,
      platform: 'reddit',
      venue: 'r/nursepractitioner',
      postUrl: null,
    })
    expect(NEW_POST_LOG.parse({ jobId: JOB, platform: 'x' })).toMatchObject({ venue: null, postUrl: null })
  })

  it('keeps a web link to the post', () => {
    const parsed = NEW_POST_LOG.parse({ jobId: JOB, platform: 'linkedin', postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1' })
    expect(parsed.postUrl).toBe('https://www.linkedin.com/feed/update/urn:li:activity:1')
  })

  it.each([
    ['a non-web link', { postUrl: 'javascript:alert(1)' }],
    ['a data link', { postUrl: 'data:text/html,hi' }],
    ['an unknown platform', { platform: 'tiktok' }],
    ['a job id with characters no id has', { jobId: "abc' OR 1=1" }],
    ['an overlong venue', { venue: 'x'.repeat(121) }],
    ['an overlong post link', { postUrl: `https://example.com/${'x'.repeat(500)}` }],
  ])('rejects %s', (_label, overrides) => {
    expect(NEW_POST_LOG.safeParse({ jobId: JOB, platform: 'linkedin', ...overrides }).success).toBe(false)
  })
})

describe('platforms', () => {
  it('gives every platform a letter, a name and a venue hint', () => {
    for (const platform of SOCIAL_PLATFORMS) {
      expect(PLATFORM_LETTER[platform]).toMatch(/^[a-z]$/)
      expect(PLATFORM_LABEL[platform].length).toBeGreaterThan(0)
      expect(VENUE_HINT[platform].length).toBeGreaterThan(0)
    }
    expect(new Set(Object.values(PLATFORM_LETTER)).size).toBe(SOCIAL_PLATFORMS.length)
  })

  it('knows its own platforms and nothing else', () => {
    expect(SOCIAL_PLATFORMS.every(isSocialPlatform)).toBe(true)
    expect(isSocialPlatform('myspace')).toBe(false)
  })
})

describe('groupPostLogs', () => {
  it('groups by job and platform, newest first', () => {
    const groups = groupPostLogs([
      log({ id: 'old', postedAt: '2026-10-01T10:00:00.000Z' }),
      log({ id: 'fb', platform: 'facebook' }),
      log({ id: 'new', postedAt: '2026-10-22T10:00:00.000Z' }),
    ])
    expect(groups.get(trackerKey(JOB, 'linkedin'))?.map((l) => l.id)).toEqual(['new', 'old'])
    expect(groups.get(trackerKey(JOB, 'facebook'))?.map((l) => l.id)).toEqual(['fb'])
    expect(groups.get(trackerKey(JOB, 'reddit'))).toBeUndefined()
  })

  it('leaves the input as it was', () => {
    const input = [log({ id: 'a', postedAt: '2026-10-01T10:00:00.000Z' }), log({ id: 'b', postedAt: '2026-10-22T10:00:00.000Z' })]
    groupPostLogs(input)
    expect(input.map((l) => l.id)).toEqual(['a', 'b'])
  })
})

describe('recency', () => {
  const now = new Date('2026-10-23T18:00:00.000Z') // 1 PM Central

  it('counts the last 7 days as recent', () => {
    expect(isRecent('2026-10-16T18:00:01.000Z', now)).toBe(true)
    expect(isRecent('2026-10-16T17:59:59.000Z', now)).toBe(false)
    expect(isRecent(undefined, now)).toBe(false)
  })

  it('labels by Central calendar day', () => {
    expect(postedAgoLabel('2026-10-23T06:00:00.000Z', now)).toBe('Today') // 1 AM Central
    expect(postedAgoLabel('2026-10-23T04:00:00.000Z', now)).toBe('Yesterday') // 11 PM Central the day before
    expect(postedAgoLabel('2026-10-20T18:00:00.000Z', now)).toBe('3 days ago')
  })
})
