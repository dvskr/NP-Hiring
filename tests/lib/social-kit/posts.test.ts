/**
 * lib/social-kit/posts.ts: the ready-to-paste posts for one live paid job.
 *
 * Pins the rules a post must keep, whatever the job:
 *  - one post per platform, each carrying its own tracked /r/ link
 *  - the facts say what the job page says (work mode, schedule, pay), and an
 *    estimated figure is never quoted
 *  - no en or em dash anywhere, and no emoji
 *  - every part within its platform cap, X counted the way X counts
 *  - the copy speaks as the board, from config/brand.ts, and the Reddit and
 *    forum posts say plainly that the board posted them
 */
import { describe, it, expect } from 'vitest'
import { brand } from '@/config/brand'
import { resolveWorkModeLabel } from '@/app/jobs/[slug]/job-posting-facts'
import {
  buildSocialKitEntry,
  DISCLOSURE,
  LINKEDIN_POST_LIMIT,
  REDDIT_TITLE_LIMIT,
  X_POST_LIMIT,
  xWeightedLength,
} from '@/lib/social-kit/posts'
import { PLATFORM_LETTER } from '@/lib/social-kit/platforms'
import type { SocialKitJob } from '@/lib/social-kit/types'

const BASE = 'https://board.example'
const NOW = new Date('2026-11-25T15:00:00Z')

function job(overrides: Partial<SocialKitJob> = {}): SocialKitJob {
  return {
    id: '3f9a20c1-0000-4000-8000-000000000001',
    slug: 'family-np-3f9a20c1-0000-4000-8000-000000000001',
    title: 'Family Nurse Practitioner \u{2013} Primary Care',
    employer: 'Example Family Health',
    location: 'Denver, Colorado',
    city: 'Denver',
    state: 'Colorado',
    stateCode: 'CO',
    country: 'US',
    isRemote: false,
    isHybrid: true,
    mode: 'Hybrid',
    jobType: 'Full-Time',
    salaryPeriod: 'annual',
    minSalary: 140000,
    maxSalary: 160000,
    salaryIsEstimated: false,
    salaryConfidence: null,
    experienceLabel: '1 to 2 yrs · new grads welcome',
    minYearsExperience: 1,
    maxYearsExperience: 2,
    newGradFriendly: true,
    setting: 'Outpatient',
    population: 'Adults',
    benefits: ['Health Insurance', 'PTO / Vacation'],
    description:
      '<p><strong>About Us</strong></p><p>We care for families across the city \u{2014} two clinics.</p>' +
      '<p><strong>Requirements</strong></p><ul><li>Colorado APRN license</li><li>DEA, Schedules II\u{2013}V</li></ul>',
    createdAt: new Date('2026-11-24T19:00:00Z'),
    expiresAt: new Date('2027-01-23T19:00:00Z'),
    companyWebsite: 'https://example.test',
    ...overrides,
  }
}

type Entry = ReturnType<typeof buildSocialKitEntry>

function allText(entry: Entry): string {
  return entry.posts.flatMap((p) => p.parts.map((part) => part.text)).join('\n')
}

function partsOf(entry: Entry, platform: string) {
  return entry.posts.find((p) => p.platform === platform)!.parts
}

const location = (entry: Entry): string | undefined => entry.facts.find((f) => f.label === 'Location')?.value

