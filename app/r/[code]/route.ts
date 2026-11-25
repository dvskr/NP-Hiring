import { brand } from '@/config/brand'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { runAfterResponse } from '@/lib/after-response'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  identifyBot,
  parseJobLinkCode,
  recordClick,
  resolveJobLink,
  resolveShortlink,
} from '@/lib/shortlinks'
import type { JobLinkCode, ShortlinkResolution } from '@/lib/shortlinks'

/**
 * Social-campaign short-link redirect.
 *
 *   /r/l0   → linkedin click on the "browse all" landing
 *   /r/p2   → program director outreach, to /for-programs
 *   /r/f3   → facebook click on catalog job #3 (lib/shortlinks/campaigns.ts;
 *             this board's catalog lists none, so it goes to /jobs)
 *   /r/l3f9a20c1 → linkedin click on the employer post whose job id starts
 *                  3f9a20c1 (the admin social kit's per-job links)
 *
 * Pipeline per request:
 *   1. Validate code shape (zod) — reject obvious garbage with a 302 to /jobs
 *      so a typo never strands a user but also never enters the tracker.
 *   2. Rate-limit by IP. /r/ is a cheap 302 by design, but it's still an
 *      open endpoint and shouldn't be a free proxy.
 *   3. Resolve code → destination: in memory for catalog codes, one small
 *      employer_jobs lookup for per-job codes.
 *   4. Skip HEAD probes and honor privacy signals (DNT / GPC / pmhnp_privacy_signal cookie):
 *      redirect but do NOT log.
 *   5. Classify bot — record with is_bot=true; do not dedup or rate-limit
 *      preview-fetch traffic separately (preview fetches are 1/share).
 *   6. Tracker write scheduled with runAfterResponse, so DB latency never
 *      blocks the redirect and the function is not frozen before it lands.
 *   7. 302 to the bare destination. The redirect itself sets X-Robots-Tag
 *      and Cache-Control so /r/ paths don't leak into search indexes.
 */

const PARAMS_SCHEMA = z.object({
  code: z
    .string()
    .min(1)
    .max(9)
    // <letter><1 to 4 digits> for the catalog campaigns, <letter><8 hex> for
    // the per-job links the admin social kit writes (lib/shortlinks/job-links.ts).
    .regex(/^[A-Za-z](?:[0-9]{1,4}|[0-9A-Fa-f]{8})$/, 'code must be <letter><digits> or <letter><8 hex>'),
})

// Per-recipient attribution token. UUIDs (36 chars), cuids (~25 chars),
// and short hashed ids all fit comfortably under 64. Restrict to
// alphanumeric+hyphen so we never write something injected-looking into
// the analytics column, even though Prisma parameterizes the value.
const RECIPIENT_LEAD_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/

const FALLBACK_PATH = '/jobs'

function buildBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || brand.baseUrl
  )
}

function withRedirectHeaders(res: NextResponse): NextResponse {
  // Short links are not indexable and should never be cached by an
  // intermediate CDN — every hit must reach the handler so the tracker
  // sees it.
  res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  res.headers.set('Cache-Control', 'private, no-store, max-age=0')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return res
}

function clientIpOf(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return null
}

function extractRecipientLeadId(req: NextRequest): string | null {
  const raw = req.nextUrl.searchParams.get('r')
  if (!raw) return null
  // Silently drop malformed values rather than 400ing — the redirect
  // path must never strand the user over a tracking parameter.
  return RECIPIENT_LEAD_ID_PATTERN.test(raw) ? raw : null
}

function isPrivacyRespectingRequest(req: NextRequest): boolean {
  if (req.headers.get('sec-gpc') === '1') return true
  if (req.headers.get('dnt') === '1') return true
  const signal = req.cookies.get('pmhnp_privacy_signal')?.value
  return signal === 'gpc' || signal === 'dnt'
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const baseUrl = buildBaseUrl()

  // ── 1. Validate code shape ────────────────────────────────────────
  const raw = await params
  const parsed = PARAMS_SCHEMA.safeParse(raw)
  if (!parsed.success) {
    logger.warn('[shortlink] rejected malformed code', { code: raw.code })
    return withRedirectHeaders(
      NextResponse.redirect(`${baseUrl}${FALLBACK_PATH}`, 302),
    )
  }
  const code = parsed.data.code.toLowerCase()

  // ── 2. Rate limit ─────────────────────────────────────────────────
  const limited = await rateLimit(req, 'shortlink-redirect', RATE_LIMITS.shortlinkRedirect)
  if (limited) return limited

  // ── 3. Resolve ────────────────────────────────────────────────────
  // Catalog codes resolve in memory. Per-job codes need one small lookup,
  // done after the rate limit so the endpoint cannot be used to hammer it.
  const jobCode = parseJobLinkCode(code)
  const resolved = jobCode
    ? await resolveJobLinkSafely(jobCode, baseUrl, code)
    : resolveShortlink(code, baseUrl)
  if (!resolved) {
    logger.warn('[shortlink] unresolved code', { code })
    return withRedirectHeaders(
      NextResponse.redirect(`${baseUrl}${FALLBACK_PATH}`, 302),
    )
  }

  // ── 4. HEAD probes and privacy signals: redirect without logging ──
  // Next.js answers HEAD with this GET handler. Nobody reads a page with
  // HEAD: it is link checkers and scanners testing the URL, and recording
  // them would count a click nobody made.
  if (req.method === 'HEAD') {
    return withRedirectHeaders(NextResponse.redirect(resolved.destination, 302))
  }
  if (isPrivacyRespectingRequest(req)) {
    logger.debug('[shortlink] privacy signal — skipping tracker', {
      code,
      campaign: resolved.campaign,
    })
    return withRedirectHeaders(NextResponse.redirect(resolved.destination, 302))
  }

  // ── 5. Bot classification ─────────────────────────────────────────
  const userAgent = req.headers.get('user-agent')
  const referer = req.headers.get('referer')
  const country =
    req.headers.get('x-vercel-ip-country') ||
    req.headers.get('cf-ipcountry') ||
    null
  const bot = identifyBot(userAgent)

  // ── 6. Tracker write after the response ───────────────────────────
  // runAfterResponse keeps the function alive until the row lands, so the
  // click counts (the admin social kit reads them) do not lose writes to a
  // frozen function, and the redirect never waits on the database.
  const recipientLeadId = extractRecipientLeadId(req)
  runAfterResponse('shortlink click write', () =>
    recordClick({
      resolution: resolved,
      code,
      bot,
      ip: clientIpOf(req),
      userAgent,
      referer,
      country,
      recipientLeadId,
    }),
  )

  logger.info('[shortlink] click', {
    code,
    platform: resolved.platform,
    campaign: resolved.campaign,
    content: resolved.content,
    jobId: resolved.jobId,
    isBot: bot.isBot,
    botName: bot.botName,
    hasRecipient: recipientLeadId !== null,
  })

  // ── 7. Redirect ───────────────────────────────────────────────────
  return withRedirectHeaders(NextResponse.redirect(resolved.destination, 302))
}

/**
 * A database error must not strand the person who clicked: treat it as an
 * unknown code, which sends them to /jobs. The error is logged with its
 * stack, so the failure is never silent.
 */
async function resolveJobLinkSafely(
  jobCode: JobLinkCode,
  baseUrl: string,
  code: string,
): Promise<ShortlinkResolution | null> {
  try {
    return await resolveJobLink(jobCode, baseUrl)
  } catch (error) {
    logger.error('[shortlink] job link lookup failed', error, { code })
    return null
  }
}
