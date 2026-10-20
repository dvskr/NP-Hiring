import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

/** Longest sourceUrl kept, the de facto URL length limit. */
const MAX_SOURCE_URL_LENGTH = 2048

/** Longest jobId accepted: Job.id is a 36-character UUID, and /api/saved-jobs uses the same cap. */
const MAX_JOB_ID_LENGTH = 64

/** A C0 control character or DEL. Postgres rejects NUL in text, so a statement carrying one threw. */
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/

/** The body fields POST and DELETE read; each may be absent or any JSON value. */
interface BodyFields {
    jobId?: unknown
    sourceUrl?: unknown
}

/**
 * The fields of a JSON object body. A body that is not JSON, or is JSON
 * null, threw in the parse or the destructure and answered 500; it reads as
 * no fields, so the handler answers 400 as for a missing jobId.
 * tests/api/applications-route-fields.test.ts
 */
async function readBodyFields(request: NextRequest): Promise<BodyFields> {
    const body: unknown = await request.json().catch(() => null)
    return body !== null && typeof body === 'object' ? (body as BodyFields) : {}
}

/**
 * A jobId worth a query: a non-empty string of at most MAX_JOB_ID_LENGTH
 * characters (a longer one names no job) with no control character. The type
 * was the only check, so a NUL reached Postgres and the handler answered 500.
 * tests/api/applications-route-fields.test.ts
 */
function isJobId(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= MAX_JOB_ID_LENGTH
        && !CONTROL_CHARACTER.test(value)
}

/**
 * The sourceUrl to store: the trimmed string when it is non-empty, at most
 * MAX_SOURCE_URL_LENGTH long and free of control characters, otherwise null
 * (never a cut link). The only legitimate value is the job's apply link
 * (components/ApplyButton.tsx).
 *
 * SECURITY: POST stored `sourceUrl || null`, so a string as large as the
 * request body was written once per job, and a number, an object or a NUL
 * character made the insert throw (a 500).
 * tests/api/applications-route-fields.test.ts
 */
function normalizeSourceUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > MAX_SOURCE_URL_LENGTH) return null
    return CONTROL_CHARACTER.test(trimmed) ? null : trimmed
}

/** The Prisma error code on `error` (P2002 unique, P2003 foreign key), when it has one. */
function prismaErrorCode(error: unknown): string | undefined {
    return (error as { code?: string } | null)?.code
}

/**
 * The user's application row for this job, created once and then kept as it
 * is. Null when no job has this id.
 *
 * Two outcomes threw and answered 500 though neither is a fault. P2002: a
 * concurrent POST for the same job inserted the row after this upsert looked
 * for it; the row exists now, so a second upsert returns it. P2003 for a job
 * id that names no job: the applied-jobs sync posts a visitor's local-only
 * entries again (lib/hooks/useAppliedJobs.ts), a deleted job among them. A
 * P2003 while the job exists is the other foreign key, a user with no profile
 * row, and still throws. tests/api/applications-route-fields.test.ts
 */
async function logApplication(userId: string, jobId: string, sourceUrl: string | null): Promise<{ id: string } | null> {
    // Upsert: don't duplicate if user already applied
    const upsert = () => prisma.jobApplication.upsert({
        where: {
            userId_jobId: { userId, jobId },
        },
        update: {}, // no-op if exists
        create: { userId, jobId, sourceUrl },
    })
    try {
        return await upsert().catch((error: unknown) => {
            if (prismaErrorCode(error) !== 'P2002') throw error
            return upsert()
        })
    } catch (error) {
        if (prismaErrorCode(error) !== 'P2003') throw error
        const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } })
        if (job) throw error
        return null
    }
}

/**
 * POST /api/applications — Log a job application
 * Body: { jobId: string, sourceUrl?: string }
 */
export async function POST(request: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(request, 'applications', RATE_LIMITS.general);
    if (rateLimitResult) return rateLimitResult;

    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { jobId, sourceUrl } = await readBodyFields(request)

        if (!isJobId(jobId)) {
            return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
        }

        const application = await logApplication(user.id, jobId, normalizeSourceUrl(sourceUrl))
        if (!application) {
            return NextResponse.json({ error: 'Job not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true, id: application.id })
    } catch (error) {
        console.error('Error logging application:', error)
        return NextResponse.json({ error: 'Failed to log application' }, { status: 500 })
    }
}

/**
 * DELETE /api/applications — Remove an application row by jobId.
 *
 * Distinct from `/withdraw`: this is for "remove from my history" cases —
 * mistaken click-throughs the user never actually submitted, or stale
 * entries the user wants to prune. Hard-deletes the JobApplication row.
 *
 * Withdrawal (GDPR scrub of an actually-submitted in-platform app) is the
 * `/withdraw` endpoint and keeps the record with status='withdrawn'.
 *
 * Body: { jobId: string }
 */
export async function DELETE(request: NextRequest) {
    // SECURITY: DELETE had no rate limit, so a caller could send deletes
    // without bound. It gets the POST budget in a bucket of its own: Clear
    // history (app/saved/page.tsx) sends one DELETE per entry it clears, the
    // ones with a server row are at most one GET page (take: 50), and the
    // POSTs the applied-jobs sync sends for local-only entries must not spend it.
    // tests/api/applications-route-fields.test.ts
    const rateLimitResult = await rateLimit(request, 'applications-delete', RATE_LIMITS.general);
    if (rateLimitResult) return rateLimitResult;

    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { jobId } = await readBodyFields(request)

        if (!isJobId(jobId)) {
            return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
        }

        await prisma.jobApplication.deleteMany({
            where: { userId: user.id, jobId },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting application:', error)
        return NextResponse.json({ error: 'Failed to delete application' }, { status: 500 })
    }
}

/**
 * GET /api/applications — Fetch user's applications with job details
 */
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // SECURITY: this used `include`, which returns every column, so a
        // candidate could read the employer's private notes (the auto-reject
        // reason among them) and the employer-side AI assessment
        // (aiMatchScore, aiMatchReasons, aiMissingItems). Select only what the
        // candidate's own pages read: app/my-applications/page.tsx, the Clear
        // history partition in app/saved/page.tsx and
        // lib/hooks/useAppliedJobs.ts. A new column stays hidden until it is
        // added here. tests/api/applications-route-fields.test.ts
        const applications = await prisma.jobApplication.findMany({
            where: { userId: user.id },
            orderBy: { appliedAt: 'desc' },
            take: 50,
            select: {
                id: true,
                jobId: true,
                appliedAt: true,
                status: true,
                withdrawnAt: true,
                consentGiven: true,
                coverLetter: true,
                coverLetterUrl: true,
                resumeUrl: true,
                screeningAnswers: true,
                job: {
                    select: {
                        id: true,
                        title: true,
                        slug: true,
                        employer: true,
                        location: true,
                        jobType: true,
                        mode: true,
                        displaySalary: true,
                        isPublished: true,
                    },
                },
            },
        })

        return NextResponse.json(applications)
    } catch (error) {
        console.error('Error fetching applications:', error)
        return NextResponse.json({ error: 'Failed to fetch applications' }, { status: 500 })
    }
}
