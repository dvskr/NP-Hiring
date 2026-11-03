import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { submitDirectApplication } from '@/lib/applications/submit-direct-application';

/**
 * POST /api/applications/apply-direct
 * Submit an in-platform job application (for jobs with applyOnPlatform=true).
 * Body: { jobId: string, coverLetter?: string, resumeUrl?: string, consent: boolean }
 *
 * The submission itself (validation, the locked upsert, the emails and the
 * AI scoring) is lib/applications/submit-direct-application.ts, shared with
 * the AI app's submit_application tool so both apply the same rules.
 */
export async function POST(request: NextRequest) {
    try {
        // 0. Rate limit (per-IP, 10 req/min)
        const rateLimitResult = await rateLimit(request, 'applyDirect', RATE_LIMITS.applyDirect);
        if (rateLimitResult) return rateLimitResult;

        // 1. Require authentication
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 2. Parse the body; every value is validated by the shared routine
        const body = await request.json();
        const { jobId, coverLetter, coverLetterUrl, resumeUrl, consent, screeningAnswers } = body;

        const outcome = await submitDirectApplication({
            userId: user.id,
            jobId,
            coverLetter,
            coverLetterUrl,
            resumeUrl,
            consent,
            screeningAnswers,
        });

        if (!outcome.ok) {
            return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        }

        return NextResponse.json({
            success: true,
            applicationId: outcome.applicationId,
            // True only when this request created the row; a re-submit of an
            // existing application (including one the candidate withdrew)
            // answers false. See step 5b of the shared routine.
            isNew: outcome.isNew,
            ...(outcome.autoRejected && { autoRejected: true, autoRejectReason: outcome.autoRejectReason }),
        });
    } catch (error) {
        logger.error('Error in apply-direct:', error);
        return NextResponse.json(
            { error: 'Failed to submit application' },
            { status: 500 }
        );
    }
}
