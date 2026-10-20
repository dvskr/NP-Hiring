import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

/** A saved row's note keeps at most this many characters, as on POST /api/employer/saved-candidates. */
const MAX_NOTE_LENGTH = 2000;
/**
 * The tags of one saved row. The tags API holds an employer to 20 tags, but
 * deleting a tag leaves its name on the rows it was applied to, so a row can
 * carry more names than that through ordinary use.
 */
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 50;

/** A tag list as the Saved tab sends it: at most MAX_TAGS strings of at most MAX_TAG_LENGTH characters. */
function isTagList(value: unknown): value is string[] {
    return Array.isArray(value)
        && value.length <= MAX_TAGS
        && value.every(tag => typeof tag === 'string' && tag.length <= MAX_TAG_LENGTH);
}

/**
 * PATCH /api/employer/saved-candidates/note
 * Update note and/or tags on a saved candidate.
 * Body: { candidateId: string, postingId?: string, note?: string, tags?: string[] }
 */
export async function PATCH(req: NextRequest) {
    // SECURITY (EMP-SAVED-1): only GET of the saved list had a rate limit.
    // Pinned by tests/api/employer-saved-candidates-writes.test.ts.
    const rateLimitResponse = await rateLimit(req, 'employer:saved-candidates:note', RATE_LIMITS.employer);
    if (rateLimitResponse) return rateLimitResponse;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: user.id },
        select: { id: true, role: true },
    });

    if (!profile || !['employer', 'admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // SECURITY (EMP-SAVED-1): the body was read with no catch (a malformed
    // one answered 500) and written as sent, so an object such as
    // `tags: { push: 'x' }` reached Prisma as an update operator, and a note
    // or tag list of any size was stored. Same test file.
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { candidateId, postingId, note, tags } = body as {
        candidateId?: unknown; postingId?: unknown; note?: unknown; tags?: unknown;
    };

    if (!candidateId || typeof candidateId !== 'string') {
        return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
    }
    if (postingId !== undefined && postingId !== null && typeof postingId !== 'string') {
        return NextResponse.json({ error: 'postingId must be a string' }, { status: 400 });
    }
    if (note !== undefined && note !== null && typeof note !== 'string') {
        return NextResponse.json({ error: 'note must be a string' }, { status: 400 });
    }
    if (typeof note === 'string' && note.length > MAX_NOTE_LENGTH) {
        return NextResponse.json({ error: `note must be at most ${MAX_NOTE_LENGTH} characters` }, { status: 400 });
    }
    if (tags !== undefined && !isTagList(tags)) {
        return NextResponse.json({
            error: `tags must be a list of at most ${MAX_TAGS} tags, each at most ${MAX_TAG_LENGTH} characters`,
        }, { status: 400 });
    }

    // SECURITY (EMP-SAVED-1): the candidate was looked up first, so an id
    // that matches no profile answered 'Candidate not found' and a real one
    // 'Candidate not saved', which told the two apart. The saved record is
    // found through its candidate instead, and both answer the same 404.
    // Same test file.
    const saved = await prisma.savedCandidate.findFirst({
        where: {
            employerId: profile.id,
            candidate: { supabaseId: candidateId },
            employerJobId: postingId || null,
        },
    });

    if (!saved) {
        return NextResponse.json({ error: 'Candidate not saved' }, { status: 404 });
    }

    // Build update payload
    const updateData: { note?: string | null; tags?: string[] } = {};
    if (note !== undefined) updateData.note = note || null;
    if (tags !== undefined) updateData.tags = tags;

    const updated = await prisma.savedCandidate.update({
        where: { id: saved.id },
        data: updateData,
    });

    return NextResponse.json({ success: true, note: updated.note, tags: updated.tags });
}