describe('buildSocialKitEntry', () => {
  const entry = buildSocialKitEntry(job(), BASE, NOW)

  it('builds one post per platform, each with its own tracked short link', () => {
    expect(entry.posts.map((p) => p.platform)).toEqual(['linkedin', 'facebook', 'reddit', 'x', 'forum'])
    for (const post of entry.posts) {
      expect(post.link).toBe(`${BASE}/r/${PLATFORM_LETTER[post.platform]}3f9a20c1`)
      expect(post.code).toBe(`${PLATFORM_LETTER[post.platform]}3f9a20c1`)
      expect(post.parts.some((part) => part.text.includes(post.link))).toBe(true)
    }
  })

  it('states the facts the job page shows', () => {
    expect(entry.facts).toEqual([
      { label: 'Location', value: 'Hybrid, Denver, CO' },
      { label: 'Schedule', value: 'Full-Time' },
      { label: 'Pay', value: '$140k to $160k/yr' },
      { label: 'Experience', value: '1 to 2 years, new grads welcome' },
      { label: 'Setting', value: 'Outpatient' },
      { label: 'Patients', value: 'Adults' },
      { label: 'Benefits', value: 'Health Insurance, PTO / Vacation' },
    ])
  })

  it('carries the full description on Facebook and forums', () => {
    for (const platform of ['facebook', 'forum'] as const) {
      const text = partsOf(entry, platform).map((p) => p.text).join('\n')
      expect(text).toContain('We care for families across the city, two clinics.')
      expect(text).toContain('• DEA, Schedules II to V')
    }
  })

  it('has no en or em dash, and no emoji, anywhere in any post', () => {
    expect(allText(entry)).not.toMatch(/[\u{2013}\u{2014}]/u)
    expect(entry.descriptionText).not.toMatch(/[\u{2013}\u{2014}]/u)
    expect(entry.facts.map((f) => f.value).join(' ')).not.toMatch(/[\u{2013}\u{2014}]/u)
    expect(allText(entry)).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('formats Reddit as a title plus Markdown with the link and the disclosure', () => {
    const [title, body] = partsOf(entry, 'reddit')
    expect(title.text).toBe('[Hiring] Family Nurse Practitioner, Primary Care | Example Family Health | Hybrid, Denver, CO | $140k to $160k/yr')
    expect(body.text).toContain('* **Pay:** $140k to $160k/yr')
    expect(body.text).toContain('**Requirements**')
    expect(body.text).toContain(`**Apply:** ${BASE}/r/r3f9a20c1`)
    expect(body.text).toContain(`*${DISCLOSURE}*`)
  })

  it('says plainly on Reddit and forums that the board posted it', () => {
    expect(DISCLOSURE).toContain(`Posted by ${brand.name}`)
    expect(DISCLOSURE).toContain('job board')
    expect(partsOf(entry, 'forum')[1].text).toContain(DISCLOSURE)
  })

  it('tags posts from the brand config, with the job state', () => {
    const linkedin = partsOf(entry, 'linkedin')[0].text
    const roleTag = `#${brand.niche.long.replace(/[^A-Za-z0-9]/g, '')}`
    expect(linkedin).toContain(roleTag)
    expect(linkedin).toContain(`#${brand.niche.short}Jobs`)
    expect(linkedin).toContain('#ColoradoJobs')
  })

  it('flags a post as new for 48 hours', () => {
    expect(entry.isNew).toBe(true)
    expect(buildSocialKitEntry(job({ createdAt: new Date('2026-11-20T00:00:00Z') }), BASE, NOW).isNew).toBe(false)
  })

  it('leaves pay out when the figure is an estimate, not the employer\'s', () => {
    for (const estimated of [job({ salaryIsEstimated: true }), job({ salaryConfidence: 0.2 })]) {
      const built = buildSocialKitEntry(estimated, BASE, NOW)
      expect(built.facts.some((f) => f.label === 'Pay')).toBe(false)
      expect(allText(built)).not.toContain('$140k')
    }
  })
})

describe('work mode agrees with the job page', () => {
  const variants: Array<[string, Partial<SocialKitJob>]> = [
    ['hybrid', {}],
    ['in person', { isHybrid: false, mode: 'In-Person' }],
    ['remote by mode only, flags never set', { isHybrid: false, isRemote: false, mode: 'Remote' }],
    ['verified remote', {
      isHybrid: false, isRemote: true, mode: 'Remote', location: 'Remote', city: null, state: null, stateCode: null,
      description: '<p>See patients by video.</p>',
    }],
    ['no mode at all', { isHybrid: false, mode: null }],
  ]

  it.each(variants)('%s: the location says the mode only when the page shows it', (_label, overrides) => {
    const row = job(overrides)
    const shown = resolveWorkModeLabel(row)
    const where = location(buildSocialKitEntry(row, BASE, NOW)) ?? ''
    if (shown === 'Remote' || shown === 'Hybrid') expect(where.startsWith(shown)).toBe(true)
    if (shown !== 'Remote') expect(where).not.toMatch(/\bRemote\b/)
    if (shown !== 'Hybrid') expect(where).not.toMatch(/\bHybrid\b/)
  })

  it('reads an in-person job as its place', () => {
    expect(location(buildSocialKitEntry(job({ isHybrid: false, mode: 'In-Person' }), BASE, NOW))).toBe('Denver, CO')
  })

  it('never calls a job remote on a mode the page does not trust', () => {
    // The employer chose Remote but the flags were never set: the job page
    // shows no work mode, so the post names the place only.
    expect(location(buildSocialKitEntry(job({ isHybrid: false, mode: 'Remote' }), BASE, NOW))).toBe('Denver, CO')
  })
})

describe('platform limits', () => {
  const longDescription = Array.from({ length: 40 }, (_, i) =>
    `<p><strong>Section ${i + 1}</strong></p><ul><li>${'Clinical duty detail '.repeat(8)}${i}</li></ul>`,
  ).join('')
  const big = buildSocialKitEntry(
    job({
      title: 'Family Nurse Practitioner (FNP) Primary Care Hybrid Colorado and Surrounding States Opportunity With Growth',
      employer: 'Example Family Health Group dba Example Primary Care and Partners of the Front Range',
      description: longDescription,
    }),
    BASE,
    NOW,
  )

  it('keeps every part within its platform cap', () => {
    for (const post of big.posts) {
      for (const part of post.parts) {
        if (part.limit !== null) expect(part.length, `${post.platform} ${part.label}`).toBeLessThanOrEqual(part.limit)
      }
    }
  })

  it('trims LinkedIn at a section break and points to the full post', () => {
    const linkedin = big.posts.find((p) => p.platform === 'linkedin')!
    expect(linkedin.trimmed).toBe(true)
    expect(linkedin.parts[0].text.length).toBeLessThanOrEqual(LINKEDIN_POST_LIMIT)
    expect(linkedin.parts[0].text).toContain(`Read the full description and apply: ${BASE}/r/l3f9a20c1`)
  })

  it('fits X in 280 counted the way X counts, and keeps the link', () => {
    for (const part of partsOf(big, 'x')) {
      expect(xWeightedLength(part.text)).toBeLessThanOrEqual(X_POST_LIMIT)
      expect(part.text).toContain(`${BASE}/r/x3f9a20c1`)
    }
  })

  it('shortens the title and employer on X but never the location or pay', () => {
    const huge = buildSocialKitEntry(
      job({ title: 'Family Nurse Practitioner '.repeat(8), employer: 'Primary Care Partners of America '.repeat(4) }),
      BASE,
      NOW,
    )
    const post = partsOf(huge, 'x')[0]
    expect(post.length).toBeLessThanOrEqual(X_POST_LIMIT)
    expect(post.text).toMatch(/· Hybrid, Denver, CO\n\$140k to \$160k\/yr\n/)
  })

  it('caps the Reddit title even with a long employer and location', () => {
    const long = buildSocialKitEntry(job({ employer: 'Employer Name '.repeat(30) }), BASE, NOW)
    expect(partsOf(long, 'reddit')[0].length).toBeLessThanOrEqual(REDDIT_TITLE_LIMIT)
  })

  it('still builds every post when the job names no place and no mode', () => {
    const bare = buildSocialKitEntry(
      job({ isHybrid: false, mode: null, location: '', city: null, state: null, stateCode: null }),
      BASE,
      NOW,
    )
    expect(location(bare)).toBeUndefined()
    expect(partsOf(bare, 'forum')[0].text).toBe('Hiring: Family Nurse Practitioner, Primary Care')
    expect(partsOf(bare, 'x')[0].text.split('\n')[1]).toBe('Example Family Health')
  })
})

describe('xWeightedLength', () => {
  it('counts any link as 23', () => {
    expect(xWeightedLength('https://board.example/r/x3f9a20c1')).toBe(23)
    expect(xWeightedLength('Apply https://a.b')).toBe(6 + 23)
  })

  it('counts the ellipsis and bullet as 2, as X does', () => {
    expect(xWeightedLength('ab…')).toBe(4)
    expect(xWeightedLength('•')).toBe(2)
  })
})
