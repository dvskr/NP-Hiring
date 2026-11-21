import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isBotUserAgent } from '@/lib/bot-user-agent';
import { PUBLISHED_LISTING_WHERE } from '@/lib/pseo/listing-where';

/**
 * Counts one view of a job page (employer dashboards read it as "views").
 *
 * Posted by the visitor's browser from JobViewTracker when the job page
 * mounts. The count used to be written by the page render itself, but the
 * page is cached for a day (ISR), so that write ran once per cache refresh,
 * mostly for crawlers, and spent two pool connections on each one
 * (2026-11-21). Counting here records real visitors: crawlers rarely run the
 * script, and known bot user agents are dropped as on GET /api/jobs/[id].
 *
 * Stores the job id only, as the render did. No referrer or user agent, so
 * no analytics consent is needed (compare track-apply).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await rateLimit(request, 'track-view', RATE_LIMITS.telemetry);
  if (rateLimitResult) return rateLimitResult;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ success: false, error: 'Job ID is required' }, { status: 400 });
  }

  if (isBotUserAgent(request.headers.get('user-agent'))) {
    return NextResponse.json({ success: true, counted: false });
  }

  try {
    // Only a live listing counts, by the same predicate the page renders on.
    const { count } = await prisma.job.updateMany({
      where: { id, ...PUBLISHED_LISTING_WHERE },
      data: { viewCount: { increment: 1 } },
    });
    if (count === 0) {
      return NextResponse.json({ success: false, reason: 'job_not_found' });
    }
    await prisma.jobViewEvent.create({ data: { jobId: id } });
    return NextResponse.json({ success: true, counted: true });
  } catch (error) {
    // Report the failure in the body, as track-apply does: the page never
    // waits on this response.
    logger.error('Error tracking job view', error, { jobId: id });
    return NextResponse.json({ success: false, reason: 'persist_failed' });
  }
}
