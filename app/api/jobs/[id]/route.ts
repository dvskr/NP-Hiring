import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { isBotUserAgent } from '@/lib/bot-user-agent';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const jobId = resolvedParams.id;

    // Only expose PUBLISHED, non-expired jobs. Without this gate the endpoint
    // returned the full row for unpublished/expired jobs (and counted a view on
    // them), even though the /jobs/<id> page 410s those. Treat anything else as
    // not found.
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        isPublished: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Only count views from real users — filter out bots/crawlers
    const userAgent = request.headers.get('user-agent');
    if (!isBotUserAgent(userAgent)) {
      await Promise.all([
        prisma.job.update({
          where: { id: job.id },
          data: { viewCount: { increment: 1 } },
        }),
        prisma.jobViewEvent.create({
          data: {
            jobId: job.id,
            referrer: request.headers.get('referer') || undefined,
            userAgent: userAgent || undefined,
          },
        }),
      ]);
    }

    return NextResponse.json(job);
  } catch (error) {
    logger.error('Error fetching job:', error);
    return NextResponse.json(
      { error: 'Failed to fetch job' },
      { status: 500 }
    );
  }
}

