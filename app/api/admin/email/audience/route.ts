import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { BROADCAST_SEGMENTS, isBroadcastSegment } from '@/lib/admin/broadcast-audience';
import { buildSegmentRecipients } from '@/lib/admin/broadcast-recipients';
import { logger } from '@/lib/logger';

const SAMPLE_SIZE = 5;

/**
 * GET /api/admin/email/audience?segment=all|job_seekers|employers|subscribers|newsletter
 * Returns the count and a sample of the people the given segment reaches.
 *
 * The list comes from buildSegmentRecipients, the builder the send route
 * uses, so the count shown before sending is the number of recipient rows
 * the send creates. Automatic mailing list entries that never asked for mail,
 * hand unsubscribes and suppressed addresses are left out of both.
 */
export async function GET(req: Request) {
    const authError = await requireApiAdmin(req);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const segment = searchParams.get('segment') || 'all';
    if (!isBroadcastSegment(segment)) {
        return NextResponse.json(
            { success: false, error: `segment must be one of: ${BROADCAST_SEGMENTS.join(', ')}` },
            { status: 400 },
        );
    }

    try {
        const recipients = await buildSegmentRecipients(segment);
        return NextResponse.json({
            success: true,
            segment,
            count: recipients.length,
            sample: recipients.slice(0, SAMPLE_SIZE),
        });
    } catch (error) {
        logger.error('[Admin Email Audience] Error', error, { segment });
        return NextResponse.json({ success: false, error: 'Failed to get audience' }, { status: 500 });
    }
}
