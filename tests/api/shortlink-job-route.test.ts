/**
 * /r/<letter><8 hex>: the per-job links the admin social kit writes, beside
 * the catalog codes (/r/<letter><1 to 4 digits>) the route already served.
 *
 * Pins:
 *  - a job code is looked up and redirected, and the click is recorded
 *  - an unknown job, or a lookup that throws, still redirects to /jobs and
 *    records nothing; the failure is logged with the error itself
 *  - HEAD probes and privacy signals redirect without a record, so link
 *    checkers never count as people
 *  - catalog codes keep their in-memory path with no lookup, and a numbered
 *    code this board never shipped falls through to /jobs unrecorded
 *  - a code longer than either shape is refused
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { shortlinkRedirect: {} },
}))

vi.mock('@/lib/shortlinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shortlinks')>()
  return { ...actual, recordClick: vi.fn().mockResolvedValue(undefined), resolveJobLink: vi.fn() }
})

import { GET } from '@/app/r/[code]/route'
import { logger } from '@/lib/logger'
import { recordClick, resolveJobLink, JOB_LINKS_CAMPAIGN } from '@/lib/shortlinks'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

function call(code: string, { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {}) {
  const req = new NextRequest(`https://board.example/r/${code}`, {
    method,
    headers: { 'user-agent': BROWSER_UA, ...headers },
  })
  return GET(req, { params: Promise.resolve({ code }) })
}

const LIVE = Object.freeze({
  destination: 'https://board.example/jobs/family-np-3f9a20c1',
  destinationPath: '/jobs/family-np-3f9a20c1',
  platform: 'linkedin',
  campaign: JOB_LINKS_CAMPAIGN,
  content: 'example-clinic',
  jobId: 1,
})

const pathOf = (res: Response): string => new URL(res.headers.get('location')!).pathname

describe('/r/<letter><8 hex> per-job links from the social kit', () => {
  beforeEach(() => {
    vi.mocked(recordClick).mockClear()
    vi.mocked(resolveJobLink).mockReset()
  })

  it('redirects to the job and records the click', async () => {
    vi.mocked(resolveJobLink).mockResolvedValue(LIVE)
    const res = await call('L3F9A20C1')

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(LIVE.destination)
    expect(res.headers.get('x-robots-tag')).toContain('noindex')
    expect(vi.mocked(resolveJobLink).mock.calls[0][0]).toEqual({ letter: 'l', platform: 'linkedin', idPrefix: '3f9a20c1' })
    expect(recordClick).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordClick).mock.calls[0][0]).toMatchObject({ code: 'l3f9a20c1', resolution: LIVE })
  })

  it('sends an unknown job to /jobs without recording it', async () => {
    vi.mocked(resolveJobLink).mockResolvedValue(null)
    const res = await call('f00000000')
    expect(pathOf(res)).toBe('/jobs')
    expect(recordClick).not.toHaveBeenCalled()
  })

  it('still redirects when the lookup fails, and logs the failure', async () => {
    const failure = new Error('db down')
    vi.mocked(resolveJobLink).mockRejectedValue(failure)
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const res = await call('x3f9a20c1')
    // The Error itself goes in the error slot, so the report keeps the stack.
    expect(logged).toHaveBeenCalledWith('[shortlink] job link lookup failed', failure, { code: 'x3f9a20c1' })
    logged.mockRestore()
    expect(res.status).toBe(302)
    expect(pathOf(res)).toBe('/jobs')
    expect(recordClick).not.toHaveBeenCalled()
  })

  it('does not record HEAD probes or privacy-signal visits', async () => {
    vi.mocked(resolveJobLink).mockResolvedValue(LIVE)
    const probes = [
      await call('l3f9a20c1', { method: 'HEAD' }),
      await call('l3f9a20c1', { headers: { 'sec-gpc': '1' } }),
      await call('l3f9a20c1', { headers: { dnt: '1' } }),
    ]
    for (const res of probes) {
      expect(res.headers.get('location')).toBe(LIVE.destination)
    }
    expect(recordClick).not.toHaveBeenCalled()
  })

  it('records a link preview fetch as a bot, so the kit leaves it out of human clicks', async () => {
    vi.mocked(resolveJobLink).mockResolvedValue(LIVE)
    await call('l3f9a20c1', { headers: { 'user-agent': 'LinkedInBot/1.0 (compatible; Mozilla/5.0)' } })
    expect(vi.mocked(recordClick).mock.calls[0][0]).toMatchObject({ bot: { isBot: true, botName: 'linkedinbot' } })
  })

  it('leaves catalog codes on their in-memory path, with no lookup', async () => {
    const res = await call('f0')
    expect(res.status).toBe(302)
    expect(pathOf(res)).toBe('/jobs')
    expect(resolveJobLink).not.toHaveBeenCalled()
    expect(recordClick).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordClick).mock.calls[0][0]).toMatchObject({ code: 'f0', resolution: { platform: 'facebook', content: 'browse-all' } })
  })

  it('sends a numbered catalog code this board never shipped (the old /r/f1 to /r/f14) to /jobs, like any unknown code', async () => {
    for (const code of ['f1', 'f3', 'f12', 'f14', 'i7']) {
      const res = await call(code)
      expect(res.status, code).toBe(302)
      expect(pathOf(res), code).toBe('/jobs')
    }
    expect(resolveJobLink).not.toHaveBeenCalled()
    expect(recordClick).not.toHaveBeenCalled()
  })

  it('reads 8 digits as a job code, never as a catalog number', async () => {
    vi.mocked(resolveJobLink).mockResolvedValue(null)
    await call('f12345678')
    expect(vi.mocked(resolveJobLink).mock.calls[0][0]).toEqual({ letter: 'f', platform: 'facebook', idPrefix: '12345678' })
  })

  it('rejects a code longer than either shape', async () => {
    const res = await call('l3f9a20c1f')
    expect(pathOf(res)).toBe('/jobs')
    expect(resolveJobLink).not.toHaveBeenCalled()
    expect(recordClick).not.toHaveBeenCalled()
  })
})
