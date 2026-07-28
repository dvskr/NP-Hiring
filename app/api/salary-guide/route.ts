import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { buildSalaryGuideHtml, sendAndLog, isEmailSuppressed } from '@/lib/email-service';
import { rateLimit } from '@/lib/rate-limit';
import { brand } from '@/config/brand';
import { SALARY_GUIDE_PDF_AVAILABLE } from './pdf-availability';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

// Environment-aware PDF URL — env override first, then this board's own
// asset from config/brand.ts (audit P0 #6: the previous fallback pointed
// at the donor board's branded PDF asset).
const PDF_URL = process.env.SALARY_GUIDE_URL || brand.assets.salaryGuidePdf;

export async function POST(request: NextRequest) {
  try {
    // Audit P0 #6: while the PDF deliverable does not exist, refuse before
    // capturing the lead or sending an email with a dead link. The UI hides
    // the form behind the same flag; this guards direct POSTs too.
    if (!SALARY_GUIDE_PDF_AVAILABLE) {
      logger.warn('Salary guide request refused — PDF deliverable not yet available');
      return NextResponse.json(
        { success: false, error: 'The salary guide PDF is not yet available. All salary data is free at /salary-guide.' },
        { status: 503 }
      );
    }

    // Rate limiting — 5 req/min (sends emails, must be strict)
    const rateLimitResult = await rateLimit(request, 'salary-guide', { limit: 5, windowSeconds: 60 });
    if (rateLimitResult) return rateLimitResult;

    const body = await request.json();
    const { email } = body;

    logger.info('Salary guide request received', { email });

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { success: false, error: 'Valid email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Suppression check before any DB writes — a suppressed user shouldn't even
    // re-create an EmailLead row from this entry point.
    if (await isEmailSuppressed(normalizedEmail)) {
      logger.info('Salary guide skipped — email suppressed', { email: normalizedEmail });
      return NextResponse.json({ success: true, suppressed: true });
    }

    // Upsert the lead. Use the existing token if there is one so the unsubscribe
    // link in the email matches what the user already has on file.
    const existing = await prisma.emailLead.findUnique({
      where: { email: normalizedEmail },
      select: { unsubscribeToken: true },
    });
    const unsubscribeToken = existing?.unsubscribeToken ?? randomUUID();

    await prisma.emailLead.upsert({
      where: { email: normalizedEmail },
      update: {
        updatedAt: new Date(),
        // Preserve original source, don't overwrite it
      },
      create: {
        email: normalizedEmail,
        source: 'salary-guide',
        isSubscribed: true,
        unsubscribeToken,
        preferences: { salaryGuide: true },
      },
    });

    const currentYear = new Date().getFullYear();
    logger.info('Lead saved to database', { email: normalizedEmail });

    await sendAndLog({
      from: '', // overridden by sendAndLog (marketing sender — salary_guide is in MARKETING_EMAIL_TYPES)
      to: normalizedEmail,
      subject: `Your ${currentYear} ${brand.niche.short} Salary Guide is Ready`,
      html: buildSalaryGuideHtml(PDF_URL, unsubscribeToken),
    }, 'salary_guide', { year: currentYear }, `${BASE_URL}/unsubscribe?token=${unsubscribeToken}`);

    logger.info('Salary guide email sent successfully', { email: normalizedEmail });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error sending salary guide', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send salary guide' },
      { status: 500 }
    );
  }
}
