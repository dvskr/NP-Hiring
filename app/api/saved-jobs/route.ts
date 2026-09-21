import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const MAX_JOB_ID_LENGTH = 64

/** Parse and validate { jobId } from the body; null when absent or malformed. */
async function readJobId(request: NextRequest): Promise<string | null> {
    let body: unknown
    try {
        body = await request.json()
    } catch {
        return null
    }
    if (!body || typeof body !== 'object') return null
    const jobId = (body as { jobId?: unknown }).jobId
    if (typeof jobId !== 'string') return null
    const trimmed = jobId.trim()
    if (!trimmed || trimmed.length > MAX_JOB_ID_LENGTH) return null
    return trimmed
}

// GET: List saved jobs for current user
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const savedJobs = await prisma.savedJob.findMany({
            where: { userId: user.id },
            orderBy: { savedAt: 'desc' },
        })

        return NextResponse.json({ savedJobs })
    } catch (error) {
        console.error('Error fetching saved jobs:', error)
        return NextResponse.json({ error: 'Failed to fetch saved jobs' }, { status: 500 })
    }
}

// POST: Save a job
export async function POST(request: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(request, 'saved-jobs', RATE_LIMITS.general);
    if (rateLimitResult) return rateLimitResult;

    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const jobId = await readJobId(request)
        if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

        // Only a real, published job can be saved: an arbitrary id would
        // otherwise create an orphan row (or surface a raw FK error).
        const job = await prisma.job.findFirst({
            where: { id: jobId, isPublished: true },
            select: { id: true },
        })
        if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

        const savedJob = await prisma.savedJob.upsert({
            where: { userId_jobId: { userId: user.id, jobId } },
            create: { userId: user.id, jobId },
            update: {},  // no-op if already exists
        })

        return NextResponse.json({ savedJob })
    } catch (error) {
        console.error('Error saving job:', error)
        return NextResponse.json({ error: 'Failed to save job' }, { status: 500 })
    }
}

// DELETE: Unsave a job
export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const jobId = await readJobId(request)
        if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

        await prisma.savedJob.deleteMany({
            where: { userId: user.id, jobId },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error unsaving job:', error)
        return NextResponse.json({ error: 'Failed to unsave job' }, { status: 500 })
    }
}
