/**
 * /api/admin/social-kit/posts
 *
 * The social kit's posting tracker (/admin/social-kit): log that a job was
 * posted on a platform, or remove a log entry added by mistake.
 *
 *   POST   { jobId, platform, venue?, postUrl? }  -> 201 { success, data: PostLogEntry }
 *   DELETE ?id=<log id>                          -> 200 { success, removed }
 *
 * DELETE is idempotent: an entry that is already gone answers 200 with
 * removed false, so the page drops it either way.
 *
 * Auth: requireApiAdminActor, which answers JSON 401/403/429/500 for fetch
 * callers and names the admin for the audit trail. CSRF: enforced for every
 * mutating /api route in middleware.ts, and checked here as well. Each write
 * is audit logged with ids only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireApiAdminActor } from '@/lib/auth/require-api-admin'
import { verifyCsrf } from '@/lib/csrf'
import { logAudit } from '@/lib/audit-log'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { NEW_POST_LOG, type NewPostLog, type PostLogEntry } from '@/lib/social-kit/tracker'

export const dynamic = 'force-dynamic'

const LOG_ID = z.string().regex(/^[a-z0-9]{8,40}$/i, 'Invalid log id')

function fail(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status })
}

/** The body as a NewPostLog, or the message that says what is wrong with it. */
async function readNewPostLog(req: NextRequest): Promise<{ input: NewPostLog } | { error: string }> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { error: 'Invalid JSON body' }
  }
  const parsed = NEW_POST_LOG.safeParse(body)
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => issue.message).join('; ') }
  return { input: parsed.data }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { error: authError, actor } = await requireApiAdminActor(req)
  if (authError) return authError

  const csrfError = verifyCsrf(req)
  if (csrfError) return csrfError

  const read = await readNewPostLog(req)
  if ('error' in read) return fail(read.error, 400)
  const { input } = read

  try {
    const job = await prisma.job.findUnique({ where: { id: input.jobId }, select: { id: true } })
    if (!job) return fail('That job no longer exists', 404)

    const row = await prisma.socialPostLog.create({
      data: { jobId: input.jobId, platform: input.platform, venue: input.venue, postUrl: input.postUrl },
    })
    await logAudit({
      action: 'social_kit.post_logged',
      actorType: 'admin',
      actorId: actor.profileId,
      targetType: 'job',
      targetId: input.jobId,
      metadata: { logId: row.id, platform: input.platform },
    })
    const data: PostLogEntry = {
      id: row.id,
      jobId: row.jobId,
      platform: input.platform,
      venue: row.venue,
      postUrl: row.postUrl,
      postedAt: row.postedAt.toISOString(),
    }
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (err) {
    logger.error('[social-kit] could not log a post', err, { jobId: input.jobId, platform: input.platform })
    return fail('Could not save the post log. Try again.', 500)
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { error: authError, actor } = await requireApiAdminActor(req)
  if (authError) return authError

  const csrfError = verifyCsrf(req)
  if (csrfError) return csrfError

  const parsed = LOG_ID.safeParse(req.nextUrl.searchParams.get('id') ?? '')
  if (!parsed.success) return fail('Invalid log id', 400)

  try {
    const { count } = await prisma.socialPostLog.deleteMany({ where: { id: parsed.data } })
    if (count === 0) return NextResponse.json({ success: true, removed: false })
    await logAudit({
      action: 'social_kit.post_log_removed',
      actorType: 'admin',
      actorId: actor.profileId,
      targetType: 'social_post_log',
      targetId: parsed.data,
    })
    return NextResponse.json({ success: true, removed: true })
  } catch (err) {
    logger.error('[social-kit] could not remove a post log', err, { id: parsed.data })
    return fail('Could not remove the post log. Try again.', 500)
  }
}
