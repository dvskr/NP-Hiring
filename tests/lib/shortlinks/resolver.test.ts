import { describe, it, expect } from 'vitest'
import { resolveShortlink } from '@/lib/shortlinks/resolver'
import { ACTIVE_CAMPAIGN, BOARD_CAMPAIGN, JOB_LINKS_CAMPAIGN, PLATFORM_BY_LETTER } from '@/lib/shortlinks/campaigns'
import type { ShortlinkCampaign } from '@/lib/shortlinks/types'
import { readCode } from '../../helpers/source'

const BASE = 'https://board.example'

/** A catalog with numbered job codes, for the paths this board's own catalog does not use yet. */
const NUMBERED: ShortlinkCampaign = {
  campaign: 'numbered-test-campaign',
  jobs: [
    { id: 1, slug: 'family-np-example-1', content: 'example-one' },
    { id: 2, slug: 'acute-np-example-2', content: 'example-two' },
    { id: 3, slug: 'peds-np-example-3', content: 'example-three' },
  ],
}

describe('resolveShortlink — invalid input', () => {
  it.each([
    ['empty', ''],
    ['too long', 'aaaaaaaaaa'],
    ['no digits', 'fff'],
    ['leading digit', '3f'],
    ['letter only', 'f'],
    ['punctuation', 'f-3'],
    ['spaces', ' f3'],
    ['null-ish string', 'null'],
    ['negative not allowed (pattern excludes minus)', '-1'],
  ])('rejects %s → %j', (_label, code) => {
    expect(resolveShortlink(code, BASE)).toBeNull()
  })

  it('rejects unknown platform letters', () => {
    expect(resolveShortlink('z3', BASE)).toBeNull()
    expect(resolveShortlink('q1', BASE)).toBeNull()
  })

  it('rejects unknown job numbers', () => {
    expect(resolveShortlink('f99', BASE)).toBeNull()
    expect(resolveShortlink('i999', BASE)).toBeNull()
    expect(resolveShortlink('f4', BASE, NUMBERED)).toBeNull()
  })

  it('handles non-string input defensively', () => {
    // Real route handlers receive strings from zod, but defensive
    // call sites in tests / scripts may not.
    expect(resolveShortlink(null as unknown as string, BASE)).toBeNull()
    expect(resolveShortlink(undefined as unknown as string, BASE)).toBeNull()
    expect(resolveShortlink(42 as unknown as string, BASE)).toBeNull()
  })
})

describe('resolveShortlink — browse-all (id=0)', () => {
  it('resolves to /jobs with browse-all content for every social platform', () => {
    for (const [letter, source] of Object.entries(PLATFORM_BY_LETTER)) {
      // Program-director ('p') is intentionally not browse-all — it
      // always lands on /for-programs regardless of id. See the
      // dedicated PD-letter describe block below.
      if (letter === 'p') continue
      const r = resolveShortlink(`${letter}0`, BASE)
      expect(r, `code ${letter}0`).not.toBeNull()
      expect(r!.destinationPath).toBe('/jobs')
      expect(r!.destination).toBe(`${BASE}/jobs`)
      expect(r!.platform).toBe(source)
      expect(r!.content).toBe('browse-all')
      expect(r!.jobId).toBe(0)
    }
  })
})

describe('resolveShortlink — program-director ("p" letter)', () => {
  it('always lands on /for-programs regardless of id', () => {
    for (const id of [0, 1, 5, 99]) {
      const r = resolveShortlink(`p${id}`, BASE)
      expect(r, `code p${id}`).not.toBeNull()
      expect(r!.destinationPath).toBe('/for-programs')
      expect(r!.destination).toBe(`${BASE}/for-programs`)
      expect(r!.platform).toBe('program-director')
      expect(r!.content).toBe('pd-landing')
      expect(r!.jobId).toBe(id)
    }
  })

  it('does not consult the campaign job list for the destination', () => {
    // Even with a custom campaign that has different jobs, /p<id> still
    // routes to /for-programs — the PD motion is education, not
    // job-discovery.
    const customCampaign: ShortlinkCampaign = {
      campaign: 'pd-test-campaign',
      jobs: [{ id: 7, slug: 'irrelevant', content: 'whatever' }],
    }
    const r = resolveShortlink('p7', BASE, customCampaign)
    expect(r!.destinationPath).toBe('/for-programs')
    expect(r!.content).toBe('pd-landing')
    expect(r!.campaign).toBe('pd-test-campaign')
  })
})

