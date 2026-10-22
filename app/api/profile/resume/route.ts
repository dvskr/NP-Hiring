import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { toBareResumePath, toOwnResumePath } from '@/lib/resume-storage';
import { removeUnreferencedResumeUploads } from '@/lib/supabase-storage';

/**
 * Register 2.26: the delete removed only the current resume, so every
 * replaced resume and every cover letter no application names stayed in
 * storage for good. Those older than a day go now. A file one of the caller's
 * applications names stays, because the employer opens the file the
 * application names. The current resume is removed even when an application
 * names it, as it always was; DECISION D35 asks whether it should stay too.
 * Never fails the delete.
 * Tests: tests/api/profile-resume-delete-sweep.test.ts
 */
async function removeEarlierUploads(supabaseId: string): Promise<void> {
    try {
        const applications = await prisma.jobApplication.findMany({
            where: { userId: supabaseId },
            select: { resumeUrl: true, coverLetterUrl: true },
        });
        const named = new Set(
            applications
                .flatMap((application) => [application.resumeUrl, application.coverLetterUrl])
                .map((stored) => toOwnResumePath(stored, supabaseId))
                .filter((path): path is string => path !== null),
        );
        const { removed, failed } = await removeUnreferencedResumeUploads(supabaseId, named);
        if (removed > 0 || failed.length > 0) {
            logger.info('Resume delete: swept earlier uploads', { userId: supabaseId, removed, failed });
        }
    } catch (err) {
        logger.error('Resume delete: could not sweep earlier uploads', err, { userId: supabaseId });
    }
}

/**
 * DELETE /api/profile/resume
 * Securely deletes the current user's resume from storage and clears the DB reference.
 * Server-side only — prevents client-side storage access with anon key.
 */
export async function DELETE(request: NextRequest) {
    // Rate limiting — 5 deletions per hour
    const rateLimitResult = await rateLimit(request, 'resume-delete', { limit: 5, windowSeconds: 3600 });
    if (rateLimitResult) return rateLimitResult;

    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get current resume URL from profile
        const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id },
            select: { resumeUrl: true },
        });

        if (!profile?.resumeUrl) {
            return NextResponse.json({ error: 'No resume found' }, { status: 404 });
        }

        // SECURITY (RES-2): the column is writable by its owner, so it can name
        // another user's object, and this service-role remove used to delete
        // whatever it named. Only a key in the caller's own upload folder is
        // removed; the reference is cleared either way. toOwnResumePath also
        // resolves the bare key /api/upload stores, which the old URL-only
        // parser skipped, leaving the file behind.
        // Tests: tests/regressions/resume-ownership-readers.test.ts.
        const storagePath = toOwnResumePath(profile.resumeUrl, user.id);

        if (storagePath) {
            // Use service role key to delete from storage (bypasses RLS)
            const adminClient = createAdminClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!
            );

            const { error: deleteError } = await adminClient.storage
                .from('resumes')
                .remove([storagePath]);

            if (deleteError) {
                logger.error('Failed to delete resume from storage', deleteError);
                // Continue to clear DB reference even if storage deletion fails
            }
        } else {
            logger.warn("Resume delete: stored resume is outside the caller's upload folder, storage left untouched", {
                userId: user.id,
                path: toBareResumePath(profile.resumeUrl) ?? undefined,
            });
        }

        // Clear resume URL from profile
        await prisma.userProfile.update({
            where: { supabaseId: user.id },
            data: {
                resumeUrl: null,
            },
        });

        await removeEarlierUploads(user.id);

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Resume deletion error:', error);
        return NextResponse.json(
            { error: 'Failed to delete resume' },
            { status: 500 }
        );
    }
}
