import { z } from 'zod'
import type { SocialPlatform } from './types'

/**
 * The posting tracker: where and when each live paid job went out on each
 * platform, logged by hand from /admin/social-kit (table social_post_logs).
 * Pure helpers here; the API route and the page share the validation.
 */

export const SOCIAL_PLATFORMS = ['linkedin', 'facebook', 'reddit', 'x', 'forum'] as const satisfies readonly SocialPlatform[]

/** A job counts as recently posted on a platform for this many days. */
export const RECENT_POST_DAYS = 7

export const VENUE_MAX_LENGTH = 120
export const POST_URL_MAX_LENGTH = 500

export interface PostLogEntry {
  readonly id: string
  readonly jobId: string
  readonly platform: SocialPlatform
  readonly venue: string | null
  readonly postUrl: string | null
  /** ISO timestamp. */
  readonly postedAt: string
}

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Body of POST /api/admin/social-kit/posts. Blank optional fields become null. */
export const NEW_POST_LOG = z.object({
  // Shape check only; the route confirms the job exists. Not z.uuid(), which
  // rejects any id that is not a strict RFC version 1 to 8 uuid.
  jobId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/, 'Invalid job id'),
  platform: z.enum(SOCIAL_PLATFORMS),
  venue: z
    .string()
    .max(VENUE_MAX_LENGTH, `Keep "where" under ${VENUE_MAX_LENGTH} characters`)
    .nullish()
    .transform(blankToNull),
  postUrl: z
    .string()
    .max(POST_URL_MAX_LENGTH, 'The post link is too long')
    .nullish()
    .transform(blankToNull)
    .refine((url) => url === null || /^https?:\/\/[^\s]+$/i.test(url), 'The post link must start with http:// or https://'),
})

export type NewPostLog = z.infer<typeof NEW_POST_LOG>

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value)
}

export function trackerKey(jobId: string, platform: SocialPlatform): string {
  return `${jobId}:${platform}`
}

/** Every log for each job and platform, newest first. */
export function groupPostLogs(logs: readonly PostLogEntry[]): ReadonlyMap<string, readonly PostLogEntry[]> {
  const buckets = new Map<string, PostLogEntry[]>()
  for (const log of logs) {
    const key = trackerKey(log.jobId, log.platform)
    buckets.set(key, [...(buckets.get(key) ?? []), log])
  }
  return new Map(
    [...buckets].map(([key, list]) => [key, [...list].sort((a, b) => b.postedAt.localeCompare(a.postedAt))]),
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Posted within the last `days` days of `now`. */
export function isRecent(postedAt: string | undefined, now: Date, days: number = RECENT_POST_DAYS): boolean {
  if (!postedAt) return false
  return now.getTime() - new Date(postedAt).getTime() < days * DAY_MS
}

/** The calendar day in Central time, the timezone the admin panel uses. */
function centralDay(date: Date): string {
  return date.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })
}

/** "Today", "Yesterday", "3 days ago", by Central calendar day. */
export function postedAgoLabel(postedAt: string, now: Date): string {
  const posted = new Date(postedAt)
  if (centralDay(posted) === centralDay(now)) return 'Today'
  if (centralDay(posted) === centralDay(new Date(now.getTime() - DAY_MS))) return 'Yesterday'
  const days = Math.max(2, Math.round((now.getTime() - posted.getTime()) / DAY_MS))
  return `${days} days ago`
}