describe("this board's catalog", () => {
  it("is the active campaign, with no numbered job codes and none of another board's jobs", () => {
    expect(ACTIVE_CAMPAIGN).toBe(BOARD_CAMPAIGN)
    expect(ACTIVE_CAMPAIGN.jobs).toEqual([])
    expect(ACTIVE_CAMPAIGN.campaign).not.toBe(JOB_LINKS_CAMPAIGN)
    // The campaigns file carries no job slugs or employer labels of its own.
    const source = readCode('lib/shortlinks/campaigns.ts')
    expect(source).not.toMatch(/slug:\s*'/)
    expect(source).not.toMatch(/pmhnp|psychiatr/i)
  })

  it('sends a numbered code nobody ships, such as the old /r/f1 to /r/f14, nowhere: the route falls back to /jobs', () => {
    for (let id = 1; id <= 14; id += 1) {
      for (const letter of ['f', 'i', 'l', 'x', 'r', 't', 'n']) {
        expect(resolveShortlink(`${letter}${id}`, BASE), `code ${letter}${id}`).toBeNull()
      }
    }
  })

  it('still serves browse-all and the program director landing', () => {
    expect(resolveShortlink('f0', BASE)!.destinationPath).toBe('/jobs')
    expect(resolveShortlink('f0', BASE)!.campaign).toBe(BOARD_CAMPAIGN.campaign)
    expect(resolveShortlink('p3', BASE)!.destinationPath).toBe('/for-programs')
  })
})

describe('resolveShortlink: a catalog with numbered job codes', () => {
  it('produces a bare /jobs/<slug> destination with no query params', () => {
    const r = resolveShortlink('i1', BASE, NUMBERED)
    expect(r).not.toBeNull()
    const parsed = new URL(r!.destination)
    expect(parsed.pathname).toBe(`/jobs/${NUMBERED.jobs[0].slug}`)
    expect(parsed.search).toBe('')
    expect(r!.destinationPath).toBe(`/jobs/${NUMBERED.jobs[0].slug}`)
    expect(r!.platform).toBe('instagram')
    expect(r!.content).toBe(NUMBERED.jobs[0].content)
    expect(r!.jobId).toBe(1)
    expect(r!.campaign).toBe(NUMBERED.campaign)
  })

  it('maps each platform letter to the documented source', () => {
    for (const [letter, source] of Object.entries(PLATFORM_BY_LETTER)) {
      const r = resolveShortlink(`${letter}1`, BASE, NUMBERED)
      expect(r, `code ${letter}1`).not.toBeNull()
      expect(r!.platform).toBe(source)
    }
  })

  it('is case-insensitive on the platform letter', () => {
    const lower = resolveShortlink('f3', BASE, NUMBERED)
    const upper = resolveShortlink('F3', BASE, NUMBERED)
    expect(lower).not.toBeNull()
    expect(upper).toEqual(lower)
  })

  it('produces a distinct destination for every job code', () => {
    const seen = new Set<string>()
    for (const job of NUMBERED.jobs) {
      const r = resolveShortlink(`f${job.id}`, BASE, NUMBERED)
      expect(r, `code f${job.id}`).not.toBeNull()
      expect(seen.has(r!.destination), `duplicate for ${job.content}`).toBe(false)
      seen.add(r!.destination)
    }
    expect(seen.size).toBe(NUMBERED.jobs.length)
  })

  it('returns a frozen object so callers cannot mutate shared state', () => {
    expect(Object.isFrozen(resolveShortlink('f1', BASE, NUMBERED)!)).toBe(true)
    expect(Object.isFrozen(resolveShortlink('f0', BASE)!)).toBe(true)
  })

  it('trims a trailing slash on baseUrl', () => {
    const r1 = resolveShortlink('f1', 'https://example.com', NUMBERED)
    const r2 = resolveShortlink('f1', 'https://example.com/', NUMBERED)
    expect(r1!.destination).toBe(r2!.destination)
  })
})

describe('resolveShortlink — custom campaign', () => {
  const custom: ShortlinkCampaign = {
    campaign: 'test-campaign-2030',
    jobs: [{ id: 1, slug: 'fake-slug-abc', content: 'fake-content' }],
  }

  it('uses the passed campaign instead of the active default', () => {
    const r = resolveShortlink('l1', BASE, custom)
    expect(r).not.toBeNull()
    expect(r!.campaign).toBe('test-campaign-2030')
    expect(r!.destinationPath).toBe('/jobs/fake-slug-abc')
    expect(r!.content).toBe('fake-content')
  })

  it('still supports browse-all on a custom campaign', () => {
    const r = resolveShortlink('f0', BASE, custom)
    expect(r).not.toBeNull()
    expect(r!.content).toBe('browse-all')
    expect(r!.campaign).toBe('test-campaign-2030')
  })
})
