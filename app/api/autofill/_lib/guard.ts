/**
 * Shared route guards for the autofill AI endpoints.
 *
 *   - `checkAutofillAiFeature` — feature-flag kill switch (audit F31). Every
 *     autofill AI route calls this before any DB or model work so
 *     KILL_AI_CANDIDATE_AUTOFILL_* env flips (or admin DB overrides) stop the
 *     feature within the flag cache TTL (~1 minute).
 *   - `aiGatewayErrorResponse` — maps AiGatewayError codes from
 *     lib/ai/gateway `complete()` onto the HTTP statuses the extension
 *     already understands (429 rate-limit, 503 unconfigured, 502 provider
 *     failure).
 */

import { NextResponse } from 'next/server';
import { isAiFeatureEnabled, type AiFeatureFlag } from '@/lib/ai/feature-flags';
import { AiGatewayError } from '@/lib/ai/types';

/**
 * Returns a 503 response when the flag is off for this candidate, or null
 * when the route may proceed.
 */
export async function checkAutofillAiFeature(
    flag: AiFeatureFlag,
    userId: string,
): Promise<NextResponse | null> {
    const enabled = await isAiFeatureEnabled(flag, { type: 'candidate', id: userId });
    if (enabled) return null;
    return NextResponse.json(
        { error: 'This AI feature is temporarily unavailable.', code: 'feature_disabled' },
        { status: 503 },
    );
}

/** Maps a gateway error to the route's HTTP response. */
export function aiGatewayErrorResponse(err: AiGatewayError, label: string): NextResponse {
    if (err.code === 'rate_limited') {
        return NextResponse.json(
            { error: `${label} rate limit exceeded — please try again shortly.` },
            { status: 429 },
        );
    }
    if (err.code === 'provider_not_configured') {
        return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });
    }
    return NextResponse.json({ error: `${label} failed — please try again.` }, { status: 502 });
}
