import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeJobAlert } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { createJobAlert } from '@/lib/job-alerts/create-alert';
import { provesControlOf } from '@/lib/job-alerts/alert-access';

interface CreateAlertBody {
  email: string;
  name?: string;
  keyword?: string;
  location?: string;
  mode?: string;
  jobType?: string;
  minSalary?: number;
  maxSalary?: number;
  frequency?: string;
  newsletterOptIn?: boolean;
  newGradFriendly?: boolean;
  minYearsExperience?: number;
}

/**
 * Experience criteria (P6 #4) — the first WRITE side for the
 * JobAlert.newGradFriendly / minYearsExperience columns. The digest cron
 * (lib/job-alerts-service.ts) has consumed both since Phase 5, but no form
 * or API accepted them, so they were dead columns no user could set.
 *
 * Semantics mirror the /jobs filters exactly:
 *   newGradFriendly     true → only jobs open to new grads (flag OR title
 *                       keywords, minus exclusions — same as /jobs?newGrad=1).
 *   minYearsExperience  N → candidate-qualifies: jobs whose stated minimum is
 *                       ≤ N or unstated (same as /jobs?minYears=N).
 *
 * null = no experience constraint. The cron gates on `=== true` and
 * `typeof === 'number' && >= 0` respectively, so existing alerts (all-null)
 * keep their no-op semantics untouched. `false` is normalized to null below —
 * the schema documents null as "no preference" and the cron treats false and
 * null identically, so storing false would only create a third, meaningless
 * state.
 */
const experienceCriteriaSchema = z.object({
  newGradFriendly: z.boolean().optional(),
  // Integer years, same bounds spirit as the /jobs candidate filter (its live
  // buckets are 1/2/5; the cap only rejects nonsense payloads, not future
  // buckets).
  minYearsExperience: z.number().int().min(0).max(60).optional(),
});

// POST - Create new job alert
export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimitResult = await rateLimit(request, 'jobAlerts', RATE_LIMITS.jobAlerts);
  if (rateLimitResult) return rateLimitResult;

  // Parse JSON on its own so a malformed body is the client's 400, not the
  // catch-all 500 below. A parsed value that is not a plain object (null, an
  // array, a bare string) is equally malformed.
  let body: CreateAlertBody;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json(
        { success: false, error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }
    body = parsed as CreateAlertBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  try {
    // Sanitize inputs
    const sanitized = sanitizeJobAlert(body);
    const { email, name, keyword, location, mode, jobType, minSalary, maxSalary } = sanitized;
    const frequency = sanitized.frequency || 'weekly';

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address' },
        { status: 400 }
      );
    }

    // Validate frequency
    if (frequency && !['daily', 'weekly'].includes(frequency)) {
      return NextResponse.json(
        { success: false, error: 'Frequency must be "daily" or "weekly"' },
        { status: 400 }
      );
    }

    // Validate salary values
    if (minSalary !== undefined && (typeof minSalary !== 'number' || minSalary < 0)) {
      return NextResponse.json(
        { success: false, error: 'Invalid minimum salary' },
        { status: 400 }
      );
    }
    if (maxSalary !== undefined && (typeof maxSalary !== 'number' || maxSalary < 0)) {
      return NextResponse.json(
        { success: false, error: 'Invalid maximum salary' },
        { status: 400 }
      );
    }
    if (minSalary && maxSalary && minSalary > maxSalary) {
      return NextResponse.json(
        { success: false, error: 'Minimum salary cannot be greater than maximum salary' },
        { status: 400 }
      );
    }

    // Experience criteria — validated with zod (see experienceCriteriaSchema
    // above). Read from the raw body: sanitizeJobAlert only passes the legacy
    // string/number fields through, and these two need type validation, not
    // text sanitization.
    const expParsed = experienceCriteriaSchema.safeParse({
      newGradFriendly: body.newGradFriendly,
      minYearsExperience: body.minYearsExperience,
    });
    if (!expParsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid experience criteria' },
        { status: 400 }
      );
    }
    // Normalize: false → null (null = no preference; the cron treats both as
    // no-op, so only `true` is worth storing).
    const newGradFriendly = expParsed.data.newGradFriendly === true ? true : null;
    const minYearsExperience =
      typeof expParsed.data.minYearsExperience === 'number'
        ? expParsed.data.minYearsExperience
        : null;

    const normalizedEmail = email.toLowerCase();

    // The form takes any address, so typing one proves nothing: only a
    // signed-in session on the address may switch email back on for it or
    // change an alert it already has (lib/job-alerts/alert-access.ts).
    const callerOwnsEmail = await provesControlOf(normalizedEmail);
    const result = await createJobAlert({
      email: normalizedEmail,
      name,
      keyword,
      location,
      mode,
      jobType,
      minSalary,
      maxSalary,
      newGradFriendly,
      minYearsExperience,
      frequency,
      // Newsletter consent counts only when the body says exactly true.
      newsletterOptIn: body.newsletterOptIn === true,
      callerOwnsEmail,
    });

    return NextResponse.json({
      success: true,
      // Whether this request stored a new alert (true) or matched an existing
      // alert (false). The status is 200 either way, so the signup surfaces
      // read this field to decide whether to count a GA4 subscribe; without
      // it, a repeat submission of the same criteria (or a second exit-popup
      // signup from one address) books a second conversion against one alert
      // row. Decided inside the creator's locked transaction, so two
      // concurrent submits cannot both say true.
      isNew: result.created,
      // What happened is told to the address's owner only. Anyone else is
      // told to check the inbox, whatever happened: an alert stored for an
      // address that turned our email off, or an existing alert left as it
      // was, would otherwise read as active, and a different answer for each
      // would tell a stranger which it was (lib/job-alerts/alert-result-copy.ts).
      ...(callerOwnsEmail ? { created: result.created, reactivated: result.reactivated } : { checkInbox: true }),
      // SECURITY: no alert id or token here. This route takes no proof that
      // the caller controls the address unless a session shows it, so its
      // answer goes to whoever typed it, and the token is the key to that
      // address's alerts (GET ?token= lists them all with their tokens;
      // PATCH and DELETE accept those). It reaches the inbox only, in each
      // digest's manage and unsubscribe links. A signed-in owner uses
      // /api/job-alerts/by-email.
    });
  } catch (error) {
    logger.error('Error creating job alert', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create job alert' },
      { status: 500 }
    );
  }
}

