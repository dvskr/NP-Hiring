/**
 * POST /api/jobs/search/semantic/event — B80.
 *
 * Records the click/apply ExperimentEvents the semantic-search A/B loop
 * needs to be evaluable. The search route (GET ../) records impressions;
 * this endpoint is the sink for the two conversion events:
 *
 *   { eventType: 'click', jobId }  — user opened a job from the AI result list
 *   { eventType: 'apply', jobId }  — user applied / clicked apply on a job
 *
 * Tenant + arm resolution is shared with the search route via
 * lib/ai/semantic-search-experiment.ts. Callers without an existing
 * experiment assignment (never searched, cookie cleared) get
 * { recorded: false } — the endpoint never buckets new tenants.
 *
 * Always 200 on valid input: event recording is telemetry and must never
 * surface an error into the apply/click flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { recordSemanticSearchEvent } from '@/lib/ai/semantic-search-experiment';

const bodySchema = z.object({
    eventType: z.enum(['click', 'apply']),
    jobId: z.string().min(10).max(64),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
    const rl = await rateLimit(request, 'semantic-experiment-event', RATE_LIMITS.telemetry);
    if (rl) return rl;

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'Invalid event', details: parsed.error.issues },
            { status: 400 }
        );
    }

    const { eventType, jobId } = parsed.data;
    const result = await recordSemanticSearchEvent(eventType, jobId);
    return NextResponse.json(result);
}
