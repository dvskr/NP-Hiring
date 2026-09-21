import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  LEAD_SUPPRESSION_SELECT,
  UNDELIVERABLE_MESSAGE,
  parsePreferences,
  resubscribeLead,
  unsubscribeLead,
  type EmailPreferences,
} from '@/app/api/email/_lib/subscription';

// Helper function to mask email (e.g., "s***@email.com")
function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return '***@***.***';

  const maskedLocal = localPart.length > 1
    ? localPart[0] + '***'
    : localPart + '***';

  return `${maskedLocal}@${domain}`;
}

// GET - Get current subscription status
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
      select: {
        email: true,
        isSubscribed: true,
        newsletterOptIn: true,
        preferences: true,
      },
    });

    if (!emailLead) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      email: maskEmail(emailLead.email),
      isSubscribed: emailLead.isSubscribed,
      newsletterOptIn: emailLead.newsletterOptIn,
      preferences: emailLead.preferences,
    });
  } catch (error) {
    logger.error('Error fetching preferences', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch preferences' },
      { status: 500 }
    );
  }
}

// POST - Update subscription status and preferences
export async function POST(request: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(request, 'email-prefs', RATE_LIMITS.general);
    if (rateLimitResult) return rateLimitResult;

  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: 'Token is required' },
        { status: 400 }
      );
    }
    const { token, isSubscribed, newsletterOptIn, preferences } = body as Record<string, unknown>;

    if (typeof token !== 'string' || !token) {
      return NextResponse.json(
        { success: false, message: 'Token is required' },
        { status: 400 }
      );
    }

    // Only a flat object of known boolean keys is accepted; never store an
    // arbitrary client payload in EmailLead.preferences.
    let parsedPreferences: EmailPreferences | undefined;
    if (preferences !== undefined && preferences !== null) {
      const parsed = parsePreferences(preferences);
      if (!parsed) {
        return NextResponse.json(
          { success: false, message: 'Preferences must be an object of known boolean settings.' },
          { status: 400 }
        );
      }
      parsedPreferences = parsed;
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

    // Subscription state changes go through the same suppression-aware writes
    // as the unsubscribe endpoints; flipping isSubscribed alone would leave the
    // send-gates (isEmailSuppressed) out of sync with what the user chose.
    if (isSubscribed === false) {
      await unsubscribeLead(token, emailLead);
    } else if (isSubscribed === true) {
      const lifted = await resubscribeLead(token, emailLead);
      if (!lifted) {
        return NextResponse.json(
          { success: false, message: UNDELIVERABLE_MESSAGE },
          { status: 409 }
        );
      }
    }

    const updateData: {
      newsletterOptIn?: boolean;
      preferences?: EmailPreferences;
    } = {
      ...(typeof newsletterOptIn === 'boolean' ? { newsletterOptIn } : {}),
      ...(parsedPreferences ? { preferences: parsedPreferences } : {}),
    };

    const updatedEmailLead = await prisma.emailLead.update({
      where: { unsubscribeToken: token },
      data: updateData,
      select: {
        email: true,
        isSubscribed: true,
        newsletterOptIn: true,
        preferences: true,
      },
    });

    return NextResponse.json({
      success: true,
      email: maskEmail(updatedEmailLead.email),
      isSubscribed: updatedEmailLead.isSubscribed,
      newsletterOptIn: updatedEmailLead.newsletterOptIn,
      preferences: updatedEmailLead.preferences,
    });
  } catch (error) {
    logger.error('Error updating preferences', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update preferences' },
      { status: 500 }
    );
  }
}