// GET - Get all alerts for an email (look up email from token)
export async function GET(request: NextRequest) {
  // SECURITY: a valid token lists every alert on its address, each with its
  // own token, and nothing limited how fast tokens could be tried. The
  // bucket is its own (DELETE below shares it), so signups through POST
  // never spend a reader's allowance, at the budget (general) the email
  // unsubscribe and preferences routes give their token POSTs.
  // tests/api/job-alerts-token-hygiene.test.ts
  const rateLimitResult = await rateLimit(request, 'job-alerts-token', RATE_LIMITS.general);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token is required' },
        { status: 400 }
      );
    }

    // First find the alert to get the email
    const jobAlert = await prisma.jobAlert.findUnique({
      where: { token },
    });

    if (!jobAlert) {
      return NextResponse.json(
        { success: false, error: 'Job alert not found' },
        { status: 404 }
      );
    }

    // Now find ALL alerts for this email
    const allAlerts = await prisma.jobAlert.findMany({
      where: { email: jobAlert.email },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      alerts: allAlerts.map(a => ({
        id: a.id,
        token: a.token,
        email: a.email,
        name: a.name,
        keyword: a.keyword,
        location: a.location,
        mode: a.mode,
        jobType: a.jobType,
        minSalary: a.minSalary,
        maxSalary: a.maxSalary,
        newGradFriendly: a.newGradFriendly,
        minYearsExperience: a.minYearsExperience,
        frequency: a.frequency,
        isActive: a.isActive,
        lastSentAt: a.lastSentAt,
        createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    logger.error('Error fetching job alert', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch job alert' },
      { status: 500 }
    );
  }
}

// DELETE - Delete alert by token
export async function DELETE(request: NextRequest) {
  // SECURITY: the same token, answered 404 or 200 the same way, with no
  // limit, so once GET was limited this was the unlimited way to try
  // tokens. It spends GET's bucket: switching methods gives no fresh
  // allowance. The manage and unsubscribe pages send one per click.
  // tests/api/job-alerts-token-hygiene.test.ts
  const rateLimitResult = await rateLimit(request, 'job-alerts-token', RATE_LIMITS.general);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token is required' },
        { status: 400 }
      );
    }

    const jobAlert = await prisma.jobAlert.findUnique({
      where: { token },
    });

    if (!jobAlert) {
      return NextResponse.json(
        { success: false, error: 'Job alert not found' },
        { status: 404 }
      );
    }

    await prisma.jobAlert.delete({
      where: { token },
    });

    return NextResponse.json({
      success: true,
      message: 'Job alert deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting job alert', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete job alert' },
      { status: 500 }
    );
  }
}

