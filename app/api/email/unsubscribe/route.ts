import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  LEAD_SUPPRESSION_SELECT,
  UNDELIVERABLE_MESSAGE,
  resubscribeLead,
  unsubscribeLead,
} from '@/app/api/email/_lib/subscription';

// GET - Unsubscribe
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Token is required' },
        { status: 400 }
      );
    }

    const emailLead = await prisma.emailLead.findUnique({
      where: { unsubscribeToken: token },
      select: LEAD_SUPPRESSION_SELECT,
    });

    if (!emailLead) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 404 }
      );
    }

    // Honor the opt-out everywhere: every marketing send-gate checks
    // isEmailSuppressed(), not isSubscribed. See _lib/subscription.ts.
    await unsubscribeLead(token, emailLead);

    return NextResponse.json({
      success: true,
      message: 'Unsubscribed successfully',
    });
  } catch (error) {
    logger.error('Error unsubscribing:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to unsubscribe' },
      { status: 500 }
    );
  }
}

// POST - Resubscribe
export async function POST(request: NextRequest) {
  const rateLimitResult = await rateLimit(request, 'email-unsub', RATE_LIMITS.general);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body: unknown = await request.json().catch(() => null);
    const token = body && typeof body === 'object' ? (body as { token?: unknown }).token : undefined;

    if (typeof token !== 'string' || !token) {
      return NextResponse.json(
        { success: false, message: 'Token is required' },
        { status: 400 }
      );
    }

    const emailLead = await prisma.emailLead.findUnique({
      where: { unsubscribeToken: token },
      select: LEAD_SUPPRESSION_SELECT,
    });

    if (!emailLead) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 404 }
      );
    }

    // Lifts unsubscribe suppression only; bounce/complaint stays suppressed.
    const lifted = await resubscribeLead(token, emailLead);
    if (!lifted) {
      return NextResponse.json(
        { success: false, message: UNDELIVERABLE_MESSAGE },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Resubscribed successfully',
    });
  } catch (error) {
    logger.error('Error resubscribing:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to resubscribe' },
      { status: 500 }
    );
  }
}
