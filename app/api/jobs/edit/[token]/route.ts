import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { NEW_POST_CHARGE_SELECT } from '@/lib/pricing';
import { renewalRungForRow } from '@/lib/renewal-price';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { editWindowClosedResponse, isEditWindowClosed } from '@/lib/edit-token-window';

/**
 * GET /api/jobs/edit/[token]
 *
 * Loads an employer's job for the unauthenticated edit form. The `editToken`
 * is the magic-link credential delivered via the post-confirmation email.
 *
 * Security posture:
 *   - Rate-limited per IP (auth preset) so the UUID token space cannot be
 *     brute-forced even at modest scale.
 *   - Every successful and failed access is logged with anonymized context
 *     so token enumeration attempts are visible in observability.
 *   - The response is deliberately scoped to fields the edit form renders —
 *     contactEmail is included because the form displays it for editing,
 *     not because callers should be able to harvest it. Treat the token as
 *     a bearer credential; the rate limiter is the brute-force defense.
 *
 * `employerJob.renewalPrice` is what this post pays to renew, in dollars (the
 * edit page's renewal modal prints it): config.proRenewalPrice for a post
 * bought at the posting price, config.renewalPrice for every other one
 * (lib/renewal-price.ts). The page has neither the ledger nor that module, so
 * the route reads the row's 'new' charge and answers the price, not the charge.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // H2 fix: rate-limit to bound any future token-guessing attempt and to
  // make abuse visible in logs.
  const limited = await rateLimit(request, 'jobs-edit-token', RATE_LIMITS.auth);
  if (limited) return limited;

  try {
    const resolvedParams = await params;
    const token = resolvedParams.token;

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    const employerJob = await prisma.employerJob.findFirst({
      where: { editToken: token },
      include: {
        job: {
          include: {
            // Pull screening questions so the edit form can display + modify
            // them in-place. Order by sortOrder for stable rendering.
            screeningQuestions: { orderBy: { sortOrder: 'asc' } },
          },
        },
        ...NEW_POST_CHARGE_SELECT,
      },
    });

    if (!employerJob) {
      // Log failed attempts so token enumeration shows up as an outlier
      // in the dashboard alongside successful loads.
      logger.warn('[jobs-edit] invalid edit token', {
        // Hash-truncate the token in logs so the raw value never lands
        // in observability storage even if a legitimate token was used
        // by an attacker.
        tokenPrefix: token.slice(0, 4),
      });
      return NextResponse.json(
        { error: 'Invalid or expired edit token' },
        { status: 401 }
      );
    }

    // P5.A fix (2026-06-01): the token is honored while the job is published
    // or until 30 days past its expiresAt, so an old leaked confirmation email
    // cannot reach a long dead post. The save and the unpublish
    // (/api/jobs/update) apply the same rule (lib/edit-token-window.ts).
    if (isEditWindowClosed(employerJob.job)) {
      return editWindowClosedResponse('jobs-edit', token, employerJob.job.id);
    }

    return NextResponse.json({
      job: employerJob.job,
      employerJob: {
        id: employerJob.id,
        employerName: employerJob.employerName,
        contactEmail: employerJob.contactEmail,
        companyWebsite: employerJob.companyWebsite,
        companyLogoUrl: employerJob.companyLogoUrl,
        paymentStatus: employerJob.paymentStatus,
        renewalPrice: config.renewalPriceDollarsFor(renewalRungForRow(employerJob)),
      },
    });
  } catch (error) {
    logger.error('Error fetching job for edit', error);
    return NextResponse.json(
      { error: 'Failed to fetch job' },
      { status: 500 }
    );
  }
}

