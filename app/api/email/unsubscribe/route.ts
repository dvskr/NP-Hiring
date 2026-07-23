import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

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

    // Find EmailLead by unsubscribeToken
    const emailLead = await prisma.emailLead.findUnique({
      where: { unsubscribeToken: token },
    });

    if (!emailLead) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 404 }
      );
    }

    // Honor the opt-out everywhere. Every marketing send-gate checks
    // isEmailSuppressed() (EmailLead.isSuppressed / UserProfile.emailSuppressed),
    // NOT isSubscribed — so unsubscribing without setting suppression leaves
    // broadcasts, candidate alerts, saved-job reminders, and digests still
    // sending. Set suppression on the lead and mirror it onto the registered
    // profile (broadcast audiences are built from UserProfile).
    const now = new Date();
    await prisma.$transaction([
      prisma.emailLead.update({
        where: { unsubscribeToken: token },
        data: {
          isSubscribed: false,
          newsletterOptIn: false,
          isSuppressed: true,
          suppressedAt: now,
          suppressionReason: 'unsubscribe',
        },
      }),
      prisma.userProfile.updateMany({
        where: { email: emailLead.email },
        data: { emailSuppressed: true, emailSuppressedAt: now },
      }),
    ]);

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
    // Rate limiting
    const rateLimitResult = await rateLimit(request, 'email-unsub', RATE_LIMITS.general);
    if (rateLimitResult) return rateLimitResult;

  try {
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Token is required' },
        { status: 400 }
      );
    }

    // Find EmailLead by unsubscribeToken
    const emailLead = await prisma.emailLead.findUnique({
      where: { unsubscribeToken: token },
    });

    if (!emailLead) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 404 }
      );
    }

    // Re-enable sending. Only lift suppression when it came from an explicit
    // unsubscribe — never resurrect an address suppressed by a hard bounce or
    // spam complaint (those keep isSuppressed set with a different reason).
    const clearSuppression = emailLead.suppressionReason === 'unsubscribe';
    await prisma.$transaction([
      prisma.emailLead.update({
        where: { unsubscribeToken: token },
        data: {
          isSubscribed: true,
          ...(clearSuppression
            ? { isSuppressed: false, suppressedAt: null, suppressionReason: null }
            : {}),
        },
      }),
      ...(clearSuppression
        ? [
            prisma.userProfile.updateMany({
              where: { email: emailLead.email },
              data: { emailSuppressed: false, emailSuppressedAt: null },
            }),
          ]
        : []),
    ]);

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

