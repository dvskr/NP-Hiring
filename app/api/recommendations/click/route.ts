import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/recommendations/click  (audit B14/B88)
 *
 * Engagement write-side of the recommendation feedback loop. The reader
 * already existed on both ends — recommendations.ts boosts employers the
 * candidate clicked through to (clickedAt) and the dashboard/API filter out
 * dismissed rows (dismissedAt) — but NOTHING ever wrote either column, so
 * the loop was dead code. The dashboard "For you" cards call this endpoint
 * (fire-and-forget) on click-through and on explicit dismiss.
 *
 * Body: { jobId: string, action?: 'click' | 'dismiss' }   (default 'click')
 *
 * updateMany scopes strictly to the caller's own recommendation rows —
 * a user can never mutate another candidate's engagement signals. Jobs the
 * cron never recommended to this user simply match 0 rows (harmless no-op
 * for the rule-based fallback recommendations, which have no rows).
 */

const clickRequestSchema = z.object({
    jobId: z.string().min(1).max(64),
    action: z.enum(['click', 'dismiss']).catch('click'),
});

export async function POST(request: NextRequest) {
    const rateLimitResult = await rateLimit(request, 'recommendations-click', RATE_LIMITS.general);
    if (rateLimitResult) return rateLimitResult;

    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        const parsed = clickRequestSchema.safeParse(body ?? {});
        if (!parsed.success) {
            return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
        }
        const { jobId, action } = parsed.data;

        // Stamp every not-yet-stamped recommendation row for this
        // (candidate, job) pair. First engagement wins — re-clicks don't
        // move the timestamp, so the ranking boost reflects first interest.
        const result = action === 'dismiss'
            ? await prisma.candidateRecommendation.updateMany({
                where: { supabaseId: user.id, jobId, dismissedAt: null },
                data: { dismissedAt: new Date() },
            })
            : await prisma.candidateRecommendation.updateMany({
                where: { supabaseId: user.id, jobId, clickedAt: null },
                data: { clickedAt: new Date() },
            });

        return NextResponse.json({ success: true, action, updated: result.count });
    } catch (error) {
        logger.error('Error recording recommendation engagement', error);
        return NextResponse.json({ error: 'Failed to record engagement' }, { status: 500 });
    }
}
