/**
 * /api/admin/social-kit/posts: the social kit's posting tracker.
 *
 * Locks in:
 *  - the admin gate short-circuits both methods before any database work
 *  - a cross-site request is refused before any write
 *  - invalid bodies and ids are refused without a write
 *  - a log for a job that no longer exists is a 404, not a foreign-key 500
 *  - a valid log is created, audited with ids only, and returned in the
 *    shape the page renders
 *  - removing a log is idempotent, and a database failure says so
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const db = vi.hoisted(() => ({
  job: { findUnique: vi.fn() },
  socialPostLog: { create: vi.fn(), deleteMany: vi.fn() },
}))
const requireApiAdminActor = vi.hoisted(() => vi.fn())
const logAudit = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdminActor }))
vi.mock('@/lib/audit-log', () => ({ logAudit }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { DELETE, POST } from '@/app/api/admin/social-kit/posts/route'

const JOB = '3f9a20c1-0000-4000-8000-000000000001'
const URL_BASE = 'https://board.example/api/admin/social-kit/posts'
const ADMIN = { profileId: 'admin-profile-1', supabaseId: 'admin-auth-1' }

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function del(id: string): NextRequest {
  return new NextRequest(`${URL_BASE}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireApiAdminActor.mockResolvedValue({ error: null, actor: ADMIN })
  logAudit.mockResolvedValue(undefined)
})

describe('POST /api/admin/social-kit/posts', () => {
  it('refuses non-admins before touching the database', async () => {
    requireApiAdminActor.mockResolvedValue({ error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }), actor: null })
    const res = await POST(post({ jobId: JOB, platform: 'linkedin' }))
    expect(res.status).toBe(403)
    expect(db.job.findUnique).not.toHaveBeenCalled()
    expect(db.socialPostLog.create).not.toHaveBeenCalled()
  })

  it('refuses a cross-site request before any write', async () => {
    const res = await POST(post({ jobId: JOB, platform: 'linkedin' }, { origin: 'https://attacker.example' }))
    expect(res.status).toBe(403)
    expect(db.socialPostLog.create).not.toHaveBeenCalled()
  })

  it('refuses an invalid body without a write, and says what is wrong', async () => {
    const res = await POST(post({ jobId: JOB, platform: 'linkedin', postUrl: 'javascript:alert(1)' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/http/)
    expect(db.socialPostLog.create).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON', async () => {
    const res = await POST(post('not json'))
    expect(res.status).toBe(400)
    expect(db.socialPostLog.create).not.toHaveBeenCalled()
  })

  it('refuses a platform the kit does not post to', async () => {
    const res = await POST(post({ jobId: JOB, platform: 'tiktok' }))
    expect(res.status).toBe(400)
    expect(db.socialPostLog.create).not.toHaveBeenCalled()
  })

  it('answers 404 for a job that no longer exists', async () => {
    db.job.findUnique.mockResolvedValue(null)
    const res = await POST(post({ jobId: JOB, platform: 'linkedin' }))
    expect(res.status).toBe(404)
    expect(db.socialPostLog.create).not.toHaveBeenCalled()
  })

  it('logs the post, audits it with ids only, and returns it as the page shows it', async () => {
    db.job.findUnique.mockResolvedValue({ id: JOB })
    db.socialPostLog.create.mockResolvedValue({
      id: 'clog1234567',
      jobId: JOB,
      platform: 'reddit',
      venue: 'r/nursepractitioner',
      postUrl: null,
      postedAt: new Date('2026-11-23T15:00:00.000Z'),
    })

    const res = await POST(post({ jobId: JOB, platform: 'reddit', venue: ' r/nursepractitioner ', postUrl: '' }))
    expect(res.status).toBe(201)
    expect(db.socialPostLog.create.mock.calls[0][0]).toEqual({
      data: { jobId: JOB, platform: 'reddit', venue: 'r/nursepractitioner', postUrl: null },
    })
    expect(await res.json()).toEqual({
      success: true,
      data: { id: 'clog1234567', jobId: JOB, platform: 'reddit', venue: 'r/nursepractitioner', postUrl: null, postedAt: '2026-11-23T15:00:00.000Z' },
    })
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'admin',
      actorId: ADMIN.profileId,
      targetType: 'job',
      targetId: JOB,
      metadata: { logId: 'clog1234567', platform: 'reddit' },
    }))
  })

  it('answers 500 with a message when the write fails', async () => {
    db.job.findUnique.mockResolvedValue({ id: JOB })
    db.socialPostLog.create.mockRejectedValue(new Error('connection reset'))
    const res = await POST(post({ jobId: JOB, platform: 'x' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Could not save/)
    expect(logAudit).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/social-kit/posts', () => {
  it('refuses non-admins', async () => {
    requireApiAdminActor.mockResolvedValue({ error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }), actor: null })
    const res = await DELETE(del('clog1234567'))
    expect(res.status).toBe(401)
    expect(db.socialPostLog.deleteMany).not.toHaveBeenCalled()
  })

  it('refuses a malformed id', async () => {
    const res = await DELETE(del("x' OR 1=1"))
    expect(res.status).toBe(400)
    expect(db.socialPostLog.deleteMany).not.toHaveBeenCalled()
  })

  it('removes a log and audits it', async () => {
    db.socialPostLog.deleteMany.mockResolvedValueOnce({ count: 1 })
    const res = await DELETE(del('clog1234567'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, removed: true })
    expect(db.socialPostLog.deleteMany.mock.calls[0][0]).toEqual({ where: { id: 'clog1234567' } })
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ actorId: ADMIN.profileId, targetId: 'clog1234567' }))
  })

  it('is idempotent: an entry already gone answers 200, says so, and audits nothing', async () => {
    db.socialPostLog.deleteMany.mockResolvedValueOnce({ count: 0 })
    const res = await DELETE(del('clog1234567'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, removed: false })
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('answers 500 with a message when the delete fails', async () => {
    db.socialPostLog.deleteMany.mockRejectedValue(new Error('connection reset'))
    const res = await DELETE(del('clog1234567'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Could not remove/)
  })
})
